/**
 * "BANAO!! DONO!" — admin, 2026-09-22, on the two gaps left after the ₹50 credit shipped.
 *
 * 🔴 THE FIRST WARNING A USER EVER GOT ARRIVED AT THE WALL. `notifyLowBalance(uid, blocked)` has
 * shipped since 2026-07-26 with a `blocked: false` branch reading *"Your balance is running low"*,
 * and **nothing in this repo ever called it with `false`** — while its own docblock claimed it fired
 * "from the affordability gate (economy or block branch)". The economy branch called nothing.
 *
 * 🔴 AND THE ONE CALL THAT EXISTED WAS UNBOUNDED: a push on EVERY refused build, so five presses
 * were five pushes — the exact noise the admin ended in September, reproduced in a subsystem the
 * monitor's fix never touched.
 *
 * ⚠️ HALF OF THIS IS SOURCE-LEVEL. `tsc` and `vitest` cannot see that a notification is sent from a
 * branch that never runs, nor that a cooldown was skipped — which is how both shipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideBalanceAlert, observeHealthyBalance, balanceAlertTunables,
  BALANCE_ALERT_DEFAULTS, HOUR_MS, type BalanceAlertState,
} from '../src/server/lib/balanceAlertPolicy';
import { balanceAlertMessage } from '../src/server/lib/balanceAlert';
import { NOTIFICATION_ACTIONS, readNotificationAction } from '../src/server/lib/AdminNotificationStore';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const T = BALANCE_ALERT_DEFAULTS;
const at = (h: number) => 1_700_000_000_000 + h * HOUR_MS;

describe('the admin budget, verbatim: one notice, two at most, the second 48 h later', () => {
  it('a user nothing has been said to is told at once', () => {
    const d = decideBalanceAlert({ kind: 'low', state: {}, now: at(0) });
    expect(d.send).toBe(true);
    expect(d.reason).toBe('first-of-episode');
    expect(d.next).toEqual({ lastAlertAt: at(0), sentThisEpisode: 1, lastKind: 'low' });
  });

  it('a second build an hour later says NOTHING — that is the five-pushes bug', () => {
    const state: BalanceAlertState = { lastAlertAt: at(0), sentThisEpisode: 1, lastKind: 'low' };
    expect(decideBalanceAlert({ kind: 'low', state, now: at(1) })).toMatchObject({ send: false, reason: 'cooldown' });
    // …and still nothing at 47 h.
    expect(decideBalanceAlert({ kind: 'low', state, now: at(47) })).toMatchObject({ send: false, reason: 'cooldown' });
  });

  it('the SECOND notice lands after 48 h, and is the last one', () => {
    const first: BalanceAlertState = { lastAlertAt: at(0), sentThisEpisode: 1, lastKind: 'low' };
    const second = decideBalanceAlert({ kind: 'low', state: first, now: at(48) });
    expect(second.send).toBe(true);
    expect(second.next?.sentThisEpisode).toBe(2);
    // A third is refused however long anyone waits — "maximum 2" is a cap, not a rate.
    const after = second.next as BalanceAlertState;
    expect(decideBalanceAlert({ kind: 'low', state: after, now: at(1000) }))
      .toMatchObject({ send: false, reason: 'budget-spent' });
  });

  it('🔒 AN ESCALATION SPENDS THE SECOND SLOT — it is not exempt', () => {
    // The admin's own rule: an exemption is how a cap quietly becomes a suggestion.
    const state: BalanceAlertState = { lastAlertAt: at(0), sentThisEpisode: 1, lastKind: 'low' };
    // Inside the cooldown even the wall stays quiet.
    expect(decideBalanceAlert({ kind: 'blocked', state, now: at(2) })).toMatchObject({ send: false, reason: 'cooldown' });
    const esc = decideBalanceAlert({ kind: 'blocked', state, now: at(48) });
    expect(esc.send).toBe(true);
    expect(esc.reason).toBe('escalated');
    expect(esc.next?.sentThisEpisode).toBe(2); // spent, not free
  });

  it('🔴 AND A SPENT BUDGET SILENCES THE WALL ITSELF — found by reversion, not by reasoning', () => {
    // The first draft of this suite proved an escalation COSTS a slot and never that it is REFUSED
    // once the slots are gone. Exempting `blocked` from the cap passed every case above — which is
    // the whole shape of "a cap quietly becomes a suggestion", and it survived a review that had
    // just written that sentence down.
    const spent: BalanceAlertState = { lastAlertAt: at(0), sentThisEpisode: 2, lastKind: 'low' };
    expect(decideBalanceAlert({ kind: 'blocked', state: spent, now: at(100) }))
      .toMatchObject({ send: false, reason: 'budget-spent' });
    expect(decideBalanceAlert({ kind: 'blocked', state: spent, now: at(10_000) }))
      .toMatchObject({ send: false, reason: 'budget-spent' });
  });
});

describe('🔒 an episode ends on a COOLING period, never on one healthy reading', () => {
  const spent: BalanceAlertState = { lastAlertAt: at(0), sentThisEpisode: 2, lastKind: 'blocked' };

  it('a healthy reading starts a clock rather than clearing the record', () => {
    const next = observeHealthyBalance(spent, at(10));
    expect(next).toMatchObject({ sentThisEpisode: 2, healthySince: at(10) });
  });

  it('a wobble back into shortage inside the cooling window is the SAME episode', () => {
    const cooling = observeHealthyBalance(spent, at(10)) as BalanceAlertState;
    // 1 hour of healthy, cooling is 2 — still the same episode, still silent.
    expect(decideBalanceAlert({ kind: 'low', state: cooling, now: at(11) }))
      .toMatchObject({ send: false, reason: 'budget-spent' });
  });

  it('once the cooling window completes, a genuinely new shortage may speak at once', () => {
    const cooling = observeHealthyBalance(spent, at(10)) as BalanceAlertState;
    expect(decideBalanceAlert({ kind: 'low', state: cooling, now: at(13) }))
      .toMatchObject({ send: true, reason: 'first-of-episode' });
  });

  it('the clock is not restarted by later healthy readings', () => {
    const first = observeHealthyBalance(spent, at(10)) as BalanceAlertState;
    // Restarting it on every healthy build would mean an episode that never ends.
    expect(observeHealthyBalance(first, at(11))).toBe(first);
  });
});

describe('🔒 it fails CLOSED', () => {
  it('an unreadable record sends nothing', () => {
    expect(decideBalanceAlert({ kind: 'blocked', state: null, now: at(0) }))
      .toMatchObject({ send: false, reason: 'unknown-state' });
  });

  it('and a hold never writes state', () => {
    const state: BalanceAlertState = { lastAlertAt: at(0), sentThisEpisode: 1, lastKind: 'low' };
    expect(decideBalanceAlert({ kind: 'low', state, now: at(1) }).next).toBeUndefined();
    expect(decideBalanceAlert({ kind: 'low', state: null, now: at(1) }).next).toBeUndefined();
  });
});

describe('the tunables take the DEFAULT on anything unreadable, never "no limit"', () => {
  it('reads real values', () => {
    const t = balanceAlertTunables({ BALANCE_ALERT_COOLDOWN_HOURS: '24', BALANCE_ALERT_MAX_PER_EPISODE: '3' } as NodeJS.ProcessEnv);
    expect(t.cooldownMs).toBe(24 * HOUR_MS);
    expect(t.maxPerEpisode).toBe(3);
  });

  it('a blank, junk, zero or negative value falls back — the unbounded direction is the bug', () => {
    for (const raw of ['', '   ', 'soon', '0', '-5', 'NaN']) {
      const t = balanceAlertTunables({ BALANCE_ALERT_COOLDOWN_HOURS: raw, BALANCE_ALERT_MAX_PER_EPISODE: raw } as NodeJS.ProcessEnv);
      expect(t.cooldownMs, `"${raw}"`).toBe(T.cooldownMs);
      expect(t.maxPerEpisode, `"${raw}"`).toBe(T.maxPerEpisode);
    }
    expect(balanceAlertTunables({} as NodeJS.ProcessEnv)).toEqual(T);
  });
});

describe('what the user reads', () => {
  it('the LOW notice says the build still ran — that is the whole difference from the wall', () => {
    const low = balanceAlertMessage('low');
    expect(low).toMatch(/running low/i);
    expect(low).toMatch(/still ran/i);
    expect(low).toMatch(/add credit/i);
  });

  it('the BLOCKED notice does not frighten anyone about work they already have', () => {
    const blocked = balanceAlertMessage('blocked');
    expect(blocked).toMatch(/finished|paused/i);
    expect(blocked).toMatch(/nothing you have already made is affected/i);
  });

  it('🔒 white-label — neither names an engine', () => {
    const both = `${balanceAlertMessage('low')} ${balanceAlertMessage('blocked')}`.toLowerCase();
    for (const v of ['glm', 'kimi', 'claude', 'gemini', 'grok', 'openai', 'nemotron']) {
      expect(both).not.toContain(v);
    }
  });
});

describe('it is TAPPABLE, through a name and never a URL', () => {
  it('open-billing is in the closed set', () => {
    expect(NOTIFICATION_ACTIONS).toContain('open-billing');
    expect(readNotificationAction('open-billing')).toBe('open-billing');
    // A stored URL would make the notification table an open redirect.
    expect(readNotificationAction('https://evil.example')).toBeUndefined();
    expect(readNotificationAction('open-anything')).toBeUndefined();
  });

  it('the client resolves it through the app’s existing navigation channel', () => {
    const bell = src('src/components/NotificationBell.tsx');
    expect(bell).toContain("n.action === 'open-billing'");
    expect(bell).toContain("detail: { view: 'billing' }");
  });
});

describe('🔒 source guards — the branch that never ran', () => {
  const route = src('src/server/routes/agentv3.ts');

  it('🔴 the ECONOMY branch warns — this is the call that did not exist', () => {
    expect(route).toContain("void warnAboutBalance(userId, email, 'low');");
  });

  it('the BLOCK branch goes through the same bounded door, not a raw push', () => {
    expect(route).toContain("void warnAboutBalance(userId, email, 'blocked');");
    // The unbounded call is gone: five refused builds were five pushes.
    expect(route).not.toContain('notifyLowBalance(userId, true)');
    expect(route).not.toContain('notifyLowBalance');
  });

  it('a healthy build ends the episode, or nothing ever would', () => {
    expect(route).toContain('void balanceLooksHealthy(userId);');
  });

  it('the store claims the slot inside a TRANSACTION — "at most 2" must be true by construction', () => {
    const store = src('src/server/lib/balanceAlertStore.ts');
    // Many Cloud Run instances: a read-then-write lets two builds both decide to send.
    expect(store).toContain('db.runTransaction(');
    expect(store).toContain('decideBalanceAlert({ kind, state, now');
    // Unreadable ⇒ no send. Returning a send here would be unbounded noise on every build.
    expect(store.match(/reason: 'unknown-state'/g) ?? []).toHaveLength(3);
  });

  it('the inbox comes FIRST, because a push reaches almost nobody on the website', () => {
    const door = src('src/server/lib/balanceAlert.ts');
    const inbox = door.indexOf('saveNotification(');
    const push = door.indexOf('notifyLowBalance(');
    expect(inbox).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(inbox);
    expect(door).toContain("action: 'open-billing'");
  });
});

/**
 * The referral-code window as pure arithmetic (admin 2026-09-30: "3 bar app open hone ke bad band",
 * "30 min wala theek hai", "7 din baad apne aap band ho jaye", "b"). The wired routes are driven in
 * referralRoutes.test.ts; this file pins the rule itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { buildChecklist, pendingRupees, shouldShowChecklist } from '../src/lib/referralChecklist';
import { rewardsChecklistModel } from '../src/lib/rewardsChecklist';
import {
  CODE_WINDOW_OPENS, OPEN_GAP_MS, CODE_WINDOW_DAYS,
  accountCreatedAt, codeWindow, countAppOpen, readAppOpenState, codeWindowClosedMessage,
} from '../src/server/lib/referralCodeWindow';

const T0 = Date.parse('2026-10-01T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('the numbers the admin chose', () => {
  it('three opens, thirty minutes, seven days', () => {
    expect(CODE_WINDOW_OPENS).toBe(3);
    expect(OPEN_GAP_MS).toBe(30 * 60 * 1000);
    expect(CODE_WINDOW_DAYS).toBe(7);
  });
});

describe('countAppOpen', () => {
  it('counts the first open', () => {
    const r = countAppOpen({ appOpens: 0, lastAppOpenAt: null }, T0);
    expect(r).toEqual({ counted: true, next: { appOpens: 1, lastAppOpenAt: new Date(T0).toISOString() } });
  });

  it('folds everything inside thirty minutes of the last COUNTED open into it', () => {
    let s = countAppOpen({ appOpens: 0, lastAppOpenAt: null }, T0).next;
    for (const m of [1, 10, 29]) {
      const r = countAppOpen(s, T0 + m * 60_000);
      expect(r.counted).toBe(false);
      s = r.next;
    }
    expect(s.appOpens).toBe(1);
    expect(countAppOpen(s, T0 + OPEN_GAP_MS).counted).toBe(true);
  });

  it('a clock that runs backwards spends nothing', () => {
    const s = countAppOpen({ appOpens: 0, lastAppOpenAt: null }, T0).next;
    expect(countAppOpen(s, T0 - 60 * 60_000).counted).toBe(false);
  });

  it('stops counting once the window has closed — no write for a closed window', () => {
    const s = { appOpens: 4, lastAppOpenAt: new Date(T0).toISOString() };
    expect(countAppOpen(s, T0 + DAY)).toEqual({ next: s, counted: false });
  });
});

describe('codeWindow', () => {
  const young = new Date(T0 - 60_000).toISOString();
  it('open through the third open, closed on the fourth', () => {
    expect(codeWindow({ appOpens: 1, accountCreatedAt: young, nowMs: T0 })).toEqual({ open: true, opensLeft: 2 });
    expect(codeWindow({ appOpens: 3, accountCreatedAt: young, nowMs: T0 })).toEqual({ open: true, opensLeft: 0 });
    expect(codeWindow({ appOpens: 4, accountCreatedAt: young, nowMs: T0 })).toEqual({ open: false, closedBy: 'opens' });
  });

  it('closed at seven days of age, however few opens', () => {
    const created = new Date(T0).toISOString();
    expect(codeWindow({ appOpens: 1, accountCreatedAt: created, nowMs: T0 + 7 * DAY - 1 }).open).toBe(true);
    expect(codeWindow({ appOpens: 1, accountCreatedAt: created, nowMs: T0 + 7 * DAY })).toEqual({ open: false, closedBy: 'age' });
  });

  it('an unreadable creation time leaves the opens rule to decide — a failed lookup never refuses a new person', () => {
    expect(codeWindow({ appOpens: 0, accountCreatedAt: null, nowMs: T0 }).open).toBe(true);
    expect(codeWindow({ appOpens: 0, accountCreatedAt: 'not a date', nowMs: T0 }).open).toBe(true);
  });
});

describe('accountCreatedAt', () => {
  it('takes the EARLIEST readable time — falling back can only keep a window open longer', () => {
    const a = '2026-09-01T00:00:00.000Z';
    const b = '2026-09-20T00:00:00.000Z';
    expect(accountCreatedAt(b, a)).toBe(a);
    expect(accountCreatedAt(null, b)).toBe(b);
    expect(accountCreatedAt(undefined, 'junk')).toBeNull();
  });
});

describe('readAppOpenState', () => {
  it('reads anything unreadable as never opened', () => {
    expect(readAppOpenState(undefined)).toEqual({ appOpens: 0, lastAppOpenAt: null });
    expect(readAppOpenState({ appOpens: '-3', lastAppOpenAt: 'x' })).toEqual({ appOpens: 0, lastAppOpenAt: null });
    expect(readAppOpenState({ appOpens: 2.7, lastAppOpenAt: '2026-10-01T10:00:00Z' }).appOpens).toBe(2);
  });
});

describe('the refusal', () => {
  it('says why, and does not imply the account is in trouble', () => {
    const m = codeWindowClosedMessage();
    expect(m).toMatch(/first 3 app opens or first 7 days/);
    expect(m).toMatch(/still earns every other bonus/);
  });
});

// ── The client half: a missed row is ❌, never money still waiting ─────────────────────────────────

const serverRows = [
  { step: 'signup', claimed: true, rupees: 50 },
  { step: 'referral-code', claimed: false, rupees: 100, missed: true },
  { step: 'email', claimed: true, rupees: 50 },
  { step: 'mobile', claimed: false, rupees: 100 },
  { step: 'github', claimed: false, rupees: 100 },
];

describe('the checklist rows', () => {
  it('reads the server’s missed flag and says so in words', () => {
    const row = buildChecklist(serverRows).find((r) => r.step === 'referral-code')!;
    expect(row.missed).toBe(true);
    expect(row.label).toBe('Referral code window closed — ₹100 missed');
  });

  it('a missed row is never counted as waiting — ₹300 becomes ₹200', () => {
    expect(pendingRupees(buildChecklist(serverRows))).toBe(200);
  });

  it('only an explicit true is missed, and never on a claimed row', () => {
    const rows = buildChecklist([
      { step: 'referral-code', claimed: true, rupees: 100, missed: true },
      { step: 'github', claimed: false, rupees: 100, missed: 'yes' },
    ]);
    expect(rows.every((r) => r.missed === false)).toBe(true);
  });

  it('a checklist whose only open row is missed stops waiting for the user', () => {
    const rows = buildChecklist([
      { step: 'signup', claimed: true, rupees: 50 },
      { step: 'referral-code', claimed: false, rupees: 100, missed: true },
    ]);
    expect(shouldShowChecklist(rows, 'android')).toBe(false);
  });
});

describe('the notification card', () => {
  const base = {
    enabled: true, surface: 'android' as const, emailVerified: true, phoneVerified: false,
    githubLinked: false, referred: false, webCapRupees: null,
  };
  it('❌ the missed row has its own state, no button, and is left out of the headline', () => {
    const m = rewardsChecklistModel({ ...base, rows: buildChecklist(serverRows) })!;
    const row = m.rows.find((r) => r.step === 'referral-code')!;
    expect(row.state).toBe('missed');
    expect(row.hint).toMatch(/Missed/);
    expect(m.pendingRupees).toBe(200);
    expect(m.headline).toBe('₹200 free credit waiting for you');
  });

  it('with everything else claimed, it does not claim "all rewards claimed"', () => {
    const rows = buildChecklist([
      { step: 'signup', claimed: true, rupees: 50 },
      { step: 'referral-code', claimed: false, rupees: 100, missed: true },
      { step: 'email', claimed: true, rupees: 50 },
    ]);
    const m = rewardsChecklistModel({ ...base, rows })!;
    expect(m.allDone).toBe(true);
    expect(m.headline).toBe('₹100 earned — nothing left to claim');
  });
});

describe('the wiring', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('the app asks for missed rows — an older build that does not ask never sees one', () => {
    expect(src('src/hooks/useReferralProgress.ts')).toMatch(/\?platform=\$\{surface\}&missed=1/);
  });
  it('coming back to the app asks again, so a phone that never cold-starts is still counted', () => {
    const app = src('src/App.tsx');
    expect(app).toMatch(/useRefreshReferralOnResume\(referralProgress\.refresh, Boolean\(user\?\.uid\)\)/);
  });
  it('both surfaces draw the missed state without a button', () => {
    expect(src('src/components/RewardsChecklistCard.tsx')).toMatch(/row\.state === 'missed'/);
    expect(src('src/components/panels/ReferralPanel.tsx')).toMatch(/row\.missed && !row\.claimed/);
  });
});

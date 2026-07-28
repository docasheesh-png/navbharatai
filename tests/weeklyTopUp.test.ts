import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  decideWeeklyTopUp, weeklyTopUpTokens, freeCreditCapTokens, topUpLedgerEntry,
} from '../src/server/lib/weeklyTopUp';
import { welcomeBonusTokens, TOKENS_PER_RUPEE } from '../src/server/lib/payments';

// The free tier is now ONE wallet: ₹250 at signup, ₹200 a week after that, never stacking past ₹750.
// This is a giveaway, so every branch below is a cost decision — a bug here is money out of the door,
// not a broken screen.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const T0 = Date.parse('2026-07-01T00:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.WEEKLY_TOPUP_TOKENS;
  delete process.env.WALLET_FREE_CAP_TOKENS;
  delete process.env.WELCOME_BONUS_TOKENS;
});
afterEach(() => { process.env = { ...saved }; });

describe('the amounts the admin asked for', () => {
  it('₹250 at signup, ₹200 a week, capped at ₹750', () => {
    expect(welcomeBonusTokens()).toBe(250 * TOKENS_PER_RUPEE);
    expect(weeklyTopUpTokens()).toBe(200 * TOKENS_PER_RUPEE);
    expect(freeCreditCapTokens()).toBe(750 * TOKENS_PER_RUPEE);
  });

  it('every amount is retunable from Cloud Run without a deploy', () => {
    process.env.WELCOME_BONUS_TOKENS = '10000';
    process.env.WEEKLY_TOPUP_TOKENS = '5000';
    process.env.WALLET_FREE_CAP_TOKENS = '30000';
    expect(welcomeBonusTokens()).toBe(10_000);
    expect(weeklyTopUpTokens()).toBe(5_000);
    expect(freeCreditCapTokens()).toBe(30_000);
  });

  it('WEEKLY_TOPUP_TOKENS=0 switches the weekly credit off entirely', () => {
    process.env.WEEKLY_TOPUP_TOKENS = '0';
    const d = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: iso(T0 - 10 * WEEK), now: T0 });
    expect(d.reason).toBe('disabled');
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBeNull(); // nothing written at all
  });
});

describe('the week has to have actually passed', () => {
  it('grants nothing before seven days', () => {
    const d = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: iso(T0 - 6 * DAY), now: T0 });
    expect(d.reason).toBe('too-soon');
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBeNull(); // do not move the anchor, or the week never completes
  });

  it('grants on the seventh day', () => {
    const d = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: iso(T0 - WEEK), now: T0 });
    expect(d.reason).toBe('granted');
    expect(d.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });

  it('being away for five weeks does NOT return five weeks of credit', () => {
    // One week per visit. Otherwise disappearing pays better than showing up, which is backwards for a
    // retention mechanic — and it is the expensive reading of "₹200 weekly".
    const d = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: iso(T0 - 5 * WEEK), now: T0 });
    expect(d.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
  });
});

describe('the ₹750 ceiling', () => {
  it('tops up only into the space left below the cap', () => {
    // ₹600 held → only ₹150 of room, not the full ₹200.
    const d = decideWeeklyTopUp({ tokenBalance: 600 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0 - WEEK), now: T0 });
    expect(d.grantTokens).toBe(150 * TOKENS_PER_RUPEE);
    expect(d.reason).toBe('granted');
  });

  it('grants nothing at the ceiling, but still counts the week', () => {
    const d = decideWeeklyTopUp({ tokenBalance: 750 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0 - WEEK), now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.reason).toBe('at-cap');
    // The anchor MUST move: otherwise a user parked at the cap banks an instant grant the moment they
    // spend a single rupee.
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });

  it('a paying customer receives no free weekly credit — the gift is for free users', () => {
    const d = decideWeeklyTopUp({ tokenBalance: 5000 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0 - WEEK), now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.reason).toBe('at-cap');
  });

  it('the free credit can never take a balance past the ceiling', () => {
    for (const held of [0, 100, 400, 550, 700, 749, 750]) {
      const d = decideWeeklyTopUp({ tokenBalance: held * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0 - WEEK), now: T0 });
      expect(held * TOKENS_PER_RUPEE + d.grantTokens, `held ₹${held}`).toBeLessThanOrEqual(750 * TOKENS_PER_RUPEE);
    }
  });
});

describe('wallets that existed before this shipped', () => {
  it('anchors on createdAt, so an old account waits out its week like everyone else', () => {
    const fresh = decideWeeklyTopUp({ tokenBalance: 0, createdAt: iso(T0 - 2 * DAY), now: T0 });
    expect(fresh.reason).toBe('too-soon');
    const old = decideWeeklyTopUp({ tokenBalance: 0, createdAt: iso(T0 - 3 * WEEK), now: T0 });
    expect(old.reason).toBe('granted');
  });

  it('with no timestamp at all it starts the clock instead of guessing', () => {
    const d = decideWeeklyTopUp({ tokenBalance: 0, now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });

  it('an unparseable timestamp is treated the same way — never as "grant now"', () => {
    const d = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: 'last tuesday', now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });
});

describe('a broken balance never becomes free money', () => {
  it('treats rubbish and negatives as zero held, and still respects the cap', () => {
    for (const bad of [undefined, null, NaN, 'lots', {}, -5000]) {
      const d = decideWeeklyTopUp({ tokenBalance: bad as unknown, lastTopUpAt: iso(T0 - WEEK), now: T0 });
      expect(d.grantTokens, String(bad)).toBe(200 * TOKENS_PER_RUPEE);
    }
  });
});

describe('the user can see where the credit came from', () => {
  it('writes an honest ledger row naming the amount in rupees', () => {
    const e = topUpLedgerEntry(200 * TOKENS_PER_RUPEE, iso(T0)) as Record<string, unknown>;
    expect(e.moneySpent).toBe(0);
    expect(String(e.description)).toContain('Weekly free credit');
    expect(String(e.description)).toContain('200');
    expect(e.timestamp).toBe(iso(T0));
  });
});

describe('a user cannot farm credit by changing their device clock', () => {
  // The whole decision is computed from values only the SERVER controls: `now` (the Cloud Run clock,
  // passed as Date.now() at the single call site) and the anchor read out of Firestore, which is only
  // ever written server-side. Nothing the browser or phone sends reaches this function, so moving the
  // device date forward a year changes nothing.

  it('the same stored anchor always yields the same answer, whatever a device believes the time is', () => {
    const anchor = iso(T0 - 2 * DAY);
    // Whatever a tampered device might claim, the server's own clock is what is passed in.
    const serverSaysTooSoon = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: anchor, now: T0 });
    expect(serverSaysTooSoon.reason).toBe('too-soon');
    expect(serverSaysTooSoon.grantTokens).toBe(0);
  });

  it('re-reading the wallet again and again inside the same week grants nothing extra', () => {
    // A user hammering refresh (or a script doing it) gets one grant, then nothing until the week is up.
    let anchor = iso(T0 - WEEK);
    const first = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: anchor, now: T0 });
    expect(first.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
    anchor = first.newLastTopUpAt!;

    for (const minutesLater of [1, 60, 60 * 24, 60 * 24 * 6]) {
      const again = decideWeeklyTopUp({ tokenBalance: 200 * TOKENS_PER_RUPEE, lastTopUpAt: anchor, now: T0 + minutesLater * 60_000 });
      expect(again.grantTokens, `${minutesLater}m later`).toBe(0);
      expect(again.newLastTopUpAt, `${minutesLater}m later`).toBeNull();
    }
  });

  it('an anchor in the FUTURE grants nothing — a bad write can never mint credit', () => {
    // Defence in depth: if a clock skew or a bad migration ever stored a future timestamp, the elapsed
    // time is negative, which must read as "too soon", never as "many weeks owed".
    const d = decideWeeklyTopUp({ tokenBalance: 0, lastTopUpAt: iso(T0 + 10 * WEEK), now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.reason).toBe('too-soon');
  });
});

describe('the running cost of the giveaway, stated in the tests so it cannot be forgotten', () => {
  it('a fully-spending free user costs about ₹50 of real provider spend a week', () => {
    // Builds bill at ~4x real cost, so ₹200 of credit ≈ ₹50 of real spend. Over a year that is ~₹2,600
    // per continuously-active free account — which is why the top-up is lazy (dormant accounts accrue
    // nothing) and why WEEKLY_TOPUP_TOKENS is a single env knob that can be cut instantly.
    const weeklyBilledInr = weeklyTopUpTokens() / TOKENS_PER_RUPEE;
    expect(weeklyBilledInr).toBe(200);
    expect(weeklyBilledInr / 4).toBe(50);
  });
});

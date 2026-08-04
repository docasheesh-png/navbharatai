import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  decideWeeklyTopUp, weeklyTopUpTokens, lifetimeGiftCapTokens, topUpLedgerEntry, summarizeGiftLadder,
} from '../src/server/lib/weeklyTopUp';
import { welcomeBonusTokens, TOKENS_PER_RUPEE } from '../src/server/lib/payments';

// The free tier's gift ladder: ₹250 at signup → +₹200 → +₹200 → CUT OFF, permanently. ₹650 EVER, not
// ₹650 a month and not ₹650 held at once.
//
// The single most expensive mistake available here is capping on the BALANCE instead of on the total
// ever gifted: that reads almost the same and turns a ₹650 one-off into ₹200 a week forever (~₹2,600 of
// billed credit per active account per year). The tests below exist mainly to keep that from happening.

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
  it('₹250 at signup, ₹200 a rung, ₹650 for life', () => {
    expect(welcomeBonusTokens()).toBe(250 * TOKENS_PER_RUPEE);
    expect(weeklyTopUpTokens()).toBe(200 * TOKENS_PER_RUPEE);
    expect(lifetimeGiftCapTokens()).toBe(650 * TOKENS_PER_RUPEE);
  });

  it('the lifetime cap is exactly the signup grant plus two rungs', () => {
    // 250 + 200 + 200 = 650. Stated as arithmetic so the three numbers can never drift apart.
    expect(welcomeBonusTokens() + 2 * weeklyTopUpTokens()).toBe(lifetimeGiftCapTokens());
  });

  it('every amount is retunable from Cloud Run without a deploy', () => {
    process.env.WELCOME_BONUS_TOKENS = '10000';
    process.env.WEEKLY_TOPUP_TOKENS = '5000';
    process.env.WALLET_FREE_CAP_TOKENS = '30000';
    expect(welcomeBonusTokens()).toBe(10_000);
    expect(weeklyTopUpTokens()).toBe(5_000);
    expect(lifetimeGiftCapTokens()).toBe(30_000);
  });

  it('WEEKLY_TOPUP_TOKENS=0 switches the weekly credit off entirely', () => {
    process.env.WEEKLY_TOPUP_TOKENS = '0';
    const d = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: iso(T0 - 10 * WEEK), now: T0 });
    expect(d.reason).toBe('disabled');
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBeNull(); // nothing written at all
  });
});

describe('the week has to have actually passed', () => {
  it('grants nothing before seven days', () => {
    const d = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: iso(T0 - 6 * DAY), now: T0 });
    expect(d.reason).toBe('too-soon');
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBeNull(); // do not move the anchor, or the week never completes
  });

  it('grants on the seventh day', () => {
    const d = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: iso(T0 - WEEK), now: T0 });
    expect(d.reason).toBe('granted');
    expect(d.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });

  it('being away for five weeks does NOT return five weeks of credit', () => {
    // One week per visit. Otherwise disappearing pays better than showing up, which is backwards for a
    // retention mechanic — and it is the expensive reading of "₹200 weekly".
    const d = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: iso(T0 - 5 * WEEK), now: T0 });
    expect(d.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
  });
});

describe('the ladder ends after two rungs — this is a ONE-TIME gift', () => {
  const week = (given: number) => decideWeeklyTopUp({ giftedSoFar: given, lastTopUpAt: iso(T0 - WEEK), now: T0 });

  it('walks ₹250 → ₹450 → ₹650 → nothing, ever again', () => {
    const r1 = week(250 * TOKENS_PER_RUPEE);
    expect(r1.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
    expect(r1.exhausted).toBe(false);

    const r2 = week(450 * TOKENS_PER_RUPEE);
    expect(r2.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
    expect(r2.exhausted).toBe(true); // this rung completes the gift

    const r3 = week(650 * TOKENS_PER_RUPEE);
    expect(r3.grantTokens).toBe(0);
    expect(r3.reason).toBe('exhausted');
  });

  it('SPENDING the balance does NOT re-open the ladder — the cap counts what was GIVEN', () => {
    // This is the whole cost model. A user who received all ₹650 and spent every rupee of it is
    // finished; if this ever measured the balance instead, they would draw ₹200 a week forever.
    const brokeButFullyGifted = decideWeeklyTopUp({
      giftedSoFar: 650 * TOKENS_PER_RUPEE,
      lastTopUpAt: iso(T0 - 52 * WEEK),
      now: T0,
    });
    expect(brokeButFullyGifted.grantTokens).toBe(0);
    expect(brokeButFullyGifted.reason).toBe('exhausted');
    expect(brokeButFullyGifted.exhausted).toBe(true);
  });

  it('an exhausted account writes NOTHING at all, not even the anchor', () => {
    const d = week(650 * TOKENS_PER_RUPEE);
    expect(d.newLastTopUpAt).toBeNull();
  });

  it('a final rung is trimmed to whatever is left of the ₹650, never rounded up', () => {
    // ₹500 already gifted → only ₹150 remains, not a full ₹200.
    const d = week(500 * TOKENS_PER_RUPEE);
    expect(d.grantTokens).toBe(150 * TOKENS_PER_RUPEE);
    expect(d.exhausted).toBe(true);
  });

  it('the total ever gifted can never exceed ₹650', () => {
    for (const given of [0, 100, 250, 449, 450, 600, 649, 650, 5000]) {
      const d = week(given * TOKENS_PER_RUPEE);
      const total = given * TOKENS_PER_RUPEE + d.grantTokens;
      expect(total, `gifted ₹${given}`).toBeLessThanOrEqual(Math.max(650 * TOKENS_PER_RUPEE, given * TOKENS_PER_RUPEE));
    }
  });

  it('a paying customer is judged on their GIFT total, not their purchased balance', () => {
    // Someone who bought ₹5,000 of credit but has only had the ₹250 signup gift still gets their rungs
    // — the ladder is about what we gave, not what they own.
    const d = week(250 * TOKENS_PER_RUPEE);
    expect(d.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
  });
});

describe('wallets that existed before this shipped', () => {
  it('anchors on createdAt, so an old account waits out its week like everyone else', () => {
    const fresh = decideWeeklyTopUp({ giftedSoFar: 0, createdAt: iso(T0 - 2 * DAY), now: T0 });
    expect(fresh.reason).toBe('too-soon');
    const old = decideWeeklyTopUp({ giftedSoFar: 0, createdAt: iso(T0 - 3 * WEEK), now: T0 });
    expect(old.reason).toBe('granted');
  });

  it('with no timestamp at all it starts the clock instead of guessing', () => {
    const d = decideWeeklyTopUp({ giftedSoFar: 0, now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });

  it('an unparseable timestamp is treated the same way — never as "grant now"', () => {
    const d = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: 'last tuesday', now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.newLastTopUpAt).toBe(iso(T0));
  });
});

describe('a broken gift total never becomes free money', () => {
  it('treats rubbish and negatives as "nothing gifted yet", and still respects the cap', () => {
    for (const bad of [undefined, null, NaN, 'lots', {}, -5000]) {
      const d = decideWeeklyTopUp({ giftedSoFar: bad as unknown, lastTopUpAt: iso(T0 - WEEK), now: T0 });
      expect(d.grantTokens, String(bad)).toBe(200 * TOKENS_PER_RUPEE);
      expect(d.exhausted, String(bad)).toBe(false);
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
    const serverSaysTooSoon = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: anchor, now: T0 });
    expect(serverSaysTooSoon.reason).toBe('too-soon');
    expect(serverSaysTooSoon.grantTokens).toBe(0);
  });

  it('re-reading the wallet again and again inside the same week grants nothing extra', () => {
    // A user hammering refresh (or a script doing it) gets one grant, then nothing until the week is up.
    let anchor = iso(T0 - WEEK);
    const first = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: anchor, now: T0 });
    expect(first.grantTokens).toBe(200 * TOKENS_PER_RUPEE);
    anchor = first.newLastTopUpAt!;

    for (const minutesLater of [1, 60, 60 * 24, 60 * 24 * 6]) {
      const again = decideWeeklyTopUp({ giftedSoFar: 200 * TOKENS_PER_RUPEE, lastTopUpAt: anchor, now: T0 + minutesLater * 60_000 });
      expect(again.grantTokens, `${minutesLater}m later`).toBe(0);
      expect(again.newLastTopUpAt, `${minutesLater}m later`).toBeNull();
    }
  });

  it('an anchor in the FUTURE grants nothing — a bad write can never mint credit', () => {
    // Defence in depth: if a clock skew or a bad migration ever stored a future timestamp, the elapsed
    // time is negative, which must read as "too soon", never as "many weeks owed".
    const d = decideWeeklyTopUp({ giftedSoFar: 0, lastTopUpAt: iso(T0 + 10 * WEEK), now: T0 });
    expect(d.grantTokens).toBe(0);
    expect(d.reason).toBe('too-soon');
  });
});

describe('the running cost of the giveaway, stated in the tests so it cannot be forgotten', () => {
  it('the whole lifetime gift is ₹650 billed ≈ ₹163 of real provider spend, ONCE per account', () => {
    // Builds bill at ~4x real cost. Because the ladder ends, this is the TOTAL exposure per account for
    // as long as it exists — not a recurring figure. The ongoing-stipend reading of the same numbers
    // would have been ~₹2,600 billed per active account per YEAR.
    const lifetimeBilledInr = lifetimeGiftCapTokens() / TOKENS_PER_RUPEE;
    expect(lifetimeBilledInr).toBe(650);
    expect(Math.round(lifetimeBilledInr / 4)).toBe(163); // 650 / 4 = 162.5
  });
});

// ── The ladder, made visible ──────────────────────────────────────────────────
// The grant used to be invisible: credit appeared, a ledger row was written that no screen rendered,
// and nothing said how much was left or when the next one arrived. `summarizeGiftLadder` is what the
// wallet screen reads — and it is derived from the SAME inputs as the grant, so what is displayed can
// never disagree with what is actually given.

describe('summarizeGiftLadder — what the user is shown', () => {
  it('reports progress along the one-time gift, not a balance', () => {
    const s = summarizeGiftLadder({ giftedSoFar: 450 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0), now: T0 });
    expect(s.giftedTokens).toBe(450 * TOKENS_PER_RUPEE);
    expect(s.capTokens).toBe(650 * TOKENS_PER_RUPEE);
    expect(s.remainingTokens).toBe(200 * TOKENS_PER_RUPEE);
    expect(s.exhausted).toBe(false);
  });

  it('says when the next rung lands — a week after the last one', () => {
    const s = summarizeGiftLadder({ giftedSoFar: 250 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0), now: T0 });
    expect(s.nextCreditAt).toBe(iso(T0 + WEEK));
  });

  it('a rung that is already DUE reads as "now", never as a date in the past', () => {
    // It lands on the very next wallet read, so telling the user it was due last Tuesday would be wrong.
    const s = summarizeGiftLadder({ giftedSoFar: 250 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0 - 3 * WEEK), now: T0 });
    expect(s.nextCreditAt).toBe(iso(T0));
  });

  it('an exhausted ladder has no next date at all', () => {
    const s = summarizeGiftLadder({ giftedSoFar: 650 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0), now: T0 });
    expect(s.exhausted).toBe(true);
    expect(s.remainingTokens).toBe(0);
    expect(s.nextCreditAt).toBeNull();
  });

  it('never shows more than the cap, even if the stored total somehow exceeds it', () => {
    const s = summarizeGiftLadder({ giftedSoFar: 99_999 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0), now: T0 });
    expect(s.giftedTokens).toBe(s.capTokens);
    expect(s.remainingTokens).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it('promises no next credit when the ladder is switched off', () => {
    process.env.WEEKLY_TOPUP_TOKENS = '0';
    const s = summarizeGiftLadder({ giftedSoFar: 250 * TOKENS_PER_RUPEE, lastTopUpAt: iso(T0), now: T0 });
    expect(s.nextCreditAt).toBeNull();
  });

  it('agrees with the grant: whatever it says is remaining is what the rungs actually deliver', () => {
    // The display and the decision must never drift. Walk the whole ladder and check the sum.
    let gifted = 250 * TOKENS_PER_RUPEE;
    const promised = summarizeGiftLadder({ giftedSoFar: gifted, lastTopUpAt: iso(T0), now: T0 }).remainingTokens;
    let delivered = 0;
    for (let i = 0; i < 10; i++) {
      const d = decideWeeklyTopUp({ giftedSoFar: gifted, lastTopUpAt: iso(T0 - WEEK), now: T0 });
      if (d.grantTokens <= 0) break;
      delivered += d.grantTokens;
      gifted += d.grantTokens;
    }
    expect(delivered).toBe(promised);
  });
});

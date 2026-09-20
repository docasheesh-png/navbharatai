import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideBackfill, backfillTokens, backfillEnabled, backfillMarkerId, backfillRupees,
  backfillLedgerDescription, emptyTally, tally, BACKFILL_RUPEES, backfillSince, openedInGap,
  RETIREMENT_ISO,
} from '../src/server/lib/welcomeBackfill';
import { MAX_SELF_GIFT_TOKENS } from '../src/server/lib/giftPolicy';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';

/**
 * 🔴 NOBODY IS PAID THE WELCOME BONUS TWICE.
 *
 * The backfill exists because a real gap left real accounts at ₹0: `flatWelcomeGiftAllowed()` has
 * returned a hardcoded `false` since 2026-09-17 and `REFERRAL_REWARDS` was never set, so the plan that
 * was meant to pay instead never did.
 *
 * What this pins is the OTHER direction. A sweep that credits every wallet is one press away from
 * paying somebody their second welcome bonus, and the evidence for "they already had one" is spread
 * across three differently-shaped signals written at three different times in this project's life.
 * Every one of them must refuse on its own.
 */

const WELCOME_TOKENS = BACKFILL_RUPEES * TOKENS_PER_RUPEE;
// Opened INSIDE the gap — after the retirement. Without this every case below would read `too-old`,
// which is the point of the narrowing and is asserted on its own further down.
const IN_GAP = '2026-09-18T10:00:00.000Z';
const fresh = { freeGiftedTokens: 0, walletLedger: [] as unknown[], createdAt: IN_GAP };
const env = {} as NodeJS.ProcessEnv;

const decide = (over: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
  decideBackfill({ wallet: { ...fresh, ...over }, welcomeMarker: false, backfillMarker: false, env, ...opts });

describe('an account that has never been gifted is owed ₹250', () => {
  it('pays exactly ₹250', () => {
    const d = decide();
    expect(d.reason).toBe('owed');
    expect(d.tokens).toBe(WELCOME_TOKENS);
    expect(backfillRupees(d.tokens)).toBe(250);
  });

  it('is owed even with a long ledger, as long as none of it is a welcome bonus', () => {
    const ledger = Array.from({ length: 40 }, (_, i) => ({ type: 'purchase', description: `Top-up ${i}` }));
    expect(decide({ walletLedger: ledger }).reason).toBe('owed');
  });

  it('is owed even when the account has spent everything and sits at zero', () => {
    expect(decide({ tokenBalance: 0, remaining_balance: 0 }).reason).toBe('owed');
  });
});

describe('🔴 each of the three "already gifted" signals refuses ON ITS OWN', () => {
  it('1 — the durable welcome marker', () => {
    // Written in the same transaction as every grant since 2026-07-12, in a separate collection so it
    // survives a wallet doc being recreated. The strongest signal there is.
    const d = decideBackfill({ wallet: fresh, welcomeMarker: true, backfillMarker: false, env });
    expect(d).toEqual({ tokens: 0, reason: 'already-welcomed' });
  });

  it('2 — the wallet ledger row buildInitialWallet writes', () => {
    // Covers accounts gifted BEFORE the marker existed, which the marker alone cannot see.
    const d = decide({ walletLedger: [{ type: 'purchase', description: 'Welcome Bonus: 25,000 AI Tokens Credited!' }] });
    expect(d).toEqual({ tokens: 0, reason: 'already-welcomed' });
  });

  it('3 — the lifetime gift total', () => {
    // Covers an account whose welcome row has rolled off the bounded ledger but whose running total
    // still remembers it.
    expect(decide({ freeGiftedTokens: 1 }).reason).toBe('already-welcomed');
    expect(decide({ freeGiftedTokens: WELCOME_TOKENS }).reason).toBe('already-welcomed');
  });

  it('🔒 and the ledger match is not fooled by wording or case', () => {
    for (const description of ['welcome bonus credited', 'WELCOME BONUS: ₹250', 'Your Welcome Bonus']) {
      expect(decide({ walletLedger: [{ description }] }).reason, description).toBe('already-welcomed');
    }
  });
});

describe('🔒 the backfill pays each account at most once', () => {
  it('refuses an account this sweep has already paid', () => {
    const d = decideBackfill({ wallet: fresh, welcomeMarker: false, backfillMarker: true, env });
    expect(d).toEqual({ tokens: 0, reason: 'already-backfilled' });
  });

  it('checks its own marker BEFORE anything about the wallet', () => {
    // A paid account must read as paid even if its wallet has since been altered or lost — the marker
    // is the only signal this feature itself writes, so it cannot depend on wallet state to be true.
    const d = decideBackfill({ wallet: null, welcomeMarker: false, backfillMarker: true, env });
    expect(d.reason).toBe('already-backfilled');
  });

  it('gives every account a distinct marker id, in the payments collection', () => {
    expect(backfillMarkerId('abc')).toBe('welcome_backfill_abc');
    expect(backfillMarkerId('abc')).not.toBe(backfillMarkerId('abd'));
    // Must never collide with the welcome marker, or a backfill would read as a welcome bonus.
    expect(backfillMarkerId('abc')).not.toBe('welcome_abc');
  });
});

describe('the ₹400 lifetime ceiling is the admin’s own ruling and still applies', () => {
  it('never lets a console value raise the ceiling', () => {
    // "Ek paisa jyada nahi" has to be enforced against the total, not assumed from the parts.
    const huge = backfillTokens({ WELCOME_BACKFILL_TOKENS: '99999999' } as NodeJS.ProcessEnv);
    expect(huge).toBeLessThanOrEqual(MAX_SELF_GIFT_TOKENS);
  });

  it('falls back to ₹250 on a malformed or empty value, never to zero and never to more', () => {
    for (const raw of ['', '   ', 'abc', '-5', '0', undefined]) {
      expect(backfillTokens({ WELCOME_BACKFILL_TOKENS: raw } as NodeJS.ProcessEnv), String(raw)).toBe(WELCOME_TOKENS);
    }
  });

  it('honours a smaller deliberate value', () => {
    expect(backfillTokens({ WELCOME_BACKFILL_TOKENS: '10000' } as NodeJS.ProcessEnv)).toBe(10_000);
  });
});

describe('the off switch', () => {
  it('is ON when unset — the admin asked for this button today', () => {
    // Deliberately the opposite default from most money flags here: a button that needs a Cloud Run
    // key before it does anything is a button that does nothing, which the second absolute rule forbids.
    expect(backfillEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(decide({}, { env: {} }).reason).toBe('owed');
  });

  it('stops every grant when set off', () => {
    const off = { WELCOME_BACKFILL: 'off' } as NodeJS.ProcessEnv;
    expect(backfillEnabled(off)).toBe(false);
    expect(decideBackfill({ wallet: fresh, welcomeMarker: false, backfillMarker: false, env: off }))
      .toEqual({ tokens: 0, reason: 'disabled' });
  });
});

describe('an account with no wallet is never invented', () => {
  it('reports no-wallet rather than creating one', () => {
    expect(decideBackfill({ wallet: null, welcomeMarker: false, backfillMarker: false, env }))
      .toEqual({ tokens: 0, reason: 'no-wallet' });
  });
});

describe('the admin’s counts are the sum of real decisions', () => {
  it('tallies each reason into its own bucket', () => {
    let t = emptyTally();
    t = tally(t, { tokens: WELCOME_TOKENS, reason: 'owed' });
    t = tally(t, { tokens: WELCOME_TOKENS, reason: 'owed' });
    t = tally(t, { tokens: 0, reason: 'already-welcomed' });
    t = tally(t, { tokens: 0, reason: 'already-backfilled' });
    t = tally(t, { tokens: 0, reason: 'no-room' });
    t = tally(t, { tokens: 0, reason: 'no-wallet' });
    t = tally(t, { tokens: 0, reason: 'too-old' });
    expect(t).toEqual({
      scanned: 7, owed: 2, owedTokens: 2 * WELCOME_TOKENS,
      alreadyWelcomed: 1, alreadyBackfilled: 1, noRoom: 1, noWallet: 1, tooOld: 1,
    });
  });

  it('the rupee total the admin reads is the token total', () => {
    expect(backfillRupees(2 * WELCOME_TOKENS)).toBe(500);
  });
});

describe('what the user sees in their own statement', () => {
  it('reads as a welcome bonus in rupees, naming no internal machinery', () => {
    const line = backfillLedgerDescription(WELCOME_TOKENS);
    expect(line).toContain('₹250');
    expect(line.toLowerCase()).toContain('welcome bonus');
    for (const leak of ['backfill', 'admin', 'sweep', 'token']) {
      expect(line.toLowerCase(), leak).not.toContain(leak);
    }
  });
});


describe('🔴 only accounts opened in the GAP — the admin’s own signal', () => {
  // *"old walo ka 00 nahi hoga, ya + me kuch hoga ya -ve ne. aap new user kar do, jinko bonus nhi mila"*
  //
  // An account that predates the retirement was GIVEN its bonus and has been living with it. One
  // opened inside the gap was handed nothing. That is a fact we store, not a guess from a ledger.

  it('pays an account opened after the retirement', () => {
    expect(decide({ createdAt: '2026-09-18T00:00:00.000Z' }).reason).toBe('owed');
  });

  it('leaves an account opened BEFORE the retirement alone, however empty it looks', () => {
    const d = decide({ createdAt: '2026-09-01T00:00:00.000Z', tokenBalance: 0, remaining_balance: 0 });
    expect(d).toEqual({ tokens: 0, reason: 'too-old' });
  });

  it('leaves a very old account alone even with an empty ledger and no gift total', () => {
    // The exact shape that used to be the residual risk: a welcome row rolled off a bounded ledger.
    // It is now excluded by DATE, before any of that reasoning is reached.
    const d = decide({ createdAt: '2026-05-04T00:00:00.000Z', walletLedger: [], freeGiftedTokens: 0 });
    expect(d.reason).toBe('too-old');
  });

  it('🔒 a wallet with NO createdAt is treated as OLD, never as new', () => {
    // Unknown ⇒ excluded. Skipping someone costs a message; including them wrongly costs money twice.
    const noDate = { freeGiftedTokens: 0, walletLedger: [] as unknown[] };
    expect(decideBackfill({ wallet: noDate, welcomeMarker: false, backfillMarker: false, env }).reason).toBe('too-old');
    expect(openedInGap(noDate)).toBe(false);
    expect(openedInGap({ createdAt: 'not a date' })).toBe(false);
    expect(openedInGap(null)).toBe(false);
  });

  it('the boundary is inclusive — an account opened AT the retirement instant is in scope', () => {
    expect(openedInGap({ createdAt: RETIREMENT_ISO })).toBe(true);
    expect(openedInGap({ createdAt: '2026-09-16T23:59:59.999Z' })).toBe(false);
  });

  it('🔒 an unreadable cutoff falls back to the retirement date, never to "no cutoff"', () => {
    for (const raw of ['', '   ', 'yesterday', 'NaN', undefined]) {
      expect(backfillSince({ WELCOME_BACKFILL_SINCE: raw } as NodeJS.ProcessEnv), String(raw))
        .toBe(Date.parse(RETIREMENT_ISO));
    }
    // A deliberate value is honoured.
    expect(backfillSince({ WELCOME_BACKFILL_SINCE: '2026-09-19' } as NodeJS.ProcessEnv))
      .toBe(Date.parse('2026-09-19'));
  });

  it('the age check comes BEFORE the wallet heuristics, so the rule is categorical', () => {
    // An old account that also shows a welcome row must report `too-old` — the admin's rule is that
    // old accounts are out of scope at all, not that they happen to fail another test.
    const d = decide({
      createdAt: '2026-08-01T00:00:00.000Z',
      walletLedger: [{ description: 'Welcome Bonus: 25,000 AI Tokens Credited!' }],
    });
    expect(d.reason).toBe('too-old');
  });
});

describe('🔴 ₹400 is a hard ceiling — "kaise bhi jaye, maximum ₹400!!!"', () => {
  it('never takes an account past ₹400, whatever the console says', () => {
    const env2 = { WELCOME_BACKFILL_TOKENS: '99999999' } as NodeJS.ProcessEnv;
    // An account already holding ₹300 of gift has ₹100 of room — and gets exactly ₹100.
    const d = decideBackfill({
      wallet: { createdAt: IN_GAP, freeGiftedTokens: 0, walletLedger: [] },
      welcomeMarker: false, backfillMarker: false, env: env2,
    });
    expect(d.tokens).toBeLessThanOrEqual(MAX_SELF_GIFT_TOKENS);
    expect(backfillRupees(d.tokens)).toBeLessThanOrEqual(400);
  });

  it('never ADDS anything that carries an account past ₹400', () => {
    // Walked over the whole range rather than asserted at one point, because "kaise bhi jaye" is the
    // instruction: there must be no pair of inputs that gets past the line.
    //
    // ⚠️ The invariant is about what this feature ADDS. An account can already sit above ₹400 from the
    // old ₹500 plan, and a backfill cannot un-give that — it can only refuse to add. So the assertion
    // is "never crosses the line, and never adds once it is already at or past it", which is the real
    // promise. The first draft of this test asserted `already + granted <= 400` flatly and failed on
    // exactly that legacy case; the test was wrong, not the code.
    for (const alreadyRupees of [0, 1, 100, 150, 250, 300, 399, 400, 500]) {
      for (const askRupees of [250, 400, 1000, 99999]) {
        const already = alreadyRupees * TOKENS_PER_RUPEE;
        const granted = decideBackfill({
          wallet: { createdAt: IN_GAP, freeGiftedTokens: already, walletLedger: [] },
          welcomeMarker: false,
          backfillMarker: false,
          env: { WELCOME_BACKFILL_TOKENS: String(askRupees * TOKENS_PER_RUPEE) } as NodeJS.ProcessEnv,
        }).tokens;
        const label = `already ₹${alreadyRupees} + ask ₹${askRupees}`;
        expect(granted, label).toBeGreaterThanOrEqual(0);
        if (already >= MAX_SELF_GIFT_TOKENS) {
          expect(granted, `${label} — no room left`).toBe(0);
        } else {
          expect(already + granted, label).toBeLessThanOrEqual(MAX_SELF_GIFT_TOKENS);
        }
      }
    }
  });
});

describe('🔒 the route moves money the one legal way', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const admin = read('src/server/routes/admin.ts');
  const run = admin.slice(admin.indexOf("app.post('/api/admin/welcome-backfill/run'"));
  const body = run.slice(0, run.indexOf('\n  app.'));

  it('credits through mirroredCreditPatch, never a direct balance write', () => {
    // The money audit's own rule: "Any NEW wallet writer must go through it — a direct updateDoc on a
    // balance field is how this class comes back."
    expect(body).toContain('mirroredCreditPatch(wallet, decision.tokens');
    expect(body).not.toMatch(/tokenBalance:\s*(?!\.)/);
    expect(body).not.toMatch(/remaining_balance:/);
  });

  it('writes the marker inside the SAME transaction as the credit', () => {
    // Splitting these two is exactly how a retry pays twice.
    const tx = body.slice(body.indexOf('runTransaction'), body.indexOf('return decision.tokens'));
    expect(tx).toContain('tx.update(walletRef');
    expect(tx).toContain('tx.set(markerRef');
  });

  it('re-reads both markers INSIDE the transaction, so they are preconditions', () => {
    expect(body).toContain('tx.get(markerRef)');
    expect(body).toContain('tx.get(welcomeRef)');
  });

  it('refuses to credit without an explicit confirmation', () => {
    expect(body).toContain("req.body?.confirm !== true");
  });

  it('appends the ledger row through the shared appender', () => {
    expect(body).toContain('ledgerPatch(wallet');
  });

  it('the preview route never writes', () => {
    const preview = admin.slice(admin.indexOf("app.get('/api/admin/welcome-backfill'"));
    const previewBody = preview.slice(0, preview.indexOf('\n  app.'));
    for (const write of ['tx.set', 'tx.update', 'setDoc', 'updateDoc', 'runTransaction']) {
      expect(previewBody, write).not.toContain(write);
    }
  });
});

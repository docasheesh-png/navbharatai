/**
 * Gift plan v2, as WIRED — the wallet route, not just the pure decisions.
 *
 * `giftPlan.test.ts` proves the arithmetic. This proves the route actually uses it, and — the part
 * that matters most before a flag is flipped on a money path — that with the flag OFF nothing about
 * the existing behaviour changed at all.
 *
 * Source-level assertions on purpose: the route needs Firestore, firebase-admin and Express to run,
 * and the properties at stake here (where the phone comes from, whether the marker is written in the
 * same transaction as the credit) are structural. A mocked-Firestore test would assert against the
 * mock; this asserts against the code that ships.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'src/server/routes/wallet.ts'), 'utf8');
const AUTH = readFileSync(join(__dirname, '..', 'src/server/lib/authMiddleware.ts'), 'utf8');

describe('gift plan v2 — off by default, and genuinely inert while off', () => {
  it('every v2 path is behind giftPlanV2Enabled()', () => {
    expect(SRC).toMatch(/const v2 = giftPlanV2Enabled\(\)/);
    // The claim endpoint refuses outright when the plan is off.
    expect(SRC).toMatch(/if \(!giftPlanV2Enabled\(\)\)[\s\S]{0,160}claimRefusalMessage\('disabled'\)/);
  });

  it('does not even LOOK anything up when the flag is off', () => {
    // The marker reads are two extra Firestore round-trips on the wallet path; a disabled feature
    // must not pay for them, and must not be able to fail for a user it does not apply to.
    expect(SRC).toMatch(/const emailUsed = v2 \? await giftIdentityUsed\(db, 'email', normEmail\) : false;/);
    expect(SRC).toMatch(/const phoneUsed = v2 \? await giftIdentityUsed\(db, 'phone', normPhone\) : false;/);
    expect(SRC).toMatch(/const normPhone = v2 \? normalizePhoneForGift\(await verifiedPhoneNumber\(req\)\) : '';/);
  });

  it('falls back to the exact legacy grant when v2 is off', () => {
    expect(SRC).toMatch(/const welcomeTokens = v2Grant[\s\S]{0,120}: welcomeGrantTokens\(alreadyGranted\);/);
  });
});

describe('gift plan v2 — the phone can only come from a verified token', () => {
  it('the route never reads a phone from the request body', () => {
    // A body-supplied number would let anyone type any number and claim the verified tier.
    expect(SRC).not.toMatch(/req\.body[?.\[\]'"a-zA-Z]*phone/i);
    expect(SRC).toMatch(/verifiedPhoneNumber\(req\)/);
  });

  it('verifiedPhoneNumber reads phone_number off the DECODED token only', () => {
    expect(AUTH).toMatch(/export async function verifiedPhoneNumber/);
    expect(AUTH).toMatch(/verifyIdToken\([\s\S]{0,80}phone_number/);
  });

  it('the client cannot ask for an amount — it is derived server-side', () => {
    expect(SRC).toMatch(/decidePhoneClaim\(\{ giftedSoFar: gifted, phoneUsed \}\)/);
    expect(SRC).not.toMatch(/req\.body[?.\[\]'"a-zA-Z]*(amount|tokens|granted)/i);
  });
});

describe('gift plan v2 — money and marker land together, or not at all', () => {
  it('the signup grant writes its identity markers inside the same transaction as the credit', () => {
    const tx = SRC.slice(SRC.indexOf('const createdWallet = await runTransaction'));
    expect(tx).toMatch(/tx\.set\(walletRef, initialWallet\)/);
    expect(tx).toMatch(/if \(v2Grant && welcomeTokens > 0\)/);
    expect(tx).toMatch(/tx\.set\(doc\(db, 'payment_transactions', id\), giftMarkerDoc\(id, 'email'/);
    expect(tx).toMatch(/tx\.set\(doc\(db, 'payment_transactions', id\), giftMarkerDoc\(id, 'phone'/);
  });

  it('the claim writes the phone marker in the same transaction as the credit', () => {
    const claim = SRC.slice(SRC.indexOf("claim-phone-bonus"));
    expect(claim).toMatch(/tx\.update\(walletRef,/);
    expect(claim).toMatch(/tx\.set\(doc\(db, 'payment_transactions', markerId\), giftMarkerDoc\(markerId, 'phone'/);
  });

  it('the claim re-decides INSIDE the transaction, not only before it', () => {
    const claim = SRC.slice(SRC.indexOf("claim-phone-bonus"));
    const decideAt = claim.indexOf('decidePhoneClaim');
    const txAt = claim.indexOf('await runTransaction');
    expect(txAt).toBeGreaterThan(-1);
    expect(decideAt).toBeGreaterThan(txAt); // the decision happens after the transaction opens
  });

  it('counts the grant against the lifetime total in the same write', () => {
    const claim = SRC.slice(SRC.indexOf("claim-phone-bonus"));
    expect(claim).toMatch(/freeGiftedTokens: gifted \+ claim\.tokens/);
  });
});

describe('gift plan v2 — the identity lookup fails CLOSED', () => {
  it('a lookup that throws is treated as already used', () => {
    // Refusing a gift is a support message to one person; granting on a failed check is money handed
    // to whoever made the check fail. The two failure modes are not symmetric.
    const fn = SRC.slice(SRC.indexOf('async function giftIdentityUsed'), SRC.indexOf('function giftMarkerDoc'));
    expect(fn).toMatch(/catch[\s\S]{0,200}return true;/);
  });

  it('checks EVERY candidate id, so adding a pepper cannot re-gift everyone', () => {
    const fn = SRC.slice(SRC.indexOf('async function giftIdentityUsed'), SRC.indexOf('function giftMarkerDoc'));
    expect(fn).toMatch(/for \(const id of giftMarkerCandidates\(kind, normalized\)\)/);
  });

  it('stores no raw email or phone in the marker document', () => {
    const fn = SRC.slice(SRC.indexOf('function giftMarkerDoc'), SRC.indexOf('function giftMarkerDoc') + 900);
    expect(fn).not.toMatch(/email:|phone:|phoneNumber|rawPhone/);
  });
});

describe('gift plan v2 — nobody who was promised a weekly credit loses it', () => {
  it('the ladder is retired ONLY for wallets stamped v2', () => {
    expect(SRC).toMatch(/const ladderRetired = data\.giftPlan === 'v2';/);
    expect(SRC).toMatch(/if \(ladderRetired\) throw new SkipLadder\(\);/);
  });

  it('a v2 skip is not logged as a top-up failure', () => {
    expect(SRC).toMatch(/if \(!\(topUpErr instanceof SkipLadder\)\)/);
  });

  it('a v2 wallet is never shown a next-credit date that will never arrive', () => {
    expect(SRC).toMatch(/freeGift: ladderRetired[\s\S]{0,40}\? v2GiftSummary\(data\)/);
    const summary = SRC.slice(SRC.indexOf('function v2GiftSummary'), SRC.indexOf('function v2GiftSummary') + 900);
    expect(summary).toMatch(/nextCreditAt: null/);
    expect(summary).toMatch(/phoneBonusClaimable/);
  });

  it('the v2 summary can never report a negative claimable amount', () => {
    const summary = SRC.slice(SRC.indexOf('function v2GiftSummary'), SRC.indexOf('function v2GiftSummary') + 900);
    expect(summary).toMatch(/Math\.max\(0, total - gifted\)/);
  });
});

describe('gift plan v2 — a refusal is not an error', () => {
  it('an already-claimed number returns 200 with granted:0, not a failure status', () => {
    const claim = SRC.slice(SRC.indexOf("claim-phone-bonus"));
    expect(claim).toMatch(/return res\.json\(\{[\s\S]{0,120}granted: 0,[\s\S]{0,120}claimRefusalMessage\(result\.reason\)/);
  });
});

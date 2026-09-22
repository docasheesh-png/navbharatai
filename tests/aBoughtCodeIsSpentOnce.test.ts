import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { giftPriceAtPct, giftPriceNoticeAtPct, splitPaymentAtPct, DEFAULT_PLATFORM_FEE_PCT } from '../src/lib/platformFee';
import { giftShareText, giftWhatsAppUrl } from '../src/lib/giftCodeRow';
import {
  mintGiftCode, isGiftCode, normalizeGiftCode, decideGiftPurchase, decideGiftRedemption,
  MIN_GIFT_INR, MAX_GIFT_INR, MAX_GIFT_CODES_PER_DAY, MAX_GIFT_INR_PER_DAY, GIFT_CODE_PREFIX,
  type GiftCodeRecord,
} from '../src/server/lib/giftCodes';

/**
 * BUY A PROMO CODE, GIVE IT AWAY, AND IT IS SPENT EXACTLY ONCE (admin 2026-09-22).
 *
 * *"promocode credit ke andar ek option aur add karo — **purchage promo code**. yaha user promocode
 * purchage kar ke apne family/friend ko gift kar sakta hai! rate wahi jo ham charge karte hai, plus
 * 2% pletform fee"*, with the condition: *"yaha jo purchage honge promocode woh real ₹ se honge
 * navbharatai dwara gift kiye gaye welcome bonus se nahi!"* — and, on the fee: *"2% hi kaafi hai!!"*
 *
 * 🔴 THE THREE THINGS THAT WOULD COST REAL MONEY IF THEY WERE WRONG, and why each is not obvious:
 *
 *  1. **The claim must be on the CODE, not on `(code, user)`.** The marketing-coupon path deliberately
 *     claims `coupon_<CODE>_<uid>` — one redemption per USER, correct for a code on a poster. Copying
 *     that here would let ten friends each redeem the same ₹500. It is the same code path, one line
 *     apart, and nothing else in the repo would have failed.
 *
 *  2. **The redeemed credit must be 'paid', not 'gift'.** Every other coupon credit in this repo is
 *     'gift', so 'gift' is what a copied line would say — and `giftSpend` would then tell the
 *     recipient that their friend's real money cannot buy a hosting plan.
 *
 *  3. **The fee is ADDED here and DEDUCTED on a recharge.** Both are the same 2%, on two different
 *     products: a recharge's amount is what the user pays, a gift's face value is what the friend
 *     receives. Using `splitPaymentAtPct` here would sell a "₹500 code" worth ₹490.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

const PAYMENT_ROUTE = stripComments(read('src/server/routes/payment.ts'));
const PAYMENTS_LIB = stripComments(read('src/server/lib/payments.ts'));
const GIFT_STORE = stripComments(read('src/server/lib/giftCodeStore.ts'));

/** Deterministic "randomness", so a minted code is a fact rather than a coin flip. */
const fixedBytes = (seed: number) => (n: number) =>
  Uint8Array.from({ length: n }, (_, i) => (seed + i * 7) % 256);

describe('🔴 the price — the fee goes ON TOP, and the identity holds exactly', () => {
  it('a ₹500 gift at 2% costs ₹510 and is worth ₹500', () => {
    const p = giftPriceAtPct(500, 2);
    expect(p.faceInr).toBe(500);
    expect(p.feeInr).toBe(10);
    expect(p.payInr).toBe(510);
  });

  it('🔒 face + fee === pay, to the paisa, at every rate and amount', () => {
    for (const face of [100, 149, 333, 999, 1234, 5000]) {
      for (const pct of [0, 1, 2, 2.5, 7, 20]) {
        const p = giftPriceAtPct(face, pct);
        expect(Math.round((p.faceInr + p.feeInr) * 100) / 100, `${face} @ ${pct}%`).toBe(p.payInr);
      }
    }
  });

  it('🔒 it is the OPPOSITE direction from a recharge, and both survive together', () => {
    // A recharge: the user names ₹500 and ₹490 reaches the wallet.
    expect(splitPaymentAtPct(500, 2).creditInr).toBe(490);
    // A gift: the friend must receive ₹500, so the buyer pays ₹510.
    expect(giftPriceAtPct(500, 2).payInr).toBe(510);
  });

  it('the default rate is the admin-confirmed 2%', () => {
    expect(DEFAULT_PLATFORM_FEE_PCT).toBe(2);
    expect(giftPriceAtPct(500, Number.NaN).payInr).toBe(510);
  });

  it('junk in gives zeroes, never a negative price or a NaN on screen', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = giftPriceAtPct(bad as number, 2);
      expect(p).toEqual({ faceInr: 0, feeInr: 0, payInr: 0 });
    }
    expect(giftPriceNoticeAtPct(0, 2)).toBe('');
  });

  it('🔒 the notice names ONE fee and never a provider', () => {
    const notice = giftPriceNoticeAtPct(500, 2).toLowerCase();
    expect(notice).toContain('platform fee');
    for (const banned of ['cashfree', 'gateway', 'upi', 'razorpay', 'stripe']) {
      expect(notice, `the notice must not name ${banned}`).not.toContain(banned);
    }
  });
});

describe('what may be bought, and how often', () => {
  const ok = { feePct: 2, todayCount: 0, todayInr: 0 };

  it('accepts a whole-rupee amount inside the bounds', () => {
    const d = decideGiftPurchase({ ...ok, faceInr: 500 });
    expect(d.ok).toBe(true);
    expect(d.price?.payInr).toBe(510);
  });

  it('refuses below the floor, above the ceiling, and anything not a whole rupee', () => {
    expect(decideGiftPurchase({ ...ok, faceInr: MIN_GIFT_INR - 1 }).reason).toBe('amount-too-small');
    expect(decideGiftPurchase({ ...ok, faceInr: MAX_GIFT_INR + 1 }).reason).toBe('amount-too-large');
    for (const bad of [499.5, '500.25', 'five hundred', null, undefined, Number.NaN]) {
      expect(decideGiftPurchase({ ...ok, faceInr: bad }).reason, String(bad)).toBe('amount-invalid');
    }
  });

  it('every refusal names the number — a user is never told just "no"', () => {
    for (const bad of [MIN_GIFT_INR - 1, MAX_GIFT_INR + 1, 12.5]) {
      const d = decideGiftPurchase({ ...ok, faceInr: bad });
      expect(d.ok).toBe(false);
      expect((d.message ?? '').length).toBeGreaterThan(10);
    }
  });

  it('the daily caps bound one buyer, by count and by rupees', () => {
    expect(decideGiftPurchase({ ...ok, faceInr: 500, todayCount: MAX_GIFT_CODES_PER_DAY }).reason).toBe('daily-count');
    expect(decideGiftPurchase({ ...ok, faceInr: 500, todayInr: MAX_GIFT_INR_PER_DAY }).reason).toBe('daily-amount');
    // Exactly at the line is still allowed; one rupee past it is not.
    expect(decideGiftPurchase({ ...ok, faceInr: 500, todayInr: MAX_GIFT_INR_PER_DAY - 500 }).ok).toBe(true);
    expect(decideGiftPurchase({ ...ok, faceInr: 500, todayInr: MAX_GIFT_INR_PER_DAY - 499 }).ok).toBe(false);
  });

  it('🔒 an UNREADABLE tally refuses the purchase — it fails CLOSED, never open', () => {
    // A Firestore outage must not open an unbounded gift path; the cap exists precisely for when
    // something has gone wrong, so it cannot be opened BY something going wrong.
    expect(decideGiftPurchase({ ...ok, faceInr: 500, todayCount: Number.NaN }).ok).toBe(false);
    expect(decideGiftPurchase({ ...ok, faceInr: 500, todayInr: Number.NaN }).ok).toBe(false);
  });
});

describe('the code itself', () => {
  it('is minted from the SUPPLIED randomness — never from Math.random()', () => {
    expect(mintGiftCode(fixedBytes(1))).toBe(mintGiftCode(fixedBytes(1)));
    expect(mintGiftCode(fixedBytes(1))).not.toBe(mintGiftCode(fixedBytes(200)));
  });

  it('🔒 carries no character a human can misread aloud', () => {
    // 0/O and 1/I/L are what turn a gift into a support ticket.
    for (let seed = 0; seed < 60; seed++) {
      const body = mintGiftCode(fixedBytes(seed)).slice(GIFT_CODE_PREFIX.length);
      expect(body, `seed ${seed}`).not.toMatch(/[0O1IL]/);
      expect(body).toHaveLength(10);
    }
  });

  it('recognises what it mints, and nothing else', () => {
    expect(isGiftCode(mintGiftCode(fixedBytes(3)))).toBe(true);
    for (const notOurs of ['DIWALI2026', 'FREE100', '', 'NBGIFT-', 'NBGIFT-SHORT', 'NBGIFT-0OOOOOOOOO']) {
      expect(isGiftCode(notOurs), notOurs).toBe(false);
    }
  });

  it('matches case- and space-insensitively — a phone keyboard will not match our casing', () => {
    const code = mintGiftCode(fixedBytes(9));
    expect(normalizeGiftCode(`  ${code.toLowerCase()} `)).toBe(code);
    expect(isGiftCode(` ${code.toLowerCase()}`)).toBe(true);
  });
});

describe('🔴 one code, one redemption', () => {
  const base: GiftCodeRecord = {
    code: 'NBGIFT-ABCDEFGHJK', buyerUid: 'buyer', faceInr: 500, paidInr: 510, feeInr: 10,
    orderId: 'ord_1', status: 'unused', createdAt: '2026-09-22T00:00:00.000Z',
  };

  it('an unused code redeems for its face value', () => {
    expect(decideGiftRedemption(base, 'friend')).toEqual({ ok: true, faceInr: 500 });
  });

  it('a spent code is refused, and said so plainly', () => {
    const out = decideGiftRedemption({ ...base, status: 'redeemed' }, 'friend');
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('already-redeemed');
  });

  it('a code that does not exist is refused without hinting at what would have worked', () => {
    const out = decideGiftRedemption(null, 'friend');
    expect(out.ok === false && out.reason).toBe('not-found');
  });

  it('🔒 the BUYER cannot redeem their own code', () => {
    // Not because it costs us anything, but because paying a fee to move money from a wallet into
    // the same wallet is a step a payments product should not offer.
    const out = decideGiftRedemption(base, 'buyer');
    expect(out.ok === false && out.reason).toBe('own-code');
  });

  it('a record with a broken face value is refused rather than crediting zero', () => {
    for (const bad of [0, -1, Number.NaN, undefined]) {
      const out = decideGiftRedemption({ ...base, faceInr: bad as number }, 'friend');
      expect(out.ok, String(bad)).toBe(false);
    }
  });
});

describe('🔴 the wiring — the three expensive mistakes, held at the source', () => {
  it('the CLAIM is on the code document, not on `coupon_<CODE>_<uid>`', () => {
    expect(GIFT_STORE).toContain('claimGiftCode');
    // The store claims by flipping the code's own status inside a transaction.
    expect(GIFT_STORE).toMatch(/status:\s*'redeemed'/);
    // And the route reaches the gift path through that claim, never through the coupon claim id.
    const giftBranch = PAYMENT_ROUTE.slice(
      PAYMENT_ROUTE.indexOf('looksLikeGiftCode(code)'),
      PAYMENT_ROUTE.indexOf('const value = couponValueInr(code)'),
    );
    expect(giftBranch.length).toBeGreaterThan(200);
    expect(giftBranch).toContain('claimGiftCode');
    expect(giftBranch, 'a gift must never take the per-user coupon claim').not.toContain('coupon_${code}');
  });

  it('🔒 the gift branch is tried BEFORE the coupon table', () => {
    // Otherwise a real gift code falls through to "invalid or expired promoter voucher card" — a
    // true sentence about the wrong question.
    const giftAt = PAYMENT_ROUTE.indexOf('looksLikeGiftCode(code)');
    const couponAt = PAYMENT_ROUTE.indexOf('const value = couponValueInr(code)');
    expect(giftAt).toBeGreaterThan(-1);
    expect(couponAt).toBeGreaterThan(-1);
    expect(giftAt).toBeLessThan(couponAt);
  });

  it('🔒 a redeemed GIFT credits `paid`; a marketing COUPON still credits `gift`', () => {
    const giftBranch = PAYMENT_ROUTE.slice(
      PAYMENT_ROUTE.indexOf('looksLikeGiftCode(code)'),
      PAYMENT_ROUTE.indexOf('const value = couponValueInr(code)'),
    );
    expect(giftBranch).toContain("mirroredCreditPatch(w, rupeesToTokens(faceInr), 'paid')");
    const couponBranch = PAYMENT_ROUTE.slice(PAYMENT_ROUTE.indexOf('const value = couponValueInr(code)'));
    expect(couponBranch).toContain("mirroredCreditPatch(w, rupeesToTokens(value), 'gift')");
  });

  it('🔒 the BUYER is credited nothing — the code is the whole delivery', () => {
    // Both halves: the order is written with a zero credit, and fulfilment returns before the
    // wallet block. Either one alone would be a single edit away from paying out twice.
    expect(PAYMENT_ROUTE).toContain('{ paidInr: orderAmount, feeInr: giftFee, creditInr: 0 }');
    const fulfil = PAYMENTS_LIB.slice(PAYMENTS_LIB.indexOf("=== 'gift_code'"));
    const walletAt = fulfil.indexOf("doc(db, 'user_token_wallets'");
    const returnAt = fulfil.indexOf('return { success: true, data: { giftCode');
    expect(returnAt).toBeGreaterThan(-1);
    expect(returnAt, 'fulfilment must return before the wallet credit').toBeLessThan(walletAt);
  });

  it('🔒 the face value comes from the TX DOC the server wrote, never from the request body', () => {
    const fulfil = PAYMENTS_LIB.slice(PAYMENTS_LIB.indexOf("=== 'gift_code'"));
    expect(fulfil).toContain('txData');
    expect(fulfil).toContain('giftFaceInr');
    // A paid order that somehow carries no face value refunds rather than minting a free code.
    expect(fulfil).toContain('gift_face_missing');
  });

  it('🔒 the purchase price is the SERVER\'s — the body\'s `amount` is ignored for a gift', () => {
    expect(PAYMENT_ROUTE).toContain('const orderAmount = isGiftCode ? Math.round((giftFace + giftFee) * 100) / 100 : clientAmount;');
    expect(PAYMENT_ROUTE).toContain('decideGiftPurchase({');
  });

  it('🔒 nothing on the buy path reads or debits a wallet — the admin\'s "real ₹" condition', () => {
    const between = PAYMENT_ROUTE.slice(
      PAYMENT_ROUTE.indexOf('if (isGiftCode) {'),
      PAYMENT_ROUTE.indexOf('const orderId = `ord_nb_'),
    );
    expect(between.length).toBeGreaterThan(100);
    expect(between, 'a gift must never be payable from a balance').not.toContain('user_token_wallets');
    expect(between).not.toContain('computeDebitedWallet');
  });
});

describe('the message the buyer sends', () => {
  it('carries the code and what it is worth', () => {
    const text = giftShareText('NBGIFT-ABCDEFGHJK', 500);
    expect(text).toContain('NBGIFT-ABCDEFGHJK');
    expect(text).toContain('₹500');
  });

  it('says exactly where to type it — the reader has never seen this app', () => {
    expect(giftShareText('NBGIFT-ABCDEFGHJK', 500)).toContain('Promocode');
  });

  it('🔒 names no vendor — the White-Label Law reaches text that leaves the app', () => {
    const text = giftShareText('NBGIFT-ABCDEFGHJK', 500).toLowerCase();
    for (const banned of ['glm', 'kimi', 'claude', 'gemini', 'grok', 'openai', 'anthropic', 'cashfree']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('the WhatsApp link is encoded once, here', () => {
    const url = giftWhatsAppUrl('NBGIFT-ABCDEFGHJK', 500);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe(giftShareText('NBGIFT-ABCDEFGHJK', 500));
  });
});

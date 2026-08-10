import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_STORE_PACKS, storePacks, packForProduct, storeBillingEnabled,
  storePlatformConfigured, storeTransactionDocId, storeFeePct, netAfterStoreFee, storePriceForCredit,
} from '../src/server/lib/storeBilling';
import {
  decodeJwsPayload, verifyApplePurchase, verifyGooglePurchase, verifyStorePurchase,
  _setStoreFetchForTests,
} from '../src/server/lib/storeVerify';

/**
 * STORE BILLING (admin 2026-08-09: "apple/google payment setup karwao"). Money code, so the tests
 * are written around the ways it could WRONGLY credit: a forged token, a product the client picked
 * itself, a refunded purchase, a pending (unpaid) UPI purchase, a replayed verify.
 */

const jws = (claims: Record<string, unknown>) =>
  `${Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const appleKeys = () => {
  process.env.APPLE_IAP_KEY_ID = 'K1';
  process.env.APPLE_IAP_ISSUER_ID = 'I1';
  process.env.APPLE_BUNDLE_ID = 'com.navbharat.ai';
  // A real EC key so the JWT actually signs — otherwise the test would prove nothing about signing.
  const { privateKey } = require('crypto').generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.APPLE_IAP_PRIVATE_KEY = privateKey;
};

afterEach(() => {
  _setStoreFetchForTests(null);
  for (const k of ['STORE_PACKS', 'STORE_BILLING', 'STORE_FEE_PCT', 'APPLE_IAP_KEY_ID', 'APPLE_IAP_ISSUER_ID', 'APPLE_BUNDLE_ID', 'APPLE_IAP_PRIVATE_KEY', 'GOOGLE_PLAY_SA_JSON', 'GOOGLE_PLAY_PACKAGE_NAME']) delete process.env[k];
});

describe('our ₹ never shrinks because of the store cut (admin 2026-08-09)', () => {
  it('EVERY default pack nets at least its credit value after the store commission', () => {
    // The whole point of the markup. If this ever fails, we are funding the store out of margin.
    for (const p of DEFAULT_STORE_PACKS) {
      expect(netAfterStoreFee(p.priceInr, 15), p.productId).toBeGreaterThanOrEqual(p.creditInr);
    }
  });

  it('storePriceForCredit is the arithmetic behind those prices — no guessing', () => {
    expect(storePriceForCredit(99, 15)).toBeLessThanOrEqual(119);
    expect(storePriceForCredit(999, 15)).toBeLessThanOrEqual(1199);
    // At Apple's non-enrolled 30% the required price is visibly higher — which is exactly the
    // signal the admin needs if the Small Business Program enrolment is ever missed.
    expect(storePriceForCredit(99, 30)).toBeGreaterThan(storePriceForCredit(99, 15));
  });

  it('the fee rate is env-tunable and junk never becomes a rate', () => {
    expect(storeFeePct()).toBe(15);
    process.env.STORE_FEE_PCT = '30';
    expect(storeFeePct()).toBe(30);
    process.env.STORE_FEE_PCT = 'banana';
    expect(storeFeePct()).toBe(15);
    process.env.STORE_FEE_PCT = '150';
    expect(storeFeePct()).toBe(15); // a rate ≥100% would compute a negative net
  });

  it('netAfterStoreFee refuses to invent a number for junk input', () => {
    expect(netAfterStoreFee(0)).toBe(0);
    expect(netAfterStoreFee(-5)).toBe(0);
    expect(netAfterStoreFee(NaN)).toBe(0);
  });
});

describe('the pack catalogue is the ONLY source of money', () => {
  it('ships sane defaults and accepts an env override', () => {
    expect(storePacks()).toEqual([...DEFAULT_STORE_PACKS]);
    process.env.STORE_PACKS = JSON.stringify([{ productId: 'x.1', priceInr: 59, creditInr: 49, label: 'Mini' }]);
    expect(storePacks()).toEqual([{ productId: 'x.1', priceInr: 59, creditInr: 49, label: 'Mini' }]);
  });

  it('a config naming only one number credits exactly what was charged — never more', () => {
    process.env.STORE_PACKS = JSON.stringify([{ productId: 'x.1', priceInr: 199 }]);
    expect(storePacks()[0]).toMatchObject({ priceInr: 199, creditInr: 199 });
    // And a config that tries to credit MORE than the store charged is clamped — no free money.
    process.env.STORE_PACKS = JSON.stringify([{ productId: 'x.2', priceInr: 99, creditInr: 9999 }]);
    expect(storePacks()[0].creditInr).toBe(99);
  });

  it('junk config NEVER leaves the app with nothing to sell, and never invents a price', () => {
    process.env.STORE_PACKS = 'not json';
    expect(storePacks()).toEqual([...DEFAULT_STORE_PACKS]);
    process.env.STORE_PACKS = JSON.stringify([{ productId: 'bad', priceInr: -5 }, { productId: '', priceInr: 10 }]);
    expect(storePacks()).toEqual([...DEFAULT_STORE_PACKS]); // every entry invalid ⇒ defaults, not an empty shop
  });

  it('an UNKNOWN product credits nothing — a retired store product cannot mint money', () => {
    expect(packForProduct('nbai.tokens.99')?.creditInr).toBe(99);
    expect(packForProduct('nbai.tokens.retired')).toBeNull();
    expect(packForProduct('')).toBeNull();
    expect(packForProduct(undefined)).toBeNull();
  });
});

describe('flags and configuration are answered honestly', () => {
  it('billing is OFF unless explicitly enabled', () => {
    expect(storeBillingEnabled()).toBe(false);
    process.env.STORE_BILLING = 'on';
    expect(storeBillingEnabled()).toBe(true);
  });

  it('each platform reports its OWN readiness — never a blanket guess', () => {
    expect(storePlatformConfigured('apple')).toBe(false);
    expect(storePlatformConfigured('google')).toBe(false);
    appleKeys();
    expect(storePlatformConfigured('apple')).toBe(true);
    expect(storePlatformConfigured('google')).toBe(false); // apple keys must not imply google
  });
});

describe('idempotency key', () => {
  it('is platform-scoped and filesystem/Firestore-safe, so two stores can never collide', () => {
    expect(storeTransactionDocId('apple', '2000000123')).toBe('store_apple_2000000123');
    expect(storeTransactionDocId('google', 'GPA.1234-5678')).toBe('store_google_GPA.1234-5678');
    expect(storeTransactionDocId('apple', 'a/../../b')).toBe('store_apple_a....b'); // no path escapes
    expect(storeTransactionDocId('apple', 'x'.repeat(300)).length).toBeLessThanOrEqual(133);
  });
});

describe('Apple verification', () => {
  it('reads the product from APPLE\'s answer, not from anything the client said', async () => {
    appleKeys();
    _setStoreFetchForTests(async () => ({
      ok: true, status: 200,
      json: async () => ({ signedTransactionInfo: jws({ productId: 'nbai.tokens.99', transactionId: '2000000123' }) }),
    }));
    const r = await verifyApplePurchase('2000000123');
    expect(r).toEqual({ ok: true, productId: 'nbai.tokens.99', transactionId: '2000000123' });
  });

  it('falls back to SANDBOX on 404 — a TestFlight purchase is not fraud', async () => {
    appleKeys();
    const hosts: string[] = [];
    _setStoreFetchForTests(async (url) => {
      hosts.push(url);
      if (url.includes('storekit.itunes')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ signedTransactionInfo: jws({ productId: 'nbai.tokens.249', transactionId: 'T9' }) }) };
    });
    const r = await verifyApplePurchase('T9');
    expect(r.ok).toBe(true);
    expect(hosts[0]).toContain('storekit.itunes');       // production first
    expect(hosts[1]).toContain('storekit-sandbox');      // then sandbox
  });

  it('a REFUNDED purchase credits nothing', async () => {
    appleKeys();
    _setStoreFetchForTests(async () => ({
      ok: true, status: 200,
      json: async () => ({ signedTransactionInfo: jws({ productId: 'nbai.tokens.99', transactionId: 'T1', revocationDate: 1754000000000 }) }),
    }));
    const r = await verifyApplePurchase('T1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('refunded');
  });

  it('unconfigured or not-found is an honest refusal, never a credit', async () => {
    expect((await verifyApplePurchase('T1') as { ok: false; reason: string }).reason).toContain('not configured');
    appleKeys();
    _setStoreFetchForTests(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const r = await verifyApplePurchase('T-missing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not found');
  });
});

describe('Google verification', () => {
  const googleKeys = () => {
    const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    process.env.GOOGLE_PLAY_SA_JSON = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey });
    process.env.GOOGLE_PLAY_PACKAGE_NAME = 'com.navbharat.ai';
  };

  it('credits only purchaseState 0 — a PENDING (unpaid UPI) purchase is refused', async () => {
    googleKeys();
    _setStoreFetchForTests(async (url) => {
      if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
      return { ok: true, status: 200, json: async () => ({ purchaseState: 1, orderId: 'GPA.1' }) };
    });
    const r = await verifyGooglePurchase('nbai.tokens.99', 'ptoken');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not purchased');
  });

  it('a real purchase returns the order id as the idempotency handle', async () => {
    googleKeys();
    _setStoreFetchForTests(async (url) =>
      url.includes('oauth2')
        ? { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }
        : { ok: true, status: 200, json: async () => ({ purchaseState: 0, orderId: 'GPA.3311' }) });
    const r = await verifyGooglePurchase('nbai.tokens.499', 'ptoken');
    expect(r).toEqual({ ok: true, productId: 'nbai.tokens.499', transactionId: 'GPA.3311' });
  });

  it('a forged token (store says 404) credits nothing', async () => {
    googleKeys();
    _setStoreFetchForTests(async (url) =>
      url.includes('oauth2')
        ? { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }
        : { ok: false, status: 404, json: async () => ({}) });
    const r = await verifyGooglePurchase('nbai.tokens.99', 'forged');
    expect(r.ok).toBe(false);
  });
});

describe('decodeJwsPayload', () => {
  it('reads the claims and refuses malformed input instead of throwing', () => {
    expect(decodeJwsPayload(jws({ productId: 'p' }))?.productId).toBe('p');
    expect(decodeJwsPayload('garbage')).toBeNull();
    expect(decodeJwsPayload('')).toBeNull();
  });
});

describe('the credit route cannot be talked into inventing money', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const src: string = readFileSync(join(__dirname, '..', 'src/server/routes/payment.ts'), 'utf8');
  const route = src.slice(src.indexOf("'/api/payment/store/verify'"));

  it('requires a VERIFIED signed-in user — the wallet is never named by the body', () => {
    expect(route).toContain('await verifyFirebaseToken(req)');
    expect(route).toContain("res.status(401)");
    expect(route).not.toMatch(/const userId = req\.body/);
  });

  it('prices from the STORE-verified product via our catalogue — never from the request', () => {
    const verifyAt = route.indexOf('verifyStorePurchase(platform, input)');
    const packAt = route.indexOf('packForProduct(verified.productId)');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(packAt).toBeGreaterThan(verifyAt);          // price is decided AFTER the store answers
    expect(route).toContain('amountPaid: pack.creditInr');
    expect(route).toContain('storePriceInr: pack.priceInr'); // both amounts recorded, none confused
    expect(route).not.toContain('req.body?.amount');   // an amount from the client is never money
  });

  it('an unverified purchase and an unknown product both refuse BEFORE any credit', () => {
    const creditAt = route.indexOf('computeCreditedWallet');
    expect(route.indexOf('if (!verified.ok)')).toBeLessThan(creditAt);
    expect(route.indexOf('if (!pack)')).toBeLessThan(creditAt);
  });

  it('is idempotent on the STORE transaction id — a replayed verify credits once', () => {
    expect(route).toContain('storeTransactionDocId(platform, verified.transactionId)');
    expect(route).toContain("paymentStatus === 'SUCCESS'");
    expect(route).toContain('alreadyProcessed: true');
  });

  it('credits through the SAME wallet function every other purchase uses, inside a transaction', () => {
    expect(route).toContain('runTransaction(db');
    expect(route).toContain('computeCreditedWallet(walletData');
  });

  it('is disabled unless the admin turns it on', () => {
    expect(route).toContain('if (!storeBillingEnabled())');
  });
});

describe('verifyStorePurchase routing', () => {
  it('sends apple to apple and google to google', async () => {
    const r1 = await verifyStorePurchase('apple', { transactionId: 'T' });
    expect(r1.ok).toBe(false); // unconfigured — but it took the apple path
    if (!r1.ok) expect(r1.reason).toContain('apple');
    const r2 = await verifyStorePurchase('google', { productId: 'p', purchaseToken: 't' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('google');
  });
});

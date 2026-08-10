/**
 * Server-side purchase verification for Apple and Google (admin 2026-08-09). This is the file that
 * decides whether real money was really paid, so it is written to be paranoid:
 *
 *  • THE DEVICE IS NEVER TRUSTED. It sends an opaque id/token; we ask the store. A forged token
 *    fails verification and credits nothing.
 *  • THE PRODUCT COMES FROM THE STORE'S ANSWER, never from the request body. Tokens are then
 *    derived from OUR catalogue entry for that product — so a client cannot buy the ₹99 pack and
 *    claim the ₹999 one.
 *  • A PURCHASE MUST BE IN A PAID STATE. Google: purchaseState 0 (purchased) only — pending (1) and
 *    cancelled (2) credit nothing. Apple: the transaction must exist and not be refunded/revoked.
 *  • EVERY FAILURE IS AN HONEST `ok:false` with a reason for the server log — never a silent credit,
 *    and never a thrown exception that a caller might mistake for "unknown, so allow".
 *
 * Both verifiers take an injectable fetch: CI has neither store, and money code must still be
 * provable. The network shapes below follow Apple's App Store Server API and Google's Play
 * Developer API; the FIRST live purchase either verifies or names exactly what to fix.
 */

import crypto from 'crypto';
import type { StorePlatform, StoreVerifyResult } from './storeBilling';

type JsonFetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

let _fetchImpl: JsonFetch = fetch as unknown as JsonFetch;
/** Test seam — neither store is reachable from CI. */
export function _setStoreFetchForTests(f: JsonFetch | null): void {
  _fetchImpl = f ?? (fetch as unknown as JsonFetch);
}

// ─────────────────────────────── Apple ───────────────────────────────

/**
 * Apple's App Store Server API authenticates with a short-lived ES256 JWT signed by the private key
 * (.p8) the admin downloads once from App Store Connect. Exported for tests: the header/payload
 * shape is Apple's contract, and getting `bid`/`aud` wrong is a silent 401 at 3 a.m.
 */
export function appleAuthJwt(now = Math.floor(Date.now() / 1000)): string | null {
  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const privateKey = (process.env.APPLE_IAP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !issuerId || !bundleId || !privateKey) return null;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const payload = b64({
    iss: issuerId,
    iat: now,
    exp: now + 20 * 60,            // Apple rejects anything over 60 min; 20 is comfortable
    aud: 'appstoreconnect-v1',
    bid: bundleId,
  });
  try {
    const signature = crypto
      .sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  } catch {
    return null; // a malformed key is a config error, not a purchase failure — caller reports it honestly
  }
}

/** Apple's signed transaction payload is a JWS; the middle segment carries the claims. Pure. */
export function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  try {
    const part = String(jws || '').split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part, 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const APPLE_HOST_PROD = 'https://api.storekit.itunes.apple.com';
const APPLE_HOST_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';

/**
 * Verify one Apple transaction id. Production is tried first and SANDBOX is the automatic fallback
 * on 404 — the same transaction id lives in only one environment, and a TestFlight build's purchase
 * is a sandbox one. Without this fallback every internal test purchase would read as fraud.
 */
export async function verifyApplePurchase(transactionId: string): Promise<StoreVerifyResult> {
  const id = (transactionId || '').trim();
  if (!id) return { ok: false, reason: 'missing transactionId' };
  const jwt = appleAuthJwt();
  if (!jwt) return { ok: false, reason: 'apple verification not configured (key/issuer/bundle/private key)' };

  for (const host of [APPLE_HOST_PROD, APPLE_HOST_SANDBOX]) {
    let res;
    try {
      res = await _fetchImpl(`${host}/inApps/v1/transactions/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
    } catch (e) {
      return { ok: false, reason: `apple unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status === 404) continue; // not in this environment — try the other one
    if (!res.ok) return { ok: false, reason: `apple HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { signedTransactionInfo?: string } | null;
    const claims = body?.signedTransactionInfo ? decodeJwsPayload(body.signedTransactionInfo) : null;
    if (!claims) return { ok: false, reason: 'apple returned no readable transaction' };
    // A refunded or revoked purchase must never credit — Apple stamps the moment it happened.
    if (claims.revocationDate || claims.revocationReason !== undefined) {
      return { ok: false, reason: 'apple transaction was refunded/revoked' };
    }
    const productId = typeof claims.productId === 'string' ? claims.productId : '';
    const txnId = typeof claims.transactionId === 'string' ? claims.transactionId : id;
    if (!productId) return { ok: false, reason: 'apple transaction has no productId' };
    return { ok: true, productId, transactionId: txnId };
  }
  return { ok: false, reason: 'apple transaction not found in production or sandbox' };
}

// ─────────────────────────────── Google ───────────────────────────────

/**
 * Google's Play Developer API authenticates with a service-account JWT exchanged for an access
 * token. The service-account JSON is the admin's one-time download; only `client_email` and
 * `private_key` are used, and neither is ever logged.
 */
function googleServiceAccount(): { clientEmail: string; privateKey: string } | null {
  const raw = (process.env.GOOGLE_PLAY_SA_JSON || '').trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!sa.client_email || !sa.private_key) return null;
    return { clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

/** Exchange the service-account JWT for a Play Developer API access token. Null on any failure. */
export async function googleAccessToken(now = Math.floor(Date.now() / 1000)): Promise<string | null> {
  const sa = googleServiceAccount();
  if (!sa) return null;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    iss: sa.clientEmail,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  let assertion: string;
  try {
    assertion = `${header}.${payload}.` + crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), sa.privateKey).toString('base64url');
  } catch {
    return null;
  }
  try {
    const res = await _fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // The body rides in the URL-encoded form; the injectable fetch signature keeps it simple by
      // carrying it here, and the real fetch accepts it the same way.
      ...({ body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}` } as object),
    } as never);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { access_token?: string } | null;
    return data?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify one Google Play purchase token for a product. `purchaseState` 0 = purchased; 1 = pending
 * (a UPI/cash payment the user has NOT completed) and 2 = cancelled — neither is money, and
 * crediting a pending purchase is how stores get farmed for free credit.
 */
export async function verifyGooglePurchase(productId: string, purchaseToken: string): Promise<StoreVerifyResult> {
  const pkg = (process.env.GOOGLE_PLAY_PACKAGE_NAME || '').trim();
  const pid = (productId || '').trim();
  const token = (purchaseToken || '').trim();
  if (!pkg) return { ok: false, reason: 'google verification not configured (package name)' };
  if (!pid || !token) return { ok: false, reason: 'missing productId or purchaseToken' };
  const access = await googleAccessToken();
  if (!access) return { ok: false, reason: 'google verification not configured (service account)' };
  let res;
  try {
    res = await _fetchImpl(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(pid)}/tokens/${encodeURIComponent(token)}`,
      { headers: { Authorization: `Bearer ${access}` } },
    );
  } catch (e) {
    return { ok: false, reason: `google unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, reason: `google HTTP ${res.status}` };
  const data = (await res.json().catch(() => null)) as { purchaseState?: number; orderId?: string } | null;
  if (!data) return { ok: false, reason: 'google returned no purchase' };
  if (data.purchaseState !== 0) return { ok: false, reason: `google purchaseState ${data.purchaseState} (not purchased)` };
  const orderId = typeof data.orderId === 'string' && data.orderId ? data.orderId : token;
  // The product id is the one WE asked Google about and Google confirmed a purchase for — so it is
  // verified, not client-asserted.
  return { ok: true, productId: pid, transactionId: orderId };
}

/** Route a verification to the right store. */
export async function verifyStorePurchase(
  platform: StorePlatform,
  input: { transactionId?: string; productId?: string; purchaseToken?: string },
): Promise<StoreVerifyResult> {
  if (platform === 'apple') return verifyApplePurchase(input.transactionId ?? '');
  return verifyGooglePurchase(input.productId ?? '', input.purchaseToken ?? '');
}

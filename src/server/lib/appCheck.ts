// APP CHECK — "is this request coming from the real NavBharatAI app?" (admin 2026-09-26: "App Check
// shuru karo").
//
// WHAT IT PROTECTS, AND WHY ONLY THIS. A signed-in user's ID token proves WHO is calling; it does not
// prove the call comes from our app. A script with a stolen or freshly-made account can hit the build,
// chat, image and OTP endpoints directly, and every one of those spends real money (model calls, a VM,
// an SMS). App Check adds a short-lived token that only the genuine app can obtain (reCAPTCHA
// Enterprise on the web; Play Integrity / App Attest in the phone apps), and the server checks it.
//
// 🔒 IT IS SCOPED TO THE ROUTES THAT SPEND MONEY, deliberately, not to all of /api:
//   • a top-level navigation cannot carry a header — OAuth callbacks, the preview iframe, share pages
//     and store downloads would all "fail" a whole-API rule;
//   • outside servers call some routes by design — the payment webhook, bot webhooks, the Developer
//     API (`/api/chat/completions`, authenticated by API key), published apps' beacons.
// Guarding those would break them; guarding the money routes is where App Check earns its keep.
//
// 🔒 THREE MODES, AND THE DEFAULT CANNOT BREAK ANYTHING.
//   • `monitor` (default) — verifies any token that arrives and COUNTS the outcome. Never refuses.
//   • `enforce` — refuses a protected request with no valid token. ⚠️ Do NOT set this until the phone
//     apps send tokens too (slice 2) and the admin card shows valid ≈ 100% on both web and native:
//     until then every installed Android/iOS build would be refused on its next build or chat.
//   • `off` — the check is skipped entirely.
//   An unreadable value means `monitor`, never `enforce` — a typo must never lock users out.
//
// 🔒 A VERIFIER THAT CANNOT RUN FAILS OPEN, EVEN IN ENFORCE. A missing admin SDK or an unreachable key
// endpoint is OUR outage, and turning it into a refusal for every user would make a Google hiccup a
// NavBharatAI outage. Only a token that was checked and found bad is refused.

import type { Request, Response, NextFunction } from 'express';
import { loadFirebaseAdmin } from './firebaseAdminModule';
import { isAppCheckProtected } from '../../lib/appCheckRoutes';

export type AppCheckMode = 'off' | 'monitor' | 'enforce';
export type AppCheckOutcome = 'valid' | 'missing' | 'invalid' | 'unverifiable';
export type ClientKind = 'web' | 'native';

/** Read the mode. Unset or unreadable ⇒ `monitor`. PURE. */
export function appCheckMode(env: NodeJS.ProcessEnv = process.env): AppCheckMode {
  const v = String(env.APP_CHECK_MODE ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'enforce') return v;
  return 'monitor';
}

/**
 * The public reCAPTCHA Enterprise site key the web app needs, or null. A site key is public by
 * construction (it sits in every page that uses it), which is why it may be served unauthenticated.
 * A malformed value is treated as unset, so a bad paste disables App Check rather than breaking it.
 */
export function appCheckSiteKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = String(env.APP_CHECK_SITE_KEY ?? '').trim();
  return /^[A-Za-z0-9_-]{20,80}$/.test(v) ? v : null;
}

/** Is this request one App Check guards? The list lives in `src/lib/appCheckRoutes.ts`, shared with
 *  the browser so the two can never disagree. */
export const isProtectedRoute = isAppCheckProtected;

/** The native shells' WebView origins (Capacitor); anything else is the website. PURE. */
export function clientKind(origin: string | undefined): ClientKind {
  const o = String(origin || '').trim().toLowerCase();
  return o === 'capacitor://localhost' || o === 'https://localhost' || o === 'http://localhost' || o === 'ionic://localhost'
    ? 'native'
    : 'web';
}

/** Would this outcome be refused in this mode? PURE — the one place the refusal rule lives. */
export function shouldRefuse(mode: AppCheckMode, outcome: AppCheckOutcome): boolean {
  return mode === 'enforce' && (outcome === 'missing' || outcome === 'invalid');
}

/** A verifier failure that is OUR problem (network, SDK), not a bad token. PURE. */
export function isVerifierOutage(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const code = String((err as { code?: unknown })?.code ?? '');
  return /fetch|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|timed? ?out|unavailable/i.test(msg)
    || /unavailable|internal-error|network/i.test(code);
}

type Counts = Record<AppCheckOutcome, number>;
const zero = (): Counts => ({ valid: 0, missing: 0, invalid: 0, unverifiable: 0 });
const counts: Record<ClientKind, Counts> = { web: zero(), native: zero() };
let refused = 0;
let since = Date.now();

/** Test-only reset. */
export function __resetAppCheckCounts(): void {
  counts.web = zero(); counts.native = zero(); refused = 0; since = Date.now();
}

/** What the admin card shows. Counts are PER INSTANCE since this server started, and say so. */
export function appCheckStats(env: NodeJS.ProcessEnv = process.env) {
  return {
    mode: appCheckMode(env),
    siteKeyConfigured: appCheckSiteKey(env) !== null,
    since: new Date(since).toISOString(),
    scope: 'this server instance since it started',
    web: { ...counts.web },
    native: { ...counts.native },
    refused,
  };
}

export type TokenVerifier = (token: string) => Promise<void>;

let cachedVerifier: TokenVerifier | null = null;
/** The real verifier: firebase-admin's App Check. Throws on a bad token. */
async function defaultVerifier(): Promise<TokenVerifier> {
  if (cachedVerifier) return cachedVerifier;
  // Imported lazily: health.ts reads `appCheckSiteKey` from this module, and pulling the whole auth
  // middleware (and its database client) into that route for a string would be a side effect.
  const { adminAppOptions } = await import('./authMiddleware');
  const admin = await loadFirebaseAdmin();
  if (!admin.apps || admin.apps.length === 0) admin.initializeApp(adminAppOptions());
  const ac = admin.appCheck();
  cachedVerifier = async (token: string) => { await ac.verifyToken(token); };
  return cachedVerifier;
}

const VERIFY_TIMEOUT_MS = 2_000;

/** Classify one request's token. Never throws. */
export async function classifyAppCheck(token: string | undefined, verify?: TokenVerifier): Promise<AppCheckOutcome> {
  const t = String(token || '').trim();
  if (!t) return 'missing';
  if (t.length > 4096) return 'invalid';
  let fn: TokenVerifier;
  try {
    fn = verify ?? await defaultVerifier();
  } catch {
    return 'unverifiable';
  }
  try {
    await Promise.race([
      fn(t),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('app-check verify timed out')), VERIFY_TIMEOUT_MS)),
    ]);
    return 'valid';
  } catch (err) {
    return isVerifierOutage(err) ? 'unverifiable' : 'invalid';
  }
}

/**
 * The middleware. Mounted once, early; it touches ONLY protected routes and passes everything else
 * straight through without reading a header.
 */
export function appCheckGuard(opts: { verify?: TokenVerifier; env?: NodeJS.ProcessEnv } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const env = opts.env ?? process.env;
    const mode = appCheckMode(env);
    if (mode === 'off' || !isProtectedRoute(req.method, req.path)) { next(); return; }
    const header = req.headers['x-firebase-appcheck'];
    const outcome = await classifyAppCheck(typeof header === 'string' ? header : undefined, opts.verify);
    const kind = clientKind(typeof req.headers.origin === 'string' ? req.headers.origin : undefined);
    counts[kind][outcome] += 1;
    if (shouldRefuse(mode, outcome)) {
      refused += 1;
      // Generic on purpose: which check failed is not something to teach a script.
      res.status(401).json({ error: 'This request could not be verified. Please update the app or refresh the page and try again.' });
      return;
    }
    next();
  };
}

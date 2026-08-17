// TWO THINGS THAT GO WRONG *AFTER* THE USER FINDS THE RIGHT KEY (admin 2026-08-17, slice 2).
//
// Slice 1 got people to the right console page. Both failures below happen once they are already
// holding a correct, working credential — which is exactly why nothing in the stack catches them today:
// the key is valid, the build is green, the preview renders, and the app is still wrong.
//
// ── 1. THE TEST KEY THAT NEVER TAKES MONEY ──────────────────────────────────────────────────────────
// Every payment console hands out a sandbox pair first, and building against it is the CORRECT thing to
// do. The failure is silent and comes later: the app ships, a real customer pays, and nothing arrives —
// because `rzp_test_` / `sk_test_` charges an imaginary card perfectly. There is no error anywhere. The
// user discovers it from a missing settlement, days after they stopped looking at NavBharatAI.
// This is INFORMATION, not a defect. It must never scold, never block, and never imply the key is wrong.
//
// ── 2. THE LIVE SECRET PUBLISHED TO EVERY VISITOR ───────────────────────────────────────────────────
// A `VITE_`/`NEXT_PUBLIC_`/`REACT_APP_` prefix is not a naming style — it is an instruction to the
// bundler to INLINE that value into the JavaScript every visitor downloads. A user who saves their
// Stripe secret key as `VITE_STRIPE_SECRET_KEY` because the publishable one needed the prefix has
// published a key that can charge cards and issue refunds. The app works flawlessly, which is what makes
// this the most dangerous state in the whole credential flow.
//
// ── WHY THIS IS A SEPARATE MODULE FROM secretPreflight.ts ───────────────────────────────────────────
// That module answers "does this credential WORK". These are a different axis entirely: a live secret in
// a browser variable works perfectly and is a disaster, and a test key connects successfully and takes
// no money. Folding either into `SecretStatus` would force one value to hold two unrelated verdicts and
// would make an exposed key look like a *broken* one. They are orthogonal, so they are separate.
//
// ── PRECISION BUDGET ────────────────────────────────────────────────────────────────────────────────
// A false "your key is exposed" is expensive: it teaches people to ignore the warning, and the next one
// is the real one. So every rule here needs a POSITIVE identification — either the curated catalogue
// says that variable is server-only, or the value carries a prefix that cannot be anything but a secret.
// A value we do not recognise produces NOTHING. Silence is the default, not the fallback.
//
// PURE — no I/O, no LLM call, zero added cost. Never blocks or fails a build.

import { findRecipeVar } from './credentialRecipes';

export type CredentialWarningKind =
  /** A sandbox credential: correct for building, takes no real money. */
  | 'test-key'
  /** A server-only secret saved under a name the bundler publishes to every visitor. */
  | 'exposed-secret';

export interface CredentialWarning {
  kind: CredentialWarningKind;
  /** The variable as the user saved it. */
  name: string;
  /** Written for the USER, naming the screen they can act on. Never contains the value. */
  message: string;
}

/** Prefixes a bundler inlines into the browser bundle. */
const BROWSER_PREFIX = /^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)/;

/**
 * Value prefixes that CANNOT be anything but a server secret, whatever the variable is called.
 *
 * This is the catalogue-independent half of the exposure check: a user can save a Stripe secret under
 * any name they like, and `sk_live_…` is a secret key in every naming scheme there has ever been. Kept
 * to shapes with a vendor-assigned, unambiguous prefix — a generic long random string is not on this
 * list, because "looks secret" is a guess and this file does not guess.
 */
const UNAMBIGUOUS_SECRET_VALUE = [
  /^sk_(?:live|test)_/,   // Stripe / Clerk secret key
  /^rk_(?:live|test)_/,   // Stripe restricted key
  /^whsec_/,              // Stripe webhook signing secret
  /^sk\./,                // Mapbox secret token
  /^SG\./,                // SendGrid API key
];

/** True when the bundler would publish a variable of this name to every visitor. PURE. */
export function isBrowserExposedName(name: string): boolean {
  return BROWSER_PREFIX.test(String(name ?? '').trim());
}

/** True when the value's own prefix identifies it as a server secret, regardless of its name. PURE. */
export function isUnambiguouslySecretValue(value: string): boolean {
  const v = String(value ?? '').trim();
  return v.length > 0 && UNAMBIGUOUS_SECRET_VALUE.some((re) => re.test(v));
}

/**
 * The sandbox prefix this value carries, or null.
 *
 * Read from the curated catalogue rather than pattern-matched, because `test` appears in plenty of
 * legitimate values and only the provider knows which prefix actually means sandbox mode. PURE.
 */
export function testKeyPrefix(name: string, value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const spec = findRecipeVar(name);
  for (const prefix of spec?.testPrefixes || []) if (v.startsWith(prefix)) return prefix;
  return null;
}

/**
 * Everything worth telling the user about ONE saved credential.
 *
 * Both warnings can apply at once — a `VITE_STRIPE_SECRET_KEY` holding `sk_test_…` is both published to
 * the browser and unable to take money — and both are reported, because fixing one leaves the other.
 * PURE.
 */
export function inspectCredential(name: string, value: string): CredentialWarning[] {
  const varName = String(name ?? '').trim();
  const v = String(value ?? '').trim();
  if (!varName || !v) return [];
  const out: CredentialWarning[] = [];

  if (isBrowserExposedName(varName)) {
    // Two independent proofs, either of which is enough. The catalogue is the precise one; the value
    // prefix catches a secret saved under a name the catalogue has never heard of.
    const serverOnly = findRecipeVar(varName)?.serverOnly === true;
    if (serverOnly || isUnambiguouslySecretValue(v)) {
      out.push({
        kind: 'exposed-secret',
        name: varName,
        message: `⚠️ ${varName} is a SECRET, but its name starts with a prefix that publishes it inside your app's `
          + 'public code — anyone who opens your site can read it. Save it WITHOUT that prefix in '
          + 'Settings → App Settings → Secrets & API Keys, use it only in your server code, and then '
          + 'change the key in the provider\'s dashboard, because the old value must be treated as public.',
      });
    }
  }

  const prefix = testKeyPrefix(varName, v);
  if (prefix) {
    out.push({
      kind: 'test-key',
      name: varName,
      message: `ℹ️ ${varName} is a test key, which is exactly right while you are building — but it cannot take real `
        + 'money. Real payments will look successful and nothing will reach your account. Swap it for the live key in '
        + 'Settings → App Settings → Secrets & API Keys before you share the app with customers.',
    });
  }
  return out;
}

/**
 * Every warning across a user's whole vault, in a stable order.
 *
 * Exposure comes first wherever both are present: one is a security incident the user should act on
 * today, the other is a note about a switch they will make later. PURE.
 */
export function inspectCredentials(secrets: Record<string, string> | null | undefined): CredentialWarning[] {
  const entries = Object.entries(secrets && typeof secrets === 'object' ? secrets : {});
  const all = entries.flatMap(([name, value]) => inspectCredential(name, String(value ?? '')));
  const rank = (k: CredentialWarningKind) => (k === 'exposed-secret' ? 0 : 1);
  return all.sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name));
}

/**
 * A one-line, admin-facing summary for the build report, or `''` when the vault is clean.
 *
 * Names variables only — never a value, not even truncated. A build report is persisted and assembled
 * into an admin inbox, and half a live secret key in permanent storage is still a leak. PURE.
 */
export function credentialWarningSummary(warnings: CredentialWarning[]): string {
  if (!Array.isArray(warnings) || warnings.length === 0) return '';
  const exposed = warnings.filter((w) => w.kind === 'exposed-secret').map((w) => w.name);
  const test = warnings.filter((w) => w.kind === 'test-key').map((w) => w.name);
  const parts: string[] = [];
  if (exposed.length) parts.push(`${exposed.length} server secret(s) saved under a browser-published name: ${exposed.join(', ')}`);
  if (test.length) parts.push(`${test.length} sandbox key(s) that cannot take real money: ${test.join(', ')}`);
  return parts.join(' · ');
}

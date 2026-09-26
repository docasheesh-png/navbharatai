// HOW MANY PEOPLE TRIED TO CLAIM THEIR WELCOME CREDIT, HOW MANY WERE PAID, AND WHY WERE THE REST REFUSED?
//
// 🔴 WHY THIS HAD TO BE BUILT (admin 2026-09-26, with a screen of new accounts all at ₹0: *"abhi bhi
// token nahi mil rahe"*). The referral records store only what was PAID. A user who never tried and a
// user who tried five times and was refused by the device check leave the SAME trace: nothing. So the
// one question that decides what to fix — "is nobody claiming, or is the check refusing real phones?" —
// had no answer anywhere, and the admin's only instrument was a column of zeros. Refused claims were
// being answered and thrown away, the same shape `mobileBuildOutcomeStore.ts` was written to end.
//
// 🔑 PATTERNED ON `mobileBuildOutcomeStore.ts`: one document per UTC day, `FieldValue.increment` per
// key, plus one small marker per (user, day) so the number of PEOPLE is honest. An automatic claim can
// fire on every app open, so attempts alone would inflate with patience rather than with users.
//
// 🔒 IT MOVES NO MONEY AND CAN NEVER BLOCK A CLAIM. Every write is best-effort and swallowed; callers
// fire it without awaiting. A lost write costs one line of a day's tally; a thrown one would cost a
// user the reply to the claim they just made.
//
// 🔒 NOTHING IN IT NAMES A PERSON. The daily document holds counts only; the per-user marker's id is a
// digest of (day, uid) and its body is a timestamp.

import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { getServerDb } from './serverDb';
import { outcomeDayKey } from './mobileBuildOutcomeStore';

export const REFERRAL_CLAIM_OUTCOME_COLLECTION = 'referral_claim_outcomes';
/** One marker per (user, UTC day): what turns "attempts" into "people". */
export const REFERRAL_CLAIM_PERSON_COLLECTION = 'referral_claim_people';

export type ClaimSurface = 'android' | 'web';

/**
 * How one claim ended. `device-failed-on-phone` never reaches the claim route at all — the phone could
 * not produce a device token, so the app reports it separately (`/claim-failed`). Without that report
 * the most likely failure on a real handset would be the one kind this counter could not see.
 */
export type ClaimOutcome =
  | 'paid'
  | 'nothing-new'
  | 'held-no-mobile'
  | 'step-not-done'
  | 'device-refused'
  | 'device-unavailable'
  | 'device-failed-on-phone'
  | 'error';

export const CLAIM_OUTCOMES: readonly ClaimOutcome[] = [
  'paid', 'nothing-new', 'held-no-mobile', 'step-not-done',
  'device-refused', 'device-unavailable', 'device-failed-on-phone', 'error',
];

const SURFACES: readonly ClaimSurface[] = ['android', 'web'];

/**
 * Collapse `checkDeviceIntegrity`'s admin detail into a short, bounded key. PURE.
 *
 * The detail strings carry values (a package name, an age in seconds, a verdict array) and would make
 * an unbounded set of Firestore field names; this keeps only the class, which is what decides the fix:
 * `app-not-play-recognized` means the install did not come from Play, `device-integrity` means the
 * phone itself failed, `google-*` means our side. Anything unrecognised is `other`, never guessed.
 */
export function deviceRefusalCategory(detail: string | null | undefined): string {
  const d = String(detail ?? '').toLowerCase();
  if (!d) return 'other';
  if (d.includes('not configured')) return 'not-configured';
  if (d.includes('access token')) return 'no-google-access-token';
  if (d.includes('unreachable')) return 'google-unreachable';
  const http = /play integrity http (\d{3})/.exec(d);
  if (http) return Number(http[1]) >= 500 ? 'google-5xx' : 'token-rejected-4xx';
  if (d.includes('no payload')) return 'no-payload';
  if (d.includes('package name') || d.includes('integrity token is for')) return 'wrong-package';
  if (d.startsWith('app verdict')) return 'app-not-play-recognized';
  if (d.startsWith('device verdict')) return 'device-integrity';
  if (d.includes('timestamp') || d.includes('token age')) return 'token-stale';
  if (d.includes('missing integrity token')) return 'missing-token';
  if (d.includes('device id')) return 'missing-device-id';
  return 'other';
}

/**
 * Google's Play Integrity client error codes (`IntegrityErrorCode`), by the number its message carries.
 * PURE. The code is the diagnosis: -16 is a wrong cloud project number baked into the build, -1 means
 * the API is not available to this app, -2/-6/-14/-15 are the phone's Play Store or Play services.
 */
const INTEGRITY_ERROR_NAMES: Record<string, string> = {
  '-1': 'api-not-available', '-2': 'play-store-not-found', '-3': 'network-error',
  '-4': 'play-store-account-not-found', '-5': 'app-not-installed', '-6': 'play-services-not-found',
  '-7': 'app-uid-mismatch', '-8': 'too-many-requests', '-9': 'cannot-bind-to-service',
  '-10': 'nonce-too-short', '-11': 'nonce-too-long', '-12': 'google-server-unavailable',
  '-13': 'nonce-not-base64', '-14': 'play-store-outdated', '-15': 'play-services-outdated',
  '-16': 'cloud-project-number-invalid', '-17': 'request-hash-too-long', '-18': 'client-transient-error',
  '-100': 'internal-error',
};

/** The class of a failure the PHONE reported before any claim was sent. PURE; bounded; never guesses. */
export function phoneCheckFailureCategory(outcome: string | null | undefined, message: string | null | undefined): string {
  const o = String(outcome ?? '').trim().toLowerCase();
  if (o === 'unavailable') return 'plugin-unavailable';
  if (o === 'not-configured') return 'not-configured-in-this-build';
  const m = String(message ?? '');
  const code = /(?:error|code)[^()\d-]{0,20}\((-?\d{1,3})\)|^\s*(-\d{1,3})\s*:/i.exec(m);
  const n = code ? (code[1] ?? code[2]) : null;
  if (n && INTEGRITY_ERROR_NAMES[n]) return `google-${INTEGRITY_ERROR_NAMES[n]}`;
  if (/missing required propert/i.test(m)) return 'request-malformed';
  if (/identifier/i.test(m)) return 'no-device-id';
  if (/empty token/i.test(m)) return 'empty-token';
  return 'phone-check-failed';
}

/** Only these characters reach a field path — a dot would split it, anything else is noise. */
function fieldKey(raw: string): string {
  const k = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return k || 'other';
}

/** The marker id: a digest of (day, user), so the collection answers "counted?" and names nobody. */
export function personMarkerId(day: string, userId: string): string {
  return createHash('sha256').update(`${day}\u0000${userId}`).digest('hex');
}

function db(): admin.firestore.Firestore | null {
  try { return getServerDb(); } catch { return null; }
}

/**
 * Count one claim. Best-effort; never throws; callers do not await it.
 *
 * `reason` is a short class (a device-refusal category, the step that was not done, the decision's own
 * reason); `tokens` is what was paid, counted only on `paid`.
 */
export async function recordClaimOutcome(
  userId: string,
  surface: ClaimSurface,
  outcome: ClaimOutcome,
  opts: { reason?: string; tokens?: number; atMs?: number } = {},
): Promise<boolean> {
  const store = db();
  if (!store || !userId) return false;
  const atMs = opts.atMs ?? Date.now();
  const day = outcomeDayKey(atMs);
  const inc = admin.firestore.FieldValue.increment;

  // The person marker first. `create` fails on a repeat, which is exactly "already counted today".
  let newPerson = false;
  try {
    await store.collection(REFERRAL_CLAIM_PERSON_COLLECTION).doc(personMarkerId(day, userId)).create({ countedAt: atMs });
    newPerson = true;
  } catch { /* already counted today, or the store is unavailable — either way not a new person */ }

  const patch: Record<string, unknown> = {
    day,
    attempts: { [surface]: { [outcome]: inc(1) } },
  };
  if (newPerson) patch.people = { [surface]: inc(1) };
  if (opts.reason) patch.reasons = { [surface]: { [`${outcome}:${fieldKey(opts.reason)}`]: inc(1) } };
  if (outcome === 'paid' && Number(opts.tokens) > 0) patch.paidTokens = { [surface]: inc(Number(opts.tokens)) };

  try {
    await store.collection(REFERRAL_CLAIM_OUTCOME_COLLECTION).doc(day).set(patch, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export interface DailyClaimOutcomes {
  day: string;
  attempts: Partial<Record<ClaimSurface, Partial<Record<ClaimOutcome, number>>>>;
  people: Partial<Record<ClaimSurface, number>>;
  reasons: Partial<Record<ClaimSurface, Record<string, number>>>;
  paidTokens: Partial<Record<ClaimSurface, number>>;
}

/** The last `days` UTC days, newest first. Bounded; never throws. */
export async function listDailyClaimOutcomes(days = 14): Promise<DailyClaimOutcomes[]> {
  const store = db();
  if (!store) return [];
  try {
    const snap = await store.collection(REFERRAL_CLAIM_OUTCOME_COLLECTION)
      .orderBy('day', 'desc')
      .limit(Math.max(1, Math.min(90, days)))
      .get();
    return snap.docs
      .map((d) => d.data() as Partial<DailyClaimOutcomes>)
      .filter((r): r is DailyClaimOutcomes => !!r && typeof r.day === 'string')
      .map((r) => ({ day: r.day, attempts: r.attempts ?? {}, people: r.people ?? {}, reasons: r.reasons ?? {}, paidTokens: r.paidTokens ?? {} }));
  } catch {
    return [];
  }
}

export interface ClaimSurfaceTally {
  surface: ClaimSurface;
  /** Distinct (person, day) pairs that made at least one claim. */
  people: number;
  attempts: number;
  byOutcome: Record<ClaimOutcome, number>;
  paidTokens: number;
  /** Why claims were refused, commonest first — `outcome:reason`. */
  reasons: Array<{ key: string; count: number }>;
}

export interface ClaimOutcomeSummary {
  days: number;
  bySurface: ClaimSurfaceTally[];
  /** The one-line reading of the numbers, for the admin. Never a guess past what the counts say. */
  headline: string;
}

/**
 * Turn the day rows into what the admin card shows. PURE — no clock, no I/O.
 *
 * ⚠️ `people` sums per day, so one person who tried on two days counts twice. It is labelled
 * "person-days" on the card for exactly that reason, rather than rounded into a claim it cannot make.
 */
export function summariseClaimOutcomes(rows: readonly DailyClaimOutcomes[]): ClaimOutcomeSummary {
  const bySurface = SURFACES.map((surface): ClaimSurfaceTally => {
    const byOutcome = Object.fromEntries(CLAIM_OUTCOMES.map((o) => [o, 0])) as Record<ClaimOutcome, number>;
    let people = 0; let paidTokens = 0;
    const reasons = new Map<string, number>();
    for (const r of rows) {
      people += Number(r.people?.[surface] ?? 0) || 0;
      paidTokens += Number(r.paidTokens?.[surface] ?? 0) || 0;
      for (const o of CLAIM_OUTCOMES) byOutcome[o] += Number(r.attempts?.[surface]?.[o] ?? 0) || 0;
      for (const [k, n] of Object.entries(r.reasons?.[surface] ?? {})) reasons.set(k, (reasons.get(k) ?? 0) + (Number(n) || 0));
    }
    const attempts = CLAIM_OUTCOMES.reduce((n, o) => n + byOutcome[o], 0);
    return {
      surface, people, attempts, byOutcome, paidTokens,
      reasons: [...reasons.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    };
  }).filter((t) => t.attempts > 0);

  return { days: rows.length, bySurface, headline: claimHeadline(bySurface) };
}

/** The sentence the admin reads first. Each branch states only what the counts prove. */
export function claimHeadline(tallies: readonly ClaimSurfaceTally[]): string {
  const attempts = tallies.reduce((n, t) => n + t.attempts, 0);
  if (attempts === 0) {
    return 'Nobody has tried to claim yet. If new accounts are at ₹0, they have not reached a claim — on the website that needs a verified mobile, and on the app the automatic claim needs build 135 or later.';
  }
  const android = tallies.find((t) => t.surface === 'android');
  if (android && android.attempts > 0) {
    const deviceRefused = android.byOutcome['device-refused'] + android.byOutcome['device-unavailable'] + android.byOutcome['device-failed-on-phone'];
    if (android.byOutcome.paid === 0 && deviceRefused > 0) {
      return 'App claims are reaching the server and the device check is refusing every one — see the reasons below. Real phones are not being paid.';
    }
    if (deviceRefused > android.byOutcome.paid) {
      return 'More app claims are refused by the device check than are paid — see the reasons below.';
    }
  }
  return 'Claims are being made and paid. Refusals, if any, are listed with their reasons below.';
}

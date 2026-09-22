// HOW OFTEN DOES A USER'S APP BUILD ACTUALLY FAIL, AND OF WHAT? — the number this pipeline writes
// down every day and has never once been able to read back.
//
// 🔴 WHY THIS HAD TO BE BUILT (admin 2026-09-22: *"NavBharatAI ka user jab apni app ka APK banata hai
// to 80% baar fail hoti hai"*). That 80% is an impression, and the irony is exact: the server ALREADY
// classifies every real failure and already writes the class down —
//     appBuildStore.setOutcome(uid, owner, repo, 'failure', diag.code)
// — and `failureCode` appears in this repository at four places, **all four inside `AppBuildStore.ts`
// itself**: the field, its comment, the parameter, the write. Nothing reads it. Ever. The one number
// that could answer "why do they fail?" was being produced and thrown away.
//
// 🔑 AND THE RECORD IT WAS WRITTEN INTO COULD NEVER HAVE ANSWERED IT ANYWAY, which is why this is a new
// counter rather than a query. `setOutcome` writes the LATEST outcome onto one document per
// (user, owner, repo), and a SUCCESS explicitly clears the previous failure's code. So an app that
// failed nine times and then worked contributes **zero** failures to any scan of those rows. A biased
// sample reads as an ABSENCE of the problem, which is worse than no measurement because nobody doubts
// it — the exact class `REPEATED_READS` was moved out of another feature's conditional for.
//
// 🔑 PATTERNED ON `agentv3_engine_use`, WHICH IS PATTERNED ON `agentv3_sandbox_starts`. One document
// per UTC day, `FieldValue.increment` per key. No new storage idea enters the codebase, and a per-RUN
// row (unbounded) is avoided: one small document however many builds run.
//
// 🔒 AN OBSERVATION MUST NEVER BLOCK A BUILD. Every write here is best-effort and swallowed, exactly
// like the two counters it mirrors. A failed write costs one day's accuracy; a thrown write would cost
// a user the status of the build they are watching.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { SHIP_WORKFLOWS } from '../../lib/shipWorkflows';

export const MOBILE_BUILD_OUTCOME_COLLECTION = 'mobile_build_outcomes';
/**
 * One marker per finished run, so a poll that repeats cannot count the same build twice.
 *
 * The status endpoint is POLLED — a client asks it every few seconds while a build runs, and keeps
 * asking after it finishes. `setOutcome` survives that because it overwrites one document; an
 * INCREMENT does not. This is the same `create()`-as-claim the failure-report inbox already uses
 * (`AdminApkReportStore.saveApkFailureReport`) and that `hosting-daily-bill` uses before it moves money.
 */
export const MOBILE_BUILD_COUNTED_COLLECTION = 'mobile_build_counted';

/** The three lanes a user can press, plus the honest bucket for anything else. */
export type BuildLane = 'apk' | 'aab' | 'ipa' | 'other';
export type BuildOutcome = 'success' | 'failure' | 'cancelled';

export interface DailyBuildOutcomes {
  day: string;
  /** Per lane: how every finished run of that lane ended. The DENOMINATOR. */
  outcomes: Partial<Record<BuildLane, Partial<Record<BuildOutcome, number>>>>;
  /** Per lane: which failure class was diagnosed. A SUBSET of the failures above — see `summarise`. */
  codes: Partial<Record<BuildLane, Record<string, number>>>;
}

/** UTC day key. The SERVER's clock, never a device's — the same rule the wallet rollup follows. */
export function outcomeDayKey(atMs: number = Date.now()): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/**
 * Which lane is this workflow? Derived from the ONE registry the dispatch allow-list also reads, so a
 * renamed workflow cannot leave this counter silently filing everything under `other`.
 *
 * A short slug rather than the filename on purpose: the admin's question is "apk / aab / ipa", and a
 * filename carries a dot, which is a field-path separator in half of Firestore's write shapes.
 */
export function buildLane(workflow: string | null | undefined): BuildLane {
  const file = String(workflow ?? '').trim();
  if (file === SHIP_WORKFLOWS.androidApk) return 'apk';
  if (file === SHIP_WORKFLOWS.androidAab) return 'aab';
  if (file === SHIP_WORKFLOWS.iosIpa) return 'ipa';
  return 'other';
}

function db(): admin.firestore.Firestore | null {
  try { return getServerDb(); } catch { return null; }
}

/**
 * Count ONE finished run, once. Best-effort; never throws.
 *
 * The marker is claimed FIRST and the counter moved only if the claim was ours. A claim that lands
 * with an increment that then fails loses one build from the day's total, which is the only direction
 * a measurement may be wrong in: under-counting is visible as a smaller sample, while double-counting
 * would inflate the very rate the admin is trying to judge.
 */
export async function recordBuildOutcome(
  owner: string, repo: string, runId: string,
  workflow: string, outcome: BuildOutcome,
  atMs: number = Date.now(),
): Promise<boolean> {
  const store = db();
  if (!store || !owner || !repo || !runId) return false;
  const lane = buildLane(workflow);
  try {
    await store.collection(MOBILE_BUILD_COUNTED_COLLECTION)
      .doc(`${owner}_${repo}_${runId}`)
      .create({ owner, repo, runId, lane, outcome, countedAt: atMs });
  } catch {
    // ALREADY_EXISTS on a repeat poll is the expected, silent case — this run is already in the day's
    // total. Any other failure is also best-effort: a build's status must never wait on telemetry.
    return false;
  }
  try {
    const day = outcomeDayKey(atMs);
    await store.collection(MOBILE_BUILD_OUTCOME_COLLECTION).doc(day).set(
      { day, outcomes: { [lane]: { [outcome]: admin.firestore.FieldValue.increment(1) } } },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Count ONE diagnosed failure class. Best-effort; never throws.
 *
 * ⚠️ CALLED ONLY WHERE THE DIAGNOSIS IS ALREADY IDEMPOTENT. The automatic failure report claims its own
 * document with `create()` and returns true exactly once per run, so this rides that claim rather than
 * inventing a second one. Do NOT call this from a path that can repeat.
 */
export async function recordBuildFailureCode(
  workflow: string, code: string, atMs: number = Date.now(),
): Promise<boolean> {
  const store = db();
  const name = String(code ?? '').trim();
  if (!store || !name) return false;
  try {
    const day = outcomeDayKey(atMs);
    const lane = buildLane(workflow);
    await store.collection(MOBILE_BUILD_OUTCOME_COLLECTION).doc(day).set(
      { day, codes: { [lane]: { [name]: admin.firestore.FieldValue.increment(1) } } },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** The last `days` UTC days of counters, newest first. Bounded; never throws. */
export async function listDailyBuildOutcomes(days = 30): Promise<DailyBuildOutcomes[]> {
  const store = db();
  if (!store) return [];
  try {
    const snap = await store.collection(MOBILE_BUILD_OUTCOME_COLLECTION)
      .orderBy('day', 'desc')
      .limit(Math.max(1, Math.min(90, days)))
      .get();
    return snap.docs
      .map((d) => d.data() as Partial<DailyBuildOutcomes>)
      .filter((r): r is DailyBuildOutcomes => !!r && typeof r.day === 'string')
      .map((r) => ({ day: r.day, outcomes: r.outcomes ?? {}, codes: r.codes ?? {} }));
  } catch {
    return [];
  }
}

export interface LaneTally {
  lane: BuildLane;
  success: number;
  failure: number;
  cancelled: number;
  finished: number;
  /** Failures ÷ finished, as a percentage rounded to one place. Null when nothing finished. */
  failureRatePct: number | null;
}

export interface OutcomeSummary {
  days: number;
  success: number;
  failure: number;
  cancelled: number;
  finished: number;
  failureRatePct: number | null;
  byLane: LaneTally[];
  /** Every diagnosed class, commonest first, with its share OF DIAGNOSED FAILURES (never of all). */
  topCodes: Array<{ code: string; count: number; sharePct: number; lanes: Partial<Record<BuildLane, number>> }>;
  /** How many failures carry a diagnosis. The honesty half — see the note on `diagnosisGap`. */
  diagnosed: number;
  /**
   * Failures counted with no class recorded against them.
   *
   * 🔒 THIS NUMBER MUST BE SHOWN WHEREVER `topCodes` IS. A class is recorded when the automatic failure
   * report lands, which happens while a client is polling; a user who closes the tab the moment their
   * build goes red is counted in `failure` and in no code. Presenting the breakdown without this gap
   * would invite reading a partial tally as the whole picture — which is the mistake this whole module
   * exists to stop being possible.
   */
  diagnosisGap: number;
}

const LANES: readonly BuildLane[] = ['apk', 'aab', 'ipa', 'other'];

/**
 * Turn the day rows into the numbers the admin card shows. PURE — no clock, no I/O.
 *
 * Every figure is a COUNT of things that really happened, never an estimate: call it twice with the
 * same rows and it answers the same way.
 */
export function summariseBuildOutcomes(rows: readonly DailyBuildOutcomes[]): OutcomeSummary {
  const tallyLane = (lane: BuildLane): LaneTally => {
    let success = 0, failure = 0, cancelled = 0;
    for (const r of rows) {
      const o = r.outcomes?.[lane] ?? {};
      success += Number(o.success ?? 0) || 0;
      failure += Number(o.failure ?? 0) || 0;
      cancelled += Number(o.cancelled ?? 0) || 0;
    }
    // CANCELLED IS NOT A FAILURE and is kept out of the denominator: a user who pressed Stop did not
    // meet a broken build, and counting them would make the rate move with impatience rather than with
    // reliability — the one thing this number is for.
    const finished = success + failure;
    return {
      lane, success, failure, cancelled, finished,
      failureRatePct: finished > 0 ? Math.round((failure / finished) * 1000) / 10 : null,
    };
  };

  const byLane = LANES.map(tallyLane).filter((t) => t.success + t.failure + t.cancelled > 0);
  const success = byLane.reduce((n, t) => n + t.success, 0);
  const failure = byLane.reduce((n, t) => n + t.failure, 0);
  const cancelled = byLane.reduce((n, t) => n + t.cancelled, 0);
  const finished = success + failure;

  const counts = new Map<string, { count: number; lanes: Partial<Record<BuildLane, number>> }>();
  for (const r of rows) {
    for (const l of LANES) {
      for (const [code, n] of Object.entries(r.codes?.[l] ?? {})) {
        const add = Number(n) || 0;
        if (add <= 0) continue;
        const row = counts.get(code) ?? { count: 0, lanes: {} };
        row.count += add;
        row.lanes[l] = (row.lanes[l] ?? 0) + add;
        counts.set(code, row);
      }
    }
  }
  const diagnosed = [...counts.values()].reduce((n, r) => n + r.count, 0);
  const topCodes = [...counts.entries()]
    .map(([code, r]) => ({
      code,
      count: r.count,
      sharePct: diagnosed > 0 ? Math.round((r.count / diagnosed) * 1000) / 10 : 0,
      lanes: r.lanes,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    days: rows.length,
    success, failure, cancelled, finished,
    failureRatePct: finished > 0 ? Math.round((failure / finished) * 1000) / 10 : null,
    byLane,
    topCodes,
    diagnosed,
    // Never negative: more diagnoses than failures would mean a repeat slipped a guard, and reporting
    // a negative gap would hide that behind a tidy-looking zero.
    diagnosisGap: Math.max(0, failure - diagnosed),
  };
}

/**
 * Which classes can a repair ever fix? Used by the card to say what the number MEANS, because the three
 * shapes of "80%" have three different cures and only one of them is the repair loop:
 *
 *  • app-code failures  → the user's own app does not compile → a better repair loop is the right lever
 *  • credential failures→ the user's own key is missing → no loop, however good, can ever help
 *  • UNKNOWN            → the classifier is blind → an eye first, then a cure
 *
 * ⚠️ DERIVED FROM `classifyBuildFailure`'s own `autoFixable`, never from a second list kept by hand —
 * `tests/theFailureCodesAreCounted.test.ts` asserts the two agree.
 */
export type CureFamily = 'repairable' | 'user-credentials' | 'unclassified';

/**
 * The classes NO repair loop can ever fix, however good it gets.
 *
 * These are the user's own credentials, not a file with a mistake in it: a signing key is the app's
 * permanent Play Store identity, a Google services file is their Firebase project, a registry token is
 * their npm account. Spending attempts on them is spending the user's time on a certainty — the cure is
 * to put the right button in front of them (the one-press key creation already exists).
 */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set([
  'MISSING_SIGNING_SECRET',
  'SIGNING_CREDENTIALS_WRONG',
  'GOOGLE_SERVICES_MISSING',
  'NPM_REGISTRY_AUTH',
]);

/**
 * Which cure does this class need? PURE.
 *
 * The admin's "80%" can be three completely different problems with three different answers, and the
 * card exists to tell them apart:
 *  • `repairable`        → the repair loop is the right lever, so make the loop better
 *  • `user-credentials`  → no loop helps; show the button that does
 *  • `unclassified`      → the classifier is blind here; give it an eye before prescribing anything
 *
 * ⚠️ `tests/theFailureCodesAreCounted.test.ts` reads EVERY code `classifyBuildFailure` can emit out of
 * its source and asserts each one lands in a family deliberately — so a 22nd class cannot quietly
 * inherit `repairable` and make the biggest number on this card a guess.
 */
export function cureFamily(code: string): CureFamily {
  const name = String(code ?? '').trim().toUpperCase();
  if (!name || name === 'UNKNOWN') return 'unclassified';
  return CREDENTIAL_CODES.has(name) ? 'user-credentials' : 'repairable';
}

/** The diagnosed failures split by what would actually cure them. Counts, never estimates. */
export function cureSplit(summary: OutcomeSummary): Record<CureFamily, number> {
  const out: Record<CureFamily, number> = { repairable: 0, 'user-credentials': 0, unclassified: 0 };
  for (const c of summary.topCodes) out[cureFamily(c.code)] += c.count;
  return out;
}

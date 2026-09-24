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
import { createHash } from 'node:crypto';
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

/**
 * The marker's document id: a digest of the run, never the run's own names.
 *
 * 🔴 WHY IT IS HASHED. `owner` is a person's GitHub login. This marker answers exactly one question —
 * *"have I already counted this run?"* — and that question does not need to know whose run it was. The
 * first version stored `${owner}_${repo}_${runId}` as the id AND `{ owner, repo }` in the body, which
 * put an identifier into a collection that grows with every build, is keyed by nothing a user owns, and
 * therefore could never be reached by `deleteUserData`. Hashing removes the data rather than promising
 * to erase it later, which is the only version of that promise nothing can quietly break.
 *
 * ⚠️ A PLAIN DIGEST, DELIBERATELY NOT AN HMAC. `siteAnalytics.visitorHash` keys its hash with a secret
 * because its input is an IP address — a 32-bit space anybody can enumerate. This input carries a
 * GitHub run id, which is not enumerable in the same way, and the cost of a secret here is severe in a
 * way it is not there: this id must resolve to the SAME string for ever, and a rotated secret would
 * make every existing claim unfindable at once, so every run still being polled would be counted a
 * second time. That is precisely the defect this document exists to prevent.
 */
export function countedDocId(owner: string, repo: string, runId: string): string {
  return createHash('sha256').update(`${owner}\u0000${repo}\u0000${runId}`).digest('hex');
}

/** The three lanes a user can press, plus the honest bucket for anything else. */
export type BuildLane = 'apk' | 'aab' | 'ipa' | 'other';
export type BuildOutcome = 'success' | 'failure' | 'cancelled';

/**
 * How each AI repair ended (2026-09-22, the loop). `fixed` was RUN through the app's own build first and
 * passed; `unverified-fix` was committed with no build to judge it (the old behaviour, now labelled);
 * `gave-up` means every candidate the model made was proven not to compile and NOTHING was committed;
 * `miss` means no rung answered in contract. The ratio of the first two is the number that says whether
 * the verifier is reaching real builds at all.
 */
export type RepairKind = 'fixed' | 'unverified-fix' | 'gave-up' | 'miss';

export interface DailyBuildOutcomes {
  day: string;
  /** Per lane: how every finished run of that lane ended. The DENOMINATOR. */
  outcomes: Partial<Record<BuildLane, Partial<Record<BuildOutcome, number>>>>;
  /** Per lane: which failure class was diagnosed. A SUBSET of the failures above — see `summarise`. */
  codes: Partial<Record<BuildLane, Record<string, number>>>;
  /** Per lane: how the AI repair loop ended. Counts model-backed repairs only, never the free rule tier. */
  repairs?: Partial<Record<BuildLane, Partial<Record<RepairKind, number>>>>;
  /**
   * How the app reached GitHub: BUILT HERE (its own production output shipped as `www/`, so the runner
   * compiles nothing) or as SOURCE (the runner compiles it, as every ship did before 2026-09-22).
   * Counts SHIP presses, not runs — a press that reached the commit.
   */
  ships?: Partial<Record<ShipKind, number>>;
  /** Why a ship went as source when it could have gone built — the number that says which fallback fires. */
  prebuildSkips?: Record<string, number>;
}

export type ShipKind = 'prebuilt' | 'source';

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
      .doc(countedDocId(owner, repo, runId))
      // The body holds what a count IS — which lane, how it ended, when — and nothing about who ran
      // it. `countedAt` is also the field its retention policy purges on.
      .create({ lane, outcome, countedAt: atMs });
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

/**
 * Count ONE AI repair's outcome. Best-effort; never throws. Called once per autofix request, which the
 * client makes once per failed run — so it needs no idempotency claim of its own.
 */
export async function recordRepairOutcome(
  workflow: string, kind: RepairKind, atMs: number = Date.now(),
): Promise<boolean> {
  const store = db();
  if (!store) return false;
  try {
    const day = outcomeDayKey(atMs);
    const lane = buildLane(workflow);
    await store.collection(MOBILE_BUILD_OUTCOME_COLLECTION).doc(day).set(
      { day, repairs: { [lane]: { [kind]: admin.firestore.FieldValue.increment(1) } } },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Count ONE ship — how the app reached GitHub, and, when it went as source, why the built path stood
 * down. Best-effort; never throws. Called once per setup request that reached the commit, so a press is
 * a press: a user who prepares the same app twice is two ships, which is what the number measures.
 */
export async function recordShip(
  kind: ShipKind, prebuildSkip: string | null = null, atMs: number = Date.now(),
): Promise<boolean> {
  const store = db();
  if (!store) return false;
  try {
    const day = outcomeDayKey(atMs);
    const reason = prebuildSkip && /^[a-z-]{1,32}$/.test(prebuildSkip) ? prebuildSkip : null;
    await store.collection(MOBILE_BUILD_OUTCOME_COLLECTION).doc(day).set(
      {
        day,
        ships: { [kind]: admin.firestore.FieldValue.increment(1) },
        ...(reason ? { prebuildSkips: { [reason]: admin.firestore.FieldValue.increment(1) } } : {}),
      },
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
      .map((r) => ({ day: r.day, outcomes: r.outcomes ?? {}, codes: r.codes ?? {}, repairs: r.repairs ?? {}, ships: r.ships ?? {}, prebuildSkips: r.prebuildSkips ?? {} }));
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
  /** How the AI repairs ended, summed across lanes. All zero until the loop has run for real. */
  repairs: Record<RepairKind, number>;
  /** How apps reached GitHub: built here first, or as source for the runner to compile. */
  ships: Record<ShipKind, number>;
  /** Why the built path stood down, commonest first. Empty until a ship has gone as source with a reason. */
  prebuildSkips: Array<{ reason: string; count: number }>;
}

const LANES: readonly BuildLane[] = ['apk', 'aab', 'ipa', 'other'];
const REPAIR_KINDS: readonly RepairKind[] = ['fixed', 'unverified-fix', 'gave-up', 'miss'];

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

  const repairs: Record<RepairKind, number> = { fixed: 0, 'unverified-fix': 0, 'gave-up': 0, miss: 0 };
  for (const r of rows) {
    for (const l of LANES) {
      for (const k of REPAIR_KINDS) repairs[k] += Math.max(0, Number(r.repairs?.[l]?.[k] ?? 0) || 0);
    }
  }

  const ships: Record<ShipKind, number> = { prebuilt: 0, source: 0 };
  const skipCounts = new Map<string, number>();
  for (const r of rows) {
    ships.prebuilt += Math.max(0, Number(r.ships?.prebuilt ?? 0) || 0);
    ships.source += Math.max(0, Number(r.ships?.source ?? 0) || 0);
    for (const [reason, n] of Object.entries(r.prebuildSkips ?? {})) {
      const count = Math.max(0, Number(n ?? 0) || 0);
      if (count > 0) skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + count);
    }
  }
  const prebuildSkips = [...skipCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    days: rows.length,
    success, failure, cancelled, finished,
    failureRatePct: finished > 0 ? Math.round((failure / finished) * 1000) / 10 : null,
    byLane,
    topCodes,
    diagnosed,
    repairs,
    ships,
    prebuildSkips,
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

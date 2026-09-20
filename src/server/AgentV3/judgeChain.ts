// THE JUDGE'S FALL-THROUGH, MOVED TO WHERE THE FAILURES ACTUALLY HAPPEN (autopsy 2026-09-20).
//
// Admin, verbatim: *"nvidia nahi chal rah hai. jabki woh free hai. dekho kya problem hai. kaha?"* —
// and the honest answer was that **nothing in this platform could say where**, which is what this
// module exists to end.
//
// 🔴 THE BUG THIS REPLACES, and it is a promise the old code made in writing and did not keep.
// `selectReviewJudge` built each judge like this:
//
//     try { const client = new OpenAI({ apiKey, baseURL, … }); … return { runTurn, … }; }
//     catch { /* fall through to the GLM / Grok / Claude judge below */ }
//
// with a comment underneath stating: *"A Nemotron outage, a revoked key, an unconstructable client —
// each simply lands on the judge that is running in production today."* **Only the last of those three
// is true.** Constructing an SDK client is local object creation: it does not contact the host, so it
// does not throw for a wrong key, a wrong model id, a wrong base URL, an exhausted plan, a 404, a 401
// or a timeout. Every one of those happens later, inside the returned `runTurn`, which the `try` does
// not cover — so they reached `judgeBuild`'s own catch, which records NOT REVIEWED and stops. The
// review did not fall back to the judge running in production; **the build simply lost its quality
// gate**, silently, on every single build of that tier.
//
// 🔑 SO THE FIX IS NOT A BIGGER TRY — IT IS A CHAIN AROUND THE CALL. A judge candidate is now
// (kind, modelId, runTurn), and the composed `runTurn` walks the candidates at CALL time: the first
// one that actually answers serves the verdict, and each one that does not is recorded with its
// reason. The shape the old comment described is finally the shape the code has.
//
// ⚠️ AN EMPTY ANSWER IS A FAILURE OF THAT RUNG, NOT A VERDICT — and this half is why the chain exists
// at all rather than just a wider try. Nemotron 3 is a reasoning model, and this repo has already been
// bitten twice by exactly that (`glm-5.3` and `kimi-k2.7-code`, both in MEASURED_ALWAYS_REASONS): the
// model's thinking consumes the whole authorised output allowance and the content comes back EMPTY.
// The old path handed that empty string to `parseJudgeVerdict`, which cannot read it, and the build
// recorded *"the reviewer's answer could not be read"* — a sentence about our parser, for a rung that
// never wrote a character. An empty reply now falls to the next candidate like any other failure.
//
// 🔒 WHAT IS DELIBERATELY UNCHANGED. The chain NEVER blocks a build: when every candidate fails it
// re-throws the last error, so `judgeBuild`'s existing catch produces the same honest NOT REVIEWED
// verdict it produces today. A judge is best-effort by design and this module does not change that —
// it changes only whether the OTHER judges get their turn, and whether anybody can see why.
//
// 🔒 WHITE-LABEL LAW. Every string this module produces names a vendor and a model id, so it is
// ADMIN-ONLY by construction: `attempts()` feeds the build report, never a narration, a summary or a
// verdict finding. The caller is responsible for keeping it on the admin side — the same discipline
// `deliveredVia` and the per-provider tally already follow.
//
// PURE — no I/O, no clock, no env. Every candidate is injected.

import type { JudgeRunTurn } from './BuildJudge';

/** The engines that may judge a build. Mirrors `selectReviewJudge`'s own union, deliberately. */
export type JudgeKind = 'grok' | 'sonnet' | 'opus' | 'glm' | 'nemotron';

export interface JudgeCandidate {
  kind: JudgeKind;
  /**
   * The model id THIS candidate must be called with.
   *
   * ⚠️ It is applied by the chain, overriding the `model` the caller passes. That is not a liberty:
   * `judgeBuild` takes ONE model id and hands it to whatever runner it was given, which was correct
   * when there was one judge and is wrong the moment there is a fallback — the second candidate would
   * otherwise be asked for the FIRST candidate's model, at a host that has never heard of it. So the
   * chain owns the id, which is also what makes each rung's failure attributable to its own engine.
   */
  modelId: string;
  runTurn: JudgeRunTurn;
}

/** What one candidate did, for the admin report. Never shown to a user. */
export interface JudgeAttempt {
  kind: JudgeKind;
  modelId: string;
  ok: boolean;
  /** Present only when `ok` is false. Bounded, single-line, admin-only. */
  reason?: string;
}

/**
 * Is this reply unusable as a verdict?
 *
 * Whitespace-only counts as empty — the same reasoning `braveApiKey()` and `nemotronKey()` already
 * apply to a configured-looking value: a reply made of nothing but newlines is not an answer that
 * happens to be short, it is the absence of one, and treating it as content would hand
 * `parseJudgeVerdict` a string it can only fail on.
 */
export function isEmptyJudgeReply(text: string | null | undefined): boolean {
  return String(text ?? '').trim().length === 0;
}

/** The longest failure reason we will carry into a report line. */
const MAX_REASON_CHARS = 200;

/**
 * Turn whatever a provider threw into ONE readable admin line.
 *
 * 🔑 THE STATUS CODE IS THE WHOLE POINT, because it is what separates the three candidate causes the
 * admin was asked to choose between and could not: **401/403 is the key, 404 is the model id or the
 * host, a timeout is the network or the plan.** The old code discarded the error object entirely, so
 * all three produced one identical sentence and the question "kaha?" had no answer anywhere in the
 * system. Extracting the status is not decoration — it IS the diagnosis.
 *
 * Defensive by construction: an SDK error, a plain `Error`, a string and an object with no message
 * all have to produce something, because this runs inside a catch on a best-effort path and must
 * never throw a second time.
 */
export function judgeFailureReason(err: unknown): string {
  if (err === null || err === undefined) return 'no reason given';
  const e = err as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const status = typeof e.status === 'number' ? `HTTP ${e.status}` : '';
  const code = typeof e.code === 'string' && e.code ? e.code : '';
  const message =
    typeof e.message === 'string' && e.message.trim()
      ? e.message.trim()
      : typeof err === 'string' && err.trim()
        ? err.trim()
        : typeof e.name === 'string' && e.name
          ? e.name
          : 'unknown error';
  // Newlines are stripped because this lands in a one-line report detail; a provider that returns an
  // HTML error page would otherwise push the rest of the line off any screen that shows it.
  const parts = [status, code, message].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
  return parts.length > MAX_REASON_CHARS ? `${parts.slice(0, MAX_REASON_CHARS - 1)}…` : parts;
}

/** The sentinel used when a candidate answered, but with nothing in it. */
export const EMPTY_REPLY_REASON = 'the engine returned an empty answer (its whole output allowance may have gone to reasoning)';

export interface JudgeChain {
  /** Hand this to `judgeBuild` exactly as a single runner was handed before. */
  runTurn: JudgeRunTurn;
  /** Who actually answered. Null until a call has succeeded — never guessed in advance. */
  servedBy: () => JudgeKind | null;
  /** The engine the chain WOULD start on, for a label printed before any call. */
  plannedKind: () => JudgeKind | null;
  /** Every attempt of the last call, in order. Admin-only. */
  attempts: () => JudgeAttempt[];
}

/**
 * Compose candidates into one runner that falls through at CALL time.
 *
 * ⚠️ IT COSTS AT MOST ONE EXTRA CALL PER FAILED RUNG, and that trade is deliberate rather than
 * overlooked: the alternative — today's behaviour — is that a build loses its review entirely and
 * ships unjudged. A quality gate that silently stops existing is the more expensive of the two, which
 * is the same reasoning `describeJudgeVerdict` already applies when it files an un-run review as a
 * WARNING rather than a pass. The chain is short and walked once per judge call; there is no loop.
 *
 * ⚠️ `attempts` is reset at the START of each call, so a re-review reports its own attempts rather
 * than accumulating the first review's. `servedBy` is NOT reset — it answers "which engine has been
 * answering this build", which is what the report's label needs.
 */
export function composeJudgeChain(candidates: readonly JudgeCandidate[]): JudgeChain {
  let served: JudgeKind | null = null;
  let attempts: JudgeAttempt[] = [];

  const runTurn: JudgeRunTurn = async (args) => {
    attempts = [];
    let lastError: unknown = new Error('no judge candidate was available');
    for (const c of candidates) {
      try {
        // The candidate's OWN model id — see the note on `JudgeCandidate.modelId`.
        const r = await c.runTurn({ ...args, model: c.modelId });
        if (isEmptyJudgeReply(r?.text)) {
          attempts.push({ kind: c.kind, modelId: c.modelId, ok: false, reason: EMPTY_REPLY_REASON });
          lastError = new Error(EMPTY_REPLY_REASON);
          continue;
        }
        attempts.push({ kind: c.kind, modelId: c.modelId, ok: true });
        served = c.kind;
        return r;
      } catch (err) {
        attempts.push({ kind: c.kind, modelId: c.modelId, ok: false, reason: judgeFailureReason(err) });
        lastError = err;
      }
    }
    // EVERY candidate failed. Re-throw so `judgeBuild`'s catch records the honest NOT REVIEWED verdict
    // it already records today — the chain must not invent a verdict of its own, and must never block.
    throw lastError;
  };

  return {
    runTurn,
    servedBy: () => served,
    plannedKind: () => candidates[0]?.kind ?? null,
    attempts: () => [...attempts],
  };
}

/**
 * The admin-only sentence describing what the chain did. Empty when there is nothing worth saying
 * (one candidate, first time, worked) — a report line should not grow noise for the ordinary case.
 */
export function describeJudgeAttempts(attempts: readonly JudgeAttempt[], label: (k: JudgeKind) => string): string {
  const failed = attempts.filter((a) => !a.ok);
  if (failed.length === 0) return '';
  const served = attempts.find((a) => a.ok);
  const failures = failed.map((a) => `${label(a.kind)} (${a.modelId}) failed: ${a.reason || 'no reason given'}`).join('; ');
  return served
    ? `${failures} — ${label(served.kind)} answered instead.`
    : `${failures} — no engine answered, so this build was not reviewed.`;
}

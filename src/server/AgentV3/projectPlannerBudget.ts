// AgentV3 — HOW LONG THE PROJECT PLANNER MAY TAKE, AND WHAT IS SAID WHEN IT CANNOT (autopsy e706e068).
//
// 🔴 ROOT CAUSE. Software Project Mode's decomposition call (`ppGenerate` in routes/agentv3.ts) raced
// the model against a hard-coded 60-second timer. The School ERP build — the admin's first real test
// of the key, on the free Weak engine — announced "🏗️ decomposing it into independently-buildable
// modules…" at 10:18:30 and then said nothing about the plan ever again. The timer had fired at
// 10:19:30, the outer `catch` swallowed it, `recordLlmCall` sits AFTER the race so no failed call was
// recorded, and the build fell through to the ordinary path. From the report it was impossible to
// tell whether the key was working at all. It was — the planner had simply been given a clock it
// could not meet: a module plan with frozen contracts is a few thousand output tokens, and a cheap
// rung that emits ~10 tokens/second needs minutes, not one.
//
// 🔑 THE RULE: the outer race must never be the BINDING bound. The provider call already carries its
// own honest clock — the streamed hard cap (`AGENTV3_STREAM_HARD_CAP_MS`, 300 s) when build calls are
// streamed, the floor ceiling (`FLOOR_TIMEOUT_CAP_MS`, 150 s) when they are not — and each of those
// distinguishes a hung provider from a slow one in ways a flat timer cannot (silence, throughput).
// So the planner's outer timeout is that inner bound plus a little slack: a backstop against a call
// that outlives its own clock, not a second, tighter clock that kills a healthy call. It is the same
// reasoning `OpenAiToolRunner` records for constructing its SDK client with the stream's cap rather
// than the floor bound: two clocks on one call, and the shorter one wins, is one clock too many.
//
// Tier-awareness is inherited, not invented: the inner bound is what it is on every tier, and the
// tiers differ in their ladders, not in how long a legitimate call may run.
//
// PURE — no I/O, no clock. Never throws.

import { buildStreamingEnabled, streamHardCapMs } from './providers/openAiStream';
import { FLOOR_TIMEOUT_CAP_MS } from './floorBudget';

/**
 * The project planner's OUTPUT allowance. It was a flat 8,000 — the same number every small text call
 * uses — for an answer the prompt allows to run to 60 modules, each with frozen TypeScript contracts.
 * Autopsy 6461025c: a 40-part ads-and-rewards spec came back cut off at exactly 8,000 tokens (26,889
 * characters, 79 s) before the module list ended, and the plan was thrown away. An allowance smaller
 * than the answer the prompt asks for is a guaranteed failure on precisely the projects this mode is
 * for. 16,000 fits a full plan with compact contracts (`projectPlanSystemPrompt` now asks for those),
 * and on the direct-answering plan rung it stays inside the planner's own time bound above.
 */
export const PROJECT_PLANNER_MAX_TOKENS = 16_000;

/** Slack past the inner call's own bound, so the outer race fires only when that bound failed to. */
export const PROJECT_PLANNER_SLACK_MS = 15_000;
/** An env override below this could not carry even a small plan; above this it exceeds any sane lane. */
export const PROJECT_PLANNER_TIMEOUT_MIN_MS = 30_000;
export const PROJECT_PLANNER_TIMEOUT_MAX_MS = 600_000;

/**
 * The outer timeout for ONE project-planner call.
 *
 * `AGENTV3_PROJECT_PLANNER_TIMEOUT_MS` overrides it (clamped); a malformed value is ignored rather
 * than read as zero, because a zero here would time the planner out before it started and reproduce
 * the silence this file exists to end.
 */
export function projectPlannerTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.AGENTV3_PROJECT_PLANNER_TIMEOUT_MS ?? '').trim());
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(PROJECT_PLANNER_TIMEOUT_MAX_MS, Math.max(PROJECT_PLANNER_TIMEOUT_MIN_MS, Math.floor(raw)));
  }
  const inner = buildStreamingEnabled(env) ? streamHardCapMs(env) : FLOOR_TIMEOUT_CAP_MS;
  return Math.min(PROJECT_PLANNER_TIMEOUT_MAX_MS, inner + PROJECT_PLANNER_SLACK_MS);
}

/** The error the planner race rejects with — matched by `plannerFailureKind`, so keep them together. */
export const PROJECT_PLANNER_TIMED_OUT = 'project planner timed out';
/**
 * The mega-app roadmap planner's race (`MEGA-APP ROADMAP` in routes/agentv3.ts) — the SIBLING of the
 * project planner, found by autopsy e706e068 one screen above it with the identical 45 s flat clock and
 * the identical silence. It shares this module's bound and this module's failure vocabulary on purpose:
 * two planners with two clocks is how one of them gets fixed and the other forgotten (rule 3).
 */
export const ROADMAP_PLANNER_TIMED_OUT = 'roadmap planner timed out';

export type PlannerFailureKind = 'timed-out' | 'threw';

export function plannerFailureKind(err: unknown): PlannerFailureKind {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg === PROJECT_PLANNER_TIMED_OUT || msg === ROADMAP_PLANNER_TIMED_OUT ? 'timed-out' : 'threw';
}

/**
 * The admin-only line for a roadmap planner that did not deliver. Says where the seconds went — the
 * one fact the School ERP report could not, because nothing was recorded between APP_SCOPE (+8 ms)
 * and ETA_BASIS (+45,112 ms).
 */
export function roadmapPlannerFailedMessage(kind: PlannerFailureKind, timeoutMs: number, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? 'unknown error');
  return kind === 'timed-out'
    ? `Mega-app roadmap: the planner did not answer within its ${Math.round(timeoutMs / 1000)}s bound — the build proceeded directly. Those seconds were spent waiting on this call.`
    : `Mega-app roadmap: the planner call failed (${detail.slice(0, 200)}) — the build proceeded directly.`;
}

/**
 * The admin-only line recorded when project mode announced a decomposition and could not deliver one.
 * Names the bound that fired, so the next reader can tell "the clock was too short" from "the model
 * answered garbage" without re-deriving either from timestamps.
 */
export function projectModeFailedMessage(kind: PlannerFailureKind, timeoutMs: number, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? 'unknown error');
  return kind === 'timed-out'
    ? `Project mode could not decompose this build: the planner did not answer within its ${Math.round(timeoutMs / 1000)}s bound — the build proceeded on the ordinary path.`
    : `Project mode could not steer this build (${detail.slice(0, 200)}) — the build proceeded on the ordinary path.`;
}

/**
 * What the USER is told when the decomposition they were promised did not happen. Branded, no
 * provider, no clock: the promise was "I will build them one per round", so its withdrawal must be
 * said aloud rather than left as a narration that trails off.
 */
export const PROJECT_MODE_FALLBACK_NARRATION =
  'ℹ️ I could not prepare the module-by-module plan in time, so I am building this in one go instead. Nothing is lost — the build continues normally.';

/**
 * 🔴 AN ANSWER THAT CANNOT BE USED IS A FAILED PLANNER, NOT A SMALL PROJECT (autopsy 6a4a799f, 2026-09-29).
 *
 * The "Blue Berry" music app announced "🏗️ decomposing it into independently-buildable modules…", the
 * planner ran for 300 s and was cut off mid-array (`finish=max_tokens`, 16,352 characters of modules),
 * `parsePlannedModules` found nothing it could read, and the route took the branch written for "fewer
 * modules than the minimum → not really a mega-project" — which records NOTHING and tells the user
 * nothing. Five of the build's twenty-four minutes went to a plan nobody saw, and the promise stood
 * unwithdrawn. `PROJECT_MODE_FAILED` existed for exactly this and could not fire, because the call did
 * not throw.
 *
 * So the empty result is split by its cause: a reply the provider CUT (max_tokens / length) or one with
 * no readable array is a planner failure and is said as one; a readable plan with too few modules is
 * the honest "this is not really a mega-project" it was always meant to be. PURE.
 */
export type UnusablePlanCause = 'cut-off' | 'unreadable' | 'too-small';

export function unusablePlanCause(input: { modules: number; stopReason: string | null | undefined; responseChars: number }): UnusablePlanCause {
  const stop = String(input.stopReason ?? '').toLowerCase();
  if (/max_tokens|length|truncat/.test(stop)) return 'cut-off';
  if (input.modules === 0) return 'unreadable';
  return 'too-small';
}

export function projectPlanUnusableMessage(input: { cause: UnusablePlanCause; modules: number; responseChars: number; latencyMs: number; min: number }): string {
  const secs = Math.round(Math.max(0, input.latencyMs) / 1000);
  switch (input.cause) {
    case 'cut-off':
      return `Project mode could not decompose this build: the planner's answer was cut off (${input.responseChars} characters in ${secs}s, before the module list was complete), so no plan could be read — the build proceeded on the ordinary path. Those ${secs}s were spent on a plan that was not used.`;
    case 'unreadable':
      return `Project mode could not decompose this build: the planner answered (${input.responseChars} characters in ${secs}s) but no module list could be read from it — the build proceeded on the ordinary path. Those ${secs}s were spent on a plan that was not used.`;
    default:
      return `Project mode stood down: the planner proposed ${input.modules} module(s), fewer than the ${input.min} a module-by-module build needs, so this was built in one go.`;
  }
}

/**
 * Why a roadmap reply could not be parsed — the one fact "no parseable roadmap" never said. A reply cut
 * off by the provider leaves its JSON unbalanced; one that is complete but malformed does not. PURE.
 */
export function roadmapUnparseableDetail(input: { stopReason: string | null | undefined; text: string }): string {
  const text = String(input.text ?? '');
  const stop = String(input.stopReason ?? '').toLowerCase();
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  const unbalanced = opens > closes;
  if (/max_tokens|length|truncat/.test(stop) || unbalanced) {
    return `the reply looks cut off (${text.length} characters, ${opens - closes} unclosed brace(s), stop=${input.stopReason ?? 'unknown'})`;
  }
  if (opens === 0) return `the reply held no JSON object (${text.length} characters)`;
  return `the reply's JSON could not be parsed (${text.length} characters, stop=${input.stopReason ?? 'unknown'})`;
}

/** What the user is told when the plan came back readable but too small to split into rounds. */
export const PROJECT_MODE_ONE_GO_NARRATION =
  'ℹ️ This fits in a single build, so I am building it in one go instead of module by module.';

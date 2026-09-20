// AgentV3 — Build Diagnostics: a structured, downloadable record of EVERY issue v5.0 hit
// while building an app, whether it auto-recovered or not.
//
// Purpose: give the admin (and Claude) a precise, technical list of where the build engine
// STRUGGLED — provider fallbacks, tool failures, "replied without building" nudges, readiness
// blockers, sandbox problems, runtime errors — so those rough edges can be fixed in code. The
// report is emitted with the build result and downloadable as JSON or text.
//
// Pure + dependency-free (no I/O) so it is fully unit-testable. It both (a) derives issues from
// the live AgentEvent stream and (b) accepts explicitly-recorded issues for signals that are not
// events (a provider fallback, a sandbox-create timeout).

import { startBandLabel } from './RequestAnalyser';
import { toolCallDetail } from './toolCallTarget';
import { isPlatformFixRequest, looksLikeMachineError, PLATFORM_COMPOSED_PREFIXES } from '../../lib/platformFixRequest';
import { isProjectSummaryNarration } from './ProjectSummary';
import { isTransientStatusLine } from './workingHeartbeat';
import type { AgentEvent } from './types';
import { parseNpmAuditSummary, npmAuditNote, auditSeverity, looksLikeDependencyInstall } from './npmAuditSummary';
import { manifestSummaryLine, type BuildManifestV1 } from './BuildManifest';
import { isDeadSandboxSignal, detectSilentDbFailure } from './sandbox/EngineerAI/actuators/sandboxHealth';
import { sandboxCost, describeSandboxCost } from './sandboxCost';
import { redactProvidersText } from '../lib/providerRedaction';
import { costAlertAdvisory, costAlertThresholdUsd } from './costAlert';
import { isModelUnavailableError } from './providerErrorClass';
import { isStarvedBudgetError, isUnclampedStarvation, isLaneBoundStarvation, isAskBoundStarvation } from './floorBudget';
import { unreachedProvidersNote } from './runnerChainSummary';
import { isBudgetEndedError } from './turnDeadline';
import { typecheckEvidenceFromCommands } from './TscGate';
import { predictsBuildFailure, prodBuildOverrulesPredictions, overruledByRealBuildMessage } from './buildFailurePrediction';
import { isAdvisoryCapOutcome } from './advisoryCapOutcome';
import { agentRunEvidence as readAgentRunEvidence, type AgentRunEvidence } from './agentRunEvidence';
import { mergeTruncation, COMPLETE, type ReportTruncation } from './reportTruncation';

export type IssuePhase =
  | 'sandbox' | 'provider' | 'plan' | 'tool' | 'build' | 'readiness' | 'preview' | 'autofix' | 'deploy';
export type IssueSeverity = 'info' | 'warning' | 'error';

/**
 * Findings that measure OUR OWN PROCESS rather than the user's app. Recorded at warning severity so
 * a human notices them; never a reason to hesitate before shipping the app.
 */
const PROCESS_ONLY_CODES = new Set([
  'TIME_TO_FIRST_RENDER', 'POST_GREEN_WRITES', // measurements of the ENGINE (postGreenWrites.ts), never app findings
  'GROUNDING_COST', 'POST_ANSWER_TIMING', 'SERVICE_GRAPH_MULTI', 'SERVICE_GRAPH_SINGLE',
  'JOURNEY_NOT_DERIVED', 'RELEASE_GATE',
  // What we chose not to charge for is an accounting fact about OUR engine (unbilledTurns.ts).
  // Counting it as a finding about the user's app is the provider-error-as-app-blocker class
  // (autopsy 4efab9d7) through yet another door.
  'UNBILLED_BARREN_WORK',
  // Our own journey runner produced nothing — a statement about OUR check, never about their app.
  'JOURNEY_NOT_RUN',
  // How this turn was ROUTED is a fact about our engine, never a finding about the user's app.
  'BUILD_ORDER_READ_AS_EDIT',
  // …and its sibling: our own page-render browser produced nothing (autopsy c6e4c6ff). Same rule —
  // a check that did not run is a fact about OUR instrument, never about the user's pages.
  'PAGE_RENDER_NOT_RUN',
  // Project mode could not steer the build — the build itself is unaffected (projectPlannerBudget.ts).
  'PROJECT_MODE_FAILED',
  // The gate said RED and a real run said otherwise — a statement about OUR verdict (runProvenApp.ts).
  'VERDICT_HELD_BY_RUN',
  // HOW A BUILD ENDED IS NOT A FINDING ABOUT THE APP (abortOutcome.ts, 2026-09-18). These are recorded
  // at error severity so the report is honest that the build did not finish — but a cost ceiling, a
  // futility breaker, a deploy drain, a reclaimed lock, a reaper sweep or the user's own Stop says
  // nothing about the app's code, and counting one as a "build-breaking blocker" on the user's health
  // card is the provider-error-as-app-blocker class (autopsy 4efab9d7) through a new door.
  'OUTCOME_USER_STOPPED', 'OUTCOME_COST_CEILING', 'OUTCOME_FUTILE', 'OUTCOME_DEPLOY_DRAIN',
  'OUTCOME_SUPERSEDED', 'OUTCOME_REAPED',
  // …and the two the deadline finalizer already wrote, for the same reason (the siblings, rule 3): the
  // wall-clock cap and an abort with no recorded cause end the RUN; neither is evidence about the app.
  // The release gate is RED on `buildOk:false` regardless, so this changes no verdict — only the
  // "N build-breaking blocker(s)" count a stopped build used to print about itself.
  'OUTCOME_STOPPED', 'OUTCOME_BUILD_TIMEOUT',
]);

/**
 * 🔴 IS THIS FINDING ABOUT THE APP, OR ABOUT THE ENGINE THAT BUILT IT? (autopsy 4efab9d7, 2026-09-15)
 *
 * The one predicate the release gate, the user's build-health card and every "is it shippable?"
 * count read from. It exists because the answer was being given in two places and both were wrong
 * in the same way: an ERROR recorded in the **provider** phase — a model call that timed out — was
 * counted as a "build-breaking blocker" of the APP. The gate went RED, the verdict was flipped to
 * NOT ok, and a build whose production bundle had compiled and whose dashboard was rendering on the
 * admin's own phone was declared not ready and made FREE. The admin's words: *"app ban jaye to
 * 'app not build' dikha kar free (₹0) charge nahi karna hai."*
 *
 * ⚠️ THE SAME CLASS HAD BEEN ROOT-CAUSED TWO DAYS EARLIER (report 70115adf, 2026-09-13) — for ONE
 * error message. `isBudgetEndedError` taught the recorder to file a *budget-ended* call as info; a
 * *timed-out* call, thrown by the very next code path, still landed as an unresolved error and was
 * still counted. Fixing the instance and not the class is what this repo's a38c6fef entry warns
 * about, and it recurred in 48 hours.
 *
 * THE RULE, stated once: **a fact about a provider call can never be a fact about the app.** A
 * timeout, a fallback, a rate limit, a benched key — these are the engine's struggle ledger, which
 * the admin reads and the fifth absolute rule mines. Whether the app works is decided by the app's
 * own evidence: does it typecheck, does it build, does it render, does a journey hold. So every
 * issue in the `provider` phase is excluded here BY PHASE, not by code — a new provider-phase code
 * added next month is excluded on the day it is written, which is the only way this stays fixed.
 *
 * Pure. Never throws.
 */
/**
 * The words that make a narration line READ like a problem. Hoisted so the classifier and
 * `narrationEchoesPromptSymptom` can never disagree about what counts as one.
 *
 * ⚠️ SINGULAR ONLY, AND THAT IS LOAD-BEARING RATHER THAN AN OVERSIGHT TO TIDY UP. `\berror\b` does
 * not match "errors" — the trailing "s" kills the word boundary — so "let me check the console
 * errors" is a step today while "the network error" is a problem. The asymmetry is almost certainly
 * accidental (the stripper one line below writes `errors?[- ]`, so the author handled plurals there
 * and forgot them here), but it is currently acting as a NOISE FILTER that suppresses roughly half
 * this class. Adding `s?` was measured against six realistic narration lines — "Let me verify there
 * are no TypeScript errors:", "Now let me handle the API errors gracefully:" and four more — and ALL
 * SIX newly flagged as problems. Widening this needs its own change and its own evidence; a test
 * pins the current behaviour so it cannot be "completed" by accident.
 */
const PROBLEM_WORD_SOURCE =
  "(error|failed|cannot|could not|not responding|isn'?t available|unavailable|retry|retrying"
  + '|stuck|timed out|blocked request|closed port|won\'?t come up|no files|warning)';
/**
 * Strip the BENIGN COMPOUNDS — "error boundary", "error handling", "warning banner" — that are
 * ordinary feature work rather than a failure. Hoisted out of the classifier (where it was added by
 * the ShopKhata autopsy 2026-07-17) so BOTH sides of the echo comparison can use it.
 *
 * 🔴 APPLYING IT TO ONE SIDE ONLY WAS A REAL DEFECT, found by adversarial review of this very change
 * before it merged. `said` came from the stripped narration while `known` came from the RAW prompt, so
 * an ordinary feature request — *"Build a checkout page with proper error handling and a warning
 * banner"* — put "error" and "warning" into the whitelist and silenced every genuine engine struggle
 * for the rest of that build. It traded false positives on fix-turns for false NEGATIVES on ordinary
 * builds, which is the same trade in the other direction.
 */
function stripBenignCompounds(text: string): string {
  return String(text ?? '')
    .replace(/\berrors?[- ](boundar(?:y|ies)|handling|handlers?|messages?|states?|pages?|toasts?|ui|display)\b/gi, '')
    .replace(/\bwarnings?[- ](messages?|banners?|badges?|toasts?)\b/gi, '');
}

/** Non-global: `.test()` on a `/g` regex is STATEFUL (measured true/false/true on one string). */
const PROBLEM_WORD_RE = new RegExp(`\\b${PROBLEM_WORD_SOURCE}\\b`, 'i');
/** Global, used ONLY via `.match()`, which does reset `lastIndex`. */
const PROBLEM_WORD_RE_G = new RegExp(`\\b${PROBLEM_WORD_SOURCE}\\b`, 'gi');

/**
 * Is every problem word in this narration one the USER THEMSELVES reported?
 *
 * 🔴 THE DEFECT THIS ANSWERS (build e4ebcb5f, 2026-09-17). The prompt was *"Fix this error and
 * continue building the app: network error"*, and the agent's ordinary narration — *"Let me check the
 * current app structure and identify the network error:"* — was recorded as a PROBLEM. It is the agent
 * quoting the symptom it was asked to investigate, which is the most normal thing an agent does on a
 * "fix this error" turn.
 *
 * 🔑 THE CLASS, and why no keyword list can express it: the classifier asks *"does this sentence
 * contain a scary word?"* when the question it exists to answer is *"did the ENGINE fail?"* Four
 * separate patches have narrowed that predicate and not one has widened it.
 *
 * ⚠️ THREE CORRECTIONS FOUND BY ADVERSARIAL REVIEW BEFORE THIS MERGED, each of which turned a
 * plausible guard into a wrong one. They are the reason this function is shaped the way it is:
 *
 *  1. **`meta.prompt` is NOT reliably "the user's own words"** — an earlier draft of this comment said
 *     it was, and that sentence was load-bearing. `fixErrorAndContinuePrompt` (AgentV3Panel) composes
 *     the prompt from a PLATFORM prefix plus NavBharatAI's own error notice, so our own wording could
 *     whitelist its own vocabulary for a whole build. The composed prefixes are removed before
 *     harvesting.
 *  2. **It must only arm on an actual SYMPTOM REPORT.** Without that, a plain feature request —
 *     *"Build me a dashboard that shows error rates"* — silenced every later "error" narration in a
 *     build that reported no symptom at all. `isPlatformFixRequest` / `looksLikeMachineError` are this
 *     repo's existing answer to "is this message reporting a failure?", so the line is drawn once.
 *  3. **Both sides must speak the same vocabulary.** `said` was stripped of benign compounds and
 *     `known` was not, so *"add proper error handling"* put "error" into the whitelist. Both now go
 *     through `stripBenignCompounds`.
 *
 * `every`, not `some`: a line mixing the user's word with a NEW one ("the network error is back and
 * the preview is not responding") carries a word the user never reported, so it stays a problem.
 *
 * 🔴 STILL OPEN, named rather than covered over: when the wrapped body is itself NavBharatAI's own
 * branded notice ("The build produced no files. Please try again."), the guard still arms — that is
 * the fdd59ef8 "our own voice fed back" class, and it belongs to that fix, not this one.
 *
 * PURE. Never throws. No prompt, or a prompt that is not a symptom report ⇒ false ⇒ today's behaviour.
 */
export function narrationEchoesPromptSymptom(text: string, prompt: string | undefined | null): boolean {
  const raw = String(prompt ?? '');
  if (!raw) return false;
  // Only a message that REPORTS a failure may whitelist failure vocabulary. A feature request that
  // merely names the vocabulary must not.
  if (!isPlatformFixRequest(raw) && !looksLikeMachineError(raw)) return false;
  // Our own composed opener is not the user reporting anything.
  let asked = raw;
  for (const prefix of PLATFORM_COMPOSED_PREFIXES) asked = asked.split(prefix).join(' ');
  asked = stripBenignCompounds(asked);
  const said = (String(text ?? '').match(PROBLEM_WORD_RE_G) ?? []).map((w) => w.toLowerCase());
  if (said.length === 0) return false;
  const known = new Set((asked.match(PROBLEM_WORD_RE_G) ?? []).map((w) => w.toLowerCase()));
  return said.every((w) => known.has(w));
}

export function isAppFinding(issue: Pick<BuildIssue, 'phase' | 'code'>): boolean {
  if (!issue) return false;
  if (issue.phase === 'provider') return false;
  return !PROCESS_ONLY_CODES.has(issue.code);
}

/**
 * How recently a build must have recorded something to count as STILL RUNNING rather than ended.
 *
 * Two heartbeat intervals (the heartbeat is once a minute), so a single missed beat cannot make a live
 * build read as one that stopped. See `deriveRootCause`'s honesty note for why the slack leans this way.
 */
export const STILL_RUNNING_WINDOW_MS = 150_000;

export interface BuildIssue {
  /** When the issue was recorded (ms) — the LATEST occurrence if repeatCount > 1. */
  ts: number;
  /** Which part of the pipeline it came from. */
  phase: IssuePhase;
  severity: IssueSeverity;
  /** Stable machine code, e.g. PROVIDER_FALLBACK, TOOL_ERROR, NO_BUILD_NUDGE, READINESS_BLOCKER. */
  code: string;
  /** Technical, human-readable description. */
  message: string;
  /** True if v5.0 recovered on its own; false if it remained a problem in the final build. */
  autoResolved: boolean;
  /**
   * True when this entry is an OBSERVATION about the user's pre-existing code rather than a defect of
   * ours — nothing was broken by us and nothing was fixed by us (mitrify autopsy 2026-08-04).
   *
   * Why it exists: an import/survey turn records advisory notes (unused deps, focus conflicts) that must
   * not count as OUR unresolved defects, so `importTurnObservation` set `autoResolved: true`. That
   * silenced the false-defect count but created a false SELF-HEAL count instead — the reported build
   * claimed "32 auto-resolved" when it had healed essentially nothing; 14 of those were notes about code
   * it never touched. A self-heal tally that inflates itself is exactly the dishonest reporting the
   * fifth absolute rule forbids, because it is the number the autopsy reads to judge the engine.
   * Observations are now their OWN bucket: neither auto-resolved nor unresolved.
   */
  observation?: boolean;
  /** Extra context (tool name, provider, file path, raw error) — optional. */
  detail?: string;
  /** Set when the SAME code+message repeated back-to-back (e.g. many identical "▶ write_file" tool
   *  calls) — collapsed into one entry instead of one line per occurrence. Absent/1 = no repeat. */
  repeatCount?: number;
}

/**
 * AI Diagnosis Bundle — gap #3 (sandbox raw logs). The full stdout/stderr/exit code of a sandbox
 * command (npm install, tsc, vite build, the dev server). The timeline only carries a one-line
 * marker; the raw logs that actually explain ~80% of "the app won't run" failures live here.
 */
export interface SandboxCommandRecord {
  ts: number;
  command: string;
  /** Process exit code. null when the actuator could not report one (e.g. it threw). */
  exitCode: number | null;
  durationMs?: number;
  /** Captured stdout (capped — far larger than the timeline's one-liner). */
  stdout: string;
  /** Captured stderr (capped). */
  stderr: string;
}

/**
 * AI Diagnosis Bundle — gap #4 (LLM input/output). One model turn's request/response shape: which
 * provider/model, the prompt + response sizes (and a head preview), the finish reason, token usage
 * and latency. This is what reveals a truncated 8K response, a max_tokens stop, or a slow provider.
 */
export interface LlmCallRecord {
  ts: number;
  provider?: string;
  model?: string;
  /** Head of the assembled prompt (system + last user turn), capped — for "what did we ask". */
  promptPreview?: string;
  /** Head of the model's text response, capped — for "what did it reply / did it truncate". */
  responsePreview?: string;
  promptChars?: number;
  responseChars?: number;
  /** Anthropic stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | … — 'max_tokens' = truncated. */
  finishReason?: string | null;
  toolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  ok: boolean;
  error?: string;
}

/**
 * True when `model` names an Anthropic Claude model (any Claude/Sonnet/Opus/Haiku id). Pure + total —
 * the single source of truth for "did Claude run" used by the weak-tier no-Claude honesty check
 * (`claudeModelUsed`). Kept here (not scattered per call site) so the two detectors can never drift
 * (rule 2 — one shared implementation). Matches on the id substring so a versioned id
 * (`claude-sonnet-4-6`, `claude-opus-4-8`, `claude-3-5-haiku-…`) is caught regardless of suffix.
 */
export function isClaudeModel(model: string | undefined | null): boolean {
  return typeof model === 'string' && /\b(claude|sonnet|opus|haiku)\b/i.test(model);
}

/**
 * AI Diagnosis Bundle — gap #1 (full errors). The timeline truncates an error to a short line; this
 * keeps the FULL message + stack so the real root cause (the actual throwing frame) is preserved.
 */
export interface CapturedError {
  ts: number;
  phase: IssuePhase;
  /** Full error message — NOT truncated to a timeline-sized snippet. */
  message: string;
  /** Stack trace when available. */
  stack?: string;
}

/**
 * AI Diagnosis Bundle — generated-file capture (#1 of the follow-up). When the app fails to compile,
 * the OFFENDING files' content is captured so the exact mismatch (e.g. a hook's return shape vs what
 * its consumer destructures) is VISIBLE in the report — no inference needed.
 */
export interface GeneratedFileRecord {
  ts: number;
  path: string;
  /** File content, capped — enough to see the bug, bounded for storage. */
  content: string;
  /** Why it was captured, e.g. "referenced by compile error". */
  note?: string;
}

/**
 * A PREVIEW failure captured from the running preview (the in-browser srcdoc iframe, or a live-server
 * runtime). The build can "succeed" yet the preview not render — capturing the real preview error
 * into the report makes that a 100%-real, downloadable signal instead of a screenshot the user must
 * send separately. ('live' server failures already appear in the sandbox command logs.)
 */
export interface PreviewErrorRecord {
  ts: number;
  /** Which preview surface failed. */
  source: 'in-browser' | 'live';
  /** The real error message/stack the preview reported (capped). */
  message: string;
}

/**
 * Billing & tier facts for THIS build (admin 2026-07-11: "free user / paid user, app kisne banaya,
 * kaun se providers fail hue" — the 2-day billing/provider system must show up in the report).
 * Written at settle time from the REAL charge (never an estimate); absent on a build that never
 * reached settle (e.g. a pre-stream refusal).
 */
export interface BuildBillingRecord {
  /** Who the build ran for: 'free-list (admin/tester)' | 'free (welcome bonus — cheap engines)' |
   *  'paid' | 'billing-off (no charge)'. */
  userTier: string;
  /** The ACTUAL amount charged (after every zeroing rule). 0 = a free build. */
  billedUsd?: number;
  billedInr?: number;
  /** Wallet tokens actually debited (absent when billing is off / nothing was charged). */
  walletTokensDebited?: number;
  /**
   * What the PROVIDERS really cost NavBharatAI for this build (USD, tokens only, at settle time's
   * rate card) — recorded on success AND failure, because a failed build still cost us. ADMIN-ONLY:
   * the White-Label Law forbids showing a user our cost or margin, and `userCostBreakdown` must never
   * carry it. Absent on reports written before 2026-09-14; the admin cost card then falls back to the
   * stored call log and says so.
   */
  realCostUsd?: number;
  /** The sandbox VM's measured cost for the build (USD), 0 unless sandbox billing is configured. */
  sandboxCostUsd?: number;
  /** WHY a build was free when tokens were really spent (empty build / unrendered preview / onboarding). */
  zeroBillReason?: string;
  /** Power (Only Opus) mode. */
  powerMode?: boolean;
  /** The RESOLVED power level this build ran at ('weak' | 'off' | 'mini' | 'medium' | 'max') — so a
   *  report unambiguously shows whether it was the free/cheap WEAK tier (no Claude) or a normal build. */
  powerLevel?: string;
  /** True when this build was forced onto the cheap tier with Claude excluded by construction. */
  noClaude?: boolean;
}

export interface BuildDiagnosticsReport {
  schema: 'navbharatai.v3.build-diagnostics/1';
  /** P0 (2026-07-12) — the UNIQUE id of the build this report belongs to. Every build mints its own;
   *  the export validates it so a report can NEVER be exported for a different build than the active one. */
  buildId?: string;
  /** Stable hash of `prompt` (buildIdentity.computePromptHash) — a secondary consistency guard on export. */
  promptHash?: string;
  sessionId?: string;
  workspaceId?: string;
  prompt?: string;
  /** What ACTUALLY delivered (last successful call). See honestModelLabel. */
  model?: string;
  /** What the router INTENDED at build start — kept so routing intent is never lost. */
  plannedModel?: string;
  framework?: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  summary?: string;
  counts: {
    total: number;
    errors: number;
    warnings: number;
    autoResolved: number;
    /**
     * Times the engine ROUTED AROUND a problem instead of fixing it — a fallback to another
     * provider or another lane. Deliberately NOT folded into `autoResolved`: rule 5 calls a
     * workaround a deferred root cause, and a tally that counts them as heals hides exactly the
     * debt the tally exists to surface.
     */
    workarounds?: number;
    unresolved: number;
    /** Advisory notes about the user's PRE-EXISTING code — not our defects and not our fixes. */
    observations?: number;
  };
  issues: BuildIssue[];
  /** AI Diagnosis Bundle — sandbox command raw logs (#3), LLM I/O (#4), full errors+stack (#1). */
  commands?: SandboxCommandRecord[];
  llmCalls?: LlmCallRecord[];
  errors?: CapturedError[];
  /** Offending generated files captured on a compile failure — so the exact bug is visible. */
  generatedFiles?: GeneratedFileRecord[];
  /** Preview failures (in-browser / live runtime) captured after the build — a build can pass yet not render. */
  previewErrors?: PreviewErrorRecord[];
  /** Which provider delivered each build turn → turn count (e.g. { GLM: 18, CLAUDE: 2 }). Shows whether
   *  the cheap floor (GLM/KIMI) actually built it or it fell back to Claude. Absent if nothing recorded. */
  providerDelivery?: Record<string, number>;
  /** THE headline: the provider that drove the MOST turns — "app kisne banaya". Derived from
   *  providerDelivery at report time. Absent when no turn was attributed (non-agentic lanes). */
  builtBy?: string;
  /** How many times each provider FAILED a turn (threw → fell through to the next), e.g.
   *  { GLM: 3, VERTEX: 1 } — "kaun se providers fail hue, kitni baar". Absent if none failed. */
  providerFailures?: Record<string, number>;
  /** provider → "18 rate-limit, 2 timeout" — WHY it failed, not just how often. A count with no reason
   *  cannot be acted on; it can only be worried about. See recordProviderFailure. */
  providerFailureReasons?: Record<string, string>;
  /** Per-provider REAL token spend for this build (reconciled to the billed total; 'other' = aux
   *  calls). The report-level view of the Billing-Phase-3 ledger. */
  providerTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  /**
   * OBSERVATIONAL ONLY — fast-lane turns, which today reach the bill through neither the provider
   * ledger nor (for four of the seven call sites) the build total at all.
   *
   * WHY IT EXISTS (2026-08-11). Fixing fast-lane attribution moves real money in BOTH directions:
   * three call sites put their tokens in the build TOTAL but not the ledger, so they land in the
   * unattributed remainder and are priced at SONNET rates despite running on the cheap floor
   * (over-charge); four record nothing anywhere, so they are billed to nobody (our loss). The admin's
   * decision was to MEASURE BEFORE CHANGING — and measurement was impossible, because the second group
   * is invisible by construction.
   *
   * This makes it visible WITHOUT touching billing: it is never read by the cost path, only reported.
   */
  shadowFastLaneTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  /**
   * LIVE, UNRECONCILED token totals — what the provider ledger has attributed SO FAR, updated as the
   * build runs. Absent once the build settles, because `providerTokens` then holds the real,
   * reconciled figure.
   *
   * WHY IT EXISTS (autopsy f04421ef). A report taken while a build was still running printed
   * `GLM: 54 call(s) · 0 in · 0 out` — and those zeros are not a measurement, they are the absence of
   * one. I read that report and reported to the admin that the build had served ZERO tokens from cache
   * and was leaving a 75% saving on the table. Both claims were false: the field was empty because the
   * build had not settled, not because the number was zero. A report that can be misread that way by
   * the person who wrote the renderer is a report that lies.
   *
   * 🔒 NEVER REACHES BILLING. This is a snapshot of an in-flight ledger, missing the aux calls that
   * reconciliation folds into 'other'. Billing reads `providerTokens` and only `providerTokens` — the
   * same separation `shadowFastLaneTokens` keeps, and for the same reason.
   */
  /**
   * The ordered engine chain this build was ACTUALLY given, e.g.
   * `GLM(glm-5.2) → KIMI(kimi-k3) → CLAUDE → CLAUDE_HAIKU`.
   *
   * Without it, `providerDelivery: { KIMI: 54 }` with no GLM entry is unreadable: GLM might have been
   * in the chain and never reached, or never configured at all. See runnerChainSummary.ts. Admin-only,
   * like every other provider name.
   */
  providerChain?: string;
  /** The distinct provider families in that chain, for lining up against providerDelivery. */
  providerChainNames?: string[];
  /**
   * What the request analyser concluded about THIS prompt, recorded so a model's performance can be
   * correlated with the difficulty of the work it was given (modelPerformance.ts).
   *
   * 🔴 IT IS STORED RATHER THAN RE-DERIVED, AND THE DIFFERENCE IS NOT COSMETIC. `analyzeRequest` is
   * pure, so a reader could in principle re-run it on the stored prompt — but the stored prompt is
   * TRUNCATED (HISTORY_PROMPT_MAX = 200 chars) and the score has explicit length bands (+5 over 300,
   * +10 over 800) plus `fileCount` and `historyTurns` inputs that are not stored at all. Re-deriving
   * would therefore produce a DIFFERENT number from the one the build actually routed on, and print
   * it as if it were the same fact. A legacy report carries nothing here and must read as unavailable.
   *
   * Observability only: written once at build start from a value the route already computed, read by
   * nothing in the build path.
   */
  requestAnalysis?: { taskType: string; complexityScore: number; startTier: string; startBand?: string; signalsCouldNotRead?: boolean };
  liveTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  /** The cache-hit input tokens seen so far, paired with `liveTokens`. Same unreconciled status. */
  liveCacheReadInputTokens?: number;
  /**
   * ADMIN-ONLY infrastructure cost: how long this build held a real E2B VM, and our estimated spend on
   * it. Billed by WALL-CLOCK, so it is a completely different cost shape from token spend — a build
   * that used almost no tokens but sat on a VM for forty minutes still cost real money, and nothing in
   * this report used to show it. Never part of the user's bill (White-Label Law §3); absent when the
   * time was not measured on this instance. See sandboxCost.ts.
   */
  sandboxCost?: { seconds: number; usd: number; estimated: true };
  /** Fix 66 — total prefix-cache HIT input tokens (GLM/Kimi auto-cache). Compare against providerTokens'
   *  input total for the real cache-hit rate on this build. Absent/0 when nothing was cache-served. */
  cacheReadInputTokens?: number;
  /** Billing & tier facts (free/paid user, actual charge, wallet debit, why-free). */
  billing?: BuildBillingRecord;
  /**
   * HOW THE BUILD'S OWN ETA HELD UP — derived at serialization from the promise made at t=0 and the
   * two timestamps this record already carried. Admin/forensic only; see `etaAccuracy`. Absent on a
   * turn that showed no ETA (chat), on a legacy record, and on a build that has not ended.
   */
  etaAccuracy?: EtaAccuracy;
  /** The post-build quality reviewer's FULL findings (every small problem it listed) — not the
   *  400-char timeline snippet. This is what makes the report's "all problems" list complete. */
  review?: string;
  /** ONLY the timeline entries that are a real problem (severity warning/error) — every "▶ write_file"
   *  / heartbeat / progress-narration info line excluded. This is the noise-free "problems only" view;
   *  `issues` (above) remains the full raw timeline for anyone who wants it. Always present (may be
   *  empty on a clean build). */
  problems: BuildIssue[];
  /** One-paragraph, plain-language ROOT CAUSE — the single most important line in the report. Derived
   *  from (in priority order) the deterministic BuildOutcome classification, the reviewer's first
   *  [CRITICAL] finding, the first fully-captured error, or the first real problem — whichever is most
   *  specific. Undefined only when the build is still running with nothing to report yet. */
  rootCause?: string;
  /** Fix 37a (admin 2026-07-07: "app kitni baar fail hui yeh bhi likho") — how many EARLIER builds in
   *  THIS workspace's durable history ended not-ok before this one started. Makes repeat failure
   *  visible in every report instead of each report looking like the first attempt. */
  priorFailedBuilds?: number;
  /**
   * What the USER lived through across this whole session — not what this one turn saw.
   *
   * Two admin complaints shared one root cause: a 58-minute session reported as 18 minutes, and three
   * workspace wipes that no report mentioned. Both because `startedAt`/`endedAt` and the data-loss
   * events are PER TURN. See sessionSummary.
   */
  session?: { turns: number; elapsedMs: number; dataLossTotal: number; failedTurns: number; truncated: boolean; line: string };
  /** Fix 37c — explicit data-loss/recovery events (sandbox recycled, files restored, generation
   *  reset), each with the observed CAUSE, so "data kyu udha" is answered inside the report itself. */
  dataLossEvents?: Array<{ ts: number; cause: string; detail: string }>;
  /**
   * WHAT THIS COPY OF THE REPORT NO LONGER CONTAINS — see reportTruncation.ts.
   *
   * Written by the recorder when its own caps dropped anything, and merged again by every storage
   * pass. `complete: true` is a measurement; ABSENT means the report predates the check and a reader
   * must say "not recorded" rather than "nothing was lost".
   */
  truncation?: ReportTruncation;
  /** U-1 — the signed determinism-audit manifest for this build (routing inputs + file hashes). */
  manifest?: BuildManifestV1;
}

export interface BuildDiagnosticsMeta {
  /** P0 — the unique id minted for THIS build (route generates it at build start). */
  buildId?: string;
  /** Stable hash of the prompt (route passes computePromptHash(prompt)). */
  promptHash?: string;
  sessionId?: string;
  workspaceId?: string;
  prompt?: string;
  model?: string;
  framework?: string;
  /** Injected clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
  /** Fired after EVERY recorded issue / ingested event / finish, with the current report — so the
   *  route can persist it in REAL TIME (the report is never empty mid-build and survives a crash). */
  onUpdate?: (report: BuildDiagnosticsReport) => void;
}

/** Hard cap on timeline entries so a runaway loop can't grow the report without bound. */
const MAX_ISSUES = 2000;
/** Cap on the "problems" (noise-free) view — kept well under MAX_ISSUES so it can never itself
 *  bypass the storage byte-budget even on a build with an unusually large number of real problems. */
const MAX_PROBLEMS = 300;
/** Caps for the AI Diagnosis Bundle channels (a long build runs many commands / model turns). */
const MAX_COMMANDS = 300;
const MAX_LLM_CALLS = 300;
const MAX_ERRORS = 200;
const MAX_GEN_FILES = 20;
const GEN_FILE_CAP = 6000;
const MAX_PREVIEW_ERRORS = 30;
const PREVIEW_ERROR_CAP = 4000;
/** Per-stream output cap — large enough to hold a real npm/tsc/vite failure, bounded for storage. */
const CMD_OUTPUT_CAP = 4000;
const LLM_PREVIEW_CAP = 2000;

/**
 * Prompt size (pre-compaction, in characters) past which a step is called out as pathological.
 *
 * 8 MB, chosen to sit far above any legitimate build. A large real prompt is a few hundred KB — the
 * transcript compactor exists precisely because ~233 KB was once enough to time the cheap floor out.
 * Anything at this scale is a tool result that should never have been read, not a big project.
 */
const HUGE_PROMPT_CHARS = 8 * 1024 * 1024;
const ERROR_MESSAGE_CAP = 4000;
const STACK_CAP = 4000;

/** Keep the last `cap` chars of a stream — the tail is where the actual error/stack lives. */
function capTail(s: string | undefined, cap: number): string {
  const t = String(s ?? '');
  return t.length <= cap ? t : `…[${t.length - cap} chars truncated]…\n${t.slice(t.length - cap)}`;
}
/** Keep the first `cap` chars — for prompts/responses where the head is the informative part. */
function capHead(s: string | undefined, cap: number): string {
  const t = String(s ?? '');
  return t.length <= cap ? t : `${t.slice(0, cap)}…[${t.length - cap} chars truncated]`;
}

/**
 * Bound the "problems" view to the most recent `MAX_PROBLEMS` entries. Exported so
 * `trimReportForStorage` (DiagnosticsStore.ts) can RECOMPUTE `problems` from the storage-trimmed
 * `issues` array with the SAME cap — otherwise a `problems` list derived from the pre-trim issues
 * could reference entries no longer present in the stored `issues` timeline (an inconsistent report)
 * or itself bypass the Firestore byte-budget safety net. PURE + unit-testable.
 */
export function capProblems(problems: readonly BuildIssue[]): BuildIssue[] {
  return problems.length <= MAX_PROBLEMS ? [...problems] : problems.slice(problems.length - MAX_PROBLEMS);
}

export class BuildDiagnostics {
  private readonly issues: BuildIssue[] = [];
  /** provider → failure bucket → count. See recordProviderFailure. */
  private readonly providerFailureReasons = new Map<string, Map<string, number>>();
  private requestAnalysis?: { taskType: string; complexityScore: number; startTier: string; startBand?: string; signalsCouldNotRead?: boolean };
  /** See the transient-status note in the narration handler. */
  private transientStatusRecorded = false;
  private readonly meta: BuildDiagnosticsMeta;
  private readonly now: () => number;
  private readonly startedAt: number;
  private endedAt?: number;
  private ok?: boolean;
  private summary?: string;
  /** Tool calls that have STARTED but not yet returned — used to name what a hang is stuck on. */
  private readonly pending = new Map<string, { tool: string; ts: number }>();
  /** Last thing the agent was doing — surfaced in the minute-by-minute heartbeat. */
  private lastActivity = 'starting';
  /** The long non-tool stretch currently running — see heartbeat()/enterPhase() for why this exists. */
  private activePhase: { name: string; at: number } | null = null;
  private truncated = false;
  /** AI Diagnosis Bundle channels — raw sandbox logs (#3), LLM I/O (#4), full errors+stack (#1). */
  private readonly commands: SandboxCommandRecord[] = [];
  private readonly llmCalls: LlmCallRecord[] = [];
  private readonly errors: CapturedError[] = [];
  private readonly generatedFiles: GeneratedFileRecord[] = [];
  private readonly previewErrors: PreviewErrorRecord[] = [];
  /** Which provider actually DELIVERED each build turn (GLM/KIMI/CLAUDE/…) → turn count. Lets the
   *  downloadable report answer "kaun sa reply kis provider se aaya" — the cheap-floor-vs-Claude split. */
  private readonly providerDelivery = new Map<string, number>();
  private readonly providerFailures = new Map<string, number>();
  private providerTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  private shadowFastLaneTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  private providerChain?: string;
  private providerChainNames?: string[];
  private plannedFirstRung?: string;
  private liveTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  private liveCacheReadInputTokens?: number;
  private sandboxCostRecord?: { seconds: number; usd: number; estimated: true };
  private cacheReadInputTokens?: number;
  private billing?: BuildBillingRecord;
  /** What the user was promised at t=0 — see `etaAccuracy`. Absent on turns that show no ETA. */
  private etaPromise?: EtaPromise;
  private reviewText?: string;
  private manifest?: BuildManifestV1;
  private priorFailedBuilds: number | undefined;
  /**
   * How many entries each channel REALLY had, including the ones the caps below refused.
   *
   * 🔴 Counting the refusals is the whole fix. `this.commands.length` can only ever report the cap;
   * a build that ran 500 commands and a build that ran exactly 300 were identical in the record, and
   * the storage layer then cut that to 40 with no statement either. A counter costs one integer and
   * makes "40 of 500" sayable. See reportTruncation.ts.
   */
  private channelTotals: { commands: number; llmCalls: number; errors: number } = { commands: 0, llmCalls: 0, errors: 0 };
  private session: BuildDiagnosticsReport['session'];
  private dataLossEvents: Array<{ ts: number; cause: string; detail: string }> = [];

  constructor(meta: BuildDiagnosticsMeta = {}) {
    this.meta = meta;
    this.now = meta.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  /** Persist the current report in REAL TIME (best-effort; never throws). */
  private notify(): void {
    try { this.meta.onUpdate?.(this.report()); } catch { /* persistence is best-effort */ }
  }

  /**
   * Record an issue/timeline entry. Capped so a runaway build can't grow it without bound.
   *
   * DEDUP: a build routinely repeats the exact same code+message back-to-back (many identical
   * "▶ write_file" tool-call entries, "⏱ minute N — still working" heartbeats with the same status,
   * the same narration line double-emitted) — recording each as its own line bloats the report with
   * pure noise while adding zero information (the message is byte-identical). Collapse a back-to-back
   * repeat into the PREVIOUS entry's `repeatCount` instead of pushing a new one.
   */
  record(issue: Omit<BuildIssue, 'ts'> & { ts?: number }): void {
    const last = this.issues[this.issues.length - 1];
    if (last && last.phase === issue.phase && last.code === issue.code && last.message === issue.message) {
      last.repeatCount = (last.repeatCount ?? 1) + 1;
      last.ts = issue.ts ?? this.now();
      this.notify();
      return;
    }
    if (this.issues.length >= MAX_ISSUES) {
      if (!this.truncated) {
        this.truncated = true;
        this.issues.push({ ts: this.now(), phase: 'build', severity: 'warning', code: 'TIMELINE_TRUNCATED', message: `Timeline capped at ${MAX_ISSUES} entries — earlier detail retained, later activity omitted.`, autoResolved: false });
      }
      return;
    }
    this.issues.push({ ts: issue.ts ?? this.now(), ...issue });
    this.notify();
  }

  /**
   * True when an UNRESOLVED readiness blocker proving a RUNTIME CRASH is on the timeline — a React
   * Rules-of-Hooks violation, an undefined JSX component, or an undefined hook (all recorded with the
   * literal "crash at runtime"). Such a defect renders fine on the first paint and white-screens on a
   * later re-render, so the render-rescue (a one-shot snapshot) must NOT upgrade the build to success
   * while one is present (real report 8a6e4585). Reads the already-computed, full-workspace readiness
   * result — no re-analysis. Pure query; never throws.
   */
  /**
   * Did the readiness gate leave an UNRESOLVED blocker? Used so a recorded claim about the build can
   * never over-claim past what the build itself reported (real report 02be22e3: a snapshot was recorded
   * as "a verified working app" while the same report said "NOT READY · 5 incomplete features").
   * Pure query; never throws.
   */
  hasUnresolvedReadinessBlocker(): boolean {
    return this.issues.some((i) => i.code === 'READINESS_BLOCKER' && i.autoResolved !== true);
  }

  hasRuntimeCrashBlocker(): boolean {
    return this.issues.some(
      (i) =>
        i.code === 'READINESS_BLOCKER' &&
        i.severity === 'error' &&
        i.autoResolved !== true &&
        /crash(es)? at runtime/i.test(i.message || ''),
    );
  }

  /**
   * Is this build still ALIVE, rather than finished-without-saying-so?
   *
   * A live build records a HEARTBEAT every minute, so recent activity with no `endedAt` means it is
   * working. Two heartbeats of slack, so one missed beat cannot flip a live build to "ended" — and the
   * lean is deliberate (see the honesty note in `deriveRootCause`). Pure over `this.now()` and the
   * recorded issues, so it is testable without a clock.
   */
  private looksStillRunning(): boolean {
    if (this.endedAt !== undefined) return false;
    const last = this.issues.length ? this.issues[this.issues.length - 1].ts : this.startedAt;
    return this.now() - last <= STILL_RUNNING_WINDOW_MS;
  }

  /**
   * Record a periodic "still working" marker so even a long quiet stretch (a slow or hung step)
   * shows minute-by-minute progress in the report instead of a blank gap. Called on a timer by the
   * route. If a tool call is in-flight, it names it — so a hang is visible as "minute N — stuck on X".
   */
  heartbeat(): void {
    const mins = Math.max(1, Math.round((this.now() - this.startedAt) / 60_000));
    const inFlight = [...this.pending.values()].map((p) => p.tool);
    // THE BLIND SPOT THIS CLOSES (autopsy d6deaaf0, 2026-08-09). A heartbeat could only ever name a
    // TOOL the agent called. The long stretches of a build are NOT tool calls — importing a repo,
    // provisioning a database, `npm install`, booting the dev server, verifying the preview — so on
    // that report five consecutive heartbeats all pointed at the SAME narration line from minute 1,
    // and a 153-second window plus an 8m46s read-only survey were left with nothing to explain them.
    // The report could not answer "where did the time go?" because nothing was ever recording it.
    // An ACTIVE PHASE now outranks a stale last-activity line, so silence is described, not guessed.
    const status = inFlight.length
      ? `in-flight: ${inFlight.join(', ')}`
      : this.activePhase
        ? `${this.activePhase.name}, ${Math.round((this.now() - this.activePhase.at) / 1000)}s so far`
        : `last: ${this.lastActivity}`;
    this.record({ phase: 'build', severity: 'info', code: 'HEARTBEAT', message: `⏱ minute ${mins} — still working (${status})`, autoResolved: true });
  }

  /**
   * Mark the start of a long non-tool stretch (import, dependency install, preview boot, verification).
   * Idempotent-ish: a new phase supersedes an unclosed one rather than nesting, because these stretches
   * are sequential and a forgotten `exitPhase` must never freeze the heartbeat on a stale label.
   */
  enterPhase(name: string): void {
    const n = (name || '').trim();
    if (!n) return;
    if (this.activePhase) this.exitPhase();
    this.activePhase = { name: n, at: this.now() };
  }

  /**
   * Close the active phase and record how long it took — so the report carries a plain timeline of
   * where a build's minutes actually went, instead of a gap the next autopsy has to guess at.
   */
  exitPhase(): void {
    const p = this.activePhase;
    if (!p) return;
    this.activePhase = null;
    const seconds = Math.round((this.now() - p.at) / 1000);
    // Only worth a line when it actually consumed time; a sub-3s step is noise on the timeline.
    if (seconds >= 3) {
      this.record({
        phase: 'build', severity: 'info', code: 'PHASE_TIMING',
        message: `⏳ ${p.name} took ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}.`,
        autoResolved: true,
      });
    }
  }

  /**
   * AI Diagnosis Bundle #3 — record a sandbox command's RAW result (full stdout/stderr/exit code).
   * The timeline gets a one-line marker (severity from the exit code); the full logs go to the
   * `commands` channel. This is the single highest-value diagnostic signal: a non-zero `npm install`
   * / `tsc` / `vite build` here explains most "the app generated but won't run" failures.
   */
  /** The last audit note recorded, so a re-install replaces its predecessor instead of stacking. */
  private lastAuditNote: string | null = null;
  /**
   * Did THIS build already run the compatible `npm audit fix`? Read from the command log rather than
   * from the env flag, so the note describes what actually happened in this run — a build where the
   * fix was skipped for time still gets the advice, and one where it ran does not.
   */
  private compatibleAuditFixRan = false;

  recordCommand(rec: { command: string; exitCode: number | null; stdout?: string; stderr?: string; durationMs?: number }): void {
    // NPM ALREADY TOLD US (dukaan report 2026-08-12). That build's install printed "8 vulnerabilities
    // (4 moderate, 4 high)" and the report said nothing at all — not "clean", not "couldn't check". The
    // OSV-backed dep-health gate returns '' for BOTH outcomes, so silence proved nothing either way,
    // while the real answer sat in a log nobody parsed. Reading it here costs no network call, no model
    // call and no extra command, and it covers every install path by construction.
    if (looksLikeDependencyInstall(rec.command)) {
      try {
        // Set BEFORE the note is built, because the command that reveals this is usually the SAME one
        // whose output we are parsing: `looksLikeDependencyInstall` matches `audit`, so `npm audit fix`
        // both applies the compatible fixes and prints the tree they left behind.
        if (/\bnpm\b[^\n]*\baudit\b[^\n]*\bfix\b/.test(rec.command) && !/--force/.test(rec.command)) {
          this.compatibleAuditFixRan = true;
        }
        const audit = parseNpmAuditSummary(`${rec.stdout ?? ''}\n${rec.stderr ?? ''}`);
        const severity = auditSeverity(audit);
        const note = npmAuditNote(audit, { compatibleFixAlreadyRun: this.compatibleAuditFixRan });
        // Only the LATEST install describes the tree the app ships with, so a later result replaces an
        // earlier one rather than stacking a second, contradictory line in the same report.
        if (severity && note && this.lastAuditNote !== note) {
          this.lastAuditNote = note;
          // Spliced out and re-recorded rather than edited in place, so the entry carries the timestamp
          // of the install that actually produced it — the timeline stays a timeline.
          for (let i = this.issues.length - 1; i >= 0; i--) {
            if (this.issues[i].code === 'DEPENDENCY_VULNERABILITIES') this.issues.splice(i, 1);
          }
          this.record({
            phase: 'build',
            severity,
            // Never an ERROR: a working app with a vulnerable transitive dependency still works, and
            // blocking it would fail builds over something we cannot safely fix for the user.
            code: 'DEPENDENCY_VULNERABILITIES',
            message: note,
            autoResolved: false,
          });
        }
      } catch { /* a diagnostic must never break the command it is describing */ }
    }
    this.channelTotals.commands += 1;
    if (this.commands.length < MAX_COMMANDS) {
      this.commands.push({
        ts: this.now(),
        command: rec.command.slice(0, 500),
        exitCode: rec.exitCode,
        durationMs: rec.durationMs,
        stdout: capTail(rec.stdout, CMD_OUTPUT_CAP),
        stderr: capTail(rec.stderr, CMD_OUTPUT_CAP),
      });
    }
    // A non-zero exit is a build FAILURE only when it's a REAL failure — not a routine probe. See
    // isExpectedNonzeroExit: `|| true` guards, inspector tools whose exit 1 = "no match" (grep / pkill /
    // ss / …), and a health-probe curl hitting a not-yet-ready port all return non-zero WITHOUT anything
    // being wrong. Flagging those made a clean, successful build look error-ridden (a real report showed
    // 12 "errors", 6 of them just `grep`/`curl`/`ss` no-match exits). Admin-authorized 2026-07-03.
    const failed = rec.exitCode !== 0 && rec.exitCode !== null
      && !isExpectedNonzeroExit(rec.command, rec.exitCode)
      // A project-wide `tsc --noEmit` whose ONLY errors are in TEST files (missing vitest types in the
      // sandbox, a test's named-vs-default import) is not an APP-build failure — the app ships without
      // its test files and compiles clean. See isTestOnlyTypecheckFailure (deep-test build #4 rootCause).
      && !isTestOnlyTypecheckFailure(rec.command, rec.stdout, rec.stderr);
    const cmdHead = rec.command.split('\n')[0].slice(0, 120);
    const durTxt = rec.durationMs != null ? ` (${Math.round(rec.durationMs / 1000)}s)` : '';
    // HONESTY (ShopSphere autopsy 2026-07-19): an `exit -1 (0s, empty)` means the command COULD NOT RUN
    // because the sandbox was reaped/expired/unreachable — an INFRASTRUCTURE condition, NOT an app-build
    // error. Reported as SANDBOX_CMD_FAILED it read like the app failed to compile (`tsc → exit -1`,
    // `tsconfig.json does not exist`) and could become the build's rootCause, falsely blaming the app.
    // Classify it distinctly so the report tells the truth and deriveRootCause never blames the app.
    const deadSandbox = failed && isDeadSandboxSignal({
      exitCode: rec.exitCode ?? 0,
      durationMs: rec.durationMs,
      stdout: rec.stdout,
      stderr: rec.stderr,
    });
    if (deadSandbox) {
      this.record({
        phase: 'build',
        severity: 'warning',
        code: 'SANDBOX_UNAVAILABLE',
        message: `$ ${cmdHead} → could not run — the build sandbox was unavailable (reaped/expired/unreachable). Infrastructure condition, not an app error.`,
        autoResolved: false,
        detail: capTail(rec.stderr || rec.stdout, 400) || undefined,
      });
      return;
    }
    // HONESTY (MediConnect autopsy 2026-07-19): a `prisma migrate`/`seed` can EXIT 0 while its output
    // proves the DB was never reachable (`P1001: Can't reach database server`, `did not come up on port
    // 5432`). The exit code lies — the migration did NOT apply. Recording it as a benign SANDBOX_CMD
    // let the builder believe the DB was ready and improvise a broken SQLite downgrade. Surface it as a
    // distinct DB_UNREACHABLE problem so the report tells the truth and the builder isn't fooled.
    if (!failed && detectSilentDbFailure({ command: rec.command, exitCode: rec.exitCode, stdout: rec.stdout, stderr: rec.stderr })) {
      this.record({
        phase: 'build',
        severity: 'error',
        code: 'DB_UNREACHABLE',
        message: `$ ${cmdHead} → reported exit 0 but the database was NOT reachable — the migration/query did not actually run.`,
        autoResolved: false,
        detail: capTail(rec.stderr || rec.stdout, 400) || undefined,
      });
      return;
    }
    this.record({
      phase: 'build',
      severity: failed ? 'error' : 'info',
      code: failed ? 'SANDBOX_CMD_FAILED' : 'SANDBOX_CMD',
      message: `$ ${cmdHead} → exit ${rec.exitCode ?? '?'}${durTxt}`,
      autoResolved: !failed,
      detail: failed ? capTail(rec.stderr || rec.stdout, 400) : undefined,
    });
  }

  /**
   * Release-gate fallback evidence (2026-09-16): did a real typecheck already run somewhere in this
   * build's OWN command history, even though the deterministic post-build gate never ran one? See
   * `typecheckEvidenceFromCommands` in `./TscGate` for the full reasoning and the exact report that
   * surfaced the gap. `undefined` means "found nothing to go on" — callers should leave their own
   * evidence at whatever default they already had, never invent a pass.
   */
  typecheckEvidenceFromAgentCommands(): 'passed' | 'failed' | undefined {
    return typecheckEvidenceFromCommands(this.commands);
  }

  /**
   * EVERYTHING this build's own command log already settles — see `./agentRunEvidence`.
   *
   * The generalisation of the method above. That one closed the typecheck half of autopsy 697b38ee
   * and was wired for that one fact; the `tests` half of the SAME report went unread, so a build
   * whose Playwright suite the agent had installed, run and PASSED was told it had "no test suite
   * that could be run here". A gate asks this instead of growing a third private fallback.
   *
   * Absent keys mean the log does not settle that fact — never a promotion to a pass.
   */
  agentRunEvidence(): AgentRunEvidence {
    return readAgentRunEvidence(this.commands);
  }

  /**
   * AI Diagnosis Bundle #4 — record one model turn's I/O (provider, model, prompt/response size +
   * preview, finish reason, tokens, latency). A `finishReason: 'max_tokens'` here is the smoking gun
   * for a truncated multi-file generation (the OneShot 8K-token cut-off).
   */
  /**
   * HOW LONG BEFORE THE BUILD ACTUALLY STARTED THINKING (admin report 2026-08-12).
   *
   * That build's first model call came 227 seconds in. For those 3 minutes 47 the user saw heartbeats
   * saying "still working" with nothing to report, and `SETUP_TIMING` cheerfully said "Workspace ready
   * in 0s" — measured before the sandbox restore, the dependency install and the secrets load, which
   * were the whole of it. So the one number the report did print about setup was the one part of setup
   * that was instant.
   *
   * Recorded HERE, on the first LLM call, because that is the only moment that can be defined without
   * guessing: everything before it is preparation, and the user experiences all of it as waiting. A
   * number nobody records is a number that grows.
   *
   * SECOND ROOT CAUSE — this diagnostic was itself misattributing time (admin report 2026-08-12, the
   * dukaan stock app). It printed:
   *
   *     107s passed before the build made its first model call — sandbox setup, project restore,
   *     dependency install and secrets loading all happen before this point
   *
   * The same report's narration disproves it: "Setting up your workspace…" at 0s, keys loaded at 18s,
   * "Planning the file list…" at 20s. Setup was over at ~20 seconds. The other ~87 were the planning
   * CALL running — because this hook fires from `recordLlmCall`, which runs when a call RETURNS, so
   * the number always contained the first call's own duration and then blamed setup for it.
   *
   * That is not a rounding error, it is a diagnostic pointing at the wrong subsystem: anyone acting on
   * it goes and optimises sandbox startup and finds nothing, while an 87-second model call goes
   * unexamined. (The "227 seconds" in the note above came from this same inflated measurement.) So the
   * call's own latency is subtracted, and the two numbers are reported separately — preparation is a
   * platform problem, model latency is a provider one, and they have nothing to do with each other.
   */
  /**
   * WHERE DID THE SILENT MINUTES GO? — the diagnostic that would have found the `listFiles` bug on the
   * day it was reported instead of a week later (Mitrify report a876b7bb, 2026-08-15).
   *
   * That report said `330s of preparation` and then listed the CATEGORIES it assumed were responsible
   * ("sandbox setup, project restore, dependency install and secrets loading") — none of them measured.
   * Meanwhile the report's own timestamps contained the answer in plain sight: 226 of those seconds
   * were ONE unbroken stretch with nothing recorded at all, sitting immediately after
   * "GitHub import via SERVER-SIDE zipball SUCCEEDED". That stretch was `listFiles` enumerating
   * `node_modules` over the network. A reader had to diff timestamps by hand to see it.
   *
   * 🔒 DERIVED FROM EVIDENCE ALREADY RECORDED, NOT FROM NEW TIMERS. Every entry is already stamped, so
   * the longest gap is a fact we own and simply never printed. That matters for more than tidiness:
   * hand-placed timers only measure the stretches somebody already suspected, and the whole problem
   * here was a stretch nobody suspected. This finds the next one too — including on code paths that do
   * not exist yet.
   *
   * Honest by construction: it names the last thing that HAPPENED before the silence, never a cause.
   * "The silence began after X" is a fact; "X caused it" would be a guess, and X is often innocent —
   * it is simply the last thing that spoke.
   *
   * Returns null when nothing is worth reporting (no gap, or one too short to matter). PURE.
   */
  /**
   * A TIMER TICK IS NOT ACTIVITY, AND COUNTING IT AS ACTIVITY HID A 160-SECOND STALL (build 8682b6b1).
   *
   * That report's preparation window was 171s, of which ONE measured step — the sandbox scan — took
   * 160.5s. The warning pointed the reader at a 60-second silence instead, because the heartbeat
   * writes `⏱ minute 1 — still working` once a minute and every one of those ticks LOOKED like
   * something happening. A 160-second stall was therefore reported as three 60-second ones, and the
   * biggest single cost in the build was invisible to the instrument built to find it.
   *
   * A heartbeat is the engine saying it is alive; it is by definition emitted while nothing else is
   *. Same rule as `isProgressNoise` in `activityTimeline.ts` — named so the two are recognisably one
   * idea rather than two coincidences.
   */
  private static isTimerChatter(e: { message?: string; code?: string }): boolean {
    return e?.code === 'HEARTBEAT' || String(e?.message ?? '').trimStart().startsWith('⏱');
  }

  static longestSilentGap(
    entries: ReadonlyArray<{ ts: number; message: string; code?: string }>,
    startedAt: number,
    untilTs: number,
    minSeconds = 20,
  ): { seconds: number; after: string; until: string } | null {
    const marks = [...(entries || [])]
      .filter((e) => e && typeof e.ts === 'number' && e.ts >= startedAt && e.ts <= untilTs)
      .filter((e) => !BuildDiagnostics.isTimerChatter(e))
      .sort((a, b) => a.ts - b.ts);
    let best: { seconds: number; after: string; until: string } | null = null;
    // The window from the build's start to its FIRST recorded entry counts too — a build that is silent
    // for four minutes before it says anything is exactly the case worth surfacing.
    let prevTs = startedAt;
    let prevMsg = 'the build started';
    for (const m of [...marks, { ts: untilTs, message: '' }]) {
      const seconds = Math.round((m.ts - prevTs) / 1000);
      // 🔑 `until` — the entry that ENDED the silence, which is usually the entry that EXPLAINS it.
      // Every self-timing step in this codebase records at COMPLETION (`PHASE_TIMING`, all four
      // `SETUP_TIMING` sites), so the line that breaks a silence is the line reporting the work that
      // filled it. `after` alone is structurally the least informative half: it names the last thing
      // that spoke BEFORE the stall, which is often innocent.
      if (seconds > (best?.seconds ?? 0)) best = { seconds, after: prevMsg, until: m.message };
      if (m.message) { prevTs = m.ts; prevMsg = m.message; }
    }
    if (!best || best.seconds < minSeconds) return null;
    const trim = (t: string) => t.split('\n')[0].slice(0, 120);
    return { seconds: best.seconds, after: trim(best.after), until: trim(best.until) };
  }

  /**
   * How much of the pre-first-call window was spent inside fast build lanes that were started and then
   * abandoned. Measured from the lanes' OWN recorded handoff events, so it is evidence rather than an
   * estimate; returns `null` when no lane was abandoned (then the ordinary setup sentence is correct).
   *
   * Static + pure so it is unit-testable without a build. See `recordTimeToFirstCall` for why it exists.
   */
  static abandonedLaneWindow(
    issues: Array<{ ts: number; code?: string }>,
    startedAt: number,
  ): { seconds: number; lanes: number } | null {
    // Only the HANDOFF events — the moment a lane gave up. A lane that SUCCEEDED never reaches this
    // code path (its build is already done), so there is nothing to exclude.
    const HANDOFF = new Set(['SIMPLE_BUILD_FALLBACK', 'ONESHOT_FALLBACK']);
    const marks = (issues ?? []).filter((i) => i && typeof i.ts === 'number' && HANDOFF.has(String(i.code)));
    if (marks.length === 0) return null;
    // The LAST handoff is where the window really ended: the lanes run in sequence, so the final one's
    // timestamp is how far into the build the fast path was still being attempted.
    const last = Math.max(...marks.map((m) => m.ts));
    const seconds = Math.round(Math.max(0, last - startedAt) / 1000);
    if (seconds <= 0) return null;
    return { seconds, lanes: marks.length };
  }

  private recordTimeToFirstCall(latencyMs?: number): void {
    if (this.llmCalls.length > 0) return; // only the first
    const elapsedMs = Math.max(0, this.now() - this.startedAt);
    // Clamped to the elapsed time: a provider-reported latency longer than the whole build so far is
    // not a measurement we can subtract, and a negative prep time would be worse than the old bug.
    const lat = typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0
      ? Math.min(latencyMs, elapsedMs)
      : undefined;
    const seconds = Math.round((lat === undefined ? elapsedMs : elapsedMs - lat) / 1000);
    const message = lat === undefined
      // NEVER INVENT THE SPLIT. Without a latency we cannot separate the two, so we say the number is
      // an upper bound rather than repeating the old confident, wrong attribution.
      ? `${seconds}s passed before the build's first model call was recorded — this includes the call's own duration, which was not measured, so treat it as an upper bound on setup.`
      // ATTRIBUTION MUST NAME THE REAL CRITICAL-PATH COSTS, not a plausible-sounding one that does not
      // block (build-setup investigation 2026-08-17). The blocking steps are sandbox create/connect,
      // project restore and secrets loading. Dependency install is DELIBERATELY not named: on a fresh
      // build `npm install` runs in the background boot, CONCURRENT with the build — it does not gate
      // this first call — and a resumed sandbox already carries node_modules. Naming it here sent an
      // autopsy to optimise install when the real cost was the cold sandbox and its round-trips.
      : `${seconds}s of preparation before the build's first model call began — sandbox setup, project restore and secrets loading all happen in it, and the user waits through every second. (Dependency install is NOT part of this wait: it runs in the background boot, concurrent with the build.) The first call itself then took ${Math.round(lat / 1000)}s; that is model time, not setup.`;
    // …UNLESS A FAST LANE ALREADY BURNED THAT WINDOW, IN WHICH CASE NONE OF THE ABOVE IS TRUE
    // (autopsy a38c6fef, 2026-09-13). A lane's model call is not RECORDED until it returns, so a lane
    // that is abandoned at its deadline leaves this window looking like pure setup. In the real report
    // that produced a confident "243s of preparation … sandbox setup, project restore and secrets
    // loading" for a build whose own SETUP_TIMING lines, in the same report, measured setup at 1.5
    // SECONDS. The 243s was two fast lanes started and abandoned (90s + 150s).
    //
    // The irony worth keeping: the comment above this sentence was itself written to fix an EARLIER
    // misattribution that "sent an autopsy to optimise install". A confident wrong cause is worse than
    // an admitted unknown, because it is acted on. So when the timeline proves a lane consumed this
    // window, the sentence says that instead — it is measured from real recorded events, never guessed.
    //
    // ⚠️ ONLY WHEN THE PREPARATION CLAIM IS ITSELF LARGE — and the SECOND report of the day is what
    // proved this guard necessary (build 5abad374, "Can you generate images?"). There, elapsed was 120s
    // and the call's own latency 117s, so preparation was correctly reported as 3s — while a lane had
    // been abandoned at 93s. Those are THE SAME CALL: the lane stopped waiting at 93s and the call
    // returned at 120s. Attributing 93s to "abandoned lanes" there would have replaced an accurate
    // sentence with a misleading one, i.e. exactly the failure this fix exists to prevent, committed by
    // the fix itself. Below the 60s line the ordinary wording is accurate and stays.
    const abandoned = seconds >= 60 ? BuildDiagnostics.abandonedLaneWindow(this.issues, this.startedAt) : null;
    const attributed = abandoned
      ? `${seconds}s passed before the build's first model call was recorded, and MOST OF IT WAS NOT SETUP: `
        + `${abandoned.seconds}s went to ${abandoned.lanes} fast build lane(s) that were started and then abandoned at their `
        + `deadline. Their model calls are only recorded when they return, so the window looks like preparation and is not. `
        + `Setup itself is measured separately — read the SETUP_TIMING lines for the real number.`
        + (lat === undefined ? '' : ` The first recorded call then took ${Math.round(lat / 1000)}s.`)
      : message;
    // WHERE THE TIME WENT — see longestSilentGap. Appended rather than replacing the sentence above,
    // because the total and the biggest single stretch answer two different questions, and the second
    // one is what an autopsy actually acts on. Only stated when a real gap exists.
    const gap = BuildDiagnostics.longestSilentGap(this.issues, this.startedAt, this.now() - (lat ?? 0));
    // ⚠️ THE WORDING HAD TO CHANGE IN THE SAME EDIT AS THE FILTER. Once timer ticks stop counting as
    // activity, "with NOTHING recorded" would be literally false — a heartbeat WAS recorded in that
    // stretch. Fixing a misleading pointer by making an untrue claim is the trade this repo forbids.
    const withGap = gap
      ? `${attributed} The longest single stretch with no work recorded (heartbeats aside) was `
        + `${gap.seconds}s, beginning right after: "${gap.after}"`
        + (gap.until
          // Self-timing steps record at COMPLETION, so this is usually the step that FILLED the
          // silence — the nearest thing to a cause the timeline can honestly offer. Still hedged: the
          // line that ended a stall is not proof it caused it.
          ? `, and ending at: "${gap.until}" — that second line is usually the step that filled it, and is where to look first.`
          : ' — that is where to look first (it names when the silence started, not what caused it).')
      : attributed;
    this.record({
      phase: 'plan',
      // Loud past the point where a user starts wondering whether anything is happening. Judged on
      // PREPARATION alone now — a fast setup followed by a slow model call is a provider problem, and
      // flagging it here sent the reader hunting the wrong subsystem.
      severity: seconds >= 60 ? 'warning' : 'info',
      code: 'TIME_TO_FIRST_CALL',
      message: withGap,
      autoResolved: seconds < 60,
    });
  }

  private firstRenderRecorded = false;
  /**
   * TIME_TO_FIRST_RENDER — when the app first rendered in a real browser during the build (inBuildGreen.ts).
   * The render-side sibling of TIME_TO_FIRST_CALL and of #3084's READY_BEFORE_END: "4 minutes" was a
   * feeling until this line; now it is a number. Recorded once, on the first proof only.
   */
  recordTimeToFirstRender(elapsedMs: number): void {
    if (this.firstRenderRecorded) return;
    this.firstRenderRecorded = true;
    const seconds = Math.max(0, Math.round(elapsedMs / 1000));
    this.record({
      phase: 'preview', severity: 'info', code: 'TIME_TO_FIRST_RENDER', autoResolved: true,
      message: `${seconds}s from build start to the first real-browser render of the app.`,
    });
  }

  recordLlmCall(rec: Omit<LlmCallRecord, 'ts' | 'promptPreview' | 'responsePreview'> & { promptPreview?: string; responsePreview?: string }): void {
    this.recordTimeToFirstCall(rec.latencyMs);
    this.channelTotals.llmCalls += 1;
    if (this.llmCalls.length < MAX_LLM_CALLS) {
      this.llmCalls.push({
        ts: this.now(),
        provider: rec.provider,
        model: rec.model,
        promptPreview: rec.promptPreview != null ? capHead(rec.promptPreview, LLM_PREVIEW_CAP) : undefined,
        responsePreview: rec.responsePreview != null ? capHead(rec.responsePreview, LLM_PREVIEW_CAP) : undefined,
        promptChars: rec.promptChars,
        responseChars: rec.responseChars,
        finishReason: rec.finishReason,
        toolCalls: rec.toolCalls,
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        latencyMs: rec.latencyMs,
        ok: rec.ok,
        error: rec.error ? rec.error.slice(0, 500) : undefined,
      });
    }
    // AN ENORMOUS PROMPT IS THE REPORT'S OWN BURIED HEADLINE — say so out loud (autopsy debc468c).
    //
    // That report carried `promptChars: 76,543,256` beside `inputTokens: 24,853`. Both numbers were
    // TRUE and they measure different things: promptChars is the system prompt plus the last message
    // BEFORE the transcript compactor trims it, inputTokens is what the provider actually received
    // after. Printed side by side with no explanation, the pair reads as broken telemetry — which is
    // exactly the conclusion I reached on first pass, and it stopped the investigation dead.
    //
    // The number was not noise. It was the loudest signal in the file: a single tool returned ~76 MB,
    // which the compactor then had to throw away. Nothing charged the user for it, so no cost line
    // showed it, and the sole trace was a field that looked like a glitch. Now it is a finding.
    if (typeof rec.promptChars === 'number' && rec.promptChars > HUGE_PROMPT_CHARS) {
      this.record({
        phase: 'provider',
        severity: 'warning',
        code: 'HUGE_PROMPT_DISCARDED',
        message:
          `A single step built a ${Math.round(rec.promptChars / (1024 * 1024))} MB prompt before compaction, ` +
          `of which the model received ${rec.inputTokens ?? 0} input tokens. Almost all of it was a tool ` +
          `result — most often one file read that is far larger than any file a build should be reading ` +
          `(a lockfile, a bundle, a minified asset). The compactor discarded it, so it cost memory and ` +
          `time without ever reaching the model.`,
        autoResolved: false,
        detail: `promptChars=${rec.promptChars} inputTokens=${rec.inputTokens ?? 0} model=${rec.model ?? 'unknown'}`,
      });
    }
    // A truncated response (max_tokens) or a failed call is a real struggle → flag on the timeline.
    const truncated = rec.finishReason === 'max_tokens' || rec.finishReason === 'length';
    // 🔴 A CALL WE STOPPED IS NOT A CALL THAT FAILED — and reading it as one told a real user their
    // working app was broken (report 70115adf, 2026-09-13).
    //
    // What happened: the fast lane handed off at 90s, the full builder finished the app, the
    // production build succeeded and a preview snapshot was saved. But the abandoned lane's plan call
    // outlived its lane by 18 seconds and then recorded an unresolved ERROR. `shippingIssueCount`
    // counts exactly those, so the release gate reported "1 build-breaking blocker", the verdict was
    // flipped to NOT ok, and the summary said the app "is NOT ready to use yet". Every artefact the
    // lane recorded for ITSELF was already marked resolved — this one arrived from a different path,
    // after the handoff, with nothing tying it back.
    //
    // ⚠️ IT IS NOT ENOUGH TO LOWER THE SEVERITY. `resolveRecoveredOnSuccess` forgives on success, and
    // success is precisely what this issue prevented: the error made the gate RED, the RED gate made
    // `ok` false, and `ok` false meant the error was never forgiven. A circle that can only be broken
    // where the fact is known — here, at the moment of recording.
    //
    // Recorded as INFO and resolved, never dropped: the build genuinely ran out of time and the
    // timeline must still show where. It simply stops being an accusation against a provider and a
    // blocker against the app.
    const budgetEnded = !rec.ok && isBudgetEndedError(rec.error);
    if (budgetEnded) {
      this.record({
        phase: 'provider',
        severity: 'info',
        code: 'LLM_CALL_BUDGET_ENDED',
        message: `A model call was stopped because this build's time budget ended, not because it failed (${rec.model ?? 'model'}).`,
        autoResolved: true,
        detail: rec.provider ? `provider=${rec.provider}` : undefined,
      });
    } else if (!rec.ok || truncated) {
      // A TURN that timed out with nothing received is not "<model> failed" — no single provider
      // answered at all, and the `model` on the record is the PLANNED id the runner was constructed
      // with (App #5 lesson below: the nominal label is not the delivering provider). Report 4efab9d7
      // printed "Model call failed (claude-sonnet-4-6)" for a weak build on which no Claude call was
      // ever made; the chain had spent the whole turn timing out on one vendor's key pool. Say what
      // is actually known, and keep the planned id where it belongs — in the detail.
      const turnTimedOutUnanswered = !rec.ok && /timed out after/.test(rec.error ?? '') && !(rec.inputTokens || 0) && !rec.provider;
      this.record({
        phase: 'provider',
        severity: rec.ok ? 'warning' : 'error',
        code: rec.ok ? 'LLM_TRUNCATED' : 'LLM_CALL_FAILED',
        message: rec.ok
          // 🔴 "MAY BE TRUNCATED" WAS TOO KIND BY HALF (autopsy ee20478d, 2026-09-15). This warning
          // fired three times in a build that produced ZERO output — 4,833 tokens spent, 0 response
          // characters, 0 tool calls, every time — and the hedged wording read like a caveat on an
          // answer that arrived. The platform had the evidence in its hand (`responseChars` and
          // `toolCalls` are on this very record) and described a total loss as a possible trim.
          // Nothing downstream acted, because nothing downstream was told anything had gone wrong.
          ? (!rec.responseChars && !rec.toolCalls
              ? `A model turn spent its ENTIRE output allowance (${rec.outputTokens ?? 0} tokens) and produced NOTHING — no text, no tool call (${rec.model ?? 'model'}, finish=${rec.finishReason}). `
                + 'This is our own output ceiling being smaller than the answer needed, not a provider fault and not the app: see floorBudget.ts.'
              : `Model response hit the token limit (${rec.model ?? 'model'}, finish=${rec.finishReason}) — output may be truncated.`)
          : turnTimedOutUnanswered
            ? `A model turn timed out with no provider answering (${rec.error})`.slice(0, 400)
            : `Model call failed (${rec.model ?? 'model'}): ${rec.error ?? 'unknown error'}`.slice(0, 400),
        autoResolved: false,
        detail: rec.provider ? `provider=${rec.provider}` : turnTimedOutUnanswered ? `planned model=${rec.model ?? 'unknown'} — the label, not a provider that ran` : undefined,
      });
    }
  }

  /**
   * WEAK-TIER NO-CLAUDE honesty check — the TRUTH of "did Claude actually DELIVER a build turn," read
   * from the PROVIDER DELIVERY / per-provider token ledger (the real runner the multi-provider chain
   * used: 'CLAUDE' / 'CLAUDE_HAIKU'), NOT from an llmCall's nominal `model` label.
   *
   * ROOT CAUSE this corrects (deep-test App #5, 2026-07-13): a 100%-GLM build recorded every llmCall with
   * the REQUESTED model id ('claude-sonnet-4-6') even though GLM answered every turn (providerDelivery
   * {GLM:14}, ZERO Claude tokens). The AgentRunner stamps the llmCall with its nominal `this.model`, while
   * the ACTUAL provider is tracked separately via onProviderUsed. The earlier model-label check
   * (`claudeModelUsed`, now removed) therefore FALSE-flagged that clean build as a no-Claude VIOLATION and
   * wrongly set billing.noClaude=false — defaming a build that never touched Claude. Provider delivery is
   * populated from the chain's real onProviderUsed, so a cheap-provider turn is never mislabelled Claude;
   * the token ledger is the corroborating cost signal (a real Claude turn burns Claude tokens).
   *
   * HAIKU AMENDMENT (admin-mandated 2026-07-13): the weak module may use Claude **HAIKU** as its
   * authorized last resort ("haiku ke alawa kuch aur nahi — sonnet ya opus never never"), so a
   * 'CLAUDE_HAIKU' / haiku-id delivery is NOT a violation anymore — only a Sonnet/Opus-class delivery
   * ('CLAUDE', or a non-haiku Claude model id) is. The generic 'anthropic' label is deliberately NOT
   * matched: fastLaneProviderLabel maps BOTH CLAUDE and CLAUDE_HAIKU to 'anthropic', so it cannot
   * distinguish the authorized Haiku from a real Sonnet leak — and a false NO_CLAUDE_VIOLATION defames
   * a clean build (the exact App #5 lesson). Chain-delivered Sonnet is always named 'CLAUDE' here.
   *
   * Returns the violating Claude provider name (or null when no unauthorized Claude ran). Pure; never
   * throws. (A raw non-Haiku Claude call that bypasses provider tracking cannot occur on a weak build:
   * ClaudeClient.runTurn's no-Claude-zone guard refuses it before it runs — see noClaudeZone.ts.)
   */
  claudeProviderDelivered(): string | null {
    const isViolatingClaude = (name: string): boolean =>
      name === 'CLAUDE' || (isClaudeModel(name) && !/haiku/i.test(name));
    for (const name of this.providerDelivery.keys()) if (isViolatingClaude(name)) return name;
    if (this.providerTokens) for (const name of Object.keys(this.providerTokens)) if (isViolatingClaude(name)) return name;
    // A weak build that leaked Sonnet must be catchable BEFORE it settles, not only after.
    if (this.liveTokens) for (const name of Object.keys(this.liveTokens)) if (isViolatingClaude(name)) return name;
    return null;
  }

  /**
   * AI Diagnosis Bundle #1 — record a FULL error (message + stack), un-truncated. The timeline keeps
   * its short BUILD_ERROR line; this channel preserves the complete text so the real root cause (the
   * throwing frame) is never lost to a 800-char slice.
   */
  recordFullError(err: { message: string; stack?: string; phase?: IssuePhase }): void {
    this.channelTotals.errors += 1;
    if (this.errors.length >= MAX_ERRORS) return;
    this.errors.push({
      ts: this.now(),
      phase: err.phase ?? 'build',
      message: capTail(err.message, ERROR_MESSAGE_CAP),
      stack: err.stack ? capTail(err.stack, STACK_CAP) : undefined,
    });
    this.notify();
  }

  /**
   * Capture an OFFENDING generated file's content on a compile failure (#1). De-dupes by path
   * (latest wins) and caps content + count so the report stays bounded. This is what lets a
   * reader SEE the exact mismatch (e.g. a hook vs its consumer) instead of inferring it.
   */
  recordFile(file: { path: string; content: string; note?: string }): void {
    if (!file.path) return;
    const existing = this.generatedFiles.findIndex((f) => f.path === file.path);
    const rec: GeneratedFileRecord = { ts: this.now(), path: file.path, content: capHead(file.content, GEN_FILE_CAP), note: file.note };
    if (existing >= 0) { this.generatedFiles[existing] = rec; this.notify(); return; }
    if (this.generatedFiles.length >= MAX_GEN_FILES) return;
    this.generatedFiles.push(rec);
    this.notify();
  }

  /**
   * Record a PREVIEW failure (in-browser srcdoc, or live runtime). Captured AFTER the build so a
   * "successful" build that doesn't actually render is still a real, downloadable signal. Also adds
   * a timeline error line. Capped + deduped against the immediately-previous identical message.
   */
  recordPreviewError(rec: { source: 'in-browser' | 'live'; message: string }): void {
    const message = capTail(rec.message, PREVIEW_ERROR_CAP);
    const last = this.previewErrors[this.previewErrors.length - 1];
    if (last && last.source === rec.source && last.message === message) return; // ignore immediate repeats
    if (this.previewErrors.length < MAX_PREVIEW_ERRORS) {
      this.previewErrors.push({ ts: this.now(), source: rec.source, message });
    }
    this.record({ phase: 'preview', severity: 'error', code: 'PREVIEW_ERROR', message: `${rec.source} preview failed: ${message}`.slice(0, 400), autoResolved: false });
  }

  /** Store the post-build reviewer's FULL findings (capped) so the report lists every small problem
   *  it flagged — not just the 400-char timeline snippet. */
  recordReview(text: string): void {
    if (!text) return;
    this.reviewText = capHead(text, 12_000);
    this.notify();
  }

  /**
   * Derive issues from a live AgentEvent. Safe to call on EVERY event — it only
   * captures the ones that signal a struggle (a failed tool, a not-ready verdict,
   * a hard error) plus a couple of useful info markers (preview, delegation).
   */
  ingestEvent(e: AgentEvent): void {
    switch (e.type) {
      case 'tool_call': {
        // Record EVERY tool call (the full activity timeline) and remember it as in-flight, so a
        // hang can be named ("stuck on X") instead of leaving an 11-minute blank in the report.
        const tc = e as unknown as { tool?: unknown; callId?: unknown; ts?: number; agent?: unknown; input?: unknown };
        const tool = String(tc.tool ?? 'tool');
        const callId = typeof tc.callId === 'string' ? tc.callId : undefined;
        if (callId) this.pending.set(callId, { tool, ts: tc.ts ?? this.now() });
        this.lastActivity = tool;
        // WHAT IT WAS AIMED AT, not just which tool. Two thirds to three quarters of a weak build's
        // turns are read_file and grep (measured, 2026-08-25) — and until now the report recorded
        // `▶ read_file` with no target, so the one question that would say whether those turns are
        // WASTE (is it reading the same file over and over?) could not be asked of any build we have
        // ever run. See toolCallTarget for why no secret can reach this line.
        this.record({ phase: 'tool', severity: 'info', code: 'TOOL_CALL', message: `▶ ${tool}`, autoResolved: true, detail: toolCallDetail(tc.agent, tc.input) });
        break;
      }
      case 'tool_result': {
        const started = e.callId ? this.pending.get(e.callId) : undefined;
        if (e.callId) this.pending.delete(e.callId);
        const durS = started ? Math.round(((e.ts ?? this.now()) - started.ts) / 1000) : undefined;
        if (!e.ok) {
          // A failed tool call. Whether it was fatal is decided at finish() from the
          // final build outcome (the agent usually retries and recovers).
          this.record({
            phase: 'tool', severity: 'warning', code: 'TOOL_ERROR',
            message: `Tool call failed: ${e.summary}`.slice(0, 500),
            autoResolved: false, detail: `agent=${e.agent} callId=${e.callId}${durS != null ? ` ${durS}s` : ''}`,
          });
        } else {
          // Successful tool call — part of the activity timeline (with how long it took).
          this.record({ phase: 'tool', severity: 'info', code: 'TOOL_DONE', message: `✓ ${started?.tool ?? 'tool'}${durS != null ? ` (${durS}s)` : ''}`, autoResolved: true });
        }
        break;
      }
      case 'error':
        this.record({
          phase: 'build', severity: 'error', code: 'BUILD_ERROR',
          message: e.message.slice(0, 800), autoResolved: false,
        });
        // #1 full errors — keep the COMPLETE message (the 800-char timeline slice can drop the real
        // root cause that sits further down a long stack/log).
        this.recordFullError({ message: e.message, phase: 'build' });
        break;
      case 'done':
        this.ok = e.ok;
        this.summary = e.summary;
        if (e.readiness) {
          for (const b of e.readiness.blockers ?? []) {
            this.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: b, autoResolved: false });
          }
          for (const w of e.readiness.warnings ?? []) {
            this.record({ phase: 'readiness', severity: 'warning', code: 'READINESS_WARNING', message: w, autoResolved: true });
          }
        }
        this.notify();
        break;
      case 'preview':
        // "PUBLISHED" CLAIMED MORE THAN WE KNEW (admin report 2026-08-24, a Next.js racing game).
        //
        // The timeline: `npm run dev` returned, the port was listening, we recorded "Preview published
        // at <url>" — and THIRTY-ONE SECONDS LATER recorded PREVIEW_NOT_RENDERED, "the server returned
        // 404 / Cannot GET". The url was handed over as a finished thing and then found not to work.
        //
        // The readiness test is not wrong: a listening port IS the right signal to publish on, and for
        // an API-only app a 404 on `/` is a perfectly healthy dev server (see PreviewVerify). What was
        // wrong is the WORD. Next.js dev binds its port immediately and compiles a route on the first
        // request, so "the port is up" and "your app answers" are seconds to a minute apart — and only
        // the second one is what "published" sounds like to the person reading it.
        //
        // So the line now says what was actually established. The render check that follows either
        // upgrades it or contradicts it, and either way the reader was never told more than we knew.
        this.record({
          phase: 'preview', severity: 'info', code: 'PREVIEW_PUBLISHED',
          message: `Preview address is live at ${e.url} — the server is listening. Whether the app itself renders is checked next.`,
          autoResolved: true,
        });
        break;
      case 'narration': {
        const t = (e.text || '').trim();
        if (!t) break;
        this.lastActivity = t.slice(0, 80);
        /**
         * 🔴 A LINE THAT UPDATES EVERY 15 SECONDS MUST NOT BECOME 120 ROWS (autopsy 2b0a3ed5).
         *
         * The "still working" clock is emitted repeatedly with a stable id so the SURFACE replaces one
         * line — but every narration also lands on this timeline, and a 30-minute build would file its
         * own reassurance a hundred times over, burying the report the line exists to sit beside.
         *
         * Recorded ONCE, which is the same discipline `slowKeptAnyway` already uses for a verdict that
         * stays true: the admin needs to know the user was being told something, not to read the clock
         * tick. `lastActivity` above is still refreshed on every tick, so the still-running detector —
         * which is the one reader that genuinely wants the newest heartbeat — is unaffected.
         */
        if (isTransientStatusLine(t)) {
          if (this.transientStatusRecorded) break;
          this.transientStatusRecorded = true;
        }
        // A problem the agent is talking about (sandbox unavailable, port/preview not responding,
        // errors remaining, retries) is flagged warning/error; everything else is recorded as a
        // normal AGENT_STEP so the report shows WHAT the agent was doing minute-to-minute, not only
        // its struggles.
        // LONG ANALYTICAL PROSE IS NEVER A PROBLEM (report honesty, 2026-07-07 ×3): a successful
        // survey/summary containing phrases like "No error boundaries" was keyword-matched into a
        // severity=error AGENT_NOTE and even became the report's rootCause. Only a SHORT status-like
        // line (no markdown headings/tables, bounded length) can be classified as a problem — a
        // multi-paragraph analysis is a deliverable, not a struggle.
        // THE PROJECT RECAP IS A DELIVERABLE, NEVER A PROBLEM (the "Top failure patterns" autopsy,
        // 2026-09-17). "🔍 I analyzed your project — no files were changed" is the platform's own
        // honest sentence about a turn with nothing to change; "no files" is a problem word (it catches
        // "no files were produced"), so a short recap was filed as a WARNING and, on an empty build,
        // became the report's root cause. Exempted by exact headline, so a model's prose cannot claim it.
        const statusLike = t.length <= 300 && !/(^|\n)#{1,4}\s|\n\s*\|/.test(t) && !isProjectSummaryNarration(t);
        // BENIGN COMPOUNDS ARE NOT PROBLEMS (ShopKhata autopsy 2026-07-17): "Now let me create the App
        // component with routing and error boundary:" was recorded severity=error because \berror\b
        // matched inside "error boundary". Building error-UX (boundaries, handling, messages, toasts)
        // is normal work — strip those compounds BEFORE the problem-keyword test so only a genuine
        // failure phrase can classify a narration as a problem.
        const tForMatch = stripBenignCompounds(t);
        const problemWord = PROBLEM_WORD_RE.test(tForMatch);
        // A genuine FAILURE VERB (not the bare noun "error") is what makes a note a real problem — and an
        // ERROR-severity one. "error"/"errors" as a NOUN the agent is working on is not itself a failure.
        const failureVerb = /\b(failed|cannot|could not|unavailable|timed out)\b/i.test(tForMatch);
        // REMEDIATION INTENT is progress, not a failure (PaisaTrack "fix all error" autopsy 2026-07-21:
        // "Now I'll fix both errors: … Fix the TypeScript type error" was recorded severity=error on a
        // SUCCESSFUL build, inflating the count to "1 error" under an "All Errors Fixed!" summary). When a
        // note is the agent fixing/removing/resolving something and carries NO real failure verb, it is a
        // build STEP, not a problem.
        const remediationIntent = /\b(fix(?:ing|ed|es)?|remov(?:e|es|ing|ed)|resolv(?:e|es|ing|ed)|correct(?:s|ing|ed)?|clean(?:s|ing|ed)?\s+up|delet(?:e|es|ing|ed))\b/i.test(tForMatch);
        // ECHOING THE USER'S OWN REPORTED SYMPTOM IS NOT THE ENGINE STRUGGLING (build e4ebcb5f).
        // Gated on `!failureVerb` exactly as `remediationIntent` is, so a genuine failure ("The dev
        // server FAILED to start — port 5173 error.") stays an error even when the prompt says "error".
        const echoesPrompt = narrationEchoesPromptSymptom(tForMatch, this.meta.prompt);
        if (statusLike && problemWord
          && !(remediationIntent && !failureVerb)
          && !(echoesPrompt && !failureVerb)) {
          this.record({ phase: 'build', severity: failureVerb ? 'error' : 'warning', code: 'AGENT_NOTE', message: t.slice(0, 400), autoResolved: true });
        } else {
          this.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: t.slice(0, 400), autoResolved: true });
        }
        break;
      }
      default: {
        // Other notable milestones (delegation, plan, todo updates) go on the timeline as info.
        const t = e.type as string;
        const milestone = ['agent_spawned', 'agent_done', 'plan', 'plan_step_start', 'plan_updated', 'todo_updated', 'checkpoint', 'repo'].includes(t);
        if (milestone) {
          const a = e as unknown as { agent?: unknown };
          this.lastActivity = t;
          this.record({ phase: 'build', severity: 'info', code: 'EVENT', message: `• ${t}${a.agent ? ` (${String(a.agent)})` : ''}`, autoResolved: true });
        } else {
          this.notify();
        }
        break;
      }
    }
  }

  /**
   * Finalize the report. Back-fills the autoResolved flag for ambiguous issues
   * (a failed tool, a "no build" nudge) based on whether the build ultimately
   * succeeded — if the build is ok, those were recovered; if not, they remained.
   */
  finish(ok: boolean, summary?: string): void {
    this.endedAt = this.now();
    this.ok = ok;
    if (summary !== undefined) this.summary = summary;
    // If the build ended NOT-ok with tool calls still in-flight, those are EXACTLY what it hung on
    // — name them so a timeout report points at the real culprit instead of a blank gap.
    if (!ok) {
      for (const { tool, ts } of this.pending.values()) {
        this.record({ phase: 'tool', severity: 'error', code: 'STUCK_TOOL', message: `Stuck on '${tool}' — in-flight ${Math.round((this.endedAt - ts) / 1000)}s, never completed.`, autoResolved: false });
      }
    }
    this.pending.clear();
    // When the build ULTIMATELY SUCCEEDED, any intermediate failure it recovered from is resolved by
    // definition (see resolveRecoveredOnSuccess). This is also applied at serialization time (toReport),
    // so a finalize path that bypasses finish() still yields an honest report.
    this.resolveRecoveredOnSuccess();
    this.notify();
  }

  /**
   * Mark every RECOVERABLE-ON-SUCCESS issue (a failed tool call, a "no build" nudge, an empty-build
   * retry, a sandbox command that exited non-zero) as resolved WHEN the build ultimately succeeded —
   * because a successful build recovered from them by definition. Idempotent and gated on ok, so it is
   * safe to run more than once and at serialization time.
   *
   * ROOT CAUSE this centralization closes (PaisaTrack "fix all error" autopsy 2026-07-21): the build
   * SUCCEEDED (app live, `ok:true`) yet the downloaded report showed "3 unresolved" TOOL_ERRORs (a
   * truncated large tool-call — "Unterminated string in JSON" — and two benign `npm run build | grep -i
   * error` exit-1 no-match probes) AND named one of them as the build's `rootCause`. The one-shot
   * back-fill in finish() had not taken effect for that serialized report (a finalize path bypassed it).
   * Making the truth a property of SERIALIZATION, not a single mutation, guarantees a successful build
   * never reports a recovered transient as an unresolved failure or as its root cause.
   */
  private resolveRecoveredOnSuccess(): void {
    if (this.ok !== true) return;
    const recovered = recoveredCommands(this.commands);
    for (const issue of this.issues) {
      if (!isRecoverableOnSuccess(issue.code)) continue;
      // A FAILED COMMAND NEEDS EVIDENCE, NOT AN ALIBI (autopsy d6deaaf0, Mitrify, 2026-08-09).
      // "The build succeeded, so everything transient was recovered" is true of a retried tool call.
      // It is NOT true of a command whose failure had a lasting consequence: `npm run db:push` exited
      // 127, the tables were never created, the next two diagnostics say exactly that — and this
      // back-fill still stamped it `autoResolved: true`, where it became the build's ONE reported
      // "self-heal". A tally that counts a permanent failure as a heal is a green number wearing a
      // lie, and it feeds the admin's first-pass-quality headline. A failed command is now forgiven
      // unless the run itself still carries an unresolved problem ABOUT that command — see
      // failureHasSurvivingConsequence for why both this case and PaisaTrack's must keep working.
      if (issue.code === 'SANDBOX_CMD_FAILED'
        && !recovered.has(commandKey(issue.message))
        && failureHasSurvivingConsequence(issue.message, this.issues)) continue;
      issue.autoResolved = true;
    }
  }

  /**
   * Update the framework label after the run learns what the app REALLY is.
   *
   * ROOT CAUSE (autopsy d6deaaf0, Mitrify, 2026-08-09): `meta.framework` was captured ONCE, when the
   * diagnostics object was constructed at build start, from the request's default (`vite-react`).
   * The import detected `node-express` twelve seconds later and the manifest recorded it correctly —
   * so ONE build carried TWO different answers to the same question, and the report's answer was the
   * wrong one. This is the exact sibling of the stale `model` label `honestModelLabel` was written to
   * fix on 2026-07-27: same object, same moment of capture, same "the truth arrives later" shape. A
   * blank value is ignored, so a caller can never erase a known framework with an unknown one.
   */
  setFramework(framework: string | undefined | null): void {
    const f = (framework ?? '').trim();
    if (f) this.meta.framework = f;
  }

  /**
   * Record that one build turn was DELIVERED by a given provider (the name the multi-provider runner
   * reports via its onProviderUsed callback, e.g. 'GLM' | 'KIMI' | 'CLAUDE' | 'CLAUDE_HAIKU'). Counts
   * per provider so the report shows the delivery split. Best-effort — a blank name is ignored.
   */
  recordProviderTurn(name: string): void {
    if (!name) return;
    this.providerDelivery.set(name, (this.providerDelivery.get(name) ?? 0) + 1);
    this.notify();
  }

  /**
   * Record that a provider FAILED a turn (threw and the chain fell through to the next) — the
   * per-provider failure COUNT the admin asked for ("kaun se providers fail hue, kitni baar").
   * Complements the PROVIDER_FALLBACK timeline entries (those carry the messages; this is the tally).
   */
  /**
   * Tally a provider failure — AND keep the distinct REASONS, which is the part that was missing.
   *
   * ROOT CAUSE (BENCHMARK 0 report, 2026-08-12): the report said `providerFailures: {GLM: 21, KIMI: 3}`
   * and carried FOUR timeline entries, because `record()` collapses consecutive identical messages and
   * every one of them reads "Provider GLM failed — falling back to the next provider". Twenty of the
   * twenty-four error messages were discarded, so the single largest struggle signal in the whole build
   * — twenty-one failures of the default provider — could not be diagnosed at all. A count with no
   * reason cannot be acted on; it can only be worried about.
   *
   * Reasons are bucketed (rate-limit / timeout / auth / …) so 21 failures collapse into "18 rate-limit,
   * 2 timeout, 1 bad-request" instead of 21 near-identical strings, and the set is hard-capped.
   */
  /** Providers already flagged for a dead ladder rung — one warning each, never 55. */
  private readonly deadRungFlagged = new Set<string>();
  /** Providers already flagged for a starved output budget — one warning each. */
  private readonly starvedBudgetFlagged = new Set<string>();

  recordProviderFailure(name: string, reason?: unknown): void {
    if (!name) return;
    this.providerFailures.set(name, (this.providerFailures.get(name) ?? 0) + 1);
    if (reason !== undefined) {
      const bucket = classifyProviderFailure(reason);
      const byBucket = this.providerFailureReasons.get(name) ?? new Map<string, number>();
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
      this.providerFailureReasons.set(name, byBucket);

      // A DEAD LADDER RUNG ANNOUNCES ITSELF (admin autopsy 2026-09-01).
      //
      // `model-unavailable` cannot come right on a retry — the id is wrong, retired, or off this key's
      // plan — so the SECOND one proves the rung is systematically unreachable rather than unlucky.
      // Raised here, at the moment the evidence exists, because the alternative (deriving it at settle
      // time) needs a call site in the route and would go missing on any path that settles early — and
      // this finding matters most precisely on the builds that end badly.
      //
      // Once per provider: 55 identical warnings is what buried this in the first place. It is a
      // WARNING and `autoResolved: false`, because the fallback rescuing the call is exactly what made
      // 56 of one build's 59 "self-heals" a single misconfiguration wearing a green checkmark.
      if (bucket === 'model-unavailable'
        && (byBucket.get(bucket) ?? 0) === 2
        && !this.deadRungFlagged.has(name)) {
        this.deadRungFlagged.add(name);
        const detail = (reason instanceof Error ? reason.message : String(reason ?? '')).split('\n')[0].slice(0, 120);
        this.record({
          phase: 'provider',
          severity: 'warning',
          code: 'MODEL_LADDER_DEAD_RUNG',
          message: `A model in the ${name} fallback ladder is UNREACHABLE on this account and fails every time it is tried — "${detail}". `
            + 'This is a configuration defect, not a provider outage: every call burns a wasted request on it before falling through '
            + 'to the next rung, on every build, until the model id is corrected against the provider\'s live model list.',
          autoResolved: false,
        });
      }

      // OUR OWN OUTPUT CEILING STARVED A HEALTHY RUNG (autopsy ee20478d, 2026-09-15).
      //
      // Raised on the FIRST occurrence, unlike the dead-rung warning above which waits for a second:
      // a dead rung needs a repeat to prove it is systematic rather than unlucky, whereas this one is
      // arithmetic — the authorised budget is a constant for the run, so one starved call proves every
      // later call on that rung would starve too. That is exactly why the rung is retired on first
      // sight in MultiProviderTurnRunner, and this finding is the admin-facing half of that decision.
      //
      // It exists because the failure it names is INVISIBLE to every other signal: the provider
      // returned HTTP 200, so before this bucket existed nothing appeared in this ledger at all, and
      // every honesty check the platform owns reads this ledger.
      if (bucket === 'output-budget' && !this.starvedBudgetFlagged.has(name)) {
        this.starvedBudgetFlagged.add(name);
        const detail = (reason instanceof Error ? reason.message : String(reason ?? '')).split('\n')[0].slice(0, 200);
        this.record({
          phase: 'provider',
          severity: 'warning',
          code: 'OUTPUT_BUDGET_STARVED',
          // 🔒 TWO DIFFERENT FACTS, TWO DIFFERENT SENTENCES (autopsy f5351721). Since the clamp is lifted
          // for a rung known to always reason, "our own output ceiling" is no longer true of every
          // starvation — and it is the clause the admin reads first. One that starves on the FULL ask
          // is a model that cannot finish thinking inside any budget a turn can carry; saying "our
          // ceiling" there would send the next autopsy to floorBudget.ts to fix arithmetic that is
          // already correct.
          // 🔴 AND A THIRD, BECAUSE THE SECOND ONE NAMED THE WRONG MODULE (autopsy d98dae01,
          // 2026-09-17). The clamped sentence ends by pointing at FLOOR_TIMEOUT_CAP_MS and
          // AGENTV3_FLOOR_MS_PER_TOKEN — true when the rung's OWN cap bounded the call, and false
          // whenever `turnDeadline` picked the calling lane's remaining budget instead. That report's
          // 2,314-token ceiling is 74,420 ms at the floor rate: the fast lane's 90 s plan cap minus a
          // crawl, nothing like the 150 s cap the sentence blamed. Raising either of the two named
          // knobs would have changed NOTHING, and an autopsy reading that line would have spent its
          // time on arithmetic that was already correct.
          message: isUnclampedStarvation(reason)
            ? `The ${name} rung answered inside its clock and produced nothing — "${detail}". `
              + 'Its ceiling was NOT reduced by us: this rung always reasons, so it keeps the build loop\'s full per-turn ask, and it still spent every token thinking before any text or tool call appeared. '
              + 'That is the model, not our arithmetic; the rung was retired for the rest of this build so the ladder could reach a vendor that fits.'
            // 🔴 AND A FOURTH (autopsy 57875eb3, 2026-09-17): the ask was never reduced at all. A
            // fast-lane repair asked for 8,000 tokens, the clock could carry ~9,800, and glm-5.3
            // spent all 8,000 thinking — thirteen times. The "own cap" sentence below blamed
            // FLOOR_TIMEOUT_CAP_MS for a ceiling that was the caller's own `maxTokens`.
            : isAskBoundStarvation(reason)
            ? `The ${name} rung answered inside its clock and produced nothing — "${detail}". `
              + 'Its ceiling was the CALLER\'S OWN ASK: the call requested exactly this many output tokens, the clock would have carried more, and nothing in floorBudget.ts reduced it — so the number to look at is that caller\'s per-call ask, not this engine\'s own cap or rate constant in floorBudget.ts. '
              + 'A reasoning model bills its thinking to the same ceiling, so an ask below its thinking returns a reply with no text and no tool call. '
              + 'The rung was retired for the rest of this build so the ladder could reach a vendor that fits.'
            : isLaneBoundStarvation(reason)
            ? `The ${name} rung answered inside its clock and produced nothing, because the ceiling it was given was spent before the answer began — "${detail}". `
              + 'This is NOT a provider outage and NOT the user\'s prompt: a reasoning model bills its thinking to the same ceiling, so a ceiling below its thinking returns a truncated reply with no text and no tool call. '
              + 'The ceiling here came from the REMAINING BUDGET OF THE LANE that made the call, not from this engine\'s own cap — so the fix is how much clock that lane reserves for an answer, not the cap or the rate constant in floorBudget.ts. '
              + 'The rung was retired for the rest of this build so the ladder could reach a vendor that fits.'
            : `The ${name} rung answered inside its clock and produced nothing, because our own output ceiling was spent before the answer began — "${detail}". `
              + 'This is NOT a provider outage and NOT the user\'s prompt: a reasoning model bills its thinking to the same ceiling, so a ceiling below its thinking returns a truncated reply with no text and no tool call. '
              + 'The ceiling is FLOOR_TIMEOUT_CAP_MS / AGENTV3_FLOOR_MS_PER_TOKEN (see floorBudget.ts); the rung was retired for the rest of this build so the ladder could reach a vendor that fits.',
          autoResolved: false,
        });
      }
    }
    this.notify();
  }

  /** "GLM: 18 rate-limit, 2 timeout, 1 bad-request" — one line per provider that failed. Pure read. */
  providerFailureBreakdown(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, byBucket] of this.providerFailureReasons) {
      out[name] = [...byBucket.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([bucket, n]) => `${n} ${bucket}`)
        .join(', ');
    }
    return out;
  }

  /** Billing & tier facts, written once at settle time from the REAL charge (admin 2026-07-11). */
  /**
   * Record the ETA the build opened with, so the ENDING can be measured against it.
   *
   * One call site, beside the `ETA_BASIS` record that already computes the estimate — the numbers are
   * stored STRUCTURED rather than parsed back out of that line's prose, because reading our own
   * sentences to recover facts we had in hand is the mistake `buildFailureCategory.ts` documents at
   * length. Never throws; a malformed estimate is simply not stored, and the report then says nothing
   * about accuracy rather than something wrong.
   */
  setEtaPromise(p: EtaPromise): void {
    const estimateMs = Number(p?.estimateMs);
    if (!Number.isFinite(estimateMs) || estimateMs <= 0) return;
    this.etaPromise = {
      estimateMs,
      lowMs: Number.isFinite(Number(p?.lowMs)) ? Number(p.lowMs) : estimateMs,
      highMs: Number.isFinite(Number(p?.highMs)) ? Number(p.highMs) : estimateMs,
      evidenced: p?.evidenced === true,
      ...(typeof p?.shown === 'string' && p.shown ? { shown: p.shown } : {}),
    };
  }

  setBilling(b: BuildBillingRecord): void {
    this.billing = b;
    this.notify();
  }

  /** Per-provider real token spend (the Billing-Phase-3 ledger, reconciled to the billed total). */
  /**
   * Record fast-lane usage for OBSERVATION. Deliberately a separate setter from setProviderTokens:
   * anything written here must never be able to reach the billing path by accident.
   */
  setShadowFastLaneTokens(u: Record<string, { inputTokens: number; outputTokens: number }>): void {
    if (u && Object.keys(u).length > 0) this.shadowFastLaneTokens = u;
  }

  /** Record the ordered engine chain this build was given. Best-effort; a blank value records nothing. */
  /**
   * Record what the analyser concluded about this request. Called once, at build start, with a value
   * the route has already computed — no work is done here and nothing in the build reads it back.
   */
  setRequestAnalysis(a: { taskType?: string; complexityScore?: number; startTier?: string; unreadable?: boolean } | null | undefined): void {
    const taskType = typeof a?.taskType === 'string' ? a.taskType.trim() : '';
    const startTier = typeof a?.startTier === 'string' ? a.startTier.trim() : '';
    const score = a?.complexityScore;
    // All three or none: a half-recorded analysis would read as a real measurement with a missing
    // half, which is the shape `USAGE_NOT_REPORTED` exists to keep out of this report.
    if (!taskType || !startTier || typeof score !== 'number' || !Number.isFinite(score)) return;
    // The band's KEY is kept (telemetry is grouped by it) and its MEANING is recorded beside it, so
    // the report never again asserts that a build started on a provider no ladder contains — see
    // `startBandLabel`. Derived here rather than at each reader, so one answer exists.
    // 🔴 SAY WHEN THE SCORER COULD NOT READ THE REQUEST (autopsy d98dae01, 2026-09-17). A Telugu or
    // Devanagari prompt matches none of the analyser's ASCII signals, so a `taskType` of 'chat' on
    // such a build is a FALLTHROUGH, not a classification — and a report that prints it without this
    // flag presents a default as a measurement, exactly as `startTier: "gemini"` once did.
    // Recorded only when TRUE, so every existing report and every English build is byte-identical.
    const couldNotRead = a?.unreadable === true;
    this.requestAnalysis = {
      taskType, complexityScore: score, startTier, startBand: startBandLabel(startTier),
      ...(couldNotRead ? { signalsCouldNotRead: true } : {}),
    };
  }

  setProviderChain(chain: string, names?: string[], firstRung?: string): void {
    const text = typeof chain === 'string' ? chain.trim() : '';
    if (!text) return;
    this.providerChain = text.slice(0, 600);
    this.providerChainNames = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n.trim()) : undefined;
    // The engine we really intend to call first — see `firstRungLabel`. Optional, so a caller that
    // does not pass it keeps the old `meta.model` answer exactly.
    const first = typeof firstRung === 'string' ? firstRung.trim() : '';
    if (first) this.plannedFirstRung = first.slice(0, 120);
    this.notify();
  }

  setProviderTokens(u: Record<string, { inputTokens: number; outputTokens: number }>): void {
    if (u && Object.keys(u).length > 0) {
      this.providerTokens = u;
      // The reconciled figure supersedes the live snapshot, so drop it rather than leave two answers
      // to one question on the same report.
      this.liveTokens = undefined;
      this.liveCacheReadInputTokens = undefined;
      this.notify();
    }
  }

  /**
   * Snapshot the in-flight provider ledger so a report taken MID-BUILD carries real numbers instead of
   * zeros that read like a measurement. Call it as often as you like — it replaces, never accumulates.
   *
   * 🔒 Deliberately a different setter from setProviderTokens, and deliberately cleared by it: nothing
   * written here may reach the billing path, because an in-flight ledger has not yet had the aux calls
   * reconciled into it and is therefore an UNDER-count of what the build really spent.
   */
  setLiveUsage(u: Record<string, { inputTokens: number; outputTokens: number }>, cacheReadInputTokens?: number): void {
    if (this.providerTokens) return; // settled already — the real figure wins
    if (!u || Object.keys(u).length === 0) return;
    this.liveTokens = u;
    const cache = Number(cacheReadInputTokens);
    this.liveCacheReadInputTokens = Number.isFinite(cache) && cache > 0 ? cache : undefined;
    this.notify();
  }

  /**
   * Record the build's sandbox wall-clock. Pass the seconds the actuator actually held the VM; a null
   * or unmeasurable value records NOTHING, so the report says "not measured" instead of showing a zero
   * that reads like a fact.
   */
  setSandboxSeconds(seconds: number | null | undefined): void {
    const cost = sandboxCost(seconds);
    if (cost) this.sandboxCostRecord = cost;
  }

  /** Fix 66 (measure-first) — the total prefix-cache HIT input tokens the cheap-floor providers
   *  (GLM/Kimi) served this build. Purely observational: reveals the real cache-hit rate against
   *  providerTokens' input total, so we can see whether the big cheap-floor input is cache-served. */
  setCacheReadInputTokens(n: number): void {
    if (Number.isFinite(n) && n > 0) { this.cacheReadInputTokens = n; this.notify(); }
  }

  /** Fix 37a — stamp how many earlier builds in this workspace ended not-ok (from durable history). */
  setPriorFailedBuilds(n: number): void {
    if (Number.isFinite(n) && n >= 0) this.priorFailedBuilds = Math.floor(n);
  }

  /** Stamp the whole-session view (see sessionSummary). Best-effort; a bad value is ignored. */
  setSession(session: BuildDiagnosticsReport['session']): void {
    if (session && Number.isFinite(session.turns)) this.session = session;
  }

  /** Fix 37c — record a data-loss/recovery event WITH its observed cause ("data kyu udha"). */
  recordDataLoss(cause: string, detail: string): void {
    this.dataLossEvents.push({ ts: this.now(), cause: String(cause).slice(0, 120), detail: String(detail).slice(0, 400) });
    this.record({ phase: 'build', severity: 'warning', code: 'DATA_LOSS_EVENT', message: `${cause}: ${detail}`.slice(0, 400), autoResolved: true });
  }

  /** U-1 — attach the signed determinism-audit manifest for this build (best-effort; never throws). */
  recordManifest(manifest: BuildManifestV1): void {
    this.manifest = manifest;
  }

  /**
   * Fix 45 (autopsy 2026-07-11) — record the deferred outcome upgrade after the route's real-browser
   * preview self-check CONFIRMED the app renders. SimpleBuilder classifies with previewOk unknown
   * (→ BUILD_PARTIAL) and explicitly defers the upgrade to the route: "previewOk is left unknown here —
   * the route's preview self-check can upgrade BUILD_PARTIAL → BUILD_SUCCESS." That upgrade was never
   * wired, so a verified-rendering app stayed labelled BUILD_PARTIAL and `deriveRootCause` (last OUTCOME_*)
   * reported "Build outcome: BUILD_PARTIAL" for a working app — a false verdict (rule 5 honesty).
   *
   * Honest by construction: it ONLY upgrades when the LAST recorded outcome is BUILD_PARTIAL or
   * PREVIEW_FAILED (the two "compiled but the live app was not (yet) verified / preview was down" states
   * the browser check actually resolves). It can NEVER overwrite a TYPECHECK_FAILED / BUILD_FAILED /
   * RUNTIME_FAILED, and it no-ops when there is no outcome yet or the app already reads BUILD_SUCCESS.
   * Returns whether an upgrade was recorded (for tests / callers).
   */
  recordPreviewVerified(): boolean {
    const last = [...this.issues].reverse().find((i) => i.code.startsWith('OUTCOME_'));
    if (!last) return false; // no classification yet — nothing to upgrade
    if (last.code !== 'OUTCOME_BUILD_PARTIAL' && last.code !== 'OUTCOME_PREVIEW_FAILED') return false;
    this.record({ phase: 'build', severity: 'info', code: 'OUTCOME_BUILD_SUCCESS', message: 'Build outcome: BUILD_SUCCESS', autoResolved: true });
    return true;
  }

  /**
   * The readiness gate has RE-RUN and passed, so the blockers it raised earlier no longer describe
   * this app. Mark them resolved. Returns how many were cleared (for tests / callers).
   *
   * 🔒 THE CALLER MUST HAVE RE-RUN THE GATE — this method takes the caller's word for it, and that is
   * the only thing that makes it honest. It is not "the repair probably worked": every call site
   * re-runs `assessBuildReadiness()` and reaches this only on `verdict.ready`. The SAME check that
   * raised each blocker has looked again and passed.
   *
   * ROOT CAUSE (Fight 3D game, buildId 5e2de8c4, 2026-08-27): a duplicate-import blocker was recorded
   * at T, the deterministic dedupe removed the duplicate at T+1.3s, and the release gate condemned the
   * build at T+2s by counting the blocker from T. The report then named, as the build's root cause, a
   * line of code that no longer existed in the file. Leaving a superseded finding unresolved does not
   * make a report more cautious — it makes it wrong, and it costs the user a working app.
   */
  resolveReadinessBlockersOnRejudge(): number {
    let cleared = 0;
    for (const issue of this.issues) {
      if (issue.code !== 'READINESS_BLOCKER' || issue.autoResolved === true) continue;
      issue.autoResolved = true;
      cleared++;
    }
    if (cleared > 0) this.notify();
    return cleared;
  }

  /**
   * Record that a heal's re-judge PASSED — and clear the blockers that re-judge just superseded.
   *
   * 🔴 WHY THIS IS ONE METHOD AND NOT TWO CALLS (build 1ef27cd7, 2026-09-14). The fix above was written
   * on 2026-08-27 for the dedupe heal and applied to that ONE call site. There are THREE heals that
   * re-judge readiness and recover the build — dedupe, the Rules-of-Hooks heal, and the incomplete-code
   * heal — and the other two never cleared the stale blocker. The dedupe site's own comment even says
   * it re-judges *"exactly as the hooks heal and the incomplete-code heal below already do"*, which was
   * true of the re-judging and false of the clearing.
   *
   * What that cost, in one real build: the engine detected a placeholder, completed it, re-judged the
   * app READY **92/100**, and the production build succeeded — and then the release gate counted the
   * superseded blocker from two minutes earlier, went RED, and the user was told
   *     *"1 thing is still broken, so it is NOT ready to use yet"*
   * about an app the platform had already re-judged as ready. The same class as the 2026-08-27 report
   * this was first fixed for: a finding that describes code which no longer exists.
   *
   * So recording the recovery and clearing what it supersedes are now a SINGLE action. A fourth heal
   * written later cannot record its recovery and forget the other half, because there is no longer a
   * way to do one without the other.
   *
   * 🔒 THE CALLER'S OBLIGATION IS UNCHANGED, and it is what keeps this honest: reach here ONLY after
   * re-running `assessBuildReadiness()` and only on `verdict.ready`. This clears blockers because the
   * same gate that raised them has looked again and passed — never because a repair "probably worked".
   */
  recordReadinessRecovery(code: string, message: string): number {
    const cleared = this.resolveReadinessBlockersOnRejudge();
    this.record({ phase: 'build', severity: 'info', code, message, autoResolved: true });
    return cleared;
  }

  /**
   * How many findings of a severity are about THE APP, for the release gate.
   *
   * The exclusion list is the reason this is a method and not a filter at the call site. Several
   * findings measure OUR OWN process — how the grounding budget was spent, how long the post-answer
   * pass took, what shape the service graph has — and are recorded at warning severity so a human
   * notices them. None of them is a reason to hesitate before shipping the user's app, and letting
   * them demote a green build to yellow would make the gate's most important state unreachable in
   * practice, which is the same as not having it. Anything already resolved is likewise not a caveat.
   */
  shippingIssueCount(severity: IssueSeverity): number {
    // 🔴 THE SAME DEFECT, COUNTED TWICE (autopsy e706e068, 2026-09-17). The readiness gate ran at
    // t+1251s and again at t+1440s, and both runs recorded the byte-identical blocker
    // `1 unresolved import(s) — the build will fail: App.tsx -> ./components/TransportRequest`.
    // `record()` collapses only a BACK-TO-BACK repeat (it compares against the last entry), and 189
    // seconds of timeline sat between these two — so both survived and both were counted. The user
    // was told "3 build-breaking blocker(s)" about an app that had TWO, and the release gate's
    // headline named that inflated number.
    //
    // One defect is one defect however many times we observed it. Two genuinely different problems
    // never share a message, so this can only ever remove a double-count — it can never hide a
    // distinct finding. The timeline keeps every entry; only the COUNT is de-duplicated.
    const seen = new Set<string>();
    for (const i of this.issues) {
      if (i.severity !== severity || i.autoResolved || !isAppFinding(i)) continue;
      seen.add(`${i.phase} ${i.code} ${i.message}`);
    }
    return seen.size;
  }

  /**
   * A real production build SUCCEEDED, so any readiness finding that merely PREDICTED it would fail
   * is superseded. Returns how many were cleared (0 when there were none).
   *
   * See `buildFailurePrediction.ts` for the incident and for why this is narrow in three separate
   * ways. The caller's obligation: pass `ran`/`code` straight from `judgeProdBuild`, never a guess.
   *
   * ⚠️ `before` bounds it to predictions made BEFORE the build ran. A finding recorded afterwards is
   * describing a tree this build never compiled, so a later blocker still stands on its own.
   *
   * Pure over the recorded issues; never throws.
   */
  resolveBuildFailurePredictions(opts: { ran: boolean; code: string; before: number }): number {
    if (!prodBuildOverrulesPredictions(opts?.code, opts?.ran === true)) return 0;
    const cutoff = Number.isFinite(opts?.before) ? opts.before : Infinity;
    let cleared = 0;
    for (const issue of this.issues) {
      if (issue.code !== 'READINESS_BLOCKER' || issue.autoResolved === true) continue;
      if (issue.ts > cutoff) continue;
      if (!predictsBuildFailure(issue.message)) continue;
      issue.autoResolved = true;
      cleared++;
    }
    if (cleared > 0) {
      this.record({
        phase: 'readiness',
        severity: 'info',
        code: 'BUILD_PREDICTION_OVERRULED',
        message: overruledByRealBuildMessage(cleared),
        autoResolved: true,
      });
    }
    return cleared;
  }

  /**
   * Did a given TOOL actually run during this build?
   *
   * Exists so the claim audit can check a sentence like "I verified this with a real browser
   * screenshot" against whether a screenshot was ever taken. Reads the timeline rather than a separate
   * counter, so it cannot drift from what the report shows.
   */
  toolWasUsed(tool: string): boolean {
    const needle = String(tool ?? '').trim().toLowerCase();
    if (!needle) return false;
    return this.issues.some(
      (i) => i.phase === 'tool' && i.code === 'TOOL_DONE' && i.message.toLowerCase().includes(needle),
    );
  }

  report(): BuildDiagnosticsReport {
    // Normalize recovered-on-success issues at SERIALIZATION time, so counts, issues[] and the derived
    // rootCause are all consistent even when a finalize path bypassed finish()'s back-fill. Idempotent.
    this.resolveRecoveredOnSuccess();
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    const warnings = this.issues.filter((i) => i.severity === 'warning').length;
    // Observations are neither ours to have healed nor ours to still owe — they get their own bucket, so
    // the auto-resolved tally means "v5.0 genuinely fixed this" and nothing else (mitrify 2026-08-04).
    const observations = this.issues.filter((i) => i.observation === true).length;
    // INFO events are excluded too (mitrify autopsy #2, same day): a read-only import+survey turn with
    // ZERO real heals reported healCount 32, because every heartbeat, tool call and narration line is
    // recorded `severity:'info', autoResolved:true`. Narration is not a fix; a heal tally that counts
    // heartbeats is a green number wearing a lie. Only a WARNING/ERROR that v5 genuinely resolved counts.
    // 🔴 A WORKAROUND IS NOT A SELF-HEAL (CLAUDE.md rule 5's five buckets, enforced in the DATA at
    // last — admin report 2026-09-13). That build's counts read `autoResolved: 4`, and all four were
    // PROVIDER_FALLBACK warnings. Not one of them resolved anything: every fallback also failed, the
    // build produced ZERO files, and the user stopped it. Four deferred root causes were reported to
    // the admin as four things the engine fixed itself.
    //
    // The constitution already says a workaround is "a DEFERRED root cause — flag it as debt, never
    // as a win". This is that sentence made true of the number the admin actually reads. Counted by
    // CODE rather than by a flag each call site sets, so a new fallback cannot forget to declare
    // itself into the honest bucket.
    const isWorkaround = (i: { code?: string }) => WORKAROUND_CODES.has(String(i.code ?? ''));
    const autoResolved = this.issues.filter((i) =>
      i.autoResolved && i.observation !== true && i.severity !== 'info' && !isWorkaround(i)).length;
    const workarounds = this.issues.filter((i) => isWorkaround(i) && i.severity !== 'info').length;
    return {
      schema: 'navbharatai.v3.build-diagnostics/1',
      buildId: this.meta.buildId,
      promptHash: this.meta.promptHash,
      manifest: this.manifest,
      sessionId: this.meta.sessionId,
      workspaceId: this.meta.workspaceId,
      prompt: this.meta.prompt,
      // HONEST MODEL LABEL (autopsy 2026-07-27): `meta.model` is the ROUTER'S INTENT, captured at
      // build start (selectBuildModel) and never revisited. On the reported build it read
      // `claude-sonnet-4-6` while `noClaude: true`, `builtBy: "KIMI"` and every one of the 8 delivered
      // turns was kimi-k2.5 — the admin diagnostic named a model that provably never ran. The report
      // now leads with what ACTUALLY delivered and keeps the intent under `plannedModel`, so no
      // information is lost and the headline field stops asserting something untrue.
      model: honestModelLabel(this.meta.model, this.llmCalls),
      // ⚠️ THE LADDER'S FIRST RUNG WHERE WE HAVE IT, not `selectBuildModel`'s answer (autopsy
      // 2b0a3ed5). That helper predates the three-ladder rewrite and still replies in the old
      // Haiku/Sonnet vocabulary, so a weak build reported its Claude BACKSTOP as the model it planned
      // to use while GLM did the work. Falls back to the old value, so nothing regresses where the
      // chain was never recorded.
      plannedModel: this.plannedFirstRung ?? this.meta.model,
      framework: this.meta.framework,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      ok: this.ok,
      summary: this.summary,
      counts: {
        total: this.issues.length,
        errors,
        warnings,
        autoResolved,
        ...(workarounds > 0 ? { workarounds } : {}),
        unresolved: this.issues.filter((i) => !i.autoResolved && i.observation !== true).length,
        ...(observations > 0 ? { observations } : {}),
      },
      issues: [...this.issues],
      problems: capProblems(this.issues.filter((i) => i.severity !== 'info')),
      rootCause: deriveRootCause({
        issues: this.issues, errors: this.errors, review: this.reviewText, ok: this.ok, commands: this.commands,
        // The serializer is the ONLY caller that can distinguish "this build never reported an
        // ending" from "the caller did not pass ok" — see the field's own comment.
        // …and, since 2026-09-13, "it has not ended YET" from "it ended without saying so".
        endedWithoutOutcome: this.ok === undefined && !this.looksStillRunning(),
        stillRunning: this.ok === undefined && this.looksStillRunning(),
      }),
      commands: this.commands.length ? [...this.commands] : undefined,
      llmCalls: this.llmCalls.length ? [...this.llmCalls] : undefined,
      errors: this.errors.length ? [...this.errors] : undefined,
      generatedFiles: this.generatedFiles.length ? [...this.generatedFiles] : undefined,
      previewErrors: this.previewErrors.length ? [...this.previewErrors] : undefined,
      providerDelivery: this.providerDelivery.size ? Object.fromEntries(this.providerDelivery) : undefined,
      // "App kisne banaya" — the provider with the MOST delivered turns (ties keep first-seen).
      builtBy: dominantDeliveryProvider(this.providerDelivery),
      providerFailures: this.providerFailures.size ? Object.fromEntries(this.providerFailures) : undefined,
      providerFailureReasons: this.providerFailureReasons.size ? this.providerFailureBreakdown() : undefined,
      requestAnalysis: this.requestAnalysis,
      providerTokens: this.providerTokens,
      shadowFastLaneTokens: this.shadowFastLaneTokens,
      providerChain: this.providerChain,
      providerChainNames: this.providerChainNames?.length ? this.providerChainNames : undefined,
      liveTokens: this.liveTokens,
      liveCacheReadInputTokens: this.liveCacheReadInputTokens,
      sandboxCost: this.sandboxCostRecord,
      cacheReadInputTokens: this.cacheReadInputTokens,
      billing: this.billing,
      // DERIVED AT SERIALIZATION, so no ending path can forget it — the same reasoning as
      // `endedWithoutOutcome` above. Pure: `report()` stays safe to call repeatedly mid-build.
      etaAccuracy: etaAccuracy(this.etaPromise, this.startedAt, this.endedAt) ?? undefined,
      review: this.reviewText,
      priorFailedBuilds: this.priorFailedBuilds,
      session: this.session,
      dataLossEvents: this.dataLossEvents.length ? [...this.dataLossEvents] : undefined,
      // DERIVED AT SERIALIZATION, like etaAccuracy above, so no ending path can forget it. This is
      // the FIRST of the report's two truncation passes: what the recorder's own caps refused. The
      // storage layer merges its own losses into this, keeping these totals (reportTruncation.ts).
      truncation: this.truncationFact(),
    };
  }

  /**
   * What the recorder's caps cost this report — the counts nothing could state before 2026-09-20.
   *
   * `issues` is deliberately absent even though it is capped: the timeline announces its own cap on
   * the timeline itself (`TIMELINE_TRUNCATED`), which is the earlier, working half of this fix, and
   * duplicating it here would double-count one loss. The three channels below had no such line.
   */
  private truncationFact(): ReportTruncation {
    return mergeTruncation(COMPLETE, {
      commands: { kept: this.commands.length, total: this.channelTotals.commands },
      llmCalls: { kept: this.llmCalls.length, total: this.channelTotals.llmCalls },
      errors: { kept: this.errors.length, total: this.channelTotals.errors },
    });
  }
}

/**
 * Derive the single most important line in the report — the ROOT CAUSE — so a reader (or the admin)
 * never has to hunt through hundreds of timeline entries to find out WHY a build struggled. Checked in
 * priority order, most specific first: the deterministic BuildOutcome classification already recorded
 * on the timeline (OUTCOME_*) → the reviewer's first [CRITICAL] finding (a real, guaranteed-to-break
 * problem it caught) → the first fully-captured error → the first REAL (non-info) problem on the
 * timeline, itself prioritized by how concerning it actually is (see below) → an honest "nothing wrong
 * found" once the build has actually settled. Pure + exported + unit-testable — this is what problem
 * #3 ("root cause bhi mil jaye") asked for.
 *
 * Within the "first real problem" tier: an UNRESOLVED problem (autoResolved:false — something that
 * happened and was never fixed) beats a merely-routine, auto-resolved one (e.g. a provider timeout that
 * successfully fell back — the resilience mechanism WORKING, not a failure), which beats a bare warning.
 * Confirmed against a real report where a routine "Provider GLM failed — falling back" (auto-resolved,
 * the system recovering on its own) was chosen as root cause ahead of a genuine unresolved
 * `pkill` command failure later in the same build — backwards; the unresolved one is the real signal.
 */
/**
 * True when a command's NON-ZERO exit is EXPECTED/routine and must NOT be recorded as a build failure.
 * PURE & unit-tested. A real failure (npm install / tsc / vite build exiting non-zero) is NEVER covered
 * here — only:
 *   1. an explicit `… || true` guard (the caller declared the outcome irrelevant);
 *   2. an inspector whose exit 1 means "nothing matched/found" — grep/egrep/fgrep, pkill/pgrep/killall,
 *      ss/netstat/lsof/fuser, ps/which/test — or a negative code (an EXTERNAL signal, e.g. E2B's daemon
 *      SIGTERM-ing the wrapper, exit -1). A PIPELINE's exit code is its LAST segment's, so
 *      `tsc --noEmit | grep -v test` exiting 1 is grep finding no lines, not a tsc failure;
 *   3. a health-probe `curl` hitting a not-yet-ready dev server (connection refused 7 / can't resolve 6
 *      / timeout 28) — probing an unready port is not a build failure.
 */
export function isExpectedNonzeroExit(command: string, exitCode: number | null): boolean {
  if (exitCode === 0 || exitCode === null) return false;
  const cmd = (command || '').trim();
  if (/\|\|\s*true\s*(?:;)?\s*$/.test(cmd)) return true;
  // The exit code of a pipeline reflects its LAST segment — split on a single `|` (never `||`). Strip
  // quoted regions first so a `|` INSIDE a pattern (e.g. `grep -v "test|vitest"`) can't be mistaken for
  // a pipe (the segment's BASE command is never itself quoted, so this is safe).
  const unquoted = cmd.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  const segments = unquoted.split(/(?<!\|)\|(?!\|)/);
  const last = (segments[segments.length - 1] || '').trim();
  const base = (last.split(/\s+/)[0] || '').replace(/^.*\//, ''); // strip any path prefix
  // ⚠️ `diff` ADDED 2026-08-25, and it had become a build's REPORTED ROOT CAUSE. A real report carried
  //     rootCause: "$ diff <(grep …) <(grep …) → exit 1 (0s)"
  // for a build whose diff had worked perfectly: the agent was comparing two lists of translation keys,
  // and `diff` exits 1 precisely when the files DIFFER. Exit 1 is the ANSWER it went looking for. Same
  // family as every name already on this line — a diagnostic tool reporting a finding, read as the tool
  // failing. Exit 2 is a genuine diff error (a missing file) and stays a failure.
  if (base === 'diff') return exitCode === 1 || exitCode < 0;
  if (/^(grep|egrep|fgrep|pkill|pgrep|killall|ss|netstat|lsof|fuser|ps|which|test)$/.test(base)) {
    return exitCode === 1 || exitCode < 0;
  }
  if (base === 'curl') return exitCode === 7 || exitCode === 6 || exitCode === 28 || exitCode < 0;
  // A single-FILE `tsc` typecheck is a SELF-INVALIDATING probe, not a build failure. See
  // isUnconfiguredTscFileProbe: passing explicit source-file operands to tsc makes it IGNORE
  // tsconfig.json (documented tsc behaviour), so `jsx`/`module`/`paths`/`lib` are all lost and it
  // spuriously errors (classically TS17004 "Cannot use JSX unless the '--jsx' flag is provided") on a
  // project that typechecks perfectly under its real config. The pipeline's authoritative typecheck is
  // the project-wide `tsc --noEmit` / `tsc -p …` (no file operands) — that one is NEVER excused here, so
  // a genuine type error still counts. tsc exits 1/2 on errors; the E2B wrapper can surface -1.
  if (isUnconfiguredTscFileProbe(last)) return exitCode === 1 || exitCode === 2 || exitCode < 0;
  // `npm audit fix` EXITS 1 WHEN VULNERABILITIES REMAIN — that is npm's documented behaviour, and on a
  // tree whose remaining advisories all need a BREAKING major upgrade it is the only exit it can give.
  // The command still did its whole job (build 5b4f9b63: "up to date, audited 727 packages", every
  // compatible fix applied, then a list of the ones that need `--force`). We deliberately never pass
  // `--force` (see npmAuditFix.ts), so this exit code is not a failure of ours — it is the expected
  // answer to the question we asked. Recorded as an error it became the headline root cause of a build
  // whose real problem was that it never built anything.
  if (/^npm(\s+\S+)*\s+audit\b/.test(last) && /\bfix\b/.test(last)) return exitCode === 1;
  return false;
}

/**
 * True when `command` is a `tsc` (or `tsgo`) invocation given EXPLICIT source-file operands but NO
 * project config — the invocation that makes TypeScript silently discard tsconfig.json and misreport.
 *
 * ROOT CAUSE (deep-test build #3, 2026-07-17): the agent ran `npx --no-install tsc --noEmit src/App.tsx`
 * to "verify" one file. tsc, when handed file operands, ignores tsconfig entirely, so it lost the
 * project's `jsx: react-jsx` setting and emitted 30+ TS17004 errors — on an app that compiled cleanly
 * the moment the agent re-ran the correct project-wide `tsc --noEmit` (exit 0). That spurious failure
 * was recorded as a real SANDBOX_CMD_FAILED (severity error, never auto-resolved) and became the
 * `rootCause` of a build that actually SUCCEEDED (ok, review 95/100, preview verified) — a false
 * verdict (rule 5 honesty). Recognising the malformed probe keeps the report honest. Pure + total.
 *
 * Deliberately NOT excused (these are trustworthy — a real error must still count):
 *   • a project run — `-p`/`--project` or build mode `-b`/`--build` (tsconfig IS honoured);
 *   • no file operands — the pipeline's real gate `tsc --noEmit` (config-driven, checks the whole app);
 *   • an explicit `--jsx …` — the caller supplied the missing setting, so the run can be valid.
 */
export function isUnconfiguredTscFileProbe(command: string): boolean {
  const cmd = (command || '').trim();
  if (!/\btsc\b|\btsgo\b/.test(cmd)) return false;                    // not a tsc invocation
  if (/(?:^|\s)(?:-p|--project|-b|--build)(?:[=\s]|$)/.test(cmd)) return false; // project/build mode → honours tsconfig
  if (/(?:^|\s)--jsx(?:[=\s])/.test(cmd)) return false;              // caller supplied jsx → potentially valid
  // At least one explicit SOURCE-FILE operand (foo.ts / foo.tsx / .jsx / .mts / .cts), not a flag —
  // that operand is what makes tsc ignore tsconfig. `2>&1`/redirects are not operands (they contain no
  // source extension), and a bare `tsc --noEmit` has no operand at all → not a file probe.
  return cmd.split(/\s+/).some((tok) => !tok.startsWith('-') && /\.(?:tsx?|jsx?|mts|cts)$/.test(tok));
}

/** A path (as tsc prints it) that belongs to a TEST/spec file, not shipped app source. Pure. */
function isTestFilePath(path: string): boolean {
  return /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\.test-d\.[cm]?tsx?$|(?:^|\/)__tests__\/|(?:^|\/)tests?\/)/i.test(path.trim());
}

/**
 * True when a `tsc`/`tsgo` typecheck FAILED but EVERY diagnostic it emitted is in a TEST file — so the
 * failure says nothing about whether the APP builds/runs.
 *
 * ROOT CAUSE (deep-test build #4, 2026-07-17): the project-wide gate `npx tsc --noEmit` exited non-zero
 * with a single diagnostic — `src/App.test.tsx(1,38): error TS2307: Cannot find module 'vitest'` — because
 * the sandbox doesn't install the test runner's types. The app's own source compiled clean (the agent's
 * piped `tsc | grep -v App.test.tsx` returned nothing) and the dev server ran, yet that test-only failure
 * was recorded as a real SANDBOX_CMD_FAILED and became the `rootCause` of a SUCCESSFUL build — a false
 * verdict (rule 5 honesty). The app ships without its test files, so a test-only type error is never an
 * app-build failure. (Distinct from isUnconfiguredTscFileProbe, which is about the wrong INVOCATION; this
 * is about a correct invocation whose failures are all out-of-app.)
 *
 * Conservative by construction: excused ONLY when it is a tsc typecheck, we could parse ≥1 tsc diagnostic
 * line (`path(line,col): error TS####`), and ALL of them are test files. A single non-test diagnostic, or
 * an unparseable/empty output, is NOT excused → a genuine app type error still counts. Pure + total.
 */
export function isTestOnlyTypecheckFailure(command: string, stdout?: string, stderr?: string): boolean {
  const cmd = (command || '').trim();
  if (!/\btsc\b|\btsgo\b/.test(cmd)) return false;                    // only a tsc typecheck qualifies
  const out = `${stdout ?? ''}\n${stderr ?? ''}`;
  const diagRe = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+/gm;          // tsc's "path(l,c): error TS####"
  const paths: string[] = [];
  for (let m = diagRe.exec(out); m; m = diagRe.exec(out)) paths.push(m[1]);
  if (paths.length === 0) return false;                              // parsed no diagnostics → don't excuse
  return paths.every(isTestFilePath);                               // excuse ONLY if every one is a test file
}

/**
 * Codes for an intermediate failure the agent USUALLY RECOVERS FROM — a failed tool call, a "no build"
 * nudge, an empty-build retry, or a sandbox command that exited non-zero. On a build that ULTIMATELY
 * SUCCEEDED these are resolved by definition, so they must not be counted as unresolved or chosen as the
 * root cause. Single source of truth shared by the finish() back-fill, the serialization normalization,
 * and deriveRootCause — so all three agree. Pure.
 */
const RECOVERABLE_ON_SUCCESS: ReadonlySet<string> = new Set([
  // A PREVIEW FAILURE THE BUILD LATER RECOVERED FROM (admin report 2026-08-12). The preview went down
  // mid-build, was restarted, and was then verified rendering by a real browser — and the report still
  // named "nothing is listening on that port" as the ROOT CAUSE of a SUCCESSFUL build. A recovered
  // transient is not a root cause; it is a thing that happened and then stopped happening. Guarded
  // below by the same rule as a failed command: only forgiven when the run carries no surviving
  // problem about it (`previewVerifiedRendered` records the positive proof).
  'PREVIEW_NOT_RENDERED',
  'TOOL_ERROR', 'NO_BUILD_NUDGE', 'EMPTY_BUILD_RETRY', 'SANDBOX_CMD_FAILED',
]);
export function isRecoverableOnSuccess(code: string): boolean {
  return RECOVERABLE_ON_SUCCESS.has(code);
}

/**
 * ADVISORY findings that must NEVER be named as a build's root cause — on any outcome.
 *
 * ROOT CAUSE (Shiv Medical Store report, 2026-08-10): an `ok: true` build whose app was verified
 * rendering reported its rootCause as
 *   "@capacitor/android is declared in package.json dependencies but no project file imports it."
 * That is a tidiness hint, and in this case a FALSE one — Capacitor's packages are consumed by its CLI
 * and native config, exactly the caveat the message itself spells out. It was the loudest thing in a
 * clean build, so it won.
 *
 * The class was already known: `importTurnObservation` was written for precisely this
 * ("…named `@hookform/resolvers is declared … but no project file imports it` as the build's
 * rootCause"), but that fix only covered IMPORT turns, so the sibling survived on every normal build.
 * Fixing it by code is what closes it for good: an advisory can be reported, counted and read, but it
 * can never be promoted to the explanation of a build.
 *
 * These are findings ABOUT the project that no build outcome depends on. A genuine failure always has
 * a louder, non-advisory record — and when nothing else exists, "completed successfully with no
 * problems recorded" is the honest answer, not a dependency hint.
 */
const NEVER_ROOT_CAUSE: ReadonlySet<string> = new Set([
  'INTEGRITY_UNUSED_DEP',        // dependency hygiene; false-positives on CLI/config-only packages
  'DEPHEALTH_ADVISORY',          // CVE/licence advisory appended to an already-successful build
  'DESIGN_PAGE_INCONSISTENT',    // per-page design coverage — a quality note, never a cause
  'TEST_SUITE_UNVERIFIED',       // our sandbox could not run the suite; not the app's defect
  'REQUIREMENT_GAPS',            // "this domain usually also needs…" — a suggestion, not a fault
  // A CVE COUNT IS A FINDING ABOUT THE USER'S DEPENDENCIES, NOT A THING OUR BUILD FAILED AT (build
  // 5b4f9b63). Same class as DEPHEALTH_ADVISORY directly above; it was simply recorded under a
  // different code and so kept its eligibility.
  'DEPENDENCY_VULNERABILITIES',
  'POST_ANSWER_TIMING',          // pure measurement
  // A setup-timing measurement (how long prep took before the first model call) is an advisory about
  // the WAIT, never the CAUSE of anything. BENCHMARK #2 (2026-08-12): a fully successful build — tsc
  // PASS, prod build PASS, preview rendered — was headlined rootCause "231s of preparation before the
  // build's first model call", because this warning is unresolved-but-not-a-failure and got picked as
  // the successful build's cause. Same class as POST_ANSWER_TIMING directly above; it belongs here too.
  'TIME_TO_FIRST_CALL',          // pure setup-timing measurement — the wait, not a cause
  // 🔴 A NOTE ABOUT OUR OWN BILLING DECISION IS NOT A REASON A BUILD FAILED (build b89ba6f8,
  // 2026-09-17). That report's `rootCause` reads, in full: *"Did not ask this user to add credits:
  // the build failed because the engine did not respond…"* — a sentence about what we chose NOT to
  // charge for, presented as the cause of the failure. It is unresolved-but-not-a-failure, so it
  // won the "most severe unresolved issue" pick, exactly as TIME_TO_FIRST_CALL and POST_ANSWER_TIMING
  // did before they were listed here. Worse than merely odd: it is the LAST word the admin's failure
  // panel reads, so a build stopped by its own user was filed under a billing sentence.
  'UPSELL_SUPPRESSED',           // what we decided not to charge for — never why anything failed
  'ARCHITECTURE_INVARIANT_VIOLATED', // consistency with the project's own conventions — not a failure
  // THE GATE IS A SUMMARY OF OTHER FINDINGS, SO IT CANNOT BE A CAUSE OF ANYTHING (first real build after
  // it shipped, 2026-08-12). It became the rootCause of a SUCCESSFUL build, and the headline the admin
  // read about a game he was playing at the time was "Not shippable". This is the same defect that was
  // fixed for PREVIEW_NOT_RENDERED and then reintroduced by a new code — which is why the fix belongs
  // in this set rather than at the gate's call site.
  'RELEASE_GATE',
  // A STATEMENT ABOUT THE SUMMARY IS NOT A CAUSE OF THE BUILD (build 4b744bef). The claim audit reads
  // the reply the model wrote; whatever it finds there, it cannot be why anything happened. It became
  // the headline rootCause of a successful import — and on that run it was also FALSE (see
  // `sourceIsWholeApp` in claimAudit.ts), so the admin's one-line verdict on a turn that worked was that
  // the platform had caught its own AI lying. Exactly the same shape as RELEASE_GATE directly above.
  'CLAIM_UNSUPPORTED',
  // A WHOLE-APP DESIGN GRADE IS A TASTE NOTE, NOT A CAUSE (admin build report 2026-08-25). A build that
  // succeeded — the game ran, the preview published — was headlined
  //     rootCause: "Design consistency 50/100 (D) across 12 file(s) … 35 distinct colours"
  // which tells the reader their build FAILED because of a colour palette. `DESIGN_PAGE_INCONSISTENT`
  // was already here for exactly this reason; the whole-app grade was simply recorded under a
  // different code and so kept its eligibility.
  'DESIGN_CONSISTENCY',
  // Same class, same report: an accessibility grade is a quality note about the app, never the reason
  // a build did or did not work.
  'ACCESSIBILITY',
  // A READINESS *WARNING* IS THE NON-BLOCKING SIBLING OF A BLOCKER, BY CONSTRUCTION (autopsy
  // fd021c64, 2026-09-14). The readiness gate splits its findings in two and this class records the
  // split faithfully: `READINESS_BLOCKER` is severity ERROR and `autoResolved: false` — those
  // genuinely explain a failure and stay eligible. `READINESS_WARNING` is the other half, recorded
  // `autoResolved: true` precisely because it does NOT block. If a warning could be why a build
  // failed, the gate would have raised it as a blocker; that it did not IS the evidence.
  // The reported build was headlined `rootCause: "postmessage-wildcard-origin @ index.html:9"` —
  // and that finding was not only advisory, it was OURS (see previewBridge.ts's withoutPreviewBridge,
  // fixed in the same change): the app's owner was told their build's problem was a line we injected.
  'READINESS_WARNING',
]);

/**
 * ⚠️ FAMILIES, BECAUSE THE LIST ABOVE HAS NOW BEEN OUTFLANKED THREE TIMES BY A NEW NAME.
 *
 * Its own comments record the pattern: PREVIEW_NOT_RENDERED was fixed and came back as RELEASE_GATE;
 * DEPHEALTH_ADVISORY was fixed and came back as DEPENDENCY_VULNERABILITIES; DESIGN_PAGE_INCONSISTENT
 * was fixed and came back as DESIGN_CONSISTENCY. Each time the SET was correct and a new code walked
 * around it, and each time a user read "your successful build's problem is …" about a taste note.
 *
 * A quality grade cannot be a cause whatever it is called. Matching the family closes the door on the
 * fourth name before it is written, which is the only version of this fix that ends the sequence.
 *
 * Deliberately NARROW: only prefixes whose whole family is advisory BY DEFINITION. `PREVIEW_`, for
 * instance, is NOT here — a preview that did not render genuinely can be why a build failed.
 */
const NEVER_ROOT_CAUSE_FAMILIES: readonly string[] = ['DESIGN_', 'ACCESSIBILITY_', 'DEPHEALTH_'];

/**
 * Bucket a provider error into something countable.
 *
 * Deliberately coarse: the goal is "why did this provider fail twenty-one times", and twenty-one
 * slightly-different rate-limit strings answer that no better than one does. Anything unrecognised
 * keeps its own first line so a new failure mode is visible rather than swallowed by 'other'. PURE.
 */
export function classifyProviderFailure(reason: unknown): string {
  const text = (reason instanceof Error ? reason.message : String(reason ?? '')).trim();
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  // PERMANENT vs TRANSIENT — checked FIRST because it is the only bucket that means "retrying this
  // will never help" (admin autopsy 2026-09-01).
  //
  // A real free build made 40 model calls and logged 57 KIMI failures: "404 Not found the model
  // kimi-k2.5 or Permission denied". `kimi-k2.5` is the FIRST rung of the free Kimi ladder, so EVERY
  // call tried a model this account cannot reach, ate the round-trip, and fell through to kimi-k2.6 —
  // 1.4 wasted requests per call, on every free build, for as long as the id stays there.
  //
  // Nothing acted on it because nothing could SEE it: a model-not-found landed in the `other:` bucket,
  // indistinguishable from a passing blip, and the fallback that rescued it was counted as a
  // self-heal. 56 of that build's 59 "auto-resolved" items were this one misconfiguration. A heal that
  // fires on every single call is not resilience — it is a config defect wearing a green checkmark.
  //
  // Separating it is what lets a caller do the only correct thing with a permanent failure: stop
  // retrying that rung and tell the admin the LADDER is wrong, rather than the provider being flaky.
  // ONE predicate, shared with the provider chain (providerErrorClass). It used to be spelled out
  // here only, which is precisely how the platform ended up able to NAME this defect in a report while
  // the runner that could have acted on it had never heard of the class.
  if (isModelUnavailableError(text)) return 'model-unavailable';
  // OUR OWN CEILING, not the provider's (autopsy ee20478d, 2026-09-15). The rung answered — quickly,
  // correctly, inside its clock — and we had authorised so little output that the answer never began.
  // It gets its own bucket because every other reading of it is wrong and leads somewhere useless:
  // `timeout` benches a healthy vendor for our arithmetic, `context-length` blames the user's prompt
  // for a cap on the reply, and `other:` is where this class hid for two nights across two vendors.
  // Checked here, above the generic tests, so a future reword of the marker cannot fall through them.
  if (isStarvedBudgetError(text)) return 'output-budget';
  if (/\b429\b|rate.?limit|too many requests|quota/.test(t)) return 'rate-limit';
  if (/timeout|timed out|etimedout|deadline/.test(t)) return 'timeout';
  if (/\b401\b|\b403\b|unauthor|forbidden|invalid api key|authentication/.test(t)) return 'auth';
  if (/\b400\b|bad request|invalid request|schema/.test(t)) return 'bad-request';
  if (/\b5\d\d\b|internal server|service unavailable|overloaded|bad gateway/.test(t)) return 'server-error';
  if (/econnreset|enotfound|econnrefused|socket hang up|network/.test(t)) return 'network';
  if (/context length|too long|max tokens|token limit/.test(t)) return 'context-length';
  return `other: ${text.split('\n')[0].slice(0, 60)}`;
}

/**
 * Buckets that mean THE PROVIDER did not answer — nothing about the user's app caused them.
 *
 * `model-unavailable` and `auth` are deliberately EXCLUDED even though they are also not the user's
 * fault: those are OUR configuration being wrong, they never come right on a retry, and lumping them
 * in here would tell a user to "try again in a few minutes" about a ladder that will still be broken
 * tomorrow. They get their own, louder treatment.
 */
const DEGRADED_BUCKETS = new Set(['timeout', 'rate-limit', 'server-error', 'network']);

/**
 * Buckets that mean OUR OWN REQUEST OR LADDER IS WRONG — they never come right on a retry.
 *
 * 🔴 THE COMMENT ABOVE PROMISED THESE "their own, louder treatment", AND FOR THE USER THERE WAS NONE
 * (build report 58fe8254, 2026-09-15). One free build recorded `GLM: 279 bad-request` — every call to
 * the first rung of its ladder rejected with the same hard 400, because we asked a model that always
 * reasons to stop reasoning. `providerFailuresLookDegraded` correctly said "not degraded" (it is not
 * transient), `deadLadderRung` matches only `model-unavailable` so it said nothing — and the user was
 * shown **"Your app needs our strongest engine to finish cleanly. Add credits."**
 *
 * We asked someone for money because our own request was malformed. That is worse than the 2026-09-13
 * outage case this file already fixed, not better: an outage at least might have passed on a retry.
 *
 * `auth` is here for the same reason and had the identical hole; `model-unavailable` had an ADMIN line
 * and still reached the upsell. One predicate now covers all three.
 */
const OUR_CONFIGURATION_BUCKETS = new Set(['model-unavailable', 'auth', 'bad-request']);

/**
 * Did this build fail because of OUR configuration rather than the engine's ability or the app's
 * difficulty? Reads the SAME recorded buckets the admin's report shows, so the two cannot disagree.
 *
 * ⚠️ Requires a REPEAT (≥ `minCount`), deliberately. A single 400 can be one odd prompt hitting one
 * rung's schema, and suppressing an honest outcome on one stray failure would be its own dishonesty.
 * A bucket that repeats is a rung that cannot work — which is the thing worth being loud about. PURE.
 */
export function providerFailuresLookMisconfigured(
  reasons: Record<string, string> | null | undefined,
  minCount = 3,
): boolean {
  const rows = Object.values(reasons ?? {});
  if (!rows.length) return false;
  return rows.some((row) => String(row)
    .split(',')
    .some((part) => {
      // Each part reads like " 279 bad-request" — the count and the bucket name.
      const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(part);
      if (!m) return false;
      const n = Number(m[1]);
      return Number.isFinite(n) && n >= minCount && OUR_CONFIGURATION_BUCKETS.has(m[2]);
    }));
}

/**
 * Codes that mean "we went around it", not "we fixed it". See the tally in `report()`.
 *
 * ⚠️ Keep this list in sync with any NEW fallback code. The counting reads the code rather than a
 * per-call-site flag precisely so that adding a fallback and forgetting to mark it cannot quietly
 * inflate the self-heal number again.
 */
const WORKAROUND_CODES = new Set([
  'PROVIDER_FALLBACK',
  'SIMPLE_BUILD_FALLBACK',
  'ONESHOT_FALLBACK',
  'SIMPLE_BUILD_OUTCOME',
]);

/**
 * Did THIS build fail because the engine could not answer, rather than because the app was hard?
 *
 * 🔴 WHY THIS IS A PREDICATE AND NOT A GUESS (admin report 2026-09-13). A free build produced zero
 * files after 4 min 18 s and the user was shown "Your app needs our strongest engine to finish
 * cleanly. Add credits." The engine was never the problem: the model's answer was CORRECT and
 * arrived — 178 seconds late, because the providers were degraded (3 timeouts on one, 7 rate-limits
 * out of 8 on the other). Asking that user for money was charging them for our own outage.
 *
 * The evidence was already here the whole time: `recordProviderFailure` has been bucketing every
 * failure by cause since 2026-09-01. Nothing had ever asked it this question.
 *
 * Reads the RECORDED buckets, so it cannot disagree with the report the admin is looking at. PURE.
 */
export function providerFailuresLookDegraded(
  reasons: Record<string, string> | null | undefined,
): boolean {
  const rows = Object.values(reasons ?? {});
  if (!rows.length) return false;
  // One bucket string per provider, e.g. "7 rate-limit, 1 timeout".
  return rows.some((row) => String(row)
    .split(',')
    .map((part) => part.trim().replace(/^\d+\s*/, ''))
    .some((bucket) => DEGRADED_BUCKETS.has(bucket)));
}

/**
 * Did this build fail because OUR OWN output ceiling starved a healthy rung? PURE.
 *
 * 🔴 WHY IT IS A SEPARATE PREDICATE, AND WHY ONE OCCURRENCE IS ENOUGH (autopsy ee20478d, 2026-09-15).
 * `providerFailuresLookMisconfigured` needs three of a bucket before it will call our configuration
 * wrong, because a single `bad-request` can be a one-off the next call gets right. This bucket cannot:
 * the authorised budget is a constant for the run, so one starved call is a proof about every call.
 * Requiring three would mean burning three ~97-second turns to earn the right to say so — the precise
 * waste the retirement in MultiProviderTurnRunner exists to stop, which would make the two halves of
 * one fix contradict each other.
 *
 * Reads the RECORDED buckets, so it can never disagree with the report the admin is looking at.
 */
export function buildStarvedItsOutputBudget(
  reasons: Record<string, string> | null | undefined,
): boolean {
  return Object.values(reasons ?? {}).some((row) => String(row)
    .split(',')
    .map((part) => part.trim().replace(/^\d+\s*/, ''))
    .includes('output-budget'));
}

/**
 * A ladder rung that CANNOT work on this account, spotted from the failure buckets.
 *
 * `model-unavailable` is different in kind from every other bucket: a rate-limit passes, a timeout
 * passes, a server error passes — this one never will, because the id is wrong, retired, or not on the
 * plan the key belongs to. So it is not a provider problem to ride out; it is OUR configuration
 * naming a model that does not answer, and every call pays a wasted round-trip for it until someone
 * changes the ladder.
 *
 * Returns the admin-facing line, or '' when there is nothing to say. PURE.
 *
 * ⚠️ Reports the MODEL ID from the provider's own message when it can be recovered, because "KIMI is
 * failing" sends someone to look at the provider's status page, and the truth is that one rung of our
 * own list is wrong. The distinction is the entire value of the finding.
 */
export function deadLadderRung(breakdown: Record<string, string>): string {
  const dead: string[] = [];
  for (const [provider, line] of Object.entries(breakdown ?? {})) {
    const m = /(\d+)\s+model-unavailable/.exec(String(line));
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    dead.push(`${provider} × ${n}`);
  }
  if (dead.length === 0) return '';
  return `A model in the fallback ladder is UNREACHABLE on this account and failed every time it was tried (${dead.join(', ')}). `
    + 'This is not a provider outage — it is a configuration defect: each attempt burns a wasted request before falling through '
    + 'to the next rung, on every build, until the ladder is corrected. Check the model ids against the provider\'s live model list.';
}

/** True when a finding is advisory-only and must never become the build's rootCause. Pure. */
export function isNeverRootCause(code: string): boolean {
  const c = String(code ?? '');
  if (NEVER_ROOT_CAUSE.has(c)) return true;
  return NEVER_ROOT_CAUSE_FAMILIES.some((prefix) => c.startsWith(prefix));
}

/**
 * The identity of a command for "did this same thing later succeed?" — the first line, trimmed and
 * capped exactly as the SANDBOX_CMD_FAILED message renders it, so an issue message and a recorded
 * command compare equal without re-parsing either. PURE.
 */
export function commandKey(commandOrMessage: string): string {
  const raw = (commandOrMessage || '').trim();
  // Issue messages render as `$ <command> → exit N (Ms)`; recorded commands are the bare command.
  const m = /^\$\s+([\s\S]*?)\s+→\s+/.exec(raw);
  return (m ? m[1] : raw).split('\n')[0].trim().slice(0, 120);
}

/**
 * Commands that ran CLEAN at least once — the strongest evidence that a failure of the same command
 * was genuinely recovered rather than merely outlived by a build that succeeded anyway. PURE.
 */
export function recoveredCommands(
  commands: ReadonlyArray<{ command: string; exitCode: number | null }>,
): Set<string> {
  const ok = new Set<string>();
  for (const c of commands) if (c?.exitCode === 0) ok.add(commandKey(c.command));
  return ok;
}

/**
 * Did a failed command leave a CONSEQUENCE that outlived it? PURE.
 *
 * This is the discriminator between the two real cases, and both must keep working:
 *  • PaisaTrack (2026-07-21): `npx tsc --noEmit` failed twice, the agent then FIXED the code and the
 *    build succeeded without ever re-running tsc. Nothing in the run says the problem survived, so
 *    the build's success genuinely supersedes it — forgiving it is what stops a passing build from
 *    reporting phantom "unresolved" failures.
 *  • Mitrify (2026-08-09): `npm run db:push` failed, and the run ALSO carries two still-unresolved
 *    problems that name that very command — the tables were never created. Forgiving it stamped a
 *    permanent failure as the build's one "self-heal".
 * So: a failure is only forgiven when NOTHING unresolved in the same run is about it. Evidence, not
 * an alibi. Deliberately conservative — with no surviving problem mentioning the command, behaviour
 * is exactly as before.
 */
export function failureHasSurvivingConsequence(
  commandText: string,
  issues: ReadonlyArray<{ code: string; message: string; autoResolved: boolean; observation?: boolean }>,
): boolean {
  const key = commandKey(commandText);
  if (!key) return false;
  return issues.some((i) =>
    !i.autoResolved
    && i.observation !== true
    && !isRecoverableOnSuccess(i.code)   // another transient is not a consequence
    // AN ADVISORY THAT *RECOMMENDS* A COMMAND IS NOT EVIDENCE THAT THE COMMAND'S FAILURE SURVIVED
    // (build 5b4f9b63). `npm audit fix` exited 1, and the DEPENDENCY_VULNERABILITIES advisory happens
    // to contain the sentence "Running `npm audit fix` applies the compatible fixes" — so the substring
    // test read the RECOMMENDATION as the CONSEQUENCE, refused to forgive the failure, and made
    // "$ npm audit fix → exit 1 (14s)" the headline root cause of a build whose real problem was that
    // it never built anything. An advisory is a note about the project; it is a consequence of nothing.
    && !isNeverRootCause(i.code)
    && typeof i.message === 'string'
    && i.message.includes(key));
}

/**
 * The model label the report should LEAD with: what actually delivered, not what was planned.
 *
 * ROOT CAUSE (autopsy 2026-07-27, buildId d1623410): the report's `model` came from the router's
 * intent at build start and was never reconciled with reality, so a weak-tier build that ran entirely
 * on kimi-k2.5 (`noClaude: true`, `builtBy: "KIMI"`, 8/8 KIMI turns) reported `claude-sonnet-4-6`.
 * An admin diagnostic that names a model which never executed is worse than no label at all — it
 * misdirects exactly the person debugging routing.
 *
 * Uses the LAST successful call's model (the one that actually produced the delivered result). Falls
 * back to the planned label when nothing ran, so a build that died before its first call still reports
 * something meaningful rather than blank. PURE + tested.
 */
export function honestModelLabel(
  plannedModel: string | undefined,
  llmCalls: ReadonlyArray<{ model?: string; ok?: boolean }>,
): string | undefined {
  for (let i = llmCalls.length - 1; i >= 0; i--) {
    const c = llmCalls[i];
    if (c?.ok !== false && typeof c?.model === 'string' && c.model) return c.model;
  }
  return plannedModel;
}

/**
 * PRE-EXISTING-CODE OBSERVATIONS on an IMPORT/SURVEY turn — advisory, never "our unresolved defect".
 *
 * ROOT CAUSE (mitrify import autopsy 2026-07-27, buildId 321f4f6c): a survey-only turn ("Import this app
 * … Do not change any files yet") finished `ok: true` yet reported **14 unresolved problems**, and named
 * `"@hookform/resolvers" is declared … but no project file imports it` as the build's **rootCause**. Both
 * claims were false, for two independent reasons:
 *
 *  1. WE DID NOT CAUSE THEM. Every one was an observation about the user's OWN pre-existing repository.
 *     A build's `unresolved`/`rootCause` must describe what OUR engine failed to do, not tidiness hints
 *     about code we were asked only to read.
 *  2. THEY WERE COMPUTED FROM A KNOWINGLY PARTIAL FILE SET. The import itself reported 316 files in the
 *     repo, of which 165 source files landed (binaries/oversize dropped by design). "No project file
 *     imports it" is unprovable when half the project was never in the map — and indeed `date-fns`,
 *     `next-themes` and `framer-motion` are standard shadcn/ui dependencies that a complete scan would
 *     have found used. The analyzer asserted certainty its input could not support.
 *
 * So on an import turn these findings are recorded as ADVISORY (autoResolved) with wording that states
 * both caveats honestly. They still appear in the report — we hide nothing — they simply stop being
 * counted as our unresolved failures or promoted to rootCause. On a real build/edit turn (where the map
 * IS the app we just wrote) nothing changes. PURE + tested.
 */
export function importTurnObservation(
  isImportTurn: boolean,
  message: string,
): { autoResolved: boolean; observation?: boolean; message: string } {
  if (!isImportTurn) return { autoResolved: false, message };
  return {
    // `autoResolved: true` keeps it out of the "problems we still owe" bucket; `observation: true` keeps
    // it out of the SELF-HEAL bucket too, so neither count lies about what v5.0 actually did.
    autoResolved: true,
    observation: true,
    message: `[observation about your existing code — nothing was changed] ${message} (Noted from the files that were imported; if part of the repo was too large to import, this may not be accurate.)`,
  };
}

/** What the user was actually PROMISED at t=0, kept so the ending can be measured against it. */
export interface EtaPromise {
  /** The midpoint the estimator produced, in ms. */
  estimateMs: number;
  /** The band the user was shown, in ms. */
  lowMs: number;
  highMs: number;
  /** True when the figure was backed by this workspace's own past builds (see etaEvidence.ts). */
  evidenced: boolean;
  /** The exact sentence the user saw, so the report can never claim a promise that was not made. */
  shown?: string;
}

/** How the promise held up. `ratio` is actual ÷ midpoint; `overBandBy` is 0 when it landed inside. */
export interface EtaAccuracy {
  promisedMs: number;
  lowMs: number;
  highMs: number;
  actualMs: number;
  ratio: number;
  withinBand: boolean;
  evidenced: boolean;
  line: string;
}

/**
 * MEASURE THE PROMISE AGAINST THE CLOCK — the half that was missing (open root cause #6, 2026-09-17).
 *
 * 🔴 WHY IT EXISTS. A build report carried `ETA ~2–4 min` and, in the SAME document, a `startedAt`
 * and an `endedAt` 16.7 minutes apart. Both facts were recorded; nothing ever put them side by side.
 * So every autopsy that wanted to know whether the estimate holds had to do the arithmetic by hand,
 * and the admin's panels could not count ETA accuracy at all — the one number that says whether the
 * ETA work of 2026-08-11 and 2026-09-14 actually landed.
 *
 * This is rule 5's honesty step applied to our own promise: the report already knew, and did not say.
 *
 * ⚠️ IT IS A MEASUREMENT, NOT A DEFECT, and it is deliberately NOT recorded as an issue. A missed
 * estimate is not a fault of the user's app, and this repo has repeatedly watched a measurement
 * recorded as a warning become the headline `rootCause` of a successful build — `POST_ANSWER_TIMING`
 * and `TIME_TO_FIRST_CALL` are both in NEVER_ROOT_CAUSE for exactly that. Recording it as a derived
 * field keeps it out of `counts`, out of the cause pick, and out of the user's bill.
 *
 * ⚠️ AND AN UNEVIDENCED ESTIMATE IS SAID TO BE ONE. Since 2026-09-14 a build with no history shows
 * the user a PHASE, not a number, so scoring its hidden midpoint as a broken promise would invent a
 * promise nobody made. The ratio is still computed — it is what teaches the estimator — but the line
 * says plainly that no figure was shown.
 *
 * PURE. Returns null when there was no estimate or no usable clock, which is the side that makes no
 * claim rather than the side that makes one.
 */
export function etaAccuracy(
  promise: EtaPromise | null | undefined,
  startedAt: number | null | undefined,
  endedAt: number | null | undefined,
): EtaAccuracy | null {
  const promisedMs = Number(promise?.estimateMs);
  const a = Number(startedAt);
  const b = Number(endedAt);
  if (!Number.isFinite(promisedMs) || promisedMs <= 0) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const actualMs = b - a;
  const lowMs = Number.isFinite(Number(promise?.lowMs)) ? Number(promise?.lowMs) : promisedMs;
  const highMs = Number.isFinite(Number(promise?.highMs)) ? Number(promise?.highMs) : promisedMs;
  const ratio = actualMs / promisedMs;
  const withinBand = actualMs >= lowMs && actualMs <= highMs;
  const mins = (ms: number) => `${(ms / 60000).toFixed(1)} min`;
  const evidenced = promise?.evidenced === true;
  const band = `${mins(lowMs)}–${mins(highMs)}`;
  const head = evidenced
    ? `The user was shown ${band} (midpoint ${mins(promisedMs)})`
    : `No figure was shown to the user (unevidenced — they saw the PHASE). The estimator's own midpoint was ${mins(promisedMs)}, band ${band}`;
  const verdict = withinBand
    ? 'the build landed INSIDE that band'
    : `the build took ${mins(actualMs)} — ${ratio.toFixed(1)}× the midpoint and ${actualMs > highMs ? 'OVER' : 'UNDER'} the band`;
  return { promisedMs, lowMs, highMs, actualMs, ratio, withinBand, evidenced, line: `${head}; ${verdict}.` };
}

/**
 * The build's own verdict CODE — the last `OUTCOME_*` issue it recorded, or '' when it recorded none.
 *
 * `deriveRootCause` already finds this issue and returns its MESSAGE, which is prose meant for a human.
 * The failure ledger needs the code instead: a machine fact that classifies without anyone regexing a
 * sentence we wrote ourselves. Same lookup, same "last one wins" rule, so the two can never disagree
 * about which outcome was final. PURE.
 */
export function outcomeCodeOf(
  issues: ReadonlyArray<{ code: string }> | null | undefined,
): string {
  const last = [...(issues ?? [])].reverse().find((i) => typeof i?.code === 'string' && i.code.startsWith('OUTCOME_'));
  return last?.code ?? '';
}

/**
 * Did the USER stop this build?
 *
 * 🔴 ROOT CAUSE (autopsy 2b0a3ed5, 2026-09-17). A user pressed Stop 66 seconds into a calculator
 * build. The report's `rootCause` read *"Build did not succeed, but no specific error was
 * captured."* — while the same document carried `USER_STOPPED_BUILD` and `CANCELLED_BUILD_CHARGED`
 * in its own timeline, and the summary the user saw said "Stopped, as you asked."
 *
 * "No specific error was captured" is the sentence that sends the next autopsy hunting a bug. Here
 * there is no bug: the reason is fully recorded, two lines away, and was simply never asked for.
 *
 * 🔑 READ OFF THE TIMELINE, exactly like `toolWasUsed`, so it cannot drift from what the report
 * shows. A new flag threaded through every ending path is a flag some future ending path forgets —
 * which is the hole `endedWithoutOutcome` already exists to plug, one level down.
 *
 * ⚠️ `USER_STOPPED_BUILD` is recorded for an ENGINE-initiated stop too, and its message says which.
 * Only the user's own doing counts here: filing a platform stop under "the user abandoned it" is the
 * misattribution `isUserInitiated` was written to prevent, and it would quietly distort every
 * quality metric built on these reports.
 */
/**
 * Was this build STOPPED at all — whoever pressed it?
 *
 * The sibling of `stoppedByUser` below, and the distinction is not pedantry. That one answers *"is it
 * FAIR to say the user stopped this?"* and deliberately excludes the case where the engine stopped a
 * build working on a prompt NavBharatAI itself composed. This one answers *"did this build reach the
 * point of having a capability to judge?"* — and the answer is no either way, which is what the
 * empty-build explanation needs before it may blame an engine, a wallet or our own configuration.
 *
 * PURE. Reads the timeline the report itself prints, so it cannot drift from what an admin sees.
 */
export function buildWasStopped(issues: readonly BuildIssue[] | null | undefined): boolean {
  if (!Array.isArray(issues)) return false;
  return issues.some((i) => i?.code === 'USER_STOPPED_BUILD');
}

export function stoppedByUser(issues: readonly BuildIssue[] | null | undefined): boolean {
  if (!Array.isArray(issues)) return false;
  return issues.some((i) => {
    if (typeof i?.message !== 'string') return false;
    if (i.code === 'USER_STOPPED_BUILD') return !i.message.includes('not by the user');
    // The outcome the abort funnel records for the user's own stop (abortOutcome.ts, 2026-09-18) — a
    // platform-composed stop is recorded under OUTCOME_STOPPED instead, so this code IS the user.
    if (i.code === 'OUTCOME_USER_STOPPED') return true;
    // 🔴 THE SAME FACT UNDER A SECOND CODE, AND THIS READER KNEW ONLY ONE (report cc8c9075).
    //
    // `USER_STOPPED_BUILD` is written by the /stop ROUTE — a separate request, against a different
    // in-flight diag, and on that report it never landed. `CANCELLED_BUILD_CHARGED` is written by the
    // BUILD'S OWN settle path from `abortCauseOf(signal)`, and `decideCancelledBuildBill` returns
    // `applies: true` for NOTHING except `abortCause === 'user-stop'` — so its presence is proof, from
    // the one actor that cannot be wrong about it.
    //
    // The cost of not reading it: that build's rootCause read *"why it failed is not known from this
    // report"* while the same document carried the engine's own sentence, *"user stopped the build …
    // charged half the work done"*, and the user-facing summary said *"Stopped, as you asked."* Three
    // statements of the stop, and the field an autopsy reads first said the cause was unknown — which
    // sends the next session hunting a failure that never happened.
    return i.code === 'CANCELLED_BUILD_CHARGED';
  });
}

/**
 * The SEVERITY the build's last `OUTCOME_*` was recorded at, or null when it recorded none.
 *
 * Sits beside `outcomeCodeOf` because the two are only useful together: one code can carry opposite
 * meanings (`OUTCOME_STOPPED` at `warning` is the advisory cap on an app that WAS built; at `error`
 * it is a build that never converged). A reader given the code alone cannot tell those apart, which
 * is exactly how a successful build came to be filed as "incomplete". PURE.
 */
export function severityOfOutcome(
  issues: ReadonlyArray<{ code: string; severity?: string }> | null | undefined,
): string | null {
  const last = [...(issues ?? [])].reverse().find((i) => typeof i?.code === 'string' && i.code.startsWith('OUTCOME_'));
  return last && typeof last.severity === 'string' ? last.severity : null;
}

/**
 * DID ANYONE ACTUALLY SEE THIS APP RUN? — the one fact that separates "the engine failed" from "we
 * told the user it failed while their app worked". PURE.
 *
 * 🔴 WHY IT IS NEEDED (admin 2026-09-17, the 40.8% panel). This repo has TWICE shipped a verdict that
 * called a working app broken: autopsy 697b38ee (a build that typechecked, built, rendered and passed
 * its own Playwright suite told the user *"The build produced no files"*) and autopsy 4efab9d7 (a
 * provider timeout counted as an app blocker → release gate RED → "working app or free" → ₹0). Both
 * were fixed forward, but every record written BEFORE those fixes keeps its old verdict — and those
 * records are what the failure panel reads today. Without this, a failure rate cannot be told apart
 * from a mislabelling rate.
 *
 * ⚠️ ONLY BROWSER-CONFIRMED EVIDENCE COUNTS, deliberately. `GREEN_GUARD_SAVE` is recorded only after
 * the app was opened in a real browser and seen rendering, and `PREVIEW_PUBLISHED` only after a URL
 * was really served. A clean typecheck or a green unit suite proves the CODE is fine and says nothing
 * about whether anything rendered, which is the distinction `deliveryProof.ts` was built on.
 */
export function appWasSeenRunning(
  issues: ReadonlyArray<{ code: string }> | null | undefined,
): boolean {
  return (issues ?? []).some((i) => i?.code === 'GREEN_GUARD_SAVE' || i?.code === 'PREVIEW_PUBLISHED');
}

/**
 * The unresolved items a build recorded that could NEVER have named its cause — and the honest
 * sentence that says so. Returns null when there are none. PURE.
 *
 * 🔴 WHY IT IS SHARED (autopsy fdd59ef8, 2026-09-17, second half). That report carried
 * `counts.unresolved: 2` while its verdict announced there were none. The fix was written INLINE in
 * the one branch the report happened to hit — a build that did NOT succeed — and the sibling branch
 * one line below, the one a SUCCESSFUL build reaches, kept the same false sentence verbatim:
 * `'Build completed successfully with no problems recorded.'`
 *
 * That sibling is the common case, not the rare one. `DESIGN_CONSISTENCY`, `RELEASE_GATE`,
 * `TIME_TO_FIRST_CALL` and `DEPENDENCY_VULNERABILITIES` are all recorded unresolved and all in
 * NEVER_ROOT_CAUSE, so nearly every green build ends with a non-zero unresolved count and a verdict
 * claiming zero. A reader who trusts the sentence stops looking for findings that are sitting right
 * there in the same document.
 *
 * ⚠️ THE ITEMS ARE COUNTED THROUGH THE CALLER'S OWN `excluded` PREDICATE, not re-derived here. An
 * item is ineligible for several different reasons (an advisory, the gate's own summary, a dead
 * sandbox, a transient the build recovered from), and a private copy of that rule is how the two
 * halves of one verdict drift apart — which is the defect being fixed, one level up.
 *
 * ⚠️ `observation !== true` matches `counts.unresolved`'s own rule. An observation about the user's
 * pre-existing code is neither ours nor unresolved, and counting it here would make this sentence
 * contradict the header in the opposite direction.
 */
export function ineligibleUnresolvedNote(
  issues: readonly BuildIssue[],
  excluded: (i: BuildIssue) => boolean,
): string | null {
  const items = issues.filter(
    (i) => i.severity !== 'info' && i.autoResolved === false && i.observation !== true && excluded(i),
  );
  if (items.length === 0) return null;
  const codes = [...new Set(items.map((i) => i.code))];
  // The CODES, not the hard-coded parenthetical the inline version carried ("a design/accessibility
  // advisory or the release-gate summary"). That phrasing was true of one report and goes stale the
  // moment a different advisory is the one recorded; naming what is actually there cannot.
  const shown = codes.slice(0, 5).join(', ');
  const more = codes.length > 5 ? `, +${codes.length - 5} more` : '';
  return `${items.length} unresolved item(s) WERE recorded (${shown}${more}), but none of them can name a cause `
    + '— each is an advisory, a summary of other findings, an infrastructure condition, or something this build recovered from';
}

export function deriveRootCause(input: {
  issues: readonly BuildIssue[];
  errors?: readonly CapturedError[];
  review?: string;
  ok?: boolean;
  /** The run's recorded commands — evidence for whether a failed one later succeeded. Optional. */
  commands?: ReadonlyArray<{ command: string; exitCode: number | null }>;
  /**
   * The report is being finalised and NO terminal event was ever recorded into it — no `done`, no
   * `finish()`, no `OUTCOME_*`. Set only by the serializer, which is the one caller that can tell this
   * apart from "the caller simply did not pass `ok`" (many do not, and they must keep today's answer).
   */
  endedWithoutOutcome?: boolean;
  /**
   * True when this build had NOT ended at the moment the report was taken — i.e. the user asked for the
   * report mid-build. See `STILL_RUNNING_WINDOW_MS` and the honesty note in `deriveRootCause`.
   */
  stillRunning?: boolean;
}): string | undefined {
  const { issues, errors, review, ok } = input;
  /**
   * 🔴 THE ADVISORY CAP IS NOT AN OUTCOME FOR THE APP (report af3a3f7f, 2026-09-17).
   *
   * A build that succeeded on every measure — rendered in a real browser, `vitest 6/6`, `PROD_BUILD_OK`,
   * `GREEN_GUARD_SAVE` — reported "Build outcome: STOPPED — the app was built; the post-build advisory
   * pass was cut short by its 2-minute cap" as its ROOT CAUSE. Nothing stopped: `ADVISORY_CAP_MS` is a
   * designed ceiling on optional post-build extras, so reaching it is the system working.
   *
   * ⚠️ AND SIMPLY SKIPPING IT WOULD HAVE TRADED ONE WRONG ANSWER FOR A WORSE ONE. This outcome pick
   * runs BEFORE every other guard, so falling through would hand the same successful build the most
   * severe remaining warning — which on that very report was `PROVIDER_FALLBACK: Provider GLM failed`.
   * That is exactly the provider-error-as-app-blocker class autopsy 4efab9d7 closed. So when the
   * advisory cap is the ONLY outcome of a SUCCESSFUL build, the honest answer is that there is NO root
   * cause: the app was built. A build that did NOT succeed still falls through as before, because we
   * owe it an explanation.
   */
  const outcomes = [...issues].reverse().filter((i) => i.code.startsWith('OUTCOME_'));
  const outcome = outcomes.find((i) => !isAdvisoryCapOutcome(i));
  if (outcome) return outcome.message;
  if (ok === true && outcomes.length > 0) return undefined;
  // A reviewer [CRITICAL] is the rootCause ONLY when the build did not succeed. On a SUCCESSFUL, rendered
  // build the app works and the reviewer's finding was OFFERED to the user, not applied (GREEN STOP /
  // REVIEW_SUGGESTED_NOT_APPLIED) — so promoting it to the build's rootCause reports a working app as
  // FAILING, the exact dishonesty rule 5 forbids. Real case (BENCHMARK #1 game evolution, 2026-08-12):
  // an admin-confirmed-correct game was headlined "Critical issue found by review: Missing Required
  // Features" while three of the reviewer's own four items were "PARTIAL" (present-but-different) on an
  // app that ran and rendered. The finding still appears in the report as a review suggestion; only its
  // promotion to the build's rootCause is withheld on success. `ok !== true` keeps a FAILED build
  // (ok:false — where a critical genuinely explains the failure) and a STILL-RUNNING build (ok undefined)
  // exactly as before; this can only ever make a successful build's verdict more honest. Sibling of the
  // already-closed "an advisory hint became the rootCause of a SUCCESSFUL build" class just below.
  if (review && ok !== true) {
    const m = review.match(/\[CRITICAL\]\s*([^\n]+)/);
    if (m) return `Critical issue found by review: ${m[1].trim()}`;
  }
  if (errors && errors.length > 0) return `Error: ${errors[0].message.split('\n')[0].slice(0, 300)}`;
  // Sandbox-unavailability is INFRA, never the app's fault — exclude it from the app-problem pick so a
  // dead sandbox can't masquerade as "tsc failed" (ShopSphere autopsy). It is surfaced honestly below.
  const isInfra = (i: BuildIssue): boolean => i.code === 'SANDBOX_UNAVAILABLE';
  // On a SUCCESSFUL build a recovered-transient (TOOL_ERROR / retry / non-zero sandbox probe) is NOT the
  // root cause — the build recovered from it (PaisaTrack "fix all error" autopsy 2026-07-21: an ok:true
  // build reported "Unterminated string in JSON" as its rootCause). Exclude those on ok:true.
  // …with the SAME evidence rule the back-fill uses (autopsy d6deaaf0): a failed command counts as
  // recovered only when that command later ran clean. Without `commands` the caller has no evidence
  // either way, so behaviour is exactly as before — this can only ever make the verdict more honest.
  const recovered = recoveredCommands(input.commands ?? []);
  const forgiven = (i: BuildIssue): boolean => i.code !== 'SANDBOX_CMD_FAILED'
    || recovered.has(commandKey(i.message))
    || !failureHasSurvivingConsequence(i.message, issues);
  const excluded = (i: BuildIssue): boolean => isInfra(i)
    // Advisory findings are excluded on EVERY outcome — a tidiness hint explains nothing, and on this
    // build it was both the rootCause and factually wrong.
    || isNeverRootCause(i.code)
    || (ok === true && isRecoverableOnSuccess(i.code) && forgiven(i));
  // Pick the TERMINAL cause, not merely the FIRST noisy one. An unresolved ERROR outranks an unresolved
  // WARNING even when the warning appears earlier in the timeline (EstateNest autopsy 2026-07-20: two
  // benign architect `read_file`-not-found WARNINGS — reading a file before it was written, build
  // continued fine — appeared before the real DB_UNREACHABLE ERROR that actually killed the build, and the
  // old first-match order blamed "useAuth.ts does not exist" instead of the database. Severity now leads
  // the pick so the report names the real killer.)
  const unresolved =
    issues.find((i) => i.severity === 'error' && !i.autoResolved && !excluded(i))
    ?? issues.find((i) => i.severity !== 'info' && !i.autoResolved && !excluded(i));
  // The autoResolved-INCLUSIVE fallbacks exist only to surface SOMETHING on a build that did NOT
  // succeed; a successful build must never report a recovered/auto-resolved item as its root cause.
  const resolvedOnly = unresolved ? undefined
    : (ok === true ? undefined : (issues.find((i) => i.severity === 'error' && !excluded(i))
      ?? issues.find((i) => i.severity !== 'info' && !excluded(i))));
  const problem = unresolved ?? resolvedOnly;
  /**
   * 🔎 THE SIBLING SWEEP (rule 3). EVERY branch below that is reached with no `problem` ends on a
   * clause asserting nothing unresolved was recorded — and each one is the fdd59ef8 contradiction
   * wearing different words. An INELIGIBLE item is still an UNRESOLVED item: it is counted in
   * `counts.unresolved`, printed in the report's own header, and merely barred from naming a cause.
   * Four branches carried that claim and the autopsy had fixed exactly one of them.
   */
  const nothingUnresolved = (plain: string): string => ineligibleUnresolvedNote(issues, excluded) ?? plain;
  /**
   * 🔴 A BUILD THAT NEVER RECORDED AN ENDING MUST NOT HAVE ONE INVENTED FOR IT (admin report 2026-09-10).
   *
   * `ok === undefined` means no terminal event ever reached this report — no `done`, no `finish()`, no
   * `OUTCOME_*`. The reported build ran 29m59s against a 30-minute cap and was exported with `ok`,
   * `summary` AND `endedAt` all absent, so the pick above named `$ npx vitest run → exit 1` as its root
   * cause: a test command that had ALREADY been fixed and re-run green four times, blamed for a build
   * it did not end.
   *
   * That is the same false attribution `finalizeOnDeadline` was written to stop (its own comment cites a
   * 35.8-minute build blamed on `npm audit fix`) — proving the hole is not in any one ending path but in
   * relying on EVERY ending path to remember. So the honesty is enforced here instead, at the one place
   * every report passes through: when nothing recorded an ending, say so, and demote the most severe
   * recorded issue to what it actually is — the worst thing SEEN, not the reason it stopped.
   *
   * The issue is still named, because it is the most useful thing we have; only the claim that it CAUSED
   * the ending is withdrawn. A build genuinely still running reads the same way, which is correct: we do
   * not know how it ends either.
   */
  /**
   * 🔴 "STILL RUNNING" AND "CUT OFF" ARE DIFFERENT SENTENCES, AND SAYING THE WRONG ONE SENDS THE READER
   * AFTER A PHANTOM (admin build report f04421ef, 2026-09-13).
   *
   * The reported build had no `endedAt`, its last recorded event was a command that SUCCEEDED nine
   * minutes in, and its last heartbeat read "in-flight: bash" — it was alive, and the admin had simply
   * pressed Report while it worked. The report nonetheless said *"This build ended without recording an
   * outcome (cut off before it could report one) — so the reason it stopped is NOT known"*, and a whole
   * autopsy went looking for a build that had stopped, when nothing had stopped at all.
   *
   * ⚠️ THIS WAS A KNOWN, ACCEPTED CONFLATION, WHICH IS WHY THE FIX IS HERE AND NOT A TWEAK. The branch
   * below carried the line *"A build genuinely still running reads the same way, which is correct: we do
   * not know how it ends either"*. It is correct that we do not know the ENDING. It is not correct to
   * announce an ending that has not happened: the first tells a reader to wait, the second tells them to
   * investigate.
   *
   * The discriminator is local and needs no new plumbing: a live build records a HEARTBEAT every minute,
   * so "no `endedAt` AND activity moments ago" is alive. The window is two heartbeats, so one missed
   * beat cannot flip a live build to "ended" — and it leans toward "still running" on purpose, because
   * being told to wait a moment for a build that had in fact stopped costs one re-read, while being told
   * it stopped when it had not costs an investigation of nothing.
   */
  if (input.stillRunning === true) {
    return problem
      ? `This build was STILL RUNNING when this report was taken — it has not ended, so there is no outcome yet and nothing has "stopped". The most severe issue recorded so far, which the build may still be working on: ${problem.message}`
      : `This build was STILL RUNNING when this report was taken — it has not ended, so there is no outcome yet, and ${nothingUnresolved('no unresolved issue has been recorded so far')}.`;
  }
  if (input.endedWithoutOutcome === true) {
    return problem
      ? `This build ended without recording an outcome (cut off before it could report one) — so the reason it stopped is NOT known. The most severe issue recorded before it stopped, which may or may not be related: ${problem.message}`
      : `This build ended without recording an outcome (cut off before it could report one) — the reason it stopped is not known, and ${nothingUnresolved('no unresolved issue was recorded either')}.`;
  }
  /**
   * 🔴 A BUILD THE USER STOPPED HAS A KNOWN CAUSE, AND IT IS NOT A DEFECT (autopsy 2b0a3ed5).
   *
   * Placed ABOVE every "worst thing seen" branch on purpose: when a person ends a build, that IS why
   * it ended, whatever else the timeline happens to contain. The most severe recorded issue is still
   * named — it is the most useful thing we have — but demoted to what it is, exactly as the
   * still-running branch above demotes it, rather than presented as the reason.
   *
   * ⚠️ `ok !== true` IS LOAD-BEARING, AND THE REASON IS ONE COMMIT OLD. #3004 landed the same day
   * because a build that SUCCEEDED on every measure was headlined "Build outcome: STOPPED". A user
   * can press Stop on a build that has already produced a working app; without this condition, this
   * branch would re-create that exact bug in a new place — reporting a stop as the root cause of a
   * successful build, and beating the `ok === true` guards further down to it.
   */
  if (ok !== true && stoppedByUser(issues)) {
    return problem
      ? `The USER stopped this build — that is why it ended, and no failure of the app or the engine is implied. The most severe thing recorded before the stop, which may be unrelated: ${problem.message}`
      : `The USER stopped this build — that is why it ended. Nothing failed, and ${nothingUnresolved('no unresolved problem was recorded')}.`;
  }
  /**
   * 🔴 AN ITEM WE OURSELVES MARKED RESOLVED MUST NOT BE PRESENTED AS THE CAUSE (autopsy fd021c64).
   *
   * `resolvedOnly` is reached only when the run recorded NOTHING unresolved, and the fallback then
   * reaches back for an `autoResolved: true` item so a failed build says something rather than
   * nothing. Naming it is right; naming it as the CAUSE is a claim that contradicts our own record —
   * `autoResolved: true` is this engine stating, in the same report, that the item is not an
   * outstanding defect.
   *
   * Adding `READINESS_WARNING` to NEVER_ROOT_CAUSE fixes the instance above. This fixes the CLASS:
   * every code recorded auto-resolved today, and every one added tomorrow, stops being able to
   * become a headline cause through this door. The item is still named — it is the most useful
   * thing the run has — with the causal claim withdrawn, exactly as the `endedWithoutOutcome` and
   * `stillRunning` branches above already do for the same reason.
   */
  if (problem && problem === resolvedOnly) {
    // 🔴 "NO unresolved problem was recorded" WAS FALSE, AND THE SAME DOCUMENT SAID SO (autopsy
    // fdd59ef8, 2026-09-17). That report carried `counts.unresolved: 2` — a DESIGN_CONSISTENCY
    // warning and the RELEASE_GATE summary — while this sentence announced there were none. Both are
    // in NEVER_ROOT_CAUSE, so they were never CANDIDATES; that is a different fact from not existing,
    // and conflating the two makes the report contradict its own header. A reader who trusts the
    // sentence stops looking for the two findings that are sitting right there.
    const note = nothingUnresolved('NO unresolved problem was recorded');
    return `This build did not succeed, but ${note} — so why it failed is not known from this report. The most severe thing seen, which the engine had already resolved and which may be unrelated: ${problem.message}`;
  }
  /**
   * 🔴 A SUCCESSFUL BUILD'S VERDICT MUST NOT READ AS A FAILURE, AND MUST NOT CLAIM A ZERO ITS OWN
   * HEADER CONTRADICTS. Both halves, because this one branch got them both wrong.
   *
   * HALF ONE — the count. See `ineligibleUnresolvedNote` above: the identical false sentence that
   * autopsy fdd59ef8 removed from the failure branch was left standing here, on the path almost every
   * green build takes.
   *
   * HALF TWO — the causal claim. `return problem.message` hands a bare finding to a field called
   * `rootCause`, which the admin report renders as "Root cause:". On a build that SUCCEEDED there is
   * no failure for anything to be the cause OF, so the app's own failing test suite came out reading
   * as the reason a working app had failed. That is the same dishonesty the `[CRITICAL]` guard above
   * and the PREVIEW_NOT_RENDERED / RELEASE_GATE entries in NEVER_ROOT_CAUSE were each written for,
   * arriving through the last door still open.
   *
   * ⚠️ AND THE FIX IS NOT TO HIDE THE ITEM — that was considered and rejected. Adding `TEST_SUITE`
   * to NEVER_ROOT_CAUSE would have silenced the single most useful finding on a build where
   * everything else is clean: a suite that RAN and failed is real evidence about the app, not an
   * advisory (its sibling `TEST_SUITE_UNVERIFIED` is in that set for the opposite reason — our
   * sandbox could not run it). So the item is still named in full, exactly as the `stillRunning`,
   * `endedWithoutOutcome` and `stoppedByUser` branches above already name theirs; only the claim
   * that it CAUSED something is withdrawn.
   *
   * 🔒 A build with nothing ineligible recorded keeps the old sentence byte-for-byte, so the common
   * genuinely-clean case is unchanged.
   */
  if (ok === true) {
    if (problem) {
      return 'This build SUCCEEDED, so nothing recorded here caused a failure. The most severe item still '
        + `unresolved against the app, which is worth reading but did not stop anything: ${problem.message}`;
    }
    const note = ineligibleUnresolvedNote(issues, excluded);
    return note
      ? `Build completed successfully. ${note}.`
      : 'Build completed successfully with no problems recorded.';
  }
  if (problem) return problem.message;
  // No app-level problem was captured, but the sandbox went away mid-build → name the infra honestly
  // instead of the generic "no specific error" (which reads like the app silently failed).
  if (issues.some(isInfra)) {
    return 'The build sandbox became unavailable mid-build (reaped/expired/unreachable), so the app could not be finished or verified. This is an infrastructure condition, not a defect in the generated app.';
  }
  if (ok === false) return 'Build did not succeed, but no specific error was captured.';
  return undefined; // still running / nothing to report yet
}

/**
 * Format the provider-delivery split for the report, dominant provider first (e.g.
 * "GLM (18 turns), CLAUDE (2 turns)"). Returns null when nothing was recorded (e.g. the
 * non-agentic SimpleBuild/OneShot lanes). Pure + exported for testing.
 */
export function formatProviderDelivery(delivery?: Record<string, number>): string | null {
  if (!delivery) return null;
  const entries = Object.entries(delivery).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name} (${n} turn${n === 1 ? '' : 's'})`)
    .join(', ');
}

/** The provider that drove the MOST delivered turns — "app kisne banaya". Ties keep first-seen. Pure. */
export function dominantDeliveryProvider(delivery: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let bestN = 0;
  for (const [name, n] of delivery) {
    if (n > bestN) { best = name; bestN = n; }
  }
  return best;
}

/** Render a report as a human/Claude-readable plain-text document (for the .txt download). */
/**
 * Which token numbers may this report show, and how must they be labelled?
 *
 * Three genuinely different states, and the old renderer collapsed all three into one:
 *   settled  — `providerTokens` is the reconciled, billed figure. No caveat.
 *   live     — the build is still running; `liveTokens` is what the ledger has attributed so far.
 *              Real numbers, an UNDER-count, and never the bill.
 *   unknown  — neither. The honest output is "tokens not recorded", NOT zeros.
 *
 * The third case is the one that caused the harm. `0 in · 0 out` is indistinguishable from a measured
 * zero, and it was read as one — by me, in an autopsy handed to the admin (report f04421ef).
 */
export function tokenUsageView(r: Pick<BuildDiagnosticsReport, 'providerTokens' | 'liveTokens' | 'liveCacheReadInputTokens' | 'cacheReadInputTokens'>): {
  state: 'settled' | 'live' | 'unknown';
  tokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  cacheReadInputTokens?: number;
  /** Suffix for the section heading — empty when the numbers are final. */
  label: string;
  /** A line to print under the table, or null. */
  caveat: string | null;
} {
  const settled = r.providerTokens && Object.keys(r.providerTokens).length > 0 ? r.providerTokens : undefined;
  if (settled) {
    return { state: 'settled', tokens: settled, cacheReadInputTokens: r.cacheReadInputTokens, label: '', caveat: null };
  }
  const live = r.liveTokens && Object.keys(r.liveTokens).length > 0 ? r.liveTokens : undefined;
  if (live) {
    return {
      state: 'live',
      tokens: live,
      cacheReadInputTokens: r.liveCacheReadInputTokens,
      label: ' — LIVE, build not settled',
      caveat: 'These totals are a running count, not the bill: aux calls (plan/judge) are folded in only when the build settles, so the real figure is HIGHER.',
    };
  }
  return {
    state: 'unknown',
    label: ' — tokens not yet recorded',
    caveat: 'No token totals were written for this build. That is an absence of measurement, not a measured zero.',
  };
}

export function renderDiagnosticsText(r: BuildDiagnosticsReport): string {
  const lines: string[] = [];
  lines.push('NavBharatAI Pro — Build Diagnostics Report');
  lines.push('='.repeat(52));
  lines.push(`Prompt   : ${r.prompt ?? '(n/a)'}`);
  lines.push(`Framework: ${r.framework ?? '(n/a)'}`);
  lines.push(`Model    : ${r.model ?? '(n/a)'}`);
  if (r.manifest) lines.push(`Manifest : ${manifestSummaryLine(r.manifest)}`); // U-1 signed determinism-audit manifest
  // Which provider(s) actually drove the build turns — the real "kaun sa reply kis provider se aaya".
  const deliveredBy = formatProviderDelivery(r.providerDelivery);
  // Infrastructure cost sits beside the model cost, because "why is the E2B bill this size?" had no
  // answer in the product before. The idle split is the actionable part: a VM that outlived its build
  // is a reaper/idle problem, not a model problem.
  const sandboxLine = describeSandboxCost(
    r.sandboxCost ?? null,
    r.endedAt && r.startedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : undefined, // epoch ms, not ISO
  );
  if (r.builtBy) lines.push(`Built by : ${r.builtBy}${deliveredBy ? ` — full split: ${deliveredBy}` : ''}`);
  else if (deliveredBy) lines.push(`Built by : ${deliveredBy}`);
  lines.push(sandboxLine);
  lines.push(`Outcome  : ${r.ok === undefined ? '(n/a)' : r.ok ? 'SUCCESS' : 'FAILED'}`);
  // PROVIDER USAGE + BILLING (admin 2026-07-11 / expanded 2026-07-12: "kitne token API call me
  // provider ne use kiya + user se kitna charge kiya") — the report answers, per provider: how many
  // API calls it drove and its input/output/total tokens; then how much the user was actually charged.
  // Joins providerDelivery (call counts) with providerTokens (in/out); 'other' = plan/judge/aux calls.
  const usage = tokenUsageView(r);
  const provNames = new Set<string>([
    ...Object.keys(usage.tokens ?? {}),
    ...Object.keys(r.providerDelivery ?? {}),
  ]);
  if (provNames.size > 0) {
    lines.push(`Provider usage (per provider — API calls · input · output · total tokens)${usage.label}:`);
    let totIn = 0, totOut = 0, totCalls = 0;
    const rows = [...provNames]
      .map((name) => {
        const calls = r.providerDelivery?.[name] ?? 0;
        const t = usage.tokens?.[name];
        return { name, calls, inTok: t?.inputTokens ?? 0, outTok: t?.outputTokens ?? 0, total: (t?.inputTokens ?? 0) + (t?.outputTokens ?? 0), known: !!t };
      })
      .sort((a, b) => (b.total - a.total) || (b.calls - a.calls));
    for (const row of rows) {
      totIn += row.inTok; totOut += row.outTok; totCalls += row.calls;
      // HONESTY (autopsy f04421ef): a provider with no ledger entry prints "not recorded", never
      // "0 in · 0 out". Zeros read as a measurement, and this exact line made me report to the admin
      // that a build had served zero tokens from cache when in truth nothing had been written yet.
      const tokenPart = row.known
        ? `${row.inTok.toLocaleString()} in · ${row.outTok.toLocaleString()} out · ${row.total.toLocaleString()} total`
        : 'tokens not recorded';
      lines.push(`  ${row.name.padEnd(8)}: ${row.calls} call(s) · ${tokenPart}`);
    }
    if (usage.tokens) {
      lines.push(`  ${'TOTAL'.padEnd(8)}: ${totCalls} call(s) · ${totIn.toLocaleString()} in · ${totOut.toLocaleString()} out · ${(totIn + totOut).toLocaleString()} total`);
    }
    if (usage.caveat) lines.push(`  ${usage.caveat}`);
    // WHICH ENGINES WERE EVEN AVAILABLE (autopsy f04421ef). A provider missing from the table above is
    // ambiguous on its own — never reached, or never configured? The chain answers it.
    if (r.providerChain) lines.push(`  Chain   : ${r.providerChain}`);
    const idle = unreachedProvidersNote(r.providerChainNames ?? [], r.providerDelivery ?? {});
    if (idle) lines.push(`  ${idle}`);
  }
  if (r.billing) {
    const tierTag = r.billing.powerLevel ? ` [power: ${r.billing.powerLevel}${r.billing.noClaude ? ', no-Claude' : ''}]` : '';
    lines.push(`User tier: ${r.billing.userTier}${tierTag}${r.billing.powerMode ? ' — POWER MODE (Only Opus)' : ''}`);
    if (typeof r.billing.billedUsd === 'number') {
      const inr = typeof r.billing.billedInr === 'number' ? `₹${r.billing.billedInr.toFixed(2)} ` : '';
      const wallet = typeof r.billing.walletTokensDebited === 'number' && r.billing.walletTokensDebited > 0
        ? ` · ${r.billing.walletTokensDebited.toLocaleString()} wallet tokens debited` : '';
      lines.push(`Charged to user: ${inr}($${r.billing.billedUsd.toFixed(4)})${r.billing.billedUsd === 0 ? ' — FREE build' : ''}${wallet}`);
    } else if (typeof r.billing.walletTokensDebited === 'number' && r.billing.walletTokensDebited > 0) {
      lines.push(`Charged to user: ${r.billing.walletTokensDebited.toLocaleString()} wallet tokens debited`);
    }
    if (r.billing.zeroBillReason) lines.push(`Why free : ${r.billing.zeroBillReason}`);
    // Cap-4 cost-alerting: surface an unusually expensive build (admin-only, env-gated, default off).
    // Additive — never changes the charged amount above, only flags it when it crosses the threshold.
    const costAlert = costAlertAdvisory(r.billing.billedUsd, costAlertThresholdUsd());
    if (costAlert) lines.push(costAlert);
  }
  if (r.providerFailures && Object.keys(r.providerFailures).length > 0) {
    const failures = Object.entries(r.providerFailures)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ×${n}`)
      .join(', ');
    lines.push(`Failures : ${failures} (each fell through to the next provider)`);
  }
  if (typeof r.startedAt === 'number' && typeof r.endedAt === 'number') {
    lines.push(`Duration : ${Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000))}s`);
  }
  // THE PROMISE, MEASURED. Both halves of this line were already in the record — the ETA at t=0 and
  // the two timestamps — and were never put side by side, so "ETA ~2–4 min" sat in the same document
  // as a 16.7-minute build and nothing said so (open root cause #6, 2026-09-17).
  if (r.etaAccuracy) lines.push(`ETA      : ${r.etaAccuracy.line}`);
  lines.push(`Issues   : ${r.counts.total} total — ${r.counts.errors} error(s), ${r.counts.warnings} warning(s), ${r.counts.autoResolved} auto-resolved, ${r.counts.unresolved} unresolved${r.counts.observations ? `, ${r.counts.observations} observation(s) about your existing code` : ''}`);
  lines.push('');
  // ROOT CAUSE first — the single most important line, so nobody has to read the whole timeline
  // to find out WHY the build struggled.
  if (r.rootCause) {
    lines.push('ROOT CAUSE:');
    lines.push(`  ${r.rootCause}`);
    lines.push('');
  }
  const problems = r.problems ?? r.issues.filter((i) => i.severity !== 'info');
  const infoCount = r.issues.length - problems.length;
  if (problems.length === 0) {
    lines.push('No problems recorded — the build ran clean. 🎉');
  } else {
    lines.push(`Problems (${problems.length}, in order — the noise-free view: warnings + errors only):`);
    problems.forEach((i, n) => {
      const rep = i.repeatCount && i.repeatCount > 1 ? ` ×${i.repeatCount}` : '';
      lines.push(`${n + 1}. [${i.severity.toUpperCase()}] (${i.phase}/${i.code})${rep} ${i.autoResolved ? 'auto-resolved' : 'UNRESOLVED'}`);
      lines.push(`   ${i.message}`);
      if (i.detail) lines.push(`   ↳ ${i.detail}`);
    });
  }
  if (infoCount > 0) {
    lines.push('');
    lines.push(`(+${infoCount} informational timeline entries — progress narration, tool calls, heartbeats —`);
    lines.push(`  omitted from this view. See the "issues" array in the downloaded JSON for the full timeline.)`);
  }
  // ── AI Diagnosis Bundle — full raw signals (the detail the timeline summarizes). ──
  if (r.errors?.length) {
    lines.push('');
    lines.push(`Full errors (${r.errors.length}):`);
    r.errors.forEach((e, n) => {
      lines.push(`${n + 1}. (${e.phase}) ${e.message}`);
      if (e.stack) lines.push(`   stack:\n${e.stack.split('\n').map((l) => `     ${l}`).join('\n')}`);
    });
  }
  if (r.commands?.length) {
    lines.push('');
    lines.push(`Sandbox commands (${r.commands.length}):`);
    r.commands.forEach((c, n) => {
      const dur = c.durationMs != null ? ` ${Math.round(c.durationMs / 1000)}s` : '';
      lines.push(`${n + 1}. $ ${c.command} → exit ${c.exitCode ?? '?'}${dur}`);
      if (c.stdout.trim()) lines.push(`   stdout: ${c.stdout}`);
      if (c.stderr.trim()) lines.push(`   stderr: ${c.stderr}`);
    });
  }
  if (r.llmCalls?.length) {
    lines.push('');
    lines.push(`LLM calls (${r.llmCalls.length}):`);
    r.llmCalls.forEach((c, n) => {
      const lat = c.latencyMs != null ? ` ${Math.round(c.latencyMs / 1000)}s` : '';
      const tok = (c.inputTokens != null || c.outputTokens != null) ? ` tokens=${c.inputTokens ?? '?'}/${c.outputTokens ?? '?'}` : '';
      lines.push(`${n + 1}. ${c.provider ?? '?'}/${c.model ?? '?'} finish=${c.finishReason ?? '?'}${tok}${lat} ${c.ok ? 'ok' : 'FAILED'}`);
      if (c.error) lines.push(`   error: ${c.error}`);
      if (c.responsePreview) lines.push(`   response[${c.responseChars ?? c.responsePreview.length}c]: ${c.responsePreview}`);
    });
  }
  if (r.previewErrors?.length) {
    lines.push('');
    lines.push(`Preview errors (${r.previewErrors.length}):`);
    r.previewErrors.forEach((p, n) => {
      lines.push(`${n + 1}. [${p.source}] ${p.message}`);
    });
  }
  if (r.review) {
    lines.push('');
    lines.push('Quality review (all flagged problems):');
    lines.push(r.review);
  }
  if (r.generatedFiles?.length) {
    lines.push('');
    lines.push(`Offending files (${r.generatedFiles.length}):`);
    r.generatedFiles.forEach((f, n) => {
      lines.push(`${n + 1}. ${f.path}${f.note ? ` — ${f.note}` : ''}`);
      lines.push(f.content.split('\n').map((l) => `     ${l}`).join('\n'));
    });
  }
  return lines.join('\n') + '\n';
}

/**
 * Render the FULL SESSION report — every settled build in this session, oldest → newest — as one
 * plain-text document. The per-build report (renderDiagnosticsText) only ever shows the LATEST build
 * because each new message overwrites the "latest" doc; this stitches the durable per-build history
 * back into the complete "0 → last" record the admin asked for ("pura kaccha chittha, gayab na ho"),
 * so a single download/copy carries the whole session's story to hand to Claude. PURE + testable.
 *
 * `reports` must already be ordered oldest → newest by the caller (the route sorts the history by
 * startedAt). A single-build session degrades to essentially the per-build report with a session header.
 */
/**
 * Bound the whole-session report payload to a byte budget so the download can actually LOAD.
 *
 * ROOT CAUSE (admin, 2026-07-06 — "build report bhi fail! Load failed"): scope=session stitched up to
 * 20 FULL reports (each up to ~2 MB: 2000 timeline issues + 300 LLM calls × 4 KB previews + 300
 * command logs) into ONE JSON response — tens of MB, which mobile Safari's fetch dies on ("Load
 * failed") and which can exceed the response-size limit. The fix is honest truncation, newest-first:
 * keep the most recent builds whole (they're what the autopsy needs), drop the OLDEST ones once the
 * budget is spent, and tell the caller exactly how many were omitted — never a silently huge payload,
 * never a silently incomplete one. Always keeps at least the newest build even if it alone exceeds
 * the budget. `reports` are ordered oldest → newest (the route's order); the kept slice preserves it.
 * PURE + unit-tested.
 */
export function capSessionReports<T>(reports: readonly T[], maxBytes = 6_000_000): { kept: T[]; omitted: number } {
  if (!reports || reports.length === 0) return { kept: [], omitted: 0 };
  const kept: T[] = [];
  let bytes = 0;
  for (let i = reports.length - 1; i >= 0; i--) {
    let size = 0;
    try { size = JSON.stringify(reports[i])?.length ?? 0; } catch { size = maxBytes; /* unserializable → treat as huge */ }
    if (kept.length > 0 && bytes + size > maxBytes) break; // newest is always kept, even if huge
    kept.unshift(reports[i]);
    bytes += size;
  }
  return { kept, omitted: reports.length - kept.length };
}

export function renderSessionDiagnosticsText(reports: readonly BuildDiagnosticsReport[]): string {
  if (!reports || reports.length === 0) {
    return 'NavBharatAI Pro — Full Session Build Report\n' + '='.repeat(52) + '\nNo builds recorded in this session yet.\n';
  }
  const n = reports.length;
  const totals = reports.reduce(
    (acc, r) => ({
      errors: acc.errors + (r.counts?.errors ?? 0),
      warnings: acc.warnings + (r.counts?.warnings ?? 0),
      unresolved: acc.unresolved + (r.counts?.unresolved ?? 0),
    }),
    { errors: 0, warnings: 0, unresolved: 0 },
  );
  const firstStart = reports[0]?.startedAt;
  const lastEnd = reports[n - 1]?.endedAt ?? reports[n - 1]?.startedAt;
  const head: string[] = [];
  head.push('NavBharatAI Pro — FULL SESSION BUILD REPORT');
  head.push('='.repeat(52));
  head.push(`Builds in this session : ${n} (oldest → newest)`);
  if (typeof firstStart === 'number' && typeof lastEnd === 'number') {
    head.push(`Session span           : ${Math.max(0, Math.round((lastEnd - firstStart) / 1000))}s across ${n} build(s)`);
  }
  head.push(`Session totals         : ${totals.errors} error(s), ${totals.warnings} warning(s), ${totals.unresolved} unresolved (summed across all builds)`);
  head.push('');
  head.push('Each build below is the message that produced it, in order. Send this WHOLE report to');
  head.push('Claude to debug the full session — nothing is trimmed to just the last build.');
  head.push('');
  const bodies = reports.map((r, i) => {
    const banner = `${'━'.repeat(20)} BUILD ${i + 1} of ${n} ${'━'.repeat(20)}`;
    const promptLine = `Message: ${r.prompt ?? '(n/a)'}`;
    return `${banner}\n${promptLine}\n\n${renderDiagnosticsText(r)}`;
  });
  return head.join('\n') + '\n' + bodies.join('\n') + '\n';
}

/**
 * Fix 68 (White-Label Law §3, CLAUDE.md) — the ADMIN-ONLY build diagnostics report names the real providers
 * ("Provider GLM failed", providerTokens, llmCalls provider/model, builtBy, manifest routing). A NORMAL end
 * user must NEVER see which backend AI/infra did the work. This returns a provider-ANONYMOUS view of the report
 * for non-admin users, built by ALLOW-LIST (any field not explicitly copied is simply absent — safe by
 * construction, so a new provider-bearing field added later cannot silently leak). The forensic/provider-only
 * sections are OMITTED entirely; the remaining free text (summary, root cause, reviewer notes, issue messages,
 * captured errors) is scrubbed through the shared redactor so a vendor/model name embedded in prose is gone too.
 * The user's OWN content — their prompt and their generated app files — is kept verbatim (echoing the user's own
 * words is not a provider leak, and scrubbing their source would corrupt it).
 */
export function userFacingReport(report: BuildDiagnosticsReport): BuildDiagnosticsReport {
  const scrub = (s: string | undefined): string | undefined => (s === undefined ? undefined : redactProvidersText(s));
  const scrubIssue = (i: BuildIssue): BuildIssue => ({
    ts: i.ts,
    phase: i.phase,
    severity: i.severity,
    code: i.code, // a machine code like PROVIDER_FALLBACK is a generic category, not a vendor name
    message: redactProvidersText(i.message),
    autoResolved: i.autoResolved,
    ...(i.detail !== undefined ? { detail: redactProvidersText(i.detail) } : {}),
    ...(i.repeatCount !== undefined ? { repeatCount: i.repeatCount } : {}),
  });
  const out: BuildDiagnosticsReport = {
    schema: report.schema,
    startedAt: report.startedAt,
    counts: report.counts,
    issues: report.issues.map(scrubIssue),
    problems: report.problems.map(scrubIssue),
    // Optional, user-relevant, provider-free fields — kept verbatim.
    ...(report.buildId !== undefined ? { buildId: report.buildId } : {}),
    ...(report.promptHash !== undefined ? { promptHash: report.promptHash } : {}),
    ...(report.sessionId !== undefined ? { sessionId: report.sessionId } : {}),
    ...(report.workspaceId !== undefined ? { workspaceId: report.workspaceId } : {}),
    ...(report.prompt !== undefined ? { prompt: report.prompt } : {}),         // the user's own words
    ...(report.framework !== undefined ? { framework: report.framework } : {}),
    ...(report.endedAt !== undefined ? { endedAt: report.endedAt } : {}),
    ...(report.ok !== undefined ? { ok: report.ok } : {}),
    ...(report.priorFailedBuilds !== undefined ? { priorFailedBuilds: report.priorFailedBuilds } : {}),
    ...(report.generatedFiles !== undefined ? { generatedFiles: report.generatedFiles } : {}), // the user's own code
    // Free text that we author — scrubbed of any provider/model name.
    ...(report.summary !== undefined ? { summary: scrub(report.summary) } : {}),
    ...(report.rootCause !== undefined ? { rootCause: scrub(report.rootCause) } : {}),
    ...(report.review !== undefined ? { review: scrub(report.review) } : {}),
    ...(report.errors !== undefined
      ? { errors: report.errors.map((e) => ({ ts: e.ts, phase: e.phase, message: redactProvidersText(e.message), ...(e.stack !== undefined ? { stack: redactProvidersText(e.stack) } : {}) })) }
      : {}),
    ...(report.previewErrors !== undefined
      ? { previewErrors: report.previewErrors.map((p) => ({ ts: p.ts, source: p.source, message: redactProvidersText(p.message) })) }
      : {}),
    ...(report.dataLossEvents !== undefined
      ? { dataLossEvents: report.dataLossEvents.map((d) => ({ ts: d.ts, cause: redactProvidersText(d.cause), detail: redactProvidersText(d.detail) })) }
      : {}),
  };
  // Explicitly OMITTED (admin-only / provider-identifying): model, providerDelivery, builtBy, providerFailures,
  // providerTokens, providerChain, providerChainNames, liveTokens, liveCacheReadInputTokens, cacheReadInputTokens, llmCalls, commands, billing, manifest, sandboxCost (our own
  // infrastructure spend — never any part of what the user is charged). Because `out` is built by
  // allow-list, they are absent by construction — the user-facing billing surface is userCostBreakdown, not this.
  return out;
}

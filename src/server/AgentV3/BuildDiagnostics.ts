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

import type { AgentEvent } from './types';
import { manifestSummaryLine, type BuildManifestV1 } from './BuildManifest';
import { isDeadSandboxSignal, detectSilentDbFailure } from './sandbox/EngineerAI/actuators/sandboxHealth';
import { redactProvidersText } from '../lib/providerRedaction';
import { costAlertAdvisory, costAlertThresholdUsd } from './costAlert';

export type IssuePhase =
  | 'sandbox' | 'provider' | 'plan' | 'tool' | 'build' | 'readiness' | 'preview' | 'autofix' | 'deploy';
export type IssueSeverity = 'info' | 'warning' | 'error';

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
  /** Per-provider REAL token spend for this build (reconciled to the billed total; 'other' = aux
   *  calls). The report-level view of the Billing-Phase-3 ledger. */
  providerTokens?: Record<string, { inputTokens: number; outputTokens: number }>;
  /** Fix 66 — total prefix-cache HIT input tokens (GLM/Kimi auto-cache). Compare against providerTokens'
   *  input total for the real cache-hit rate on this build. Absent/0 when nothing was cache-served. */
  cacheReadInputTokens?: number;
  /** Billing & tier facts (free/paid user, actual charge, wallet debit, why-free). */
  billing?: BuildBillingRecord;
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
  /** Fix 37c — explicit data-loss/recovery events (sandbox recycled, files restored, generation
   *  reset), each with the observed CAUSE, so "data kyu udha" is answered inside the report itself. */
  dataLossEvents?: Array<{ ts: number; cause: string; detail: string }>;
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
  private cacheReadInputTokens?: number;
  private billing?: BuildBillingRecord;
  private reviewText?: string;
  private manifest?: BuildManifestV1;
  private priorFailedBuilds: number | undefined;
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
   * Record a periodic "still working" marker so even a long quiet stretch (a slow or hung step)
   * shows minute-by-minute progress in the report instead of a blank gap. Called on a timer by the
   * route. If a tool call is in-flight, it names it — so a hang is visible as "minute N — stuck on X".
   */
  heartbeat(): void {
    const mins = Math.max(1, Math.round((this.now() - this.startedAt) / 60_000));
    const inFlight = [...this.pending.values()].map((p) => p.tool);
    const status = inFlight.length ? `in-flight: ${inFlight.join(', ')}` : `last: ${this.lastActivity}`;
    this.record({ phase: 'build', severity: 'info', code: 'HEARTBEAT', message: `⏱ minute ${mins} — still working (${status})`, autoResolved: true });
  }

  /**
   * AI Diagnosis Bundle #3 — record a sandbox command's RAW result (full stdout/stderr/exit code).
   * The timeline gets a one-line marker (severity from the exit code); the full logs go to the
   * `commands` channel. This is the single highest-value diagnostic signal: a non-zero `npm install`
   * / `tsc` / `vite build` here explains most "the app generated but won't run" failures.
   */
  recordCommand(rec: { command: string; exitCode: number | null; stdout?: string; stderr?: string; durationMs?: number }): void {
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
   * AI Diagnosis Bundle #4 — record one model turn's I/O (provider, model, prompt/response size +
   * preview, finish reason, tokens, latency). A `finishReason: 'max_tokens'` here is the smoking gun
   * for a truncated multi-file generation (the OneShot 8K-token cut-off).
   */
  recordLlmCall(rec: Omit<LlmCallRecord, 'ts' | 'promptPreview' | 'responsePreview'> & { promptPreview?: string; responsePreview?: string }): void {
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
    // A truncated response (max_tokens) or a failed call is a real struggle → flag on the timeline.
    const truncated = rec.finishReason === 'max_tokens' || rec.finishReason === 'length';
    if (!rec.ok || truncated) {
      this.record({
        phase: 'provider',
        severity: rec.ok ? 'warning' : 'error',
        code: rec.ok ? 'LLM_TRUNCATED' : 'LLM_CALL_FAILED',
        message: rec.ok
          ? `Model response hit the token limit (${rec.model ?? 'model'}, finish=${rec.finishReason}) — output may be truncated.`
          : `Model call failed (${rec.model ?? 'model'}): ${rec.error ?? 'unknown error'}`.slice(0, 400),
        autoResolved: false,
        detail: rec.provider ? `provider=${rec.provider}` : undefined,
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
    return null;
  }

  /**
   * AI Diagnosis Bundle #1 — record a FULL error (message + stack), un-truncated. The timeline keeps
   * its short BUILD_ERROR line; this channel preserves the complete text so the real root cause (the
   * throwing frame) is never lost to a 800-char slice.
   */
  recordFullError(err: { message: string; stack?: string; phase?: IssuePhase }): void {
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
        const tc = e as unknown as { tool?: unknown; callId?: unknown; ts?: number; agent?: unknown };
        const tool = String(tc.tool ?? 'tool');
        const callId = typeof tc.callId === 'string' ? tc.callId : undefined;
        if (callId) this.pending.set(callId, { tool, ts: tc.ts ?? this.now() });
        this.lastActivity = tool;
        this.record({ phase: 'tool', severity: 'info', code: 'TOOL_CALL', message: `▶ ${tool}`, autoResolved: true, detail: tc.agent ? `agent=${String(tc.agent)}` : undefined });
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
        this.record({ phase: 'preview', severity: 'info', code: 'PREVIEW_PUBLISHED', message: `Preview published at ${e.url}`, autoResolved: true });
        break;
      case 'narration': {
        const t = (e.text || '').trim();
        if (!t) break;
        this.lastActivity = t.slice(0, 80);
        // A problem the agent is talking about (sandbox unavailable, port/preview not responding,
        // errors remaining, retries) is flagged warning/error; everything else is recorded as a
        // normal AGENT_STEP so the report shows WHAT the agent was doing minute-to-minute, not only
        // its struggles.
        // LONG ANALYTICAL PROSE IS NEVER A PROBLEM (report honesty, 2026-07-07 ×3): a successful
        // survey/summary containing phrases like "No error boundaries" was keyword-matched into a
        // severity=error AGENT_NOTE and even became the report's rootCause. Only a SHORT status-like
        // line (no markdown headings/tables, bounded length) can be classified as a problem — a
        // multi-paragraph analysis is a deliverable, not a struggle.
        const statusLike = t.length <= 300 && !/(^|\n)#{1,4}\s|\n\s*\|/.test(t);
        // BENIGN COMPOUNDS ARE NOT PROBLEMS (ShopKhata autopsy 2026-07-17): "Now let me create the App
        // component with routing and error boundary:" was recorded severity=error because \berror\b
        // matched inside "error boundary". Building error-UX (boundaries, handling, messages, toasts)
        // is normal work — strip those compounds BEFORE the problem-keyword test so only a genuine
        // failure phrase can classify a narration as a problem.
        const tForMatch = t.replace(/\berrors?[- ](boundar(?:y|ies)|handling|handlers?|messages?|states?|pages?|toasts?|ui|display)\b/gi, '')
          .replace(/\bwarnings?[- ](messages?|banners?|badges?|toasts?)\b/gi, '');
        const problemWord = /\b(error|failed|cannot|could not|not responding|isn'?t available|unavailable|retry|retrying|stuck|timed out|blocked request|closed port|won'?t come up|no files|warning)\b/i.test(tForMatch);
        // A genuine FAILURE VERB (not the bare noun "error") is what makes a note a real problem — and an
        // ERROR-severity one. "error"/"errors" as a NOUN the agent is working on is not itself a failure.
        const failureVerb = /\b(failed|cannot|could not|unavailable|timed out)\b/i.test(tForMatch);
        // REMEDIATION INTENT is progress, not a failure (PaisaTrack "fix all error" autopsy 2026-07-21:
        // "Now I'll fix both errors: … Fix the TypeScript type error" was recorded severity=error on a
        // SUCCESSFUL build, inflating the count to "1 error" under an "All Errors Fixed!" summary). When a
        // note is the agent fixing/removing/resolving something and carries NO real failure verb, it is a
        // build STEP, not a problem.
        const remediationIntent = /\b(fix(?:ing|ed|es)?|remov(?:e|es|ing|ed)|resolv(?:e|es|ing|ed)|correct(?:s|ing|ed)?|clean(?:s|ing|ed)?\s+up|delet(?:e|es|ing|ed))\b/i.test(tForMatch);
        if (statusLike && problemWord && !(remediationIntent && !failureVerb)) {
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
    for (const issue of this.issues) {
      if (isRecoverableOnSuccess(issue.code)) issue.autoResolved = true;
    }
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
  recordProviderFailure(name: string): void {
    if (!name) return;
    this.providerFailures.set(name, (this.providerFailures.get(name) ?? 0) + 1);
    this.notify();
  }

  /** Billing & tier facts, written once at settle time from the REAL charge (admin 2026-07-11). */
  setBilling(b: BuildBillingRecord): void {
    this.billing = b;
    this.notify();
  }

  /** Per-provider real token spend (the Billing-Phase-3 ledger, reconciled to the billed total). */
  setProviderTokens(u: Record<string, { inputTokens: number; outputTokens: number }>): void {
    if (u && Object.keys(u).length > 0) this.providerTokens = u;
  }

  /** Fix 66 (measure-first) — the total prefix-cache HIT input tokens the cheap-floor providers
   *  (GLM/Kimi) served this build. Purely observational: reveals the real cache-hit rate against
   *  providerTokens' input total, so we can see whether the big cheap-floor input is cache-served. */
  setCacheReadInputTokens(n: number): void {
    if (Number.isFinite(n) && n > 0) this.cacheReadInputTokens = n;
  }

  /** Fix 37a — stamp how many earlier builds in this workspace ended not-ok (from durable history). */
  setPriorFailedBuilds(n: number): void {
    if (Number.isFinite(n) && n >= 0) this.priorFailedBuilds = Math.floor(n);
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
    const autoResolved = this.issues.filter((i) => i.autoResolved && i.observation !== true && i.severity !== 'info').length;
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
      plannedModel: this.meta.model,
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
        unresolved: this.issues.filter((i) => !i.autoResolved && i.observation !== true).length,
        ...(observations > 0 ? { observations } : {}),
      },
      issues: [...this.issues],
      problems: capProblems(this.issues.filter((i) => i.severity !== 'info')),
      rootCause: deriveRootCause({ issues: this.issues, errors: this.errors, review: this.reviewText, ok: this.ok }),
      commands: this.commands.length ? [...this.commands] : undefined,
      llmCalls: this.llmCalls.length ? [...this.llmCalls] : undefined,
      errors: this.errors.length ? [...this.errors] : undefined,
      generatedFiles: this.generatedFiles.length ? [...this.generatedFiles] : undefined,
      previewErrors: this.previewErrors.length ? [...this.previewErrors] : undefined,
      providerDelivery: this.providerDelivery.size ? Object.fromEntries(this.providerDelivery) : undefined,
      // "App kisne banaya" — the provider with the MOST delivered turns (ties keep first-seen).
      builtBy: dominantDeliveryProvider(this.providerDelivery),
      providerFailures: this.providerFailures.size ? Object.fromEntries(this.providerFailures) : undefined,
      providerTokens: this.providerTokens,
      cacheReadInputTokens: this.cacheReadInputTokens,
      billing: this.billing,
      review: this.reviewText,
      priorFailedBuilds: this.priorFailedBuilds,
      dataLossEvents: this.dataLossEvents.length ? [...this.dataLossEvents] : undefined,
    };
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
  'TOOL_ERROR', 'NO_BUILD_NUDGE', 'EMPTY_BUILD_RETRY', 'SANDBOX_CMD_FAILED',
]);
export function isRecoverableOnSuccess(code: string): boolean {
  return RECOVERABLE_ON_SUCCESS.has(code);
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

export function deriveRootCause(input: {
  issues: readonly BuildIssue[];
  errors?: readonly CapturedError[];
  review?: string;
  ok?: boolean;
}): string | undefined {
  const { issues, errors, review, ok } = input;
  const outcome = [...issues].reverse().find((i) => i.code.startsWith('OUTCOME_'));
  if (outcome) return outcome.message;
  if (review) {
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
  const excluded = (i: BuildIssue): boolean => isInfra(i) || (ok === true && isRecoverableOnSuccess(i.code));
  // Pick the TERMINAL cause, not merely the FIRST noisy one. An unresolved ERROR outranks an unresolved
  // WARNING even when the warning appears earlier in the timeline (EstateNest autopsy 2026-07-20: two
  // benign architect `read_file`-not-found WARNINGS — reading a file before it was written, build
  // continued fine — appeared before the real DB_UNREACHABLE ERROR that actually killed the build, and the
  // old first-match order blamed "useAuth.ts does not exist" instead of the database. Severity now leads
  // the pick so the report names the real killer.)
  const problem =
    issues.find((i) => i.severity === 'error' && !i.autoResolved && !excluded(i))
    ?? issues.find((i) => i.severity !== 'info' && !i.autoResolved && !excluded(i))
    // The autoResolved-INCLUSIVE fallbacks exist only to surface SOMETHING on a build that did NOT
    // succeed; a successful build must never report a recovered/auto-resolved item as its root cause.
    ?? (ok === true ? undefined : (issues.find((i) => i.severity === 'error' && !excluded(i))
      ?? issues.find((i) => i.severity !== 'info' && !excluded(i))));
  if (problem) return problem.message;
  if (ok === true) return 'Build completed successfully with no problems recorded.';
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
export function renderDiagnosticsText(r: BuildDiagnosticsReport): string {
  const lines: string[] = [];
  lines.push('NavBharatAI Pro v5.0 — Build Diagnostics Report');
  lines.push('='.repeat(52));
  lines.push(`Prompt   : ${r.prompt ?? '(n/a)'}`);
  lines.push(`Framework: ${r.framework ?? '(n/a)'}`);
  lines.push(`Model    : ${r.model ?? '(n/a)'}`);
  if (r.manifest) lines.push(`Manifest : ${manifestSummaryLine(r.manifest)}`); // U-1 signed determinism-audit manifest
  // Which provider(s) actually drove the build turns — the real "kaun sa reply kis provider se aaya".
  const deliveredBy = formatProviderDelivery(r.providerDelivery);
  if (r.builtBy) lines.push(`Built by : ${r.builtBy}${deliveredBy ? ` — full split: ${deliveredBy}` : ''}`);
  else if (deliveredBy) lines.push(`Built by : ${deliveredBy}`);
  lines.push(`Outcome  : ${r.ok === undefined ? '(n/a)' : r.ok ? 'SUCCESS' : 'FAILED'}`);
  // PROVIDER USAGE + BILLING (admin 2026-07-11 / expanded 2026-07-12: "kitne token API call me
  // provider ne use kiya + user se kitna charge kiya") — the report answers, per provider: how many
  // API calls it drove and its input/output/total tokens; then how much the user was actually charged.
  // Joins providerDelivery (call counts) with providerTokens (in/out); 'other' = plan/judge/aux calls.
  const provNames = new Set<string>([
    ...Object.keys(r.providerTokens ?? {}),
    ...Object.keys(r.providerDelivery ?? {}),
  ]);
  if (provNames.size > 0) {
    lines.push('Provider usage (per provider — API calls · input · output · total tokens):');
    let totIn = 0, totOut = 0, totCalls = 0;
    const rows = [...provNames]
      .map((name) => {
        const calls = r.providerDelivery?.[name] ?? 0;
        const t = r.providerTokens?.[name] ?? { inputTokens: 0, outputTokens: 0 };
        return { name, calls, inTok: t.inputTokens, outTok: t.outputTokens, total: t.inputTokens + t.outputTokens };
      })
      .sort((a, b) => (b.total - a.total) || (b.calls - a.calls));
    for (const row of rows) {
      totIn += row.inTok; totOut += row.outTok; totCalls += row.calls;
      lines.push(`  ${row.name.padEnd(8)}: ${row.calls} call(s) · ${row.inTok.toLocaleString()} in · ${row.outTok.toLocaleString()} out · ${row.total.toLocaleString()} total`);
    }
    lines.push(`  ${'TOTAL'.padEnd(8)}: ${totCalls} call(s) · ${totIn.toLocaleString()} in · ${totOut.toLocaleString()} out · ${(totIn + totOut).toLocaleString()} total`);
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
    return 'NavBharatAI Pro v5.0 — Full Session Build Report\n' + '='.repeat(52) + '\nNo builds recorded in this session yet.\n';
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
  head.push('NavBharatAI Pro v5.0 — FULL SESSION BUILD REPORT');
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
  // providerTokens, cacheReadInputTokens, llmCalls, commands, billing, manifest. Because `out` is built by
  // allow-list, they are absent by construction — the user-facing billing surface is userCostBreakdown, not this.
  return out;
}

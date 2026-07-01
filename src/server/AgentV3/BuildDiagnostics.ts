// AgentV3 — Build Diagnostics: a structured, downloadable record of EVERY issue v3.0 hit
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
  /** True if v3.0 recovered on its own; false if it remained a problem in the final build. */
  autoResolved: boolean;
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

export interface BuildDiagnosticsReport {
  schema: 'navbharatai.v3.build-diagnostics/1';
  sessionId?: string;
  workspaceId?: string;
  prompt?: string;
  model?: string;
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
}

export interface BuildDiagnosticsMeta {
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
  private reviewText?: string;

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
    // A command explicitly shell-guarded with `|| true` (e.g. `pkill -f "vite" || true`) has already
    // told the shell its own outcome must never matter. That guard only covers a normal non-zero exit
    // from the command's own bash — it can't stop an EXTERNAL signal (e.g. E2B's sandbox daemon SIGTERM-
    // ing the wrapper process, observed as exitCode -1 / "signal: terminated" with no NavBharatAI code
    // involved) from still being reported as a raw exit code by the actuator. Either way, the caller's
    // `|| true` is unambiguous intent: this command's result should never surface as an unresolved build
    // problem. Root-caused 2026-07-01 (previously only theorized) — confirmed via the E2B SDK/daemon,
    // not a NavBharatAI bug; see PROGRESS.md.
    const guarded = /\|\|\s*true\s*(?:;)?\s*$/.test(rec.command.trimEnd());
    const failed = !guarded && rec.exitCode !== 0 && rec.exitCode !== null;
    const cmdHead = rec.command.split('\n')[0].slice(0, 120);
    const durTxt = rec.durationMs != null ? ` (${Math.round(rec.durationMs / 1000)}s)` : '';
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
        if (/\b(error|failed|cannot|could not|not responding|isn'?t available|unavailable|retry|retrying|stuck|timed out|blocked request|closed port|won'?t come up|no files|warning)\b/i.test(t)) {
          this.record({ phase: 'build', severity: /\b(error|failed|cannot|could not|unavailable|timed out)\b/i.test(t) ? 'error' : 'warning', code: 'AGENT_NOTE', message: t.slice(0, 400), autoResolved: true });
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
    for (const issue of this.issues) {
      if ((issue.code === 'TOOL_ERROR' || issue.code === 'NO_BUILD_NUDGE' || issue.code === 'EMPTY_BUILD_RETRY') && ok) {
        issue.autoResolved = true;
      }
    }
    this.notify();
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

  report(): BuildDiagnosticsReport {
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    const warnings = this.issues.filter((i) => i.severity === 'warning').length;
    const autoResolved = this.issues.filter((i) => i.autoResolved).length;
    return {
      schema: 'navbharatai.v3.build-diagnostics/1',
      sessionId: this.meta.sessionId,
      workspaceId: this.meta.workspaceId,
      prompt: this.meta.prompt,
      model: this.meta.model,
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
        unresolved: this.issues.filter((i) => !i.autoResolved).length,
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
      review: this.reviewText,
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
  const problem = issues.find((i) => i.severity !== 'info' && !i.autoResolved)
    ?? issues.find((i) => i.severity === 'error')
    ?? issues.find((i) => i.severity !== 'info');
  if (problem) return problem.message;
  if (ok === true) return 'Build completed successfully with no problems recorded.';
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

/** Render a report as a human/Claude-readable plain-text document (for the .txt download). */
export function renderDiagnosticsText(r: BuildDiagnosticsReport): string {
  const lines: string[] = [];
  lines.push('NavBharatAI Pro v3.0 — Build Diagnostics Report');
  lines.push('='.repeat(52));
  lines.push(`Prompt   : ${r.prompt ?? '(n/a)'}`);
  lines.push(`Framework: ${r.framework ?? '(n/a)'}`);
  lines.push(`Model    : ${r.model ?? '(n/a)'}`);
  // Which provider(s) actually drove the build turns — the real "kaun sa reply kis provider se aaya".
  const deliveredBy = formatProviderDelivery(r.providerDelivery);
  if (deliveredBy) lines.push(`Built by : ${deliveredBy}`);
  lines.push(`Outcome  : ${r.ok === undefined ? '(n/a)' : r.ok ? 'SUCCESS' : 'FAILED'}`);
  if (typeof r.startedAt === 'number' && typeof r.endedAt === 'number') {
    lines.push(`Duration : ${Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000))}s`);
  }
  lines.push(`Issues   : ${r.counts.total} total — ${r.counts.errors} error(s), ${r.counts.warnings} warning(s), ${r.counts.autoResolved} auto-resolved, ${r.counts.unresolved} unresolved`);
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

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
  /** When the issue was recorded (ms). */
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

  constructor(meta: BuildDiagnosticsMeta = {}) {
    this.meta = meta;
    this.now = meta.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  /** Persist the current report in REAL TIME (best-effort; never throws). */
  private notify(): void {
    try { this.meta.onUpdate?.(this.report()); } catch { /* persistence is best-effort */ }
  }

  /** Record an issue/timeline entry. Capped so a runaway build can't grow it without bound. */
  record(issue: Omit<BuildIssue, 'ts'> & { ts?: number }): void {
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
    };
  }
}

/** Render a report as a human/Claude-readable plain-text document (for the .txt download). */
export function renderDiagnosticsText(r: BuildDiagnosticsReport): string {
  const lines: string[] = [];
  lines.push('NavBharatAI Pro v3.0 — Build Diagnostics Report');
  lines.push('='.repeat(52));
  lines.push(`Prompt   : ${r.prompt ?? '(n/a)'}`);
  lines.push(`Framework: ${r.framework ?? '(n/a)'}`);
  lines.push(`Model    : ${r.model ?? '(n/a)'}`);
  lines.push(`Outcome  : ${r.ok === undefined ? '(n/a)' : r.ok ? 'SUCCESS' : 'FAILED'}`);
  if (typeof r.startedAt === 'number' && typeof r.endedAt === 'number') {
    lines.push(`Duration : ${Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000))}s`);
  }
  lines.push(`Issues   : ${r.counts.total} total — ${r.counts.errors} error(s), ${r.counts.warnings} warning(s), ${r.counts.autoResolved} auto-resolved, ${r.counts.unresolved} unresolved`);
  lines.push('');
  if (r.issues.length === 0) {
    lines.push('No issues recorded — the build ran clean. 🎉');
  } else {
    lines.push('Issues (in order):');
    r.issues.forEach((i, n) => {
      lines.push(`${n + 1}. [${i.severity.toUpperCase()}] (${i.phase}/${i.code}) ${i.autoResolved ? 'auto-resolved' : 'UNRESOLVED'}`);
      lines.push(`   ${i.message}`);
      if (i.detail) lines.push(`   ↳ ${i.detail}`);
    });
  }
  return lines.join('\n') + '\n';
}

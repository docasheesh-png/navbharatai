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
}

export class BuildDiagnostics {
  private readonly issues: BuildIssue[] = [];
  private readonly meta: BuildDiagnosticsMeta;
  private readonly now: () => number;
  private readonly startedAt: number;
  private endedAt?: number;
  private ok?: boolean;
  private summary?: string;

  constructor(meta: BuildDiagnosticsMeta = {}) {
    this.meta = meta;
    this.now = meta.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  /** Record an issue explicitly (provider fallback, sandbox timeout, …). */
  record(issue: Omit<BuildIssue, 'ts'> & { ts?: number }): void {
    this.issues.push({ ts: issue.ts ?? this.now(), ...issue });
  }

  /**
   * Derive issues from a live AgentEvent. Safe to call on EVERY event — it only
   * captures the ones that signal a struggle (a failed tool, a not-ready verdict,
   * a hard error) plus a couple of useful info markers (preview, delegation).
   */
  ingestEvent(e: AgentEvent): void {
    switch (e.type) {
      case 'tool_result':
        if (!e.ok) {
          // A failed tool call. Whether it was fatal is decided at finish() from the
          // final build outcome (the agent usually retries and recovers).
          this.record({
            phase: 'tool', severity: 'warning', code: 'TOOL_ERROR',
            message: `Tool call failed: ${e.summary}`.slice(0, 500),
            autoResolved: false, detail: `agent=${e.agent} callId=${e.callId}`,
          });
        }
        break;
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
        break;
      case 'preview':
        this.record({ phase: 'preview', severity: 'info', code: 'PREVIEW_PUBLISHED', message: `Preview published at ${e.url}`, autoResolved: true });
        break;
      default:
        // Other events (narration, todo, etc.) are not diagnostics.
        break;
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
    for (const issue of this.issues) {
      if ((issue.code === 'TOOL_ERROR' || issue.code === 'NO_BUILD_NUDGE' || issue.code === 'EMPTY_BUILD_RETRY') && ok) {
        issue.autoResolved = true;
      }
    }
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

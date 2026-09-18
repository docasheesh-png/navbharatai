/**
 * 🔴 THE "TOP FAILURE PATTERNS" AUTOPSY (admin card, 2026-09-17) — three raw sentences as "patterns".
 *
 *     🔍 I analyzed your project — no files were changed. Overview:                    1 · 25%
 *     The GLM rung answered inside its clock and produced nothing, because our own …  1 · 25%
 *     Tool call failed: edit_file: old_string not found in <file>. The string you …    1 · 25%
 *
 * Each row was one EMPTY BUILD's root cause — and none of the three sentences was the reason. The
 * empty-build verdict flip (`emptyBuildFailureSummary`) was the ONLY flip in the route that recorded
 * no `OUTCOME_*` code, so `deriveRootCause` had no fact to read and named the loudest recorded
 * warning: the model's own recap, a provider diagnostic, a tool miss. This file pins all three halves
 * of the fix: the flip records its outcome; the recap is never a "problem"; the filed report carries
 * the code to the card.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyBuildOutcomeIssue } from '../src/server/routes/agentv3';
import { BuildDiagnostics, deriveRootCause, type BuildIssue } from '../src/server/AgentV3/BuildDiagnostics';
import { buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';
import { ANALYSIS_ONLY_HEADLINE, isProjectSummaryNarration, summarizeProject } from '../src/server/AgentV3/ProjectSummary';
import { classifyFailureReason } from '../src/lib/failureReason';
import type { AgentEvent } from '../src/server/AgentV3/types';

const RECAP = `${ANALYSIS_ONLY_HEADLINE}\nStack: React + Vite\n3 files`;
const STARVED = 'The GLM rung answered inside its clock and produced nothing, because our own output ceiling was spent before the answer began — "starved". This is NOT a provider outage';
const TOOL_MISS = 'Tool call failed: edit_file: old_string not found in src/App.tsx. The string you supplied does not appear in the file.';

/** The three "patterns", as the issue list of one empty build really carried them. */
const NOISE: BuildIssue[] = [
  { ts: 1, phase: 'build', severity: 'warning', code: 'AGENT_NOTE', message: RECAP, autoResolved: true },
  { ts: 2, phase: 'provider', severity: 'warning', code: 'OUTPUT_BUDGET_STARVED', message: STARVED, autoResolved: false },
  { ts: 3, phase: 'tool', severity: 'warning', code: 'TOOL_ERROR', message: TOOL_MISS, autoResolved: false },
];

describe('the empty-build flip records its own machine fact', () => {
  it('THE BUG, reproduced: with no outcome recorded, the loudest warning became the root cause', () => {
    const cause = deriveRootCause({ issues: NOISE, ok: false });
    // Not asserting WHICH noise wins — only that a sentence that is not the reason was named as it.
    expect([STARVED, TOOL_MISS, RECAP]).toContain(cause);
  });

  it('with the outcome recorded, the root cause is the fact, not the noise', () => {
    const issues = [...NOISE, { ts: 4, ...emptyBuildOutcomeIssue(false) }];
    expect(deriveRootCause({ issues, ok: false })).toMatch(/^Build outcome: EMPTY/);
    const infra = [...NOISE, { ts: 4, ...emptyBuildOutcomeIssue(true) }];
    expect(deriveRootCause({ issues: infra, ok: false })).toMatch(/^Build outcome: SANDBOX_UNAVAILABLE/);
  });

  it('two causes, two codes — infrastructure is never filed as the engine\'s empty build', () => {
    expect(emptyBuildOutcomeIssue(false).code).toBe('OUTCOME_EMPTY_BUILD');
    expect(emptyBuildOutcomeIssue(true).code).toBe('OUTCOME_SANDBOX_UNAVAILABLE');
    for (const sandboxDown of [true, false]) {
      const i = emptyBuildOutcomeIssue(sandboxDown);
      expect(i.severity).toBe('error');
      expect(i.autoResolved).toBe(false);
      expect(i.phase).toBe('build');
    }
  });

  it('both codes are named by the shared classifier, so the card shows a stable label', () => {
    expect(classifyFailureReason('anything', 'OUTCOME_EMPTY_BUILD', 'error').key).toBe('empty-build');
    expect(classifyFailureReason('anything', 'OUTCOME_SANDBOX_UNAVAILABLE', 'error').key).toBe('sandbox-unavailable');
  });

  it('🔒 the route records it AT the flip, before the verdict changes', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const at = src.indexOf('buildDiag.record(emptyBuildOutcomeIssue(sandboxUnavailable))');
    expect(at, 'the flip does not record its outcome').toBeGreaterThan(-1);
    const flip = src.indexOf('result = { ...result, ok: false, summary: emptyFail };');
    expect(flip).toBeGreaterThan(at);
    expect(flip - at).toBeLessThan(600);
  });
});

describe('the project recap is a deliverable, never a "problem" note', () => {
  const fresh = () => { let t = 0; return new BuildDiagnostics({ now: () => (t += 10) }); };

  it('THE BUG, reproduced on the predicate: the recap starts with a problem word', () => {
    expect(isProjectSummaryNarration(RECAP)).toBe(true);
    expect(isProjectSummaryNarration("✅ Here's what I built:\nStack: Vite")).toBe(true);
    expect(isProjectSummaryNarration('✅ Done — I changed 2 files in your project (a.ts, b.ts). Overview:')).toBe(true);
    // A model's own sentence that merely resembles it is NOT exempt.
    expect(isProjectSummaryNarration('I analyzed your project — no files were changed, sorry.')).toBe(false);
    expect(isProjectSummaryNarration('')).toBe(false);
  });

  it('a short recap is recorded as a STEP (info), while a genuine "no files" struggle stays a NOTE', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: RECAP, ts: 1 } as AgentEvent);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'The build produced no files — retrying.', ts: 2 } as AgentEvent);
    const r = d.report();
    const recap = r.issues.find((i) => i.message.startsWith('🔍'));
    expect(recap?.code).toBe('AGENT_STEP');
    expect(recap?.severity).toBe('info');
    const struggle = r.issues.find((i) => i.message.includes('retrying'));
    expect(struggle?.code).toBe('AGENT_NOTE');
  });

  it('the real recap the engine emits is the one the predicate recognises (no drift between the two)', () => {
    const graph = { files: ['src/App.tsx'], symbols: [], components: [], routes: [], imports: {}, dependencies: [] } as never;
    const text = summarizeProject(graph, 'check it', { previewLive: false, changedFiles: 0 });
    expect(text.split('\n')[0]).toBe(ANALYSIS_ONLY_HEADLINE);
    expect(isProjectSummaryNarration(text)).toBe(true);
  });
});

describe('the filed report carries the code to the card', () => {
  const ctx = { reportedAt: 1786030906044, userId: 'u1', email: 'a@b.c', name: null, workspaceId: 'ws', buildId: 'b1' };
  const base = { schema: 'navbharatai.v3.build-diagnostics/1', buildId: 'b1', prompt: 'build a shop', startedAt: 1, endedAt: 2, counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 }, problems: [] };

  it('meta.outcomeCode / outcomeSeverity are the LAST outcome the build recorded', () => {
    const rec = buildAdminReportRecord({ ...base, ok: false, rootCause: 'x', issues: [...NOISE, { ts: 4, ...emptyBuildOutcomeIssue(false) }] } as never, ctx);
    expect(rec.meta.outcomeCode).toBe('OUTCOME_EMPTY_BUILD');
    expect(rec.meta.outcomeSeverity).toBe('error');
  });

  it('a report with no outcome carries null, never an invented code', () => {
    const rec = buildAdminReportRecord({ ...base, ok: false, rootCause: TOOL_MISS, issues: NOISE } as never, ctx);
    expect(rec.meta.outcomeCode).toBeNull();
    expect(rec.meta.outcomeSeverity).toBeNull();
  });
});

/**
 * A report's problem projection must agree with its measured-finding tallies. Synthetic regression,
 * not a reconstruction of the unavailable group358 report. Raw narration remains forensic evidence.
 */
import { describe, expect, it, vi } from 'vitest';

// The projection needs none of the request planner's broad graph or the store's persistence ports.
// Fully replace them before loading the real recorder/store; never importActual through those ports.
vi.mock('../src/server/AgentV3/RequestAnalyser', () => ({ startBandLabel: () => 'test band' }));
vi.mock('firebase-admin', () => ({ apps: [], initializeApp: () => { throw new Error('No persistence in projection tests'); } }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => { throw new Error('No database in projection tests'); } }));
vi.mock('../src/server/lib/audit', () => ({ audit: () => { throw new Error('No audit I/O in projection tests'); }, truncateForAudit: (s: string) => s }));

import {
  BuildDiagnostics, capProblems, deriveRootCause, isReportProblem, renderDiagnosticsText,
  reportProblems, type BuildDiagnosticsReport, type BuildIssue,
} from '../src/server/AgentV3/BuildDiagnostics';
import { compactReportForRecord, dropHeavyChannelsForStorage, trimReportForStorage } from '../src/server/AgentV3/DiagnosticsStore';
import { buildLessonFromDiagnostics } from '../src/server/AgentV3/BuildLessons';
import { buildHealthFromDiagnostics } from '../src/server/AgentV3/buildHealthCard';

const issue = (code: string, severity: BuildIssue['severity'], ts: number, autoResolved = true): BuildIssue => ({
  ts, code, severity, phase: 'build', autoResolved, message: `${code} synthetic evidence ${ts}`,
});
const mixed = (): BuildIssue[] => [
  issue('AGENT_NOTE', 'error', 1),
  issue('BUILD_ERROR', 'error', 2, false),
  issue('AGENT_NOTE', 'warning', 3),
  issue('SYNTAX_HEALED', 'warning', 4),
  issue('AGENT_STEP', 'error', 5), // future/legacy loud narration follows the same code-based rule
  { ...issue('PROVIDER_FALLBACK', 'warning', 6), phase: 'provider' },
  { ...issue('EXISTING_CODE_OBSERVATION', 'warning', 7), observation: true },
  issue('HEARTBEAT', 'info', 8),
  issue('FUTURE_MEASURED_FAILURE', 'error', 9),
];
const eligible = (items: readonly BuildIssue[]) => items.filter((i) => i.severity !== 'info' && i.code !== 'AGENT_NOTE' && i.code !== 'AGENT_STEP');
const base = (issues: BuildIssue[], extra: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport => ({
  schema: 'navbharatai.v3.build-diagnostics/1', startedAt: 1,
  counts: { total: issues.length, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
  issues, problems: issues.filter((i) => i.severity !== 'info'), ...extra,
});
const stores = [
  ['normal storage', trimReportForStorage],
  ['last-resort storage', dropHeavyChannelsForStorage],
  ['embedded record', compactReportForRecord],
] as const;

describe('narration is retained, not promoted into measured problems', () => {
  it('the live recorder preserves raw order/severity while retaining every measured kind', () => {
    let t = 0;
    const d = new BuildDiagnostics({ now: () => ++t });
    for (const { ts: _ts, ...entry } of mixed()) d.record(entry);
    const before = d.report();
    const raw = structuredClone(before.issues);
    const after = d.report();
    expect(after.issues).toEqual(raw);
    expect(after.issues.map((i) => [i.code, i.severity])).toEqual(mixed().map((i) => [i.code, i.severity]));
    expect(after.problems).toEqual(eligible(raw));
    expect(after.counts).toEqual(before.counts);
    expect(after.counts.errors).toBe(2);
    expect(after.counts.warnings).toBe(3);
    expect(after.counts.autoResolved).toBe(2);
    expect(after.ok).toBeUndefined();
  });

  it('filters before capping and preserves measured recovered findings, unknown codes and order', () => {
    const findings = Array.from({ length: 350 }, (_, n) => issue('MEASURED', 'error', n));
    const notes = Array.from({ length: 400 }, (_, n) => issue('AGENT_NOTE', 'error', 350 + n));
    const all = [...findings, ...notes];
    const before = structuredClone(all);
    expect(reportProblems(all)).toEqual(findings.slice(50));
    expect(reportProblems(all)[0]).toBe(findings[50]);
    expect(all).toEqual(before);
    expect(isReportProblem(issue('NEW_CODE', 'warning', 0))).toBe(true);
    expect(isReportProblem(issue('AGENT_STEP', 'warning', 0))).toBe(false);
    expect(isReportProblem(issue('MEASURED', 'info', 0))).toBe(false);
    // A size-only cap remains size-only; eligibility is not smuggled into a utility's old contract.
    expect(capProblems(notes)).toEqual(notes.slice(100));
  });

  for (const [name, project] of stores) {
    it(`${name} uses the same projection without changing retained raw evidence`, () => {
      const input = base(mixed(), { ok: false, rootCause: 'Recorded failure', summary: 'Not finished' });
      const before = structuredClone(input);
      const output = project(input);
      expect(output.issues).toEqual(input.issues);
      expect(output.problems).toEqual(eligible(input.issues));
      expect(output.counts).toEqual(input.counts);
      expect(output.ok).toBe(false);
      expect(output.rootCause).toBe(input.rootCause);
      expect(input).toEqual(before);
    });

    it(`${name} derives only from its retained window and keeps original order`, () => {
      const raw = Array.from({ length: 640 }, (_, n) => issue(n % 3 === 0 ? 'AGENT_NOTE' : 'MEASURED', 'error', n));
      const output = project(base(raw));
      expect(output.problems).toEqual(eligible(output.issues).slice(-300));
      expect(output.issues.every((i) => raw.some((original) => JSON.stringify(original) === JSON.stringify(i)))).toBe(true);
      expect(output.issues.map((i) => i.ts)).toEqual(output.issues.map((i) => i.ts).sort((a, b) => a - b));
      expect(output.truncation?.complete).toBe(false);
    });
  }

  it('normal and embedded storage still redact both raw evidence and its projection', () => {
    const secret = 'synthetic-not-a-real-key-1234567890';
    const entry = { ...issue('MEASURED', 'error', 1), message: `API_KEY=${secret}` };
    for (const project of [trimReportForStorage, compactReportForRecord]) {
      const output = project(base([entry]));
      expect(output.issues[0].message).not.toContain(secret);
      expect(output.problems).toEqual(output.issues);
    }
  });
});

describe('the text view neither expands history nor invents success', () => {
  it('honors a supplied historical problems window instead of rebuilding it from issues', () => {
    const note = issue('AGENT_NOTE', 'error', 1);
    const omitted = issue('OUTSIDE_SUPPLIED_WINDOW', 'error', 2);
    const retained = issue('RETAINED_MEASUREMENT', 'warning', 3);
    const input = base([note, omitted, retained], { problems: [note, retained] });
    const before = structuredClone(input);
    const text = renderDiagnosticsText(input);
    expect(text).toContain('RETAINED_MEASUREMENT');
    expect(text).not.toContain('OUTSIDE_SUPPLIED_WINDOW');
    expect(text).not.toContain('AGENT_NOTE');
    expect(text).toContain('+2 other timeline entries');
    expect(text).not.toContain('informational timeline entries');
    expect(input).toEqual(before);
  });

  it('does not call cap-omitted measured findings informational', () => {
    const findings = Array.from({ length: 350 }, (_, n) => issue('MEASURED', 'error', n));
    const text = renderDiagnosticsText(base(findings));
    expect(text).toContain('Problems (300,');
    expect(text).toContain('+50 other timeline entries');
    expect(text).not.toContain('informational timeline entries');
    expect(text).not.toContain('MEASURED synthetic evidence 49\n');
    expect(text).toContain('MEASURED synthetic evidence 349');
  });

  it('uses the same rule when a legacy report has no problems field', () => {
    const input = base(mixed());
    delete (input as Partial<BuildDiagnosticsReport>).problems;
    const text = renderDiagnosticsText(input);
    expect(text).toContain('Problems (5,');
    expect(text).toContain('FUTURE_MEASURED_FAILURE');
    expect(text).not.toContain('AGENT_NOTE');
    expect(text).not.toContain('AGENT_STEP');
    expect(text).toContain('+1 informational timeline entries');
    expect(text).toContain('+3 other timeline entries');
  });

  for (const ok of [false, undefined, true]) {
    it(`an empty supplied projection does not manufacture success (ok=${String(ok)})`, () => {
      const text = renderDiagnosticsText(base([issue('AGENT_NOTE', 'error', 1)], { problems: [], ok }));
      expect(text).toContain(`Outcome  : ${ok === undefined ? '(n/a)' : ok ? 'SUCCESS' : 'FAILED'}`);
      expect(text).toContain('No problems recorded in this view. This does not establish whether the build succeeded.');
      expect(text).not.toContain('ran clean');
      if (ok !== true) expect(text).not.toContain('SUCCESS');
    });
  }

  it('a successful-root summary names measured recovered findings, not the narration excluded from the view', () => {
    const notes = [issue('AGENT_NOTE', 'error', 1)];
    const recovered = issue('SYNTAX_HEALED', 'warning', 2);
    const text = deriveRootCause({ issues: [...notes, recovered], ok: true });
    expect(text).toContain('1 problem(s)');
    expect(text).toContain('SYNTAX_HEALED');
    expect(text).not.toContain('AGENT_NOTE');
    expect(deriveRootCause({ issues: notes, ok: true })).toBe('Build completed successfully with no problems recorded.');
  });
});

describe('downstream live consumers retain outcome and measured evidence', () => {
  it('the production lesson-input shape retains a recovered failure without learning narration as another problem', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.record({ phase: 'build', code: 'AGENT_NOTE', severity: 'error', autoResolved: true, message: 'Synthetic scope narration cannot provide a native integration.' });
    d.record({ phase: 'autofix', code: 'SYNTAX_HEALED', severity: 'warning', autoResolved: true, message: 'Synthetic measured syntax failure repaired.' });
    d.finish(true);
    const diag = d.report();
    const lesson = buildLessonFromDiagnostics({ ok: diag.ok, rootCause: diag.rootCause, problems: diag.problems });
    expect(lesson).toContain('Synthetic measured syntax failure repaired.');
    expect(lesson).not.toContain('Synthetic scope narration');
    expect(lesson).not.toContain('AGENT_NOTE');
    // Its existing 'unresolved' wording for recovered findings is a separate, explicitly unfixed issue.
  });

  it('no problems cannot turn a failed or unproven build into verified success', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.record({ phase: 'build', code: 'AGENT_NOTE', severity: 'error', autoResolved: true, message: 'Synthetic scope narration cannot provide a native integration.' });
    d.finish(false);
    const report = d.report();
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(false);
    expect(buildHealthFromDiagnostics(report, false).ready).toBe(false);
    expect(buildHealthFromDiagnostics(report, false).provenRunning).toBe(false);
    const unproven = buildHealthFromDiagnostics({ ...report, ok: true }, true);
    expect(unproven.provenRunning).toBe(false);
    expect(unproven.score).toBeLessThan(100);
  });
});

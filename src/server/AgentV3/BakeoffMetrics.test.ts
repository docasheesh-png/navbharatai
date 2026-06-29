import { describe, it, expect } from 'vitest';
import { parseNdjson, metricsFromEvents, aggregate, formatReport, type BuildMetrics } from './BakeoffMetrics';

describe('parseNdjson', () => {
  it('parses JSON lines and skips blanks / non-JSON (e.g. an HTML error page)', () => {
    const text = '{"type":"a"}\n\n<!DOCTYPE html>\n{"type":"b","x":1}\n';
    expect(parseNdjson(text)).toEqual([{ type: 'a' }, { type: 'b', x: 1 }]);
  });
  it('returns [] for empty input', () => {
    expect(parseNdjson('')).toEqual([]);
  });
});

describe('metricsFromEvents — objective build outcome', () => {
  it('counts DISTINCT files written and reads result/done fields', () => {
    const events = [
      { type: 'file_changed', change: { path: 'src/App.tsx', kind: 'create' } },
      { type: 'file_changed', change: { path: 'src/App.tsx', kind: 'modify' } }, // same path → not double-counted
      { type: 'file_changed', change: { path: 'index.html', kind: 'create' } },
      { type: 'done', ok: true, readiness: { score: 82 } },
      { type: 'result', ok: true, billedUsd: 0.5, diagnostics: { issues: [
        { code: 'TOOL_CALL' }, { code: 'TOOL_CALL' }, { code: 'TOOL_ERROR' }, { code: 'PROVIDER_FALLBACK' },
      ] } },
    ];
    const m = metricsFromEvents(events);
    expect(m.filesCreated).toBe(2);
    expect(m.ok).toBe(true);
    expect(m.readinessScore).toBe(82);
    expect(m.billedUsd).toBe(0.5);
    expect(m.toolCalls).toBe(2);
    expect(m.toolErrors).toBe(1);
    expect(m.providerFallbacks).toBe(1);
    expect(m.geminiTrap).toBe(false);
  });

  it('flags the GEMINI TRAP: build "ok" but ZERO files written', () => {
    const events = [
      { type: 'narration', text: 'creating index.html…' }, // described but never wrote
      { type: 'result', ok: true, billedUsd: 0.1 },
    ];
    const m = metricsFromEvents(events);
    expect(m.filesCreated).toBe(0);
    expect(m.geminiTrap).toBe(true);
  });

  it('records an error event', () => {
    const m = metricsFromEvents([{ type: 'error', message: 'boom' }]);
    expect(m.errored).toBe(true);
    expect(m.ok).toBe(false);
    expect(m.geminiTrap).toBe(false); // not ok → not the trap
  });
});

describe('aggregate + formatReport', () => {
  const mk = (over: Partial<BuildMetrics>): BuildMetrics => ({
    filesCreated: 5, ok: true, readinessScore: 80, billedUsd: 0.4, toolCalls: 10, toolErrors: 0,
    providerFallbacks: 0, geminiTrap: false, errored: false, ...over,
  });

  it('computes pass rates, averages and tool-call success', () => {
    const a = aggregate('GLM', [mk({}), mk({ ok: false, readinessScore: 40, toolErrors: 2 }), mk({ filesCreated: 0, geminiTrap: true })]);
    expect(a.runs).toBe(3);
    expect(a.filesPassRate).toBeCloseTo(2 / 3);
    expect(a.buildPassRate).toBeCloseTo(2 / 3);
    expect(a.geminiTrapRate).toBeCloseTo(1 / 3);
    expect(a.toolCallSuccessRate).toBeCloseTo((30 - 2) / 30); // 30 calls, 2 errors
  });

  it('verdict DISQUALIFIES a model with any Gemini-trap; passes a clean one', () => {
    const trap = formatReport([aggregate('KIMI', [mk({ filesCreated: 0, geminiTrap: true })])]);
    expect(trap).toContain('DISQUALIFIED');
    const good = formatReport([aggregate('GLM', [mk({}), mk({}), mk({}), mk({}), mk({}), mk({}), mk({}), mk({}), mk({}), mk({})])]);
    expect(good).toContain('Viable floor candidate');
  });
});

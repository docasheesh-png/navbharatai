import { describe, it, expect } from 'vitest';
import { QualityMonitor, handoffNote, qualityThresholds } from './qualityEscalation';

const T = { truncations: 2, editFails: 3, tscStalls: 3, maxEscalations: 2 };
const base = { truncated: false, editFailures: 0, editSuccesses: 0, tscErrors: null };

describe('QualityMonitor', () => {
  it('defaults match the solutions doc', () => {
    expect(qualityThresholds({})).toEqual(T);
  });

  it('truncation ×2 escalates', () => {
    const m = new QualityMonitor(T);
    expect(m.observe({ ...base, truncated: true }).escalate).toBe(false);
    expect(m.observe({ ...base, truncated: true })).toMatchObject({ escalate: true });
  });

  it('edit fail ×3 (consecutive) escalates; a clean edit resets the streak', () => {
    const m = new QualityMonitor(T);
    m.observe({ ...base, editFailures: 2 });
    m.observe({ ...base, editSuccesses: 1 });
    expect(m.observe({ ...base, editFailures: 2 }).escalate).toBe(false);
    expect(m.observe({ ...base, editFailures: 1 }).escalate).toBe(true);
  });

  it('tsc errors that do not drop escalate; dropping errors do not', () => {
    const falling = new QualityMonitor(T);
    for (const n of [9, 7, 5, 3, 1]) expect(falling.observe({ ...base, tscErrors: n }).escalate).toBe(false);
    const stuck = new QualityMonitor(T);
    stuck.observe({ ...base, tscErrors: 5 });
    stuck.observe({ ...base, tscErrors: 6 });
    expect(stuck.observe({ ...base, tscErrors: 5 }).escalate).toBe(true);
  });

  it('acknowledge resets and the per-build cap holds', () => {
    const m = new QualityMonitor({ ...T, maxEscalations: 1 });
    m.observe({ ...base, truncated: true });
    expect(m.observe({ ...base, truncated: true }).escalate).toBe(true);
    m.acknowledge(true);
    m.observe({ ...base, truncated: true });
    expect(m.observe({ ...base, truncated: true }).escalate).toBe(false);
  });
});

describe('handoffNote', () => {
  it('names the reason, the models and the files, and says read before edit', () => {
    const n = handoffNote({ fromModel: 'glm-4.7-flashx', toModel: 'kimi-k2.7-code', reason: 'x', touchedFiles: ['src/App.tsx'], tscErrors: 4 });
    expect(n).toContain('glm-4.7-flashx');
    expect(n).toContain('kimi-k2.7-code');
    expect(n).toContain('src/App.tsx');
    expect(n).toContain('4 error');
    expect(n).toMatch(/read_file/);
  });
});

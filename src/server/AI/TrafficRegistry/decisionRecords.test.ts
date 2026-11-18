/**
 * Traffic Manager V2, P4 — owner decision 4 (30-day logs, 10% of successes, 100% of failures, no content) and
 * improvement #4 (the SLO comes from complete counters, never from sampled records, with honest denominators).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __decisionBufferForTests, __resetDecisionSinkForTests, buildRecord, computeSlo, countOutcome, flushCounters, flushDecisions,
  isEligible, MAX_BUFFER, MAX_RECORDS_PER_FLUSH, RECORD_FIELDS, recordDecision, sampledSuccess, wilson95, type DecisionStore,
} from './decisionRecords';
import { observeChatOutcome } from '../chatOutcomeObservation';

const NOW = Date.parse('2026-11-18T10:00:00Z');
afterEach(() => { __resetDecisionSinkForTests(); vi.unstubAllEnvs(); });

function memoryStore() {
  const counters = new Map<string, any>(); const records: any[] = [];
  const store: DecisionStore = {
    writeRecords: async (r) => { records.push(...r); },
    writeCounter: async (id, v) => { counters.set(id, v); },
    readCounters: async (since) => [...counters.values()].filter(c => c.day >= since),
    readRecentFailures: async (limit) => records.filter(r => r.outcome !== 'complete').slice(0, limit),
  };
  return { store, counters, records };
}

describe('sampling: 10% of successes, every failure and critical event', () => {
  it('successes are sampled deterministically near 10%; failures always kept with weight 1', () => {
    let kept = 0;
    for (let i = 0; i < 5000; i++) if (buildRecord({ surface: 'free', path: 'legacy', outcome: 'complete', id: `r${i}`, atMs: NOW })) kept++;
    expect(kept / 5000).toBeGreaterThan(0.08); expect(kept / 5000).toBeLessThan(0.12);
    expect(sampledSuccess('same')).toBe(sampledSuccess('same'));
    for (const outcome of ['failed', 'partial', 'refused', 'cancelled'] as const) {
      expect(buildRecord({ surface: 'free', path: 'legacy', outcome, id: 'x', atMs: NOW })).toMatchObject({ weight: 1, sampled: false });
    }
    expect(buildRecord({ surface: 'free', path: 'gateway', outcome: 'complete', critical: true, id: 'not-in-sample?', atMs: NOW })).toMatchObject({ weight: 1, critical: true });
  });
  it('a sampled success carries weight 10, so weighted sums estimate totals', () => {
    const id = [...Array(200).keys()].map(i => `w${i}`).find(sampledSuccess)!;
    expect(buildRecord({ surface: 'free', path: 'legacy', outcome: 'complete', id, atMs: NOW })).toMatchObject({ weight: 10, sampled: true });
  });
});

describe('no content: a record is the fixed field list and nothing else', () => {
  it('only RECORD_FIELDS; prompt-like or key-like inputs are reduced to safe labels', () => {
    const r = buildRecord({ surface: 'free', path: 'legacy', outcome: 'failed', failure: 'unknown', provider: 'GLM <script>sk-SECRET', model: 'glm-5.3',
      latencyMs: 812, usage: { inputTokens: 120, outputTokens: 40 }, attempts: [{ provider: 'glm47', reason: 'quota', entered: true }], atMs: NOW, id: 'abc' })!;
    expect(Object.keys(r).sort()).toEqual([...RECORD_FIELDS].sort());
    expect(JSON.stringify(r)).not.toMatch(/<script>| /);
    expect(r.id).toHaveLength(16); // hashed, never the raw request id
  });
});

describe('the SLO is computed from complete counters, never from sampled records', () => {
  it('every outcome is counted; eligible excludes refusals and cancels; Wilson interval and target are reported', async () => {
    const m = memoryStore();
    for (let i = 0; i < 995; i++) countOutcome('free', 'complete', NOW);
    for (let i = 0; i < 4; i++) countOutcome('free', 'failed', NOW);
    countOutcome('free', 'partial', NOW); countOutcome('free', 'refused', NOW); countOutcome('free', 'cancelled', NOW);
    await flushCounters(m.store, NOW);
    const [row] = await computeSlo(m.store, 7, NOW);
    expect(row).toMatchObject({ surface: 'free', eligible: 1000, successes: 995, refused: 1, cancelled: 1, target: 0.995 });
    expect(row.rate).toBeCloseTo(0.995, 6);
    expect(row.ci95!.low).toBeLessThan(0.995); expect(row.ci95!.high).toBeGreaterThan(0.995);
    expect(isEligible('refused')).toBe(false); expect(isEligible('partial')).toBe(true);
  });
  it('counters are absolute per instance, so re-flushing never double-counts; two instances sum', async () => {
    const m = memoryStore();
    countOutcome('free', 'complete', NOW);
    await flushCounters(m.store, NOW); countOutcome('free', 'complete', NOW); await flushCounters(m.store, NOW); await flushCounters(m.store, NOW);
    m.counters.set('2026-11-18_free_other', { day: '2026-11-18', surface: 'free', counts: { complete: 3, partial: 0, refused: 0, cancelled: 0, failed: 1 } });
    const [row] = await computeSlo(m.store, 7, NOW);
    expect(row).toMatchObject({ eligible: 6, successes: 5 });
  });
  it('a sampled-out success still counts in the SLO', async () => {
    const m = memoryStore();
    const id = [...Array(200).keys()].map(i => `s${i}`).find(x => !sampledSuccess(x))!;
    recordDecision({ surface: 'free', path: 'legacy', outcome: 'complete', id, atMs: NOW });
    expect(__decisionBufferForTests()).toHaveLength(0);
    await flushCounters(m.store, NOW);
    expect((await computeSlo(m.store, 7, NOW))[0]).toMatchObject({ eligible: 1, successes: 1 });
  });
  it('wilson95 is bounded and honest for tiny n', () => {
    expect(wilson95(0, 0)).toBeNull();
    const w = wilson95(3, 3)!; expect(w.high).toBe(1); expect(w.low).toBeLessThan(0.5);
  });
});

describe('bounded and never in the way', () => {
  it('at most 200 records per flush; the buffer is capped and a failed write keeps the records', async () => {
    for (let i = 0; i < MAX_BUFFER + 50; i++) recordDecision({ surface: 'free', path: 'legacy', outcome: 'failed', id: `f${i}`, atMs: NOW });
    expect(__decisionBufferForTests()).toHaveLength(MAX_BUFFER);
    const failing: DecisionStore = { ...memoryStore().store, writeRecords: async () => { throw new Error('down'); } };
    expect(await flushDecisions(failing)).toBe(0);
    const m = memoryStore();
    expect(await flushDecisions(m.store)).toBe(MAX_RECORDS_PER_FLUSH);
  });
  it('ROUTING_DECISIONS=off records and counts nothing', () => {
    vi.stubEnv('ROUTING_DECISIONS', 'off');
    recordDecision({ surface: 'free', path: 'legacy', outcome: 'failed', atMs: NOW });
    expect(__decisionBufferForTests()).toHaveLength(0);
  });
  it('the chat boundary records the outcome and its path, and returns the result unchanged', async () => {
    const result = { ok: false, reason: 'no-provider', content: '', provider: 'NONE', model: 'none', latencyMs: 0 };
    expect(await observeChatOutcome('free', undefined, async () => result, undefined, () => 'gateway')).toBe(result);
    expect(__decisionBufferForTests()[0]).toMatchObject({ surface: 'free', path: 'gateway', outcome: 'failed', failure: 'unavailable', critical: true });
  });
  it('a thrown error is recorded and still thrown', async () => {
    await expect(observeChatOutcome('professional', undefined, async () => { throw Object.assign(new Error('x'), { status: 503 }); })).rejects.toThrow('x');
    expect(__decisionBufferForTests()[0]).toMatchObject({ surface: 'professional', outcome: 'failed', failure: 'upstream', path: 'legacy' });
  });
});

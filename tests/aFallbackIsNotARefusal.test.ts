/**
 * 🔴 ADMIN MONITOR CAPTURE, 2026-09-18 — the board said **AI load: 50% refused**, in red, under the
 * words *"Engines are refusing requests."* Nobody had been refused.
 *
 * `recordProviderLatency` is called once per ATTEMPT, and the router's whole design is to walk down a
 * ladder: the free leader is rate-limited, the next rung answers, the user gets their reply. That is
 * one success and one error on the per-provider counters, which is exactly 50%. The number rose when
 * the fallback was doing its job.
 *
 * Two independent halves, because either alone still misleads:
 *   1. Count per REQUEST ("did this person get an answer?"), not per attempt.
 *   2. Refuse to grade a rate with no sample behind it. The counters reset on every deploy, so minutes
 *      after a release the whole figure can rest on two requests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBoard, AI_MIN_SAMPLE } from '../src/server/lib/loadBoard';
import { recordRouterOutcome, getRouterOutcomeStats, _resetRouterOutcomes } from '../src/server/AI/Router/AIRouter';

const aiTile = (r: Parameters<typeof loadBoard>[0]) => {
  const tile = loadBoard(r).find((t) => t.id === 'ai');
  expect(tile, 'no ai tile').toBeTruthy();
  return tile!;
};

describe('the counter answers "did the user get an answer?"', () => {
  beforeEach(() => _resetRouterOutcomes());

  it('a request served by a FALLBACK rung is a success, not half a refusal', () => {
    // The capture's exact situation: the leader failed, the next rung answered. One request, answered.
    recordRouterOutcome(true);
    expect(getRouterOutcomeStats()).toEqual({ requests: 1, failed: 0 });
  });

  it('only a request that NO engine answered counts against us', () => {
    recordRouterOutcome(true);
    recordRouterOutcome(true);
    recordRouterOutcome(false);
    expect(getRouterOutcomeStats()).toEqual({ requests: 3, failed: 1 });
  });

  it('🔒 the router records an outcome at every one of its endings', () => {
    // Five places construct the router's telemetry: three successes and two all-failed returns. A
    // success path that forgot to record would quietly inflate the failure rate; a failure path that
    // forgot would hide a real outage. Pinned because no behavioural test here can see a missing one.
    const src = readFileSync(resolve(__dirname, '../src/server/AI/Router/AIRouter.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect((code.match(/recordRouterOutcome\(true\)/g) ?? [])).toHaveLength(3);
    expect((code.match(/recordRouterOutcome\(false\)/g) ?? [])).toHaveLength(2);
  });

  it('🔒 the per-provider accumulator is untouched — it answers a different question', () => {
    // "Which vendor is flaky" is still worth knowing, and the observability route still asks it. The
    // fix was that the admin board stopped asking it the wrong question.
    const src = readFileSync(resolve(__dirname, '../src/server/AI/Router/AIRouter.ts'), 'utf8');
    expect(src).toContain('export function recordProviderLatency');
    expect(src).toContain('export function getProviderStats');
  });
});

describe('🔒 a rate with no sample is not a measurement', () => {
  it(`below ${AI_MIN_SAMPLE} requests the tile says unknown and explains why`, () => {
    const tile = aiTile({ providerErrorRate: 0.5, providerRequests: 2 });
    expect(tile.level).toBe('unknown');
    expect(tile.display).toBe('unknown');
    expect(tile.note).toContain('Too few requests');
    expect(tile.note).toContain('resets on every deploy');
    // REVERSION GUARD: the red alarm the capture showed, on a sample of two.
    expect(tile.note).not.toContain('Engines are refusing requests');
  });

  it('at a real sample it grades normally', () => {
    const tile = aiTile({ providerErrorRate: 0.5, providerRequests: 40 });
    expect(tile.level).toBe('critical');
    expect(tile.display).toBe('50% unanswered');
    expect(tile.note).toContain('no answer from ANY engine');
  });

  it('a healthy platform says a fallback still counts as answered', () => {
    const tile = aiTile({ providerErrorRate: 0, providerRequests: 40 });
    expect(tile.level).toBe('ok');
    expect(tile.note).toContain('fell back to a second engine still counts as answered');
  });

  it('an unread rate is still unknown, with its own wording', () => {
    const tile = aiTile({ providerErrorRate: null, providerRequests: 40 });
    expect(tile.level).toBe('unknown');
    expect(tile.note).toContain('Could not read');
    expect(tile.note).not.toContain('Too few requests');
  });

  it('⚠️ the word changed from "refused" to "unanswered", deliberately', () => {
    // "Refused" describes a provider saying no, which is what the old per-attempt number measured and
    // is not what a user experiences. "Unanswered" is the user's side of it.
    expect(aiTile({ providerErrorRate: 0.3, providerRequests: 40 }).display).toContain('unanswered');
  });

  it('🔒 the route feeds the per-request counter, not the per-provider sum', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/routes/admin.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(code).toContain('getRouterOutcomeStats()');
    expect(code).toContain('readings.providerRequests = req');
    // REVERSION GUARD: the summation that produced 50%.
    expect(code).not.toContain('err += Number(st?.errorCount) || 0;');
  });
});

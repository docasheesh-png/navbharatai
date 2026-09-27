/**
 * ADMIN MONITOR CAPTURE, 2026-09-27 — three numbers on the admin's main panel were false.
 *
 *  1. "Builds 0 · last 6 hours" beside "AI cost ₹10.95 · kimi". `recordPlatformBuild` records a build's
 *     model calls first and the build last; the FIRST model call flushed on a quiet instance, the build
 *     counter landed in a fresh pending map, and the next deploy killed the instance with it still there.
 *  2. "Platform health — critical · Health 0 · Reliability 0 · Risk 100" while the servers were
 *     "keeping up comfortably". Errors were per LADDER RUNG (a fallback that worked counted as an
 *     error) and latency was the MODEL's generation time scored on a 2-second web scale.
 *  3. "AI load 15% unanswered" was measured on everything except streamed chat — the main path — and
 *     printed no denominator.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { metricsTimeline } from '../src/server/lib/metricsTimeline';
import { computeHealthScore, platformHealthInputs } from '../src/server/lib/HealthScore';
import { AIRouter, getRouterOutcomeStats, _resetRouterOutcomes } from '../src/server/AI/Router/AIRouter';
import { loadBoard, AI_MIN_SAMPLE } from '../src/server/lib/loadBoard';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** A Firestore stand-in that records every bucket write. */
function fakeDb() {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    collection: () => ({
      doc: () => ({ set: async (u: Record<string, unknown>) => { writes.push(u); } }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
  };
  return { db, writes };
}

describe('1 · a build and its cost reach the Monitor in the same write', () => {
  const t = metricsTimeline as any;
  let restore: () => void;
  beforeEach(() => {
    const { db, writes } = fakeDb();
    const original = t.getDb;
    t.getDb = () => db;
    t.pending = new Map();
    t.lastFlushAt = 0; // a quiet instance: the next record is due to flush
    t.lastCleanupAt = Date.now();
    (globalThis as any).__writes = writes;
    restore = () => { t.getDb = original; };
  });
  afterEach(() => restore());

  it("🔴 the capture: the build's model call no longer flushes ahead of the build it belongs to", async () => {
    // Exactly what recordPlatformBuild does, synchronously: calls first, build last.
    metricsTimeline.recordModelCall('kimi', 30_000, 6_400, 0.13);
    metricsTimeline.recordBuild({ ok: true, previewAllowed: true, ms: 1_500_000 });
    await new Promise((r) => setImmediate(r));
    await t.flush();
    const writes: Array<Record<string, unknown>> = (globalThis as any).__writes;
    expect(writes.length).toBeGreaterThan(0);
    // The first write carries BOTH — under the old code it carried the cost alone.
    expect(Object.keys(writes[0])).toEqual(expect.arrayContaining(['builds', 'costMicroUsd']));
  });

  it('a delta on a quiet instance is flushed by the timer, not left for the next build', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      t.lastFlushAt = Date.now(); // just flushed: nothing is due
      t.idleTimer = null;
      metricsTimeline.recordBuild({ ok: true, previewAllowed: true, ms: 1000 });
      expect(t.pending.size).toBe(1);
      await vi.advanceTimersByTimeAsync(61_000);
    } finally {
      vi.useRealTimers();
    }
    await t.flushing;
    const writes: Array<Record<string, unknown>> = (globalThis as any).__writes;
    expect(writes.some((w) => 'builds' in w)).toBe(true);
    expect(t.pending.size).toBe(0);
  });

  it('shutdown writes what is pending before the instance exits', () => {
    const server = read('server.ts');
    expect(server).toContain('metricsTimeline.flushNow(2500)');
    expect(server).toMatch(/setTimeout\(\(\) => \{ void flushTelemetry\(\)\.finally\(exitNow\); \}, grace\)/);
  });
});

describe('2 · platform health measures the platform', () => {
  it('🔴 the capture: a healthy server with working fallbacks is not "critical"', () => {
    const inputs = platformHealthInputs({
      builds: { total: 0, successRate: 0 },
      // 40 chat turns, every one answered — some by a second rung.
      router: { requests: 40, failed: 0 },
      serverWaitMs: 29.7, // the capture's own "Waiting time 29.7ms"
      minRequests: AI_MIN_SAMPLE,
    });
    const score = computeHealthScore(inputs);
    expect(score.grade).not.toBe('critical');
    expect(score.health).toBeGreaterThanOrEqual(90);
  });

  it('a request NO engine answered still counts, and too few requests are not a rate', () => {
    expect(platformHealthInputs({ builds: { total: 0, successRate: 0 }, router: { requests: 20, failed: 3 }, serverWaitMs: null, minRequests: 10 }).errorRatePct).toBe(15);
    expect(platformHealthInputs({ builds: { total: 0, successRate: 0 }, router: { requests: 2, failed: 1 }, serverWaitMs: null, minRequests: 10 }).errorRatePct).toBeNull();
    // The model's generation time is not an input at all; only our own server's wait is.
    expect(platformHealthInputs({ builds: { total: 0, successRate: 0 }, router: null, serverWaitMs: null, minRequests: 10 }).avgLatencyMs).toBeNull();
  });

  it('both admin routes build the inputs with the ONE function, from per-request outcomes', () => {
    const admin = read('src/server/routes/admin.ts');
    expect(admin.match(/platformHealthInputs\(\{/g)?.length).toBe(2);
    expect(admin).not.toContain('latencyWeighted');
  });
});

function streamProvider(name: AIProvider['name'], behavior: 'ok' | 'fail'): AIProvider {
  return {
    name,
    priority: 1,
    healthCheck: async () => true,
    execute: async () => ({ content: 'x', latencyMs: 1, provider: name, model: 'test' }),
    executeStream: async (_p: string, _s: string | undefined, onChunk: (t: string) => void) => {
      if (behavior === 'fail') throw new Error(`${name} down`);
      onChunk('hello');
    },
  } as AIProvider;
}

describe('3 · AI load counts the streamed chat turn and shows its sample', () => {
  beforeEach(() => _resetRouterOutcomes());

  it('🔴 a streamed turn is one request; one nobody answered is one failure', async () => {
    const ok = new AIRouter('free');
    ok.registerProvider(streamProvider('GLM', 'ok'));
    await ok.routeStream('hi', 'sys', () => {});
    const none = new AIRouter('free');
    none.registerProvider(streamProvider('VERTEX', 'fail'));
    await none.routeStream('hi', 'sys', () => {});
    expect(getRouterOutcomeStats()).toEqual({ requests: 2, failed: 1 });
  });

  it('a turn the user aborted is not counted either way', async () => {
    const r = new AIRouter('free');
    r.registerProvider(streamProvider('GLM', 'ok'));
    const ac = new AbortController();
    ac.abort();
    await r.routeStream('hi', 'sys', () => {}, ac.signal);
    expect(getRouterOutcomeStats()).toEqual({ requests: 0, failed: 0 });
  });

  it('the tile says how many requests its percentage stands on', () => {
    const tile = loadBoard({ providerErrorRate: 0.15, providerRequests: 20 } as any).find((x) => x.id === 'ai')!;
    expect(tile.display).toBe('15% unanswered');
    expect(tile.note).toContain('3 of 20 requests went unanswered');
  });
});

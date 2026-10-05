/**
 * Q-164: the Monitor's `aiRequests` added exactly ONE per provider per build, because a build reports its
 * token totals once per provider and that report was counted as one request — a build that made 40 calls to
 * one provider showed 1. The class: a count read from a total that does not carry it. The ledger now counts
 * calls as they happen, and the count rides the one recording funnel (registry → sink → timeline).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { MetricsRegistry, setMetricsSink } from '../src/server/lib/metrics';
import { recordPlatformBuild } from '../src/server/lib/platformBuildMetrics';
import { getMetrics } from '../src/server/lib/metrics';
import { readFileSync } from 'fs';

afterEach(() => setMetricsSink(null));

describe('the Monitor counts real calls', () => {
  it('the ledger counts every call, even though its token slices merge them', () => {
    const l = createProviderUsageLedger();
    for (let i = 0; i < 40; i++) l.add('GLM', { inputTokens: 100, outputTokens: 10 }, 'glm-4.7-flash');
    l.add('CLAUDE', { inputTokens: 5, outputTokens: 1 }, 'claude-haiku');
    expect(l.entries().filter((e) => e.provider === 'GLM')).toHaveLength(1); // merged slice
    expect(l.callsByProvider?.()).toEqual({ GLM: 40, CLAUDE: 1 });
  });

  it('a build\'s 40 calls reach the registry and the timeline as 40 requests', () => {
    const seen: number[] = [];
    setMetricsSink({ onModelCall: (_p, _i, _o, _c, calls) => { seen.push(calls ?? 1); } });
    const before = getMetrics().snapshot().tokens.GLM?.requests ?? 0;
    recordPlatformBuild({ ok: true, previewAllowed: true, isEdit: false, ms: 1, providerUsage: { GLM: { inputTokens: 4000, outputTokens: 400 } }, providerCalls: { GLM: 40 } });
    expect((getMetrics().snapshot().tokens.GLM?.requests ?? 0) - before).toBe(40);
    expect(seen).toEqual([40]);
  });

  it('without a count, a provider still counts as one — never zero, never invented', () => {
    const r = new MetricsRegistry();
    r.recordModelCall('KIMI', 10, 1, 0.001);
    r.recordModelCall('KIMI', 10, 1, 0.001, 0);
    r.recordModelCall('KIMI', 10, 1, 0.001, Number.NaN);
    expect(r.snapshot().tokens.KIMI.requests).toBe(3);
  });

  it('both build-telemetry call sites hand the count over, and the timeline sink forwards it', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('providerCalls: billingCtx.providerLedger.callsByProvider?.(),');
    expect(route).toContain('providerCalls: providerLedger.callsByProvider?.(),');
    expect(readFileSync('src/server/lib/metricsTimeline.ts', 'utf8')).toContain('metricsTimeline.recordModelCall(provider, inputTokens, outputTokens, costUsd, Date.now(), calls ?? 1)');
  });
});

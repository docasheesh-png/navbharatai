/**
 * Admin 2026-11-04, a copy of AI Engines → Chat Router — Live: GLM read "Healthy" with 3 requests and 3 errors;
 * `glm`, `groq`, `dsv4flash` and `cloudflare` showed as "Not used yet" twins of the real `free-chat-chain:*` rows;
 * and the usage ranking ranked "unknown" (909) and "NONE" (175) as if they were engines.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chatProviderHealth, chatProviderLatencyText } from '../src/lib/chatProviderHealth';
import { acquireSlot, releaseSlot, getProviderStats, visibleProviderStats } from '../src/server/AI/Router/AIRouter';
import { NOT_A_PROVIDER } from '../src/server/lib/usageLedger';

const now = 1_000_000;
describe('🔴 the badge reads every fact, not two', () => {
  it('the report case: 3 requests, 3 errors ⇒ Failing, never Healthy, and no "0ms" latency', () => {
    const glm = { requestCount: 3, errorCount: 3, avgLatencyMs: 0, inFlight: 0, circuitState: 'half_open', cooldownUntil: 0 };
    expect(chatProviderHealth(glm, now)).toMatchObject({ label: 'Failing', tone: 'danger', detail: '3 of 3 calls failed on this server' });
    expect(chatProviderLatencyText(glm)).toBe('—');
  });
  it('every other state says what it is', () => {
    expect(chatProviderHealth({ requestCount: 5, errorCount: 0, avgLatencyMs: 1837, circuitState: 'closed' }, now)).toMatchObject({ label: 'Healthy', tone: 'ok' });
    expect(chatProviderHealth({ requestCount: 10, errorCount: 1, circuitState: 'closed' }, now)).toMatchObject({ label: 'Degraded', tone: 'warn' });
    expect(chatProviderHealth({ requestCount: 0, circuitState: 'half_open' }, now)).toMatchObject({ label: 'Recovering', tone: 'warn' });
    expect(chatProviderHealth({ requestCount: 0, circuitState: 'closed' }, now)).toMatchObject({ label: 'Not used yet', tone: 'neutral' });
    expect(chatProviderHealth({ requestCount: 2, circuitState: 'open' }, now)).toMatchObject({ label: 'Circuit open', tone: 'danger' });
    expect(chatProviderHealth({ requestCount: 2, cooldownUntil: now + 4500 }, now)).toMatchObject({ label: 'Paused 5s', tone: 'danger' });
    expect(chatProviderHealth({ requestCount: 4, errorCount: 0, inFlight: 1, circuitState: 'closed' }, now)).toMatchObject({ label: 'Busy' });
    expect(chatProviderLatencyText({ requestCount: 5, errorCount: 0, avgLatencyMs: 1837 })).toBe('1837ms');
  });
  it('🔒 the card uses the function — the two-fact badge cannot come back', () => {
    const src = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(src).toContain('const health = chatProviderHealth(stat, Date.now());');
    expect(src).not.toMatch(/!everRan \? 'Not used yet' : 'Healthy'/);
  });
});

describe('🔴 a Free Chain concurrency pool is not shown as an engine "not used yet"', () => {
  it('the pool `groq` is flagged capacityOnly, hidden while idle, shown (flagged) while busy', () => {
    expect(acquireSlot('free-chat-chain:pool-check')).toBe(true); // the Free Chain's own key shape: universe:account
    const busy = getProviderStats()['pool-check'];
    expect(busy).toMatchObject({ capacityOnly: true, inFlight: 1, inFlightByUniverse: { 'free-chat-chain': 1 } });
    expect(Object.keys(visibleProviderStats(getProviderStats()))).toContain('pool-check');
    releaseSlot('free-chat-chain:pool-check');
    expect(getProviderStats()['pool-check']).toMatchObject({ capacityOnly: true, inFlight: 0 }); // the internal contract stays
    expect(Object.keys(visibleProviderStats(getProviderStats()))).not.toContain('pool-check');
  });
  it('reading the stats never turns a pool into a provider (no breaker is created for it)', () => {
    acquireSlot('free-chat-chain:pool-check-2'); releaseSlot('free-chat-chain:pool-check-2');
    getProviderStats(); getProviderStats();
    expect(getProviderStats()['pool-check-2'].capacityOnly).toBe(true);
  });
  it('🔒 both admin panels read the filtered view', () => {
    const route = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(route).toContain('const liveProviderStats = visibleProviderStats(getProviderStats());');
    expect(route).toContain('const providerStats = guard(() => visibleProviderStats(getProviderStats()));');
  });
});

describe('🔴 a turn no provider answered is not an engine', () => {
  it('NONE and unknown are named for what they are and kept out of the ranking', () => {
    expect(Object.keys(NOT_A_PROVIDER).sort()).toEqual(['NONE', 'unknown']);
    const route = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(route).toContain(".filter(([name]) => !(name in NOT_A_PROVIDER))");
    expect(route).toContain('providerRanking, unansweredTurns,');
  });
});

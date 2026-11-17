/**
 * Owner 2026-11-17: "jo ai/provider use ho rahe hai, wahi dikhen chahiye, aur yeh live rahe, kon se provider fail ho
 * raha kyu fail ho raha likh kar aye, admin ko saf dikhe".
 *
 * The page showed the Weak tier as GLM → KIMI → GLM while the same screen reported "Calls today: ENGINE_R1 581 ·
 * SURPLUS 514": the engines doing most Weak work were missing from the chain, nothing said why an engine failed, and
 * 13 keyless providers sat in the switch list as if they were in use. These tests lock the three fixes.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateEngineHealth, engineStatus, FAILURE_REASON_TEXT } from '../../server/AgentV3/engineHealth';
import { EngineChain, EngineHealthList } from './BuildEngineHealth';
import { ProviderSwitchesBody } from './ProviderSwitchesPanel';
import type { ProviderSwitchesView } from '../../lib/providerSwitchesView';
import { liveBuildChain } from '../../server/routes/agentv3';

const perf = (delivery: Record<string, number>, failures: Array<{ provider: string; failures: number; byReason: Record<string, number> }>) =>
  ({ providerDelivery: delivery, providerFailures: failures.map(f => ({ ...f, raw: '', starvedCalls: 0, timeoutCalls: 0, silentCalls: 0, crawlCalls: 0 })) });

describe('engine health is aggregated from what builds recorded, across servers', () => {
  const report = aggregateEngineHealth([
    { startedAt: 1_000, modelPerformance: perf({ ENGINE_R1: 0, SURPLUS: 4, GLM: 2 }, [{ provider: 'ENGINE_R1', failures: 10, byReason: { 'output-budget': 7, timeout: 3 } }]) },
    { startedAt: 5_000, modelPerformance: perf({ 'GLM#2': 3, KIMI: 1 }, [{ provider: 'GLM', failures: 1, byReason: { 'rate-limit': 1 } }, { provider: 'ENGINE_R1', failures: 2, byReason: { 'other: upstream 502, retry later': 2 } }]) },
    { startedAt: 9_000, modelPerformance: null },
  ], 24);

  it('counts every build read, merges pool names, and puts failing engines first', () => {
    expect(report.buildsRead).toBe(3);
    expect(report.engines.map(e => [e.engine, e.status])).toEqual([
      ['ENGINE_R1', 'failing'], ['GLM', 'degraded'], ['SURPLUS', 'working'], ['KIMI', 'working'],
    ]);
    expect(report.engines.find(e => e.engine === 'GLM')).toMatchObject({ delivered: 5, failures: 1, builds: 2 });
  });
  it('says WHY in plain words, most frequent cause first, with the newest failure time', () => {
    const r1 = report.engines.find(e => e.engine === 'ENGINE_R1')!;
    expect(r1.failures).toBe(12);
    expect(r1.lastFailureAt).toBe(5_000);
    expect(r1.reasons.map(r => [r.code, r.count])).toEqual([['output-budget', 7], ['timeout', 3], ['other: upstream 502, retry later', 2]]);
    expect(r1.reasons[0].text).toBe(FAILURE_REASON_TEXT['output-budget']);
    expect(r1.reasons[2].text).toBe('Error: upstream 502, retry later');
  });
  it('never calls an engine with no recorded use "working"', () => {
    expect(engineStatus(0, 0)).toBe('idle');
    expect(engineStatus(0, 3)).toBe('failing');
    expect(engineStatus(5, 0)).toBe('working');
    expect(engineStatus(5, 2)).toBe('degraded');
    expect(engineStatus(2, 5)).toBe('failing');
  });
  it('the page renders the health, and an unreadable window is never shown as "no failures"', () => {
    const html = renderToStaticMarkup(<EngineHealthList health={report} names={{ ENGINE_R1: 'Router One' }} now={65_000} />);
    expect(html).toContain('Router One');
    expect(html).toContain('Failing');
    expect(html).toContain(FAILURE_REASON_TEXT['output-budget']);
    expect(html).toContain('last failure 1 min ago');
    const unread = renderToStaticMarkup(<EngineHealthList health={null} names={undefined} />);
    expect(unread).toContain('could not be read');
    expect(unread).not.toMatch(/No build recorded/);
  });
  it('the chain chip carries the engine’s failures', () => {
    const html = renderToStaticMarkup(<EngineChain chain={[{ name: 'ENGINE_R1', model: 'deepseek-v4.1-flash' }, { name: 'GLM#2', model: 'glm-4.7-flashx' }]} health={report} names={{ ENGINE_R1: 'Router One' }} />);
    expect(html).toContain('Router One');
    expect(html).toContain('12 failed');
    expect(html).toContain('data-testid="engine-chip-GLM"');
  });
});

describe('the Build Engines chain shows the engines in front of the ladder', () => {
  beforeEach(() => {
    vi.stubEnv('ROUTER_ONE_API_KEY', 'synthetic-test-key');
    vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
    vi.stubEnv('ROUTER_ONE_ENABLED', 'on');
    vi.stubEnv('FREE_CHAIN_BLUESMINDS_API_KEY', 'synthetic-bm-key');
    vi.stubEnv('GLM_API_KEY', 'synthetic-glm-key');
    vi.stubEnv('KIMI_API_KEY', 'synthetic-kimi-key');
    vi.stubEnv('AGENTV3_LADDER_WEAK', 'GLM:glm-4.7-flashx,KIMI:kimi-k2.7-code,GLM:glm-5.3');
    vi.stubEnv('SURPLUS_API_KEY', 'synthetic-surplus-key');
    vi.stubEnv('AGENTV3_SURPLUS_BUILDER', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('Weak: Surplus → Router One → BluesMinds → the ladder, each with its model', () => {
    const chain = liveBuildChain('weak');
    expect(chain.map(r => r.name).slice(0, 4)).toEqual(['SURPLUS', 'ENGINE_R1', 'ENGINE_BM', 'GLM']);
    expect(chain.find(r => r.name === 'GLM')?.model).toBe('glm-4.7-flashx');
  });
  it('without a Surplus key the chain does not pretend Surplus runs; Normal never shows the Weak-only leads', () => {
    vi.stubEnv('SURPLUS_API_KEY', '');
    expect(liveBuildChain('weak').map(r => r.name)).not.toContain('SURPLUS');
    expect(liveBuildChain('off').map(r => r.name)).not.toContain('ENGINE_R1');
  });
  it('the endpoint and the page are wired to it', () => {
    const route = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(route).toContain('liveBuildChain(level)');
    expect(route).toContain('aggregateEngineHealth(recent, windowHours)');
    const dash = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(dash).toContain('<EngineChain chain={engines.chains[t.level]}');
    expect(dash).toContain('<EngineHealthList health={engines.health}');
    expect(dash).toMatch(/setInterval\(\(\) => \{ void fetchEngines\(\); \}, 60_000\)/);
  });
});

describe('the switch list puts providers in use first; keyless ones are tucked away', () => {
  const data: ProviderSwitchesView = {
    revision: 3, updatedAt: 1, syncMs: 10_000, thisInstance: { at: 1, ok: true, enforcingOff: [] },
    providers: [
      { id: 'surplus', name: 'Surplus', on: true, hasKey: true },
      { id: 'requesty', name: 'Requesty', on: true, hasKey: false },
      { id: 'vertex', name: 'Google Vertex AI', on: true, hasKey: null },
    ],
    history: [],
  };
  it('keyed and identity-based providers are in the open list; a keyless one is only in the closed list', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(<ProviderSwitchesBody data={data} error={null} pending={null} reason="" saving={false} saveError={null} done={null}
      onToggle={noop} onReason={noop} onConfirm={noop} onCancel={noop} />);
    const inUse = html.slice(html.indexOf('provider-switches-in-use'), html.indexOf('provider-switches-no-key'));
    expect(inUse).toContain('provider-switch-surplus');
    expect(inUse).toContain('provider-switch-vertex');
    expect(inUse).not.toContain('provider-switch-requesty');
    expect(html.slice(html.indexOf('provider-switches-no-key'))).toContain('provider-switch-requesty');
    expect(html).toContain('Not set up on this server (1)');
  });
});

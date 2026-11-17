/**
 * Owner 2026-11-17 (AI Engines page): render half. Imports NO server code, so the frontend typecheck (which excludes
 * src/server) never pulls server routes in. The server half is tests/aiEnginesShowWhatRunsAndWhyItFails.test.ts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EngineChain, EngineHealthList, type EngineHealthData } from './BuildEngineHealth';
import { ProviderSwitchesBody } from './ProviderSwitchesPanel';
import type { ProviderSwitchesView } from '../../lib/providerSwitchesView';

const report: EngineHealthData = {
  windowHours: 24, buildsRead: 3,
  engines: [
    { engine: 'ENGINE_R1', delivered: 0, failures: 12, builds: 2, lastFailureAt: 5_000, status: 'failing',
      reasons: [{ code: 'output-budget', count: 7, text: 'Spent its token allowance thinking and returned no usable answer.' }] },
    { engine: 'GLM', delivered: 5, failures: 1, builds: 2, lastFailureAt: 5_000, status: 'degraded', reasons: [] },
  ],
};

describe('engine health on the page', () => {
  it('names the failing engine, says why, and when', () => {
    const html = renderToStaticMarkup(<EngineHealthList health={report} names={{ ENGINE_R1: 'Router One' }} now={65_000} />);
    expect(html).toContain('Router One');
    expect(html).toContain('Failing');
    expect(html).toContain('Spent its token allowance thinking');
    expect(html).toContain('last failure 1 min ago');
  });
  it('an unreadable window is never shown as "no failures"', () => {
    const unread = renderToStaticMarkup(<EngineHealthList health={null} names={undefined} />);
    expect(unread).toContain('could not be read');
    expect(unread).not.toMatch(/No build recorded/);
  });
  it('the chain chip carries the engine’s failures, pool names merged', () => {
    const html = renderToStaticMarkup(<EngineChain chain={[{ name: 'ENGINE_R1', model: 'deepseek-v4.1-flash' }, { name: 'GLM#2', model: 'glm-4.7-flashx' }]} health={report} names={{ ENGINE_R1: 'Router One' }} />);
    expect(html).toContain('Router One');
    expect(html).toContain('12 failed');
    expect(html).toContain('data-testid="engine-chip-GLM"');
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

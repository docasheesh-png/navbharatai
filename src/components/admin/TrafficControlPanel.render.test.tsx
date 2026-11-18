/**
 * Owner 2026-11-17 (P2 review): label the switch "Gateway Emergency OFF" until every legacy path is covered, and show
 * plainly that provider drain/disable and traffic caps apply only to gateway-managed requests.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrafficControlBody } from './TrafficControlPanel';
import { editableBody, isTrafficControlView, saveProblem, type TrafficControlView } from '../../lib/trafficControlView';

const data: TrafficControlView = {
  current: null,
  thisInstance: { revision: 0, enforcingRevision: 0, lastReadAtMs: 1, lastReadOk: true, intervalMs: 15_000 },
  surfaces: ['chat', 'professional'],
  providers: [{ id: 'glm', name: 'Z.ai GLM', kind: 'direct', family: 'zhipu' }],
  models: [{ key: 'glm/glm-4.7-flashx', surfaces: ['chat'], dependsOn: ['zhipu'] }],
  admission: {},
  history: { revisions: [], audit: [] },
};
const noop = () => {};
const render = (over: Partial<Parameters<typeof TrafficControlBody>[0]> = {}) => renderToStaticMarkup(
  <TrafficControlBody data={data} error={null} draft={editableBody(data)} reason="" totp="" rollbackTo={null} saving={false}
    saveError={null} done={null} onDraft={noop} onReason={noop} onTotp={noop} onRollbackPick={noop} onSave={noop} onRollback={noop} onReset={noop} {...over} />);

describe('the panel says exactly what the switches cover', () => {
  it('the emergency switch is named Gateway Emergency OFF', () => {
    expect(render()).toMatch(/<p[^>]*>Gateway Emergency OFF<\/p>/);
  });
  it('the scope note says gateway-managed requests only and points to the provider switches for everywhere', () => {
    const html = render();
    expect(html).toContain('Applies to gateway-managed requests only.');
    expect(html).toContain('AI provider switches');
    expect(html.match(/gateway-managed requests only/g)?.length).toBeGreaterThanOrEqual(3); // scope note + providers + models
  });
  it('turning the gateway off says older paths that never used the gateway are not changed', () => {
    expect(render({ draft: { ...editableBody(data), global: { gateway: 'off' } } })).toContain('Older paths that never used the gateway are not changed.');
  });
  it('a save asks for a reason and an authenticator code before anything is sent', () => {
    expect(saveProblem('', '123456')).toMatch(/reason/);
    expect(saveProblem('provider outage', '12')).toMatch(/6-digit/);
    expect(saveProblem('provider outage', '123456')).toBeNull();
  });
  it('the server body is checked before it is shown', () => {
    expect(isTrafficControlView(data)).toBe(true);
    expect(isTrafficControlView({ ...data, current: { revision: 'x' } })).toBe(false);
  });
  it('with a path covered, the scope note names it and says caps and Emergency OFF stay gateway-only (P3)', () => {
    const withPaths = { ...data, paths: ['free-chain', 'chat-router', 'builder'] };
    const html = renderToStaticMarkup(<TrafficControlBody data={withPaths} error={null} draft={{ ...editableBody(withPaths), coverage: { builder: true } }}
      reason="" totp="" rollbackTo={null} saving={false} saveError={null} done={null} onDraft={noop} onReason={noop} onTotp={noop}
      onRollbackPick={noop} onSave={noop} onRollback={noop} onReset={noop} />);
    expect(html).toContain('apply to the gateway and to: Pro builder');
    expect(html).toContain('Traffic caps and the');
    expect(html).toContain('Older routing paths');
  });
  it('shared health in observe mode says nothing is skipped because of another server', () => {
    const html = render({ data: { ...data, sharedHealth: { mode: 'observe', lastPullAtMs: 1, lastPullOk: true, intervalMs: 20_000, writes: 0, adopted: 0,
      reported: [{ provider: 'GLM', state: 'suspended', kind: 'suspended', atMs: 1 }], families: [{ domain: 'deepseek', providers: ['deepseek', 'router-one'], since: 1 }] } } });
    expect(html).toContain('observe only');
    expect(html).toContain('no server skips a provider because another one reported it');
    expect(html).toContain('Suspected shared outage: deepseek');
  });
});

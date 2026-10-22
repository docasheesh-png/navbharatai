import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { registryModelFixture, registryViewFixture } from '../../../tests/liveModelRegistryFixtures';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (v: unknown) => { hooks.values[n] = typeof v === 'function' ? v(hooks.values[n]) : v; }]; },
  useRef: (initial: unknown) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => (() => void) | void) => { hooks.effects.push(fn); },
}));
import { LiveModelRegistryPanel, RegistryModelCard } from './LiveModelRegistryPanel';
let cleanup: (() => void)[] = [];
const root = () => { hooks.cursor = 0; hooks.refCursor = 0; return LiveModelRegistryPanel({ adminToken: 'never-display-token' }); };
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
interface TestButton { type: unknown; props: { children?: unknown; onClick: () => void; disabled?: boolean } }
function buttons(node: unknown): TestButton[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!React.isValidElement(node)) return [];
  const element = node as TestButton;
  return [...(element.type === 'button' ? [element] : []), ...buttons(element.props.children)];
}
function elements(node: unknown): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as { type: unknown; props: Record<string, any> };
  return [element, ...elements(element.props.children)];
}
async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock); root();
  for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  await settle();
}
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.refs = []; hooks.refCursor = 0; hooks.effects = []; vi.useFakeTimers(); vi.setSystemTime(1500); });
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('live registry real UI state transitions with mocked fetch', () => {
  it('renders honest initial loading without credentials or invented healthy zeros', () => {
    const html = renderToStaticMarkup(root()); expect(html).toContain('Reading registry status'); expect(html).not.toContain('never-display-token'); expect(html).not.toContain('No models match');
  });
  it.each([response({ error: 'no' }, false, 401), response({ models: [] }), response(null)])('read failure is not an empty catalog', async answer => {
    await mount(vi.fn(async () => answer)); const html = renderToStaticMarkup(root()); expect(html).toContain('role="alert"'); expect(html).toContain('No model status has been verified'); expect(html).not.toContain('No models match');
  });
  it('renders a validated snapshot and sends the shared admin header on versioned route', async () => {
    const f = vi.fn(async () => response(registryViewFixture())); await mount(f);
    expect(f).toHaveBeenCalledWith('/api/v1/admin/live-model-registry', expect.objectContaining({ headers: { 'x-admin-token': 'never-display-token' } }));
    const html = renderToStaticMarkup(root()); expect(html).toContain('existing routing is unchanged'); expect(html).toContain('Example'); expect(html).not.toContain('never-display-token');
  });
  it('duplicate sync clicks dispatch only one mutation before React rerenders', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(registryViewFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response(registryViewFixture()));
    await mount(f); const click = buttons(root()).find(b => b.props.children === 'Sync catalog now')!.props.onClick;
    click(); click(); expect(f).toHaveBeenCalledTimes(2); finish(response({ status: 'held' })); await settle();
    expect(renderToStaticMarkup(root())).toContain('Another sync owns the lease');
  });
  it('a rejected mutation says uncertain rather than claiming nothing was saved', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(registryViewFixture())).mockRejectedValueOnce(new Error('network failed'));
    await mount(f); buttons(root()).find(b => b.props.children === 'Sync catalog now')!.props.onClick(); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('role="alert"'); expect(html).not.toContain('Nothing was saved');
  });
  it('terms review requires checkbox and audit reason and posts the reviewed registry version', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(registryViewFixture())).mockResolvedValueOnce(response({ ok: true })).mockResolvedValue(response(registryViewFixture()));
    await mount(f);
    elements(root()).find(e => e.type === RegistryModelCard)!.props.onAction('approve-terms');
    let tree = root();
    expect(buttons(tree).find(b => b.props.children === 'Confirm control')!.props.disabled).toBe(true);
    elements(tree).find(e => e.type === 'input' && e.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
    tree = root();
    expect(buttons(tree).find(b => b.props.children === 'Confirm control')!.props.disabled).toBe(true);
    elements(tree).find(e => e.type === 'textarea')!.props.onChange({ target: { value: 'Reviewed intended-use license' } });
    tree = root();
    expect(buttons(tree).find(b => b.props.children === 'Confirm control')!.props.disabled).toBe(false);
    elements(tree).find(e => e.type === 'form')!.props.onSubmit({ preventDefault: () => {} });
    await settle();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/live-model-registry/models/action', expect.objectContaining({ method: 'POST', body: JSON.stringify({ modelId: 'example/text:free', action: 'approve-terms', registryVersion: 'v1', reason: 'Reviewed intended-use license' }) }));
  });
  it('cancel does not send a model action', async () => {
    const f = vi.fn(async () => response(registryViewFixture())); await mount(f);
    elements(root()).find(e => e.type === RegistryModelCard)!.props.onAction('disable');
    buttons(root()).find(b => b.props.children === 'Cancel')!.props.onClick();
    expect(f).toHaveBeenCalledTimes(1); expect(renderToStaticMarkup(root())).not.toContain('Review model control');
  });
  it('periodic status refresh is a GET, never a catalog sync or inference', async () => {
    const f = vi.fn(async () => response(registryViewFixture())); await mount(f);
    await vi.advanceTimersByTimeAsync(30000); await settle();
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url, options] of f.mock.calls as unknown as Array<[string, RequestInit]>) { expect(url).toBe('/api/v1/admin/live-model-registry'); expect(options.method).toBeUndefined(); }
  });
  it('a hung read becomes unconfirmed at the timeout, not an empty catalog', async () => {
    const f = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await mount(f); await vi.advanceTimersByTimeAsync(15000); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('read timed out'); expect(html).toContain('role="alert"'); expect(html).not.toContain('No models match');
  });
  it('unmount ignores a late successful GET', async () => {
    let finish!: (v: unknown) => void; const f = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); cleanup.forEach(f => f()); cleanup = []; finish(response(registryViewFixture())); await settle();
    expect(renderToStaticMarkup(root())).not.toContain('Example');
  });
});

describe('model card never promotes unknown eligibility', () => {
  it('unknown health/quota are not rendered as healthy, free forever or zero latency', () => {
    const html = renderToStaticMarkup(<RegistryModelCard model={registryModelFixture()} now={1500} snapshotTrusted={true} disabled={false} termsUntil={1800} manuallyDisabled={false} onAction={() => {}} />);
    expect(html).toContain('Not measured'); expect(html).toContain('Remaining quota not verified'); expect(html).not.toContain('100.0%');
  });
  it('a failed refresh cannot leave an old eligibility badge green', () => {
    const html = renderToStaticMarkup(<RegistryModelCard model={registryModelFixture()} now={1500} snapshotTrusted={false} disabled={true} termsUntil={3000} manuallyDisabled={false} onAction={() => {}} />);
    expect(html).toContain('UNCONFIRMED SNAPSHOT'); expect(html).not.toContain('Eligible at last verification');
  });
  it('expires the badge even when no further network response arrives', () => {
    const html = renderToStaticMarkup(<RegistryModelCard model={registryModelFixture()} now={2000} snapshotTrusted={true} disabled={false} termsUntil={3000} manuallyDisabled={false} onAction={() => {}} />);
    expect(html).toContain('STALE'); expect(html).toContain('Not routable'); expect(html).not.toContain('Eligible at last verification');
  });
});

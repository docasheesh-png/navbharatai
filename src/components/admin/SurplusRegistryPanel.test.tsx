import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Observation, SurplusManagerView, SurplusConnectionTestStatus } from '../../server/AI/SurplusRegistry/types';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (value: unknown) => { hooks.values[n] = typeof value === 'function' ? value(hooks.values[n]) : value; }]; },
  useRef: (initial: unknown) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => (() => void) | void) => { hooks.effects.push(fn); },
}));
import { isSurplusManagerView, SurplusModelCard, SurplusRegistryPanel, SurplusConnectionTestPanel, isSurplusConnectionTestStatus } from './SurplusRegistryPanel';
const version = '11111111-1111-4111-8111-111111111111';
function offer(): Observation {
  return { model: 'glm-5.3', offerId: 'offer-1', providerId: 'provider-1', available: true, healthy: true, trusted: true, providerTrustConfirmed: true,
    trustObservedAt: 1000, discountPct: 90, rates: { input: '10', output: '20' }, referenceRates: { input: '100', output: '200' }, unit: 'unverified',
    observedAt: 1000, upstreamGeneratedAt: null, sourceDate: 1000, sourceAgeSeconds: null, cacheMaxAgeSeconds: 300,
    sourceUrl: 'https://api.surplusintelligence.ai/api/markets/glm-5.3' };
}
function fixture(): SurplusManagerView {
  return { status: 'observed', enabled: true, canDispatch: false, configuredUniverse: ['glm-5.3'], intervalMs: 300_000, freshnessMs: 300_000, maxModels: 15,
    version, controlRevision: 4, fetchedAt: 1000, expiresAt: 301000, lastAttemptAt: 1000, lastSuccessAt: 1000, nextAllowedAt: 301000, lastError: null,
    workload: { input: 10000, output: 2000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    models: [{ modelId: 'glm-5.3', disabled: false, qualityReviewStatus: 'unreviewed', blockedReasons: ['coding_quality_unreviewed'], observations: [offer()], estimatedCandidate: null }],
    observedCandidates: [offer()], limitations: ['Observations do not authorize paid dispatch.'] };
}
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
const root = (token = 'private-admin-token') => { hooks.cursor = 0; hooks.refCursor = 0; return SurplusRegistryPanel({ adminToken: token }); };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
type Element = { type: unknown; props: Record<string, any> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const find = (tree: unknown, type: unknown) => elements(tree).find(e => e.type === type)!;
const button = (tree: unknown, label: string) => elements(tree).find(e => e.type === 'button' && e.props.children === label)!;
let cleanup: (() => void)[] = [];
async function mount(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', mock); root();
  for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  await settle();
}
function review() {
  find(root(), SurplusModelCard).props.onControl();
  find(root(), 'textarea').props.onChange({ target: { value: 'Investigating observed provider quality' } });
  return root();
}
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.refs = []; hooks.refCursor = 0; hooks.effects = []; vi.useFakeTimers(); vi.setSystemTime(1500); });
afterEach(() => { cleanup.forEach(fn => fn()); cleanup = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('paid manager validates server data before rendering claims', () => {
  it('accepts bounded honest views and rejects dispatch authority in a manager response', () => {
    expect(isSurplusManagerView(fixture())).toBe(true);
    expect(isSurplusManagerView({ ...fixture(), canDispatch: true })).toBe(false);
    expect(isSurplusManagerView({ ...fixture(), models: [{ ...fixture().models[0], observations: [{ ...offer(), rates: { input: 'NaN' } }] }] })).toBe(false);
    expect(isSurplusManagerView({ ...fixture(), workload: { input: 1 } })).toBe(false);
    expect(isSurplusManagerView({ ...fixture(), controlRevision: -1 })).toBe(false);
    expect(isSurplusManagerView({ ...fixture(), expiresAt: null })).toBe(false);
    expect(isSurplusManagerView({ ...fixture(), fetchedAt: null })).toBe(false);
  });
  it('never treats initial loading as an empty/healthy catalog or prints the admin token', () => {
    const html = renderToStaticMarkup(root());
    expect(html).toContain('Reading discounted builder status'); expect(html).not.toContain('private-admin-token'); expect(html).not.toContain('No verified candidate details');
  });
  it.each([response(null), response({ models: [] }), response(fixture(), false, 401), response(fixture(), false, 503)])('shows unavailable on malformed or unsuccessful responses', async answer => {
    await mount(vi.fn(async () => answer)); const html = renderToStaticMarkup(root());
    expect(html).toContain('role="alert"'); expect(html).toContain('No candidate status has been verified'); expect(html).not.toContain('Reported available');
  });
  it('uses the real versioned admin route and distinguishes configured, quality, availability and eligibility', async () => {
    const fetch = vi.fn(async () => response(fixture())); await mount(fetch);
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/surplus-registry', expect.objectContaining({ headers: { 'x-admin-token': 'private-admin-token' } }));
    const html = renderToStaticMarkup(root());
    for (const text of ['Separate from OpenRouter STRICT_FREE', 'Configured candidate', 'Not independently approved', 'Reported available', 'Not confirmed eligible', '90% minimum discount retained', 'Unknown', 'Raw source rate units are unverified']) expect(html).toContain(text);
    expect(html).not.toContain('private-admin-token'); expect(html).not.toContain('type="password"');
  });
  it('expired metadata cannot keep availability or candidate eligibility green', async () => {
    const view = fixture(); view.expiresAt = 1600;
    view.models[0] = { ...view.models[0], qualityReviewStatus: 'reviewed', blockedReasons: ['dispatch_authority_not_evaluated'], estimatedCandidate: { model: 'glm-5.3', providerId: 'provider-1', offerId: 'offer-1', estimatedMicroUsd: '0.140000', qualityArtifact: 'a'.repeat(64) } };
    await mount(vi.fn(async () => response(view)));
    expect(renderToStaticMarkup(root())).toContain('Estimate only: 0.140000');
    await vi.advanceTimersByTimeAsync(1000);
    const html = renderToStaticMarkup(root()); expect(html).toContain('Stale observations'); expect(html).toContain('Unconfirmed / stale'); expect(html).not.toContain('Estimate only:');
  });
  it('a failed background read marks the last snapshot unconfirmed and blocks controls', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture())).mockRejectedValueOnce(new Error('Network unavailable'));
    await mount(fetch); await vi.advanceTimersByTimeAsync(30000); await settle();
    const tree = root(), html = renderToStaticMarkup(tree);
    expect(html).toContain('last received snapshot is unconfirmed'); expect(html).not.toContain('Reported available'); expect(find(tree, SurplusModelCard).props.controlsAvailable).toBe(false);
  });
  it('periodic refresh reads saved state only, never a metadata sync or inference request', async () => {
    const fetch = vi.fn(async () => response(fixture())); await mount(fetch); await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls as unknown as [string, RequestInit][]) { expect(url).toBe('/api/v1/admin/surplus-registry'); expect(options.method).toBeUndefined(); }
  });
  it('turns a hung read into an honest unavailable state', async () => {
    await mount(vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted'))))));
    await vi.advanceTimersByTimeAsync(15000); await settle();
    expect(renderToStaticMarkup(root())).toContain('Manager status read timed out');
  });
  it('ignores late status after unmount', async () => {
    let finish!: (value: unknown) => void;
    await mount(vi.fn(() => new Promise(resolve => { finish = resolve; })));
    cleanup.forEach(fn => fn()); cleanup = []; finish(response(fixture())); await settle();
    expect(renderToStaticMarkup(root())).not.toContain('glm-5.3');
  });
});

describe('paid controls cannot pretend to enable paid inference', () => {
  it('requires a reason, carries exact snapshot/revision and only removes a manual block', async () => {
    const view = fixture(); view.models[0].disabled = true;
    const fetch = vi.fn().mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response({ ok: true, canDispatch: false })).mockResolvedValue(response(fixture()));
    await mount(fetch); find(root(), SurplusModelCard).props.onControl();
    let tree = root(); expect(button(tree, 'Confirm candidate control').props.disabled).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain('This does not activate paid inference');
    find(tree, 'textarea').props.onChange({ target: { value: 'Recheck candidate after investigation' } });
    tree = root(); expect(button(tree, 'Confirm candidate control').props.disabled).toBe(false);
    find(tree, 'form').props.onSubmit({ preventDefault: () => {} }); await settle();
    const [url, options] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/surplus-registry/models/action');
    expect(JSON.parse(options.body as string)).toEqual({ modelId: 'glm-5.3', action: 'enable', snapshotVersion: version, expectedRevision: 4, reason: 'Recheck candidate after investigation' });
    expect(renderToStaticMarkup(root())).toContain('Not independently approved');
    expect(renderToStaticMarkup(root())).toContain('does not approve quality');
  });
  it('duplicate submit before rerender sends one control, and does not optimistically change state', async () => {
    let finish!: (value: unknown) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response(fixture()));
    await mount(fetch); const submit = find(review(), 'form').props.onSubmit;
    submit({ preventDefault: () => {} }); submit({ preventDefault: () => {} });
    expect(fetch).toHaveBeenCalledTimes(2); expect(find(root(), SurplusModelCard).props.model.disabled).toBe(false);
    finish(response({ ok: true, canDispatch: false })); await settle();
  });
  it('cancelling review makes no external state change', async () => {
    const fetch = vi.fn(async () => response(fixture())); await mount(fetch); review();
    button(root(), 'Cancel paid control').props.onClick();
    expect(fetch).toHaveBeenCalledTimes(1); expect(elements(root()).some(e => e.type === 'form')).toBe(false);
  });
  it('a revision conflict closes the outdated review and requires a fresh status, not retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture())).mockResolvedValueOnce(response({ error: 'conflict' }, false, 409));
    await mount(fetch); find(review(), 'form').props.onSubmit({ preventDefault: () => {} }); await settle();
    const tree = root(); expect(renderToStaticMarkup(tree)).toContain('Snapshot or controls changed'); expect(find(tree, SurplusModelCard).props.controlsAvailable).toBe(false);
    expect(elements(tree).some(e => e.type === 'form')).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([response({ ok: true, canDispatch: true }), response({ ok: true })])('rejects a phony activation or incomplete control success %j', async answer => {
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture())).mockResolvedValueOnce(answer);
    await mount(fetch); find(review(), 'form').props.onSubmit({ preventDefault: () => {} }); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('Control response was unreadable'); expect(html).not.toContain('Manual block control recorded');
  });
  it('a lost mutation response never claims success and blocks another write until refresh', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture())).mockRejectedValueOnce(new Error('Connection lost'));
    await mount(fetch); find(review(), 'form').props.onSubmit({ preventDefault: () => {} }); await settle();
    const tree = root(), html = renderToStaticMarkup(tree); expect(html).toContain('lost response does not prove failure'); expect(html).not.toContain('Manual block control recorded'); expect(button(tree, 'Confirm candidate control').props.disabled).toBe(true);
  });
  it('newer background control revision invalidates an open review', async () => {
    const newer = fixture(); newer.controlRevision = 5;
    const fetch = vi.fn().mockResolvedValueOnce(response(fixture())).mockResolvedValue(response(newer));
    await mount(fetch); review(); await vi.advanceTimersByTimeAsync(30000); await settle();
    const tree = root(); expect(button(tree, 'Confirm candidate control').props.disabled).toBe(true); expect(renderToStaticMarkup(tree)).toContain('controls changed during review');
  });
  it('never links an untrusted source URL and preserves unknown prices', () => {
    const model = fixture().models[0]; model.observations[0].sourceUrl = 'javascript:alert(1)';
    const html = renderToStaticMarkup(<SurplusModelCard model={model} now={1500} fresh={true} controlsAvailable={false} onControl={() => {}} />);
    expect(html).not.toContain('javascript:'); expect(html).toContain('Official source link unavailable'); expect(html).toContain('Unknown / Unknown');
  });
});


const connectionRoot = (token = 'private-admin-token') => { hooks.cursor = 0; hooks.refCursor = 0; return SurplusConnectionTestPanel({ adminToken: token }); };
const connectionFixture = (patch: Partial<SurplusConnectionTestStatus> = {}): SurplusConnectionTestStatus => ({
  status: 'ready', environmentConfigured: true, productionFlagsOff: true, latencyMs: null, actualCostUsd: null, expectedResponse: 'not_checked', ...patch,
});
async function mountConnection(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', mock); connectionRoot();
  for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  await settle();
}
describe('independent one-shot connection testing', () => {
  it('always renders a separate connection section even when the manager is disabled', async () => {
    await mount(vi.fn(async () => response({ ...fixture(), status: 'disabled', enabled: false })));
    const html = renderToStaticMarkup(root());
    expect(html).toContain('Disabled by server configuration'); expect(html).toContain('aria-label="One-shot connection test"');
    expect(html).toContain('Server credential configuration'); expect(html).toContain('Unknown / not confirmed');
  });
  it('validates bounded status fields without accepting raw responses or credentials', () => {
    expect(isSurplusConnectionTestStatus(connectionFixture())).toBe(true);
    for (const invalid of [null, {}, { ...connectionFixture(), secret: 'private-key' }, { ...connectionFixture(), status: 'pending' }, { ...connectionFixture(), environmentConfigured: 'yes' }, { ...connectionFixture(), productionFlagsOff: false }, { ...connectionFixture(), actualCostUsd: 'NaN' }, { ...connectionFixture(), actualCostUsd: '-1' }, { ...connectionFixture(), status: 'passed' }, { ...connectionFixture(), expectedResponse: 'raw text' }]) {
      expect(isSurplusConnectionTestStatus(invalid)).toBe(false);
    }
  });
  it('starts unknown and disabled; reading cached status never sends a paid request', async () => {
    expect(button(connectionRoot(), 'Test connection').props.disabled).toBe(true);
    hooks.effects = [];
    const fetch = vi.fn(async () => response(connectionFixture())); await mountConnection(fetch);
    expect(button(connectionRoot(), 'Test connection').props.disabled).toBe(false);
    expect(renderToStaticMarkup(connectionRoot())).toContain('Configured on the server');
    expect(renderToStaticMarkup(connectionRoot())).toContain('automatic account funding is off');
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls as unknown as [string, RequestInit][]) { expect(url).toBe('/api/v1/admin/surplus-registry/connection-test'); expect(options.method).toBeUndefined(); }
  });
  it.each(['blocked_configuration', 'blocked_budget_review', 'unavailable', 'unknown_liability_hold', 'failed', 'budget_exceeded'] as const)('cannot dispatch from %s, regardless of credential presence', async status => {
    await mountConnection(vi.fn(async () => response(connectionFixture({ status }))));
    expect(button(connectionRoot(), 'Test connection').props.disabled).toBe(true);
  });
  it('sends one empty POST on explicit click, suppresses double clicks and shows exact reported cost', async () => {
    let finish!: (value: unknown) => void;
    const passed = connectionFixture({ status: 'passed', latencyMs: 421, actualCostUsd: '0.000123', expectedResponse: 'matched' });
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mountConnection(fetch);
    const click = button(connectionRoot(), 'Test connection').props.onClick; click(); click();
    expect(fetch).toHaveBeenCalledTimes(2); expect(button(connectionRoot(), 'Testing connection…').props.disabled).toBe(true);
    const [url, options] = fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/surplus-registry/connection-test'); expect(options.method).toBe('POST'); expect(options.body).toBe('{}');
    expect(options.headers).toEqual({ 'x-admin-token': 'private-admin-token', 'Content-Type': 'application/json' });
    finish(response(passed)); await settle();
    const tree = connectionRoot(), html = renderToStaticMarkup(tree);
    expect(html).toContain('$0.000123 USD (reported; not an estimate)'); expect(html).toContain('421 ms'); expect(html).toContain('Matched OK');
    expect(html).toContain('not coding quality'); expect(html).not.toContain('private-admin-token'); expect(html).not.toContain('type="password"');
    expect(button(tree, 'Test connection').props.disabled).toBe(true);
  });
  it('a lost response never re-arms the test, even if a later cached read says ready', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockRejectedValueOnce(new Error('private-provider-error')).mockResolvedValue(response(connectionFixture()));
    await mountConnection(fetch); button(connectionRoot(), 'Test connection').props.onClick(); await settle();
    let tree = connectionRoot(), html = renderToStaticMarkup(tree);
    expect(html).toContain('possible charge cannot be ruled out'); expect(html).not.toContain('private-provider-error'); expect(button(tree, 'Test connection').props.disabled).toBe(true);
    button(tree, 'Refresh connection status').props.onClick(); await settle();
    tree = connectionRoot(); expect(button(tree, 'Test connection').props.disabled).toBe(true);
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it('a pending response remains blocked and polling only reads saved status', async () => {
    const pending = connectionFixture({ status: 'unknown_liability_hold' });
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockResolvedValue(response(pending));
    await mountConnection(fetch); button(connectionRoot(), 'Test connection').props.onClick(); await settle(); await vi.advanceTimersByTimeAsync(30000);
    expect(renderToStaticMarkup(connectionRoot())).toContain('Pending or uncertain outcome');
    expect(button(connectionRoot(), 'Test connection').props.disabled).toBe(true);
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it('a bad status read blocks a formerly ready test without trusting server error text', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockResolvedValue(response({ error: 'private-account-data' }, false, 503));
    await mountConnection(fetch); await vi.advanceTimersByTimeAsync(30000);
    const tree = connectionRoot(), html = renderToStaticMarkup(tree);
    expect(button(tree, 'Test connection').props.disabled).toBe(true); expect(html).toContain('Last received status is unconfirmed'); expect(html).not.toContain('private-account-data');
  });
  it('a hung POST times out without automatically retrying or reporting success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await mountConnection(fetch); button(connectionRoot(), 'Test connection').props.onClick(); await vi.advanceTimersByTimeAsync(60000); await settle();
    const html = renderToStaticMarkup(connectionRoot()); expect(html).toContain('possible charge cannot be ruled out'); expect(html).not.toContain('Connection test passed');
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it('ignores late test completion after unmount and aborts the browser request', async () => {
    let finish!: (value: unknown) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mountConnection(fetch); button(connectionRoot(), 'Test connection').props.onClick();
    cleanup.forEach(fn => fn()); cleanup = [];
    finish(response(connectionFixture({ status: 'passed', latencyMs: 100, actualCostUsd: '0.0001', expectedResponse: 'matched' }))); await settle();
    expect((fetch.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true);
    expect(renderToStaticMarkup(connectionRoot())).not.toContain('Connection test passed');
  });
  it('checks saved authentication separately without a budget review or unlocking paid tests', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture({ status: 'blocked_budget_review' }))).mockResolvedValueOnce(response({ status: 'accepted' }));
    await mountConnection(fetch); const check = button(connectionRoot(), 'Check saved credential').props.onClick; check(); check(); await settle();
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][0]).toBe('/api/v1/admin/surplus-registry/credential-check'); expect(fetch.mock.calls[1][1].body).toBe('{}');
    const tree = connectionRoot(), html = renderToStaticMarkup(tree);
    expect(html).toContain('account authentication only'); expect(html).toContain('coding quality remain unverified'); expect(button(tree, 'Test connection').props.disabled).toBe(true);
  });
  it.each([response({ status: 'accepted', balance: 'private-finance' }), response({ status: 'unexpected' }), response({ status: 'accepted' }, false, 503)])('never trusts malformed or unsuccessful credential check %j', async answer => {
    const fetch = vi.fn().mockResolvedValueOnce(response(connectionFixture())).mockResolvedValueOnce(answer);
    await mountConnection(fetch); button(connectionRoot(), 'Check saved credential').props.onClick(); await settle();
    const html = renderToStaticMarkup(connectionRoot()); expect(html).toContain('Acceptance is not confirmed'); expect(html).toContain('permission-limited or temporarily unavailable'); expect(html).toContain('does not establish an invalid key'); expect(html).not.toContain('private-finance'); expect(html).not.toContain('Saved credential accepted');
  });
});

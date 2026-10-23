import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freeChainMetricsFixture, freeChainViewFixture } from '../../../tests/freeChatChainFixtures';
import { freeChainControls } from '../../lib/freeChatChainView';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (v: unknown) => { hooks.values[n] = typeof v === 'function' ? v(hooks.values[n]) : v; }]; },
  useRef: (initial: unknown) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => (() => void) | void) => { hooks.effects.push(fn); },
}));
import { FreeChatChainPanel, FreeChainProviderCard } from './FreeChatChainPanel';
let cleanup: (() => void)[] = [];
const root = () => { hooks.cursor = 0; hooks.refCursor = 0; return FreeChatChainPanel({ adminToken: 'private-admin-token' }); };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
interface Element { type: unknown; props: Record<string, any> }
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function button(label: string, tree = root()): Element { return elements(tree).find(e => e.type === 'button' && e.props.children === label)!; }
async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock); root();
  for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  await settle();
}
function fillReason() { elements(root()).find(e => e.type === 'textarea')!.props.onChange({ target: { value: 'Investigating provider errors' } }); }
function submit() { elements(root()).find(e => e.type === 'form')!.props.onSubmit({ preventDefault: () => {} }); }
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.refs = []; hooks.refCursor = 0; hooks.effects = []; vi.useFakeTimers(); vi.setSystemTime(1500); });
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Free Chat Chain real rendered state and controls', () => {
  it('initial loading does not invent quota, cost or healthy traffic', () => {
    const html = renderToStaticMarkup(root()); expect(html).toContain('Reading chain status'); expect(html).not.toContain('0.0%'); expect(html).not.toContain('private-admin-token');
  });
  it.each([response({ error: 'denied' }, false, 403), response({ providers: [] }), response(null)])('a failed or malformed read is unavailable, never an empty healthy panel', async result => {
    await mount(vi.fn(async () => result)); const html = renderToStaticMarkup(root());
    expect(html).toContain('role="alert"'); expect(html).toContain('No quota, budget or routing health has been verified'); expect(html).not.toContain('Provider chain, in routing order');
  });
  it('uses versioned API and shared header, showing unknown costs and scope honestly', async () => {
    const f = vi.fn(async (_url: string) => response(freeChainViewFixture())); await mount(f);
    expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain', expect.objectContaining({ headers: { 'x-admin-token': 'private-admin-token' } }));
    const html = renderToStaticMarkup(root());
    expect(html).toContain('Disabled by server configuration'); expect(html).toContain('Unavailable'); expect(html).toContain('Sampled metrics unavailable until an explicit refresh');
    expect(html).toContain('at most 4,096 event documents'); expect(html).not.toContain('Sample median / p95 latency'); expect(html).not.toContain('private-admin-token');
  });
  it('the server OFF cannot be overridden by enable control', async () => {
    await mount(vi.fn(async () => response(freeChainViewFixture({ enabled: false, runtimeEnabled: false }))));
    expect(button('Enable chain checks').props.disabled).toBe(true);
    expect(renderToStaticMarkup(root())).toContain('Off; admin controls cannot override this');
  });
  it('0% does not claim OFF when a canary allowlist is configured', async () => {
    await mount(vi.fn(async () => response(freeChainViewFixture({ enabled: true, allowListConfigured: true }))));
    expect(renderToStaticMarkup(root())).toContain('Routing enabled for selected eligible requests');
  });
  it('renders both distinct Flash rungs in the configured rung order', async () => {
    await mount(vi.fn(async () => response(freeChainViewFixture())));
    const cards = elements(root()).filter(e => e.type === FreeChainProviderCard);
    expect(cards.map(c => c.props.provider.id)).toEqual(['glm47', 'glm45', 'groq', 'gemini', 'cloudflare', 'nvidia', 'openrouter', 'modelscope', 'bluesminds', 'requesty', 'llm7', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid', 'deepseek']);
    const html = renderToStaticMarkup(root());
    expect(html).toContain('GLM 4.7 Flash'); expect(html).toContain('GLM 4.5 Flash');
    expect(html).toContain('not a second allowance');
  });
  it('displays actual configured routing order and labels omitted providers outside the chain', async () => {
    await mount(vi.fn(async () => response(freeChainViewFixture({ order: ['groq', 'openrouter'] }))));
    const cards = elements(root()).filter(e => e.type === FreeChainProviderCard);
    expect(cards.map(c => c.props.provider.id)).toEqual(['groq', 'openrouter', 'glm47', 'glm45', 'gemini', 'cloudflare', 'nvidia', 'modelscope', 'bluesminds', 'requesty', 'llm7', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid', 'deepseek']);
    expect(cards.map(c => c.props.position)).toEqual([1, 2, ...Array(15).fill(null)]);
    const html = renderToStaticMarkup(root()); expect(html).toContain('Not in configured routing order');
  });
  it('global stop requires a reason, confirms the consequence and carries the prior snapshot', async () => {
    const view = freeChainViewFixture({ enabled: true, rolloutPercent: 5 });
    const f = vi.fn().mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response({ ok: true })).mockResolvedValue(response({ ...view, runtimeEnabled: false }));
    await mount(f); button('Stop chain').props.onClick();
    expect(button('Confirm control').props.disabled).toBe(true); expect(renderToStaticMarkup(root())).toContain('Requests already in flight are not cancelled');
    fillReason(); expect(button('Confirm control').props.disabled).toBe(false); submit(); await settle();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain/control', expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: false, reason: 'Investigating provider errors', expectedControls: freeChainControls(view) }) }));
    expect(renderToStaticMarkup(root())).toContain('Control recorded'); expect(renderToStaticMarkup(root())).toContain('Stopped by admin control');
  });
  it('a provider toggle only changes that rung and preserves other disabled rungs', async () => {
    const view = freeChainViewFixture({ enabled: true }); view.providers.find(p => p.id === 'cloudflare')!.disabled = true;
    const f = vi.fn().mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response({ ok: true })).mockResolvedValue(response(view));
    await mount(f); elements(root()).find(e => e.type === FreeChainProviderCard && e.props.provider.id === 'groq')!.props.onToggle();
    fillReason(); submit(); await settle();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain/control', expect.objectContaining({ body: JSON.stringify({ disabledProviders: ['groq', 'cloudflare'], reason: 'Investigating provider errors', expectedControls: freeChainControls(view) }) }));
  });
  it('rollout changes are bounded and reviewed, without hiding the separate allowlist', async () => {
    const view = freeChainViewFixture({ enabled: true, rolloutPercent: 5 });
    const f = vi.fn().mockResolvedValueOnce(response(view)).mockResolvedValueOnce(response({ ok: true })).mockResolvedValue(response(view));
    await mount(f);
    const set = (value: string) => elements(root()).find(e => e.type === 'input' && e.props.type === 'number')!.props.onChange({ target: { value } });
    for (const value of ['', '101', '-1', '5']) { set(value); expect(button('Review rollout change').props.disabled).toBe(true); }
    set('0'); expect(button('Review rollout change').props.disabled).toBe(false); button('Review rollout change').props.onClick();
    expect(renderToStaticMarkup(root())).toContain('0% alone is not a global stop'); fillReason(); submit(); await settle();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain/control', expect.objectContaining({ body: JSON.stringify({ rolloutPercent: 0, reason: 'Investigating provider errors', expectedControls: freeChainControls(view) }) }));
  });
  it('cancel sends no mutation', async () => {
    const f = vi.fn(async (_url: string) => response(freeChainViewFixture())); await mount(f); button('Stop chain').props.onClick(); button('Cancel').props.onClick();
    expect(f).toHaveBeenCalledTimes(1); expect(renderToStaticMarkup(root())).not.toContain('Review chain control');
  });
  it('repeated submits dispatch only once even before React rerenders', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response(freeChainViewFixture()));
    await mount(f); button('Stop chain').props.onClick(); fillReason();
    const submitHandler = elements(root()).find(e => e.type === 'form')!.props.onSubmit;
    submitHandler({ preventDefault: () => {} }); submitHandler({ preventDefault: () => {} }); expect(f).toHaveBeenCalledTimes(2);
    finish(response({ ok: true })); await settle();
  });
  it('lost mutation responses block retries until refresh instead of claiming nothing changed', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockRejectedValueOnce(new Error('network failed'));
    await mount(f); button('Stop chain').props.onClick(); fillReason(); submit(); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('lost response does not prove'); expect(html).not.toContain('Control recorded'); expect(button('Confirm control').props.disabled).toBe(true);
  });
  it('409 conflict closes the old review and does not retry', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockResolvedValueOnce(response({}, false, 409));
    await mount(f); button('Stop chain').props.onClick(); fillReason(); submit(); await settle();
    expect(renderToStaticMarkup(root())).toContain('Chain controls changed during review'); expect(renderToStaticMarkup(root())).not.toContain('Review chain control'); expect(f).toHaveBeenCalledTimes(2);
  });
  it('a refreshed control change invalidates the review before dispatch', async () => {
    const view = freeChainViewFixture(); const f = vi.fn().mockResolvedValueOnce(response(view)).mockResolvedValue(response({ ...view, rolloutPercent: 5 }));
    await mount(f); button('Stop chain').props.onClick(); fillReason(); await vi.advanceTimersByTimeAsync(30_000); await settle();
    expect(button('Confirm control').props.disabled).toBe(true); expect(renderToStaticMarkup(root())).toContain('Settings changed after this review opened');
  });
  it('a failed refresh marks old observations unconfirmed and blocks every provider control', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockResolvedValue(response({}, false, 503));
    await mount(f); button('Refresh status').props.onClick(); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('Unconfirmed snapshot'); expect(html).toContain('Showing the last received snapshot only');
    for (const card of elements(root()).filter(e => e.type === FreeChainProviderCard)) expect(card.props.controlsBlocked).toBe(true);
  });
  it('periodic refresh is read-only and never a control or inference', async () => {
    const f = vi.fn(async (_url: string) => response(freeChainViewFixture())); await mount(f); await vi.advanceTimersByTimeAsync(30_000); await settle();
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url, options] of f.mock.calls as unknown as Array<[string, RequestInit]>) { expect(url).toBe('/api/v1/admin/free-chat-chain'); expect(options.method).toBeUndefined(); }
  });
  it('a hung status read times out honestly', async () => {
    const f = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await mount(f); await vi.advanceTimersByTimeAsync(15_000); await settle();
    expect(renderToStaticMarkup(root())).toContain('Chain status read timed out');
  });
  it('an unmounted panel ignores late network responses', async () => {
    let finish!: (v: unknown) => void; const f = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); cleanup.forEach(f => f()); cleanup = []; finish(response(freeChainViewFixture())); await settle();
    expect(renderToStaticMarkup(root())).not.toContain('gemini-fixture-model');
  });
});

describe('manual sampled history and visible-only cheap polling', () => {
  it('mount, timers, visibility changes and status refresh never request metrics', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' }); vi.stubGlobal('document', page);
    const f = vi.fn(async (_url: string) => response(freeChainViewFixture())); await mount(f);
    await vi.advanceTimersByTimeAsync(60_000); await settle(); expect(f).toHaveBeenCalledTimes(3);
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000); await settle(); expect(f).toHaveBeenCalledTimes(3);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); await settle(); expect(f).toHaveBeenCalledTimes(4);
    button('Refresh status').props.onClick(); await settle(); expect(f).toHaveBeenCalledTimes(5);
    expect(f.mock.calls.every(([url]) => url === '/api/v1/admin/free-chat-chain')).toBe(true);
  });
  it('a panel mounted hidden waits until visible and never scans history on return', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'hidden' }); vi.stubGlobal('document', page);
    const f = vi.fn(async (_url: string) => response(freeChainViewFixture())); await mount(f);
    await vi.advanceTimersByTimeAsync(60_000); expect(f).not.toHaveBeenCalled();
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(f).toHaveBeenCalledTimes(1); expect(f.mock.calls[0][0]).toBe('/api/v1/admin/free-chat-chain');
  });
  it('only a deliberate button reads metrics and its timestamp survives status polling', async () => {
    const f = vi.fn(async (url: string) => response(url.endsWith('/metrics') ? freeChainMetricsFixture({ sampleCount: 2, fallbackRate: .5, p95Ms: 30 }) : freeChainViewFixture()));
    await mount(f); button('Refresh sampled metrics').props.onClick(); await settle();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain/metrics', expect.objectContaining({ headers: { 'x-admin-token': 'private-admin-token' } }));
    const html = renderToStaticMarkup(root()); expect(html).toContain('2 retained samples'); expect(html).toContain('Partial retained sample'); expect(html).toContain('uniformly sampled 1-in-64'); expect(html).toContain('not exact production rates or p95'); expect(html).toContain('50.0%');
    const snapshot = elements(root()).find(e => e.type === 'time')!.props.dateTime;
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(elements(root()).find(e => e.type === 'time')!.props.dateTime).toBe(snapshot);
    expect(f.mock.calls.filter(([url]) => url.endsWith('/metrics'))).toHaveLength(1);
  });
  it('double clicking the same rendered metrics action cannot cause overlapping scans', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); const click = button('Refresh sampled metrics').props.onClick; click(); click();
    expect(f).toHaveBeenCalledTimes(2); expect(button('Reading samples…').props.disabled).toBe(true);
    finish(response(freeChainMetricsFixture())); await settle(); expect(button('Refresh sampled metrics').props.disabled).toBe(false);
  });
  it.each([response({}, false, 503), response({}, false, 429), response({ sampleCount: 0 })])('failed or malformed scans preserve a visibly stale prior snapshot %#', async failure => {
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockResolvedValueOnce(response(freeChainMetricsFixture({ sampleCount: 7 }))).mockResolvedValueOnce(failure);
    await mount(f); button('Refresh sampled metrics').props.onClick(); await settle();
    const snapshot = elements(root()).find(e => e.type === 'time')!.props.dateTime;
    button('Refresh sampled metrics').props.onClick(); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('Previous metrics are stale'); expect(html).toContain('7 retained samples');
    expect(elements(root()).find(e => e.type === 'time')!.props.dateTime).toBe(snapshot);
    expect(button('Stop chain').props.disabled).toBe(false); expect(f).toHaveBeenCalledTimes(3);
  });
  it('a failed first scan remains unavailable rather than displaying zero traffic', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockResolvedValueOnce(response({}, false, 403));
    await mount(f); button('Refresh sampled metrics').props.onClick(); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('No sampled metrics have been verified'); expect(html).not.toContain('0 retained samples'); expect(html).not.toContain('Metrics snapshot as of');
  });
  it('a hidden page cannot start a metrics scan even through an old button callback', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' }); vi.stubGlobal('document', page);
    const f = vi.fn(async (_url: string) => response(freeChainViewFixture())); await mount(f);
    const click = button('Refresh sampled metrics').props.onClick; page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange')); click();
    await settle(); expect(f).toHaveBeenCalledTimes(1);
  });
  it('a response that ignores timeout cancellation cannot overwrite metrics with a late success', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); button('Refresh sampled metrics').props.onClick(); await vi.advanceTimersByTimeAsync(15_000);
    finish(response(freeChainMetricsFixture({ sampleCount: 8 }))); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('Sampled metrics read timed out'); expect(html).not.toContain('8 retained samples');
  });
  it('a hung explicit scan times out without any automatic retry', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await mount(f); button('Refresh sampled metrics').props.onClick(); await vi.advanceTimersByTimeAsync(15_000); await settle();
    expect(renderToStaticMarkup(root())).toContain('Sampled metrics read timed out. No automatic retry'); expect(f).toHaveBeenCalledTimes(2);
  });
  it('unmount aborts an explicit scan and ignores its late response', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); button('Refresh sampled metrics').props.onClick();
    const signal = f.mock.calls[1][1].signal as AbortSignal;
    cleanup.forEach(f => f()); cleanup = []; expect(signal.aborted).toBe(true);
    finish(response(freeChainMetricsFixture({ sampleCount: 5 }))); await settle(); expect(renderToStaticMarkup(root())).not.toContain('5 retained samples');
  });
  it('hiding during a control does not invalidate its confirmation or initiate a history scan', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' }); vi.stubGlobal('document', page);
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(freeChainViewFixture())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); button('Stop chain').props.onClick(); fillReason(); submit();
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange')); finish(response({ ok: true })); await settle();
    expect(renderToStaticMarkup(root())).toContain('Control recorded'); expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('provider observations do not promise quota availability', () => {
  it('shows missing usage and reset as unavailable rather than zero or unlimited', () => {
    const html = renderToStaticMarkup(<FreeChainProviderCard provider={freeChainViewFixture().providers[0]} position={1} now={1500} trusted={true} controlsBlocked={false} onToggle={() => {}} />);
    expect(html).toContain('Unavailable'); expect(html).toContain('Not configured'); expect(html).not.toContain('Healthy'); expect(html).not.toContain('Unlimited');
  });
  it('a passed reset time does not claim quota was refilled', () => {
    const provider = { ...freeChainViewFixture().providers[0], nextResetAt: 1000, usage: { requestsDay: 20 }, limits: { requestsDay: 20 }, circuit: { state: 'open', openedUntil: 2000 } };
    const html = renderToStaticMarkup(<FreeChainProviderCard provider={provider} position={1} now={1500} trusted={true} controlsBlocked={false} onToggle={() => {}} />);
    expect(html).toContain('reset time reached; refresh to verify quota'); expect(html).toContain('20 / 20'); expect(html).toContain('open until');
  });
});


describe('durable shared paid-budget review', () => {
  const view = () => freeChainViewFixture({ paid: { policyState: 'initialized', capUsd: 2, configuredCapUsd: 10, policyRevision: 3, reservedUsd: 3, reportedUsd: 1 } });
  const fillBudget = (value: string) => elements(root()).find(e => e.type === 'input' && e.props['aria-label'] === 'New total daily cap')!.props.onChange({ target: { value } });
  it('distinguishes shared authority, local configuration and already-held amounts without invoice claims', async () => {
    const f = vi.fn(async () => response(view())); await mount(f);
    const html = renderToStaticMarkup(root());
    for (const label of ['Effective shared daily cap', 'This deployment’s configured limit', 'Shared policy revision', 'Reserved upper-bound cost', 'does not refund or cancel', 'separate from the existing funded builder wallet', 'Missing or incomplete usage keeps the full reservation held']) expect(html).toContain(label);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each(['-1', '10.01', '0.001', '', 'NaN'])('blocks invalid or over-ceiling client value %s', async value => {
    await mount(vi.fn(async () => response(view()))); fillBudget(value); expect(button('Review budget change').props.disabled).toBe(true);
  });
  it('blocks a value above the process limit and malformed initialized authority revision', async () => {
    const limited = view(); limited.paid.configuredCapUsd = 1;
    const f = vi.fn().mockResolvedValueOnce(response(limited)).mockResolvedValueOnce(response({ ...limited, paid: { ...limited.paid, capUsd: null, policyRevision: null } })); await mount(f);
    fillBudget('1.01'); expect(button('Review budget change').props.disabled).toBe(true);
    button('Refresh status').props.onClick(); await settle(); fillBudget('0'); expect(button('Review budget change').props.disabled).toBe(true);
  });
  it('a zero-cap action is explicit, reasoned and includes exactly the reviewed revision', async () => {
    const after = view(); after.paid.capUsd = 0; after.paid.policyRevision = 4;
    const f = vi.fn().mockResolvedValueOnce(response(view())).mockResolvedValueOnce(response({ ok: true, capUsd: 0, policyRevision: 4 })).mockResolvedValue(response(after)); await mount(f);
    fillBudget('0'); button('Review budget change').props.onClick(); expect(button('Confirm control').props.disabled).toBe(true);
    expect(renderToStaticMarkup(root())).toContain('using policy revision 3'); fillReason(); submit(); await settle();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain/budget', expect.objectContaining({ method: 'POST', body: JSON.stringify({ capUsd: 0, expectedRevision: 3, reason: 'Investigating provider errors' }) }));
    expect(renderToStaticMarkup(root())).toContain('Budget control recorded. Existing holds remain');
    expect(renderToStaticMarkup(root())).toContain('$3.0000 USD');
  });
  it('a raise is reviewed deliberately rather than submitted by number input or status refresh', async () => {
    const f = vi.fn(async () => response(view())); await mount(f); fillBudget('10'); button('Review budget change').props.onClick(); fillReason();
    expect(renderToStaticMarkup(root())).toContain('intentional budget change'); expect(f).toHaveBeenCalledTimes(1);
  });
  it('a changed policy revision invalidates an open review even when the cap is unchanged', async () => {
    const next = view(); next.paid.policyRevision = 4;
    const f = vi.fn().mockResolvedValueOnce(response(view())).mockResolvedValue(response(next)); await mount(f);
    fillBudget('0'); button('Review budget change').props.onClick(); fillReason(); button('Refresh status').props.onClick(); await settle();
    expect(button('Confirm control').props.disabled).toBe(true); expect(renderToStaticMarkup(root())).toContain('Settings changed after this review opened');
    submit(); await settle(); expect(f.mock.calls.some(call => String(call[0]).endsWith('/budget'))).toBe(false);
  });
  it.each([response({}, false, 409), response({}, false, 503), response({ ok: true }), response({ ok: true, capUsd: 0, policyRevision: 3 }), response({ ok: true, capUsd: 10, policyRevision: 4 })])('unconfirmed response %# clears review, keeps uncertainty and never repeats the write', async result => {
    const f = vi.fn().mockResolvedValueOnce(response(view())).mockResolvedValueOnce(result).mockResolvedValue(response(view())); await mount(f);
    fillBudget('0'); button('Review budget change').props.onClick(); fillReason(); submit(); await settle();
    const html = renderToStaticMarkup(root()); expect(html).toContain('Refresh before retrying'); expect(html).not.toContain('Budget control recorded'); expect(elements(root()).some(e => e.type === 'form')).toBe(false);
    await vi.advanceTimersByTimeAsync(90_000); expect(f.mock.calls.filter(call => String(call[0]).endsWith('/budget'))).toHaveLength(1);
  });
  it('duplicate confirmations while pending send one budget mutation', async () => {
    let finish!: (value: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(view())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response(view())); await mount(f);
    fillBudget('0'); button('Review budget change').props.onClick(); fillReason();
    const handler = elements(root()).find(e => e.type === 'form')!.props.onSubmit; handler({ preventDefault() {} }); handler({ preventDefault() {} });
    expect(f.mock.calls.filter(call => String(call[0]).endsWith('/budget'))).toHaveLength(1); finish(response({ ok: true, capUsd: 0, policyRevision: 4 })); await settle();
  });
  it('an aborted late success remains uncertain without retrying or claiming confirmation', async () => {
    let finish!: (value: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(view())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mount(f);
    fillBudget('0'); button('Review budget change').props.onClick(); fillReason(); submit(); await vi.advanceTimersByTimeAsync(30_000);
    finish(response({ ok: true, capUsd: 0, policyRevision: 4 })); await settle();
    expect(renderToStaticMarkup(root())).toContain('outcome is uncertain'); expect(renderToStaticMarkup(root())).not.toContain('Budget control recorded'); expect(f).toHaveBeenCalledTimes(2);
  });
});


describe('explicit first-use budget initialization', () => {
 const absent = () => freeChainViewFixture({ paid: { policyState: 'uninitialized', capUsd: null, configuredCapUsd: 10, policyRevision: null, reservedUsd: null, reportedUsd: null } });
 const zero = () => elements(root()).find(e => e.type === 'input' && e.props['aria-label'] === 'New total daily cap')!.props.onChange({ target: { value: '0' } });
 it('verified absence can initialize zero deliberately before enabling any chat', async () => {
  const next = absent(); next.paid = { ...next.paid, policyState: 'initialized', capUsd: 0, policyRevision: 1 };
  const f = vi.fn().mockResolvedValueOnce(response(absent())).mockResolvedValueOnce(response({ ok: true, capUsd: 0, policyRevision: 1 })).mockResolvedValue(response(next)); await mount(f);
  expect(renderToStaticMarkup(root())).toContain('Not initialized; verified absent'); expect(f).toHaveBeenCalledTimes(1);
  zero(); button('Review budget initialization').props.onClick(); expect(renderToStaticMarkup(root())).toContain('Initialize shared paid fallback budget');
  expect(button('Confirm control').props.disabled).toBe(true); fillReason(); submit(); await settle();
  expect(f).toHaveBeenCalledWith('/api/v1/admin/free-chat-chain/budget', expect.objectContaining({ body: JSON.stringify({ capUsd: 0, expectedRevision: 0, reason: 'Investigating provider errors' }) }));
  expect(renderToStaticMarkup(root())).toContain('Budget control recorded'); expect(renderToStaticMarkup(root())).toContain('Disabled by server configuration');
 });
 it.each([response({}, false, 503), response({ paid: { policyState: 'uninitialized' } }), response({ ...absent(), paid: { ...absent().paid, capUsd: 0 } })])('failure or inconsistent schema %# never creates an initialization review', async result => {
  const f = vi.fn(async () => result); await mount(f);
  expect(button('Review budget initialization')).toBeUndefined(); expect(f).toHaveBeenCalledTimes(1);
  expect(renderToStaticMarkup(root())).toContain('No quota, budget or routing health has been verified');
 });
 it('a read failure after verified absence blocks a previously opened initialization review', async () => {
  const f = vi.fn().mockResolvedValueOnce(response(absent())).mockResolvedValue(response({}, false, 503)); await mount(f);
  zero(); button('Review budget initialization').props.onClick(); fillReason(); button('Refresh status').props.onClick(); await settle();
  expect(button('Confirm control').props.disabled).toBe(true); submit(); await settle(); expect(f).toHaveBeenCalledTimes(2);
 });
 it('another initializer changes state and invalidates revision-zero review', async () => {
  const f = vi.fn().mockResolvedValueOnce(response(absent())).mockResolvedValue(response(freeChainViewFixture())); await mount(f);
  zero(); button('Review budget initialization').props.onClick(); fillReason(); button('Refresh status').props.onClick(); await settle();
  expect(button('Confirm control').props.disabled).toBe(true); expect(renderToStaticMarkup(root())).toContain('Settings changed after this review opened');
 });
});

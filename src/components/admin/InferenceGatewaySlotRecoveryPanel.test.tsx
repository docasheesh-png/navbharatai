import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (v: unknown) => { hooks.values[n] = typeof v === 'function' ? v(hooks.values[n]) : v; }]; },
  useRef: (initial: unknown) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); },
  useEffect: (fn: () => (() => void) | void) => hooks.effects.push(fn),
}));
import { InferenceGatewaySlotRecoveryPanel } from './InferenceGatewaySlotRecoveryPanel';
const START = 1_800_000_010_000;
let cleanup: (() => void)[] = [];
let data: Record<string, string>;
let recovered: ReturnType<typeof vi.fn<() => void>>;
interface Element { type: unknown; props: Record<string, any> }
function elements(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!React.isValidElement(node)) return []; const e = node as Element; return [e, ...elements(e.props.children)]; }
const root = (token = 'private-admin-session') => { hooks.cursor = 0; hooks.refCursor = 0; return InferenceGatewaySlotRecoveryPanel({ adminToken: token, onRecovered: recovered }); };
const button = (label: string) => elements(root()).find(e => e.type === 'button' && e.props.children === label)!;
const form = () => elements(root()).find(e => e.type === 'form')!;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
const preview = () => ({ kind: 'gateway_slot_recovery_preview', version: 1, previewBinding: 'a'.repeat(64), physicalAttemptId: 'attempt-one', canonicalAccountId: 'account-one', modelId: 'glm-4.7-flash', occupied: 1, scope: 'gateway-only', financialWrites: false, evidenceBasis: 'admin-reviewed-provider-record' });
async function mount(f: ReturnType<typeof vi.fn>) { vi.stubGlobal('fetch', f); root(); for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); } await settle(); }
async function showPreview() { form().props.ref.current = {}; await form().props.onSubmit({ preventDefault: () => {} }); await settle(); }
const confirm = () => button('Confirm exact slot release').props.onClick();
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.refs = []; hooks.refCursor = 0; hooks.effects = []; recovered = vi.fn<() => void>(); vi.useFakeTimers(); vi.setSystemTime(START);
  data = { canonicalAccountId: 'account-one', modelId: 'glm-4.7-flash', physicalAttemptId: 'attempt-one', providerRequestId: 'provider-request-one', evidenceRef: 'review:independent-provider-record',
    providerCompletedAt: new Date(START - 10_000).toISOString(), providerRecordVerified: 'on', exactAttemptMatched: 'on', upstreamFinished: 'on', reason: 'Independent provider completion evidence reviewed' };
  vi.stubGlobal('FormData', class { get(key: string) { return data[key] ?? null; } });
});
afterEach(() => { cleanup.forEach(fn => fn()); cleanup = []; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('exact-attempt recovery UI', () => {
  it('does not fetch on mount or precheck attestations, and explains no-evidence/no-release', async () => {
    const f = vi.fn(); await mount(f); expect(f).not.toHaveBeenCalled(); const html = renderToStaticMarkup(root());
    expect(html).toContain('Without that evidence, leave the slot occupied'); expect(html).toContain('does not refund money'); expect(html).not.toContain('private-admin-session');
    expect(elements(root()).filter(e => e.type === 'input' && e.props.type === 'checkbox').every(e => !e.props.checked && !e.props.defaultChecked)).toBe(true);
  });
  it.each(['providerRecordVerified', 'exactAttemptMatched', 'upstreamFinished'])('requires independent %s check before preview', async key => {
    delete data[key]; const f = vi.fn(); await mount(f); await showPreview(); expect(f).not.toHaveBeenCalled(); expect(renderToStaticMarkup(root())).toContain('All three independent provider-record checks');
  });
  it('previews exact typed evidence with admin headers and does not mutate', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(preview()), { status: 200 })); await mount(f); await showPreview();
    expect(f).toHaveBeenCalledOnce(); expect(f.mock.calls[0][0]).toBe('/api/v1/admin/inference-gateway/setup/preview');
    expect(f.mock.calls[0][1]!.headers).toEqual({ 'x-admin-token': 'private-admin-session', 'Content-Type': 'application/json' });
    const body = JSON.parse(f.mock.calls[0][1]!.body as string); expect(body).toMatchObject({ kind: 'model-slot-recovery', physicalAttemptId: 'attempt-one', providerRequestId: 'provider-request-one', providerRecordVerified: true, exactAttemptMatched: true, upstreamFinished: true, reason: data.reason });
    expect(body).not.toHaveProperty('apiKey'); expect(renderToStaticMarkup(root())).toContain('Preview only'); expect(button('Confirm exact slot release').props.disabled).toBe(false);
  });
  it.each([null, {}, { ...preview(), physicalAttemptId: 'other-attempt' }, { ...preview(), financialWrites: true }])('rejects malformed/mismatched preview without a save control %#', async result => {
    await mount(vi.fn(async () => response(result))); await showPreview(); expect(button('Confirm exact slot release')).toBeUndefined(); expect(renderToStaticMarkup(root())).toContain('incomplete or mismatched');
  });
  it('editing or cancelling invalidates the exact preview', async () => {
    const f = vi.fn(async () => response(preview())); await mount(f); await showPreview(); form().props.onChange(); expect(button('Confirm exact slot release')).toBeUndefined();
    await showPreview(); button('Cancel recovery review').props.onClick(); expect(button('Confirm exact slot release')).toBeUndefined(); expect(f).toHaveBeenCalledTimes(2);
  });
  it('sends a single release on double confirm and validates the matching operation response', async () => {
    let resolve!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await mount(f); await showPreview(); confirm(); confirm(); expect(f).toHaveBeenCalledTimes(2);
    const body = JSON.parse(f.mock.calls[1][1].body); expect(body.previewBinding).toBe('a'.repeat(64)); expect(body.submission.operationId).toBe(JSON.parse(f.mock.calls[0][1].body).operationId);
    resolve(response({ ok: true, recovery: true, operationId: body.submission.operationId, catalogRevision: 'unchanged-revision' })); await settle();
    expect(recovered).toHaveBeenCalledOnce(); expect(renderToStaticMarkup(root())).toContain('slot release was confirmed'); expect(button('Confirm exact slot release')).toBeUndefined();
  });
  it('keeps the exact operation after uncertain save and never retries automatically', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockRejectedValueOnce(new Error('provider echoed a private secret')).mockResolvedValueOnce(response(preview()));
    await mount(f); await showPreview(); confirm(); await settle(); expect(f).toHaveBeenCalledTimes(2); expect(recovered).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(root())).not.toContain('provider echoed'); expect(renderToStaticMarkup(root())).toContain('No automatic retry'); expect(button('Confirm exact slot release')).toBeUndefined();
    await showPreview(); expect(JSON.parse(f.mock.calls[2][1].body)).toEqual(JSON.parse(f.mock.calls[0][1].body));
  });
  it('handles stale conflict with no success and clears the save control', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockResolvedValueOnce(response({ error: 'private details' }, false, 409));
    await mount(f); await showPreview(); confirm(); await settle(); expect(recovered).not.toHaveBeenCalled(); expect(button('Confirm exact slot release')).toBeUndefined();
    expect(renderToStaticMarkup(root())).toContain('occupancy changed'); expect(renderToStaticMarkup(root())).not.toContain('private details');
  });
  it('refuses expired or backward-clock confirmation without sending a mutation', async () => {
    const f = vi.fn(async () => response(preview())); await mount(f); await showPreview(); vi.setSystemTime(START + 900_000); await vi.advanceTimersByTimeAsync(1000);
    expect(button('Confirm exact slot release').props.disabled).toBe(true); confirm(); expect(f).toHaveBeenCalledOnce();
    vi.setSystemTime(START - 1); confirm(); expect(f).toHaveBeenCalledOnce();
  });
  it('aborts on unmount and ignores the late mutation result', async () => {
    let resolve!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await mount(f); await showPreview(); confirm(); const body = JSON.parse(f.mock.calls[1][1].body); const signal = f.mock.calls[1][1].signal;
    cleanup.forEach(fn => fn()); cleanup = []; expect(signal.aborted).toBe(true);
    resolve(response({ ok: true, recovery: true, operationId: body.submission.operationId, catalogRevision: 'same' })); await settle(); expect(recovered).not.toHaveBeenCalled();
  });
  it('does not convert a confirmed release into failure when parent status refresh throws', async () => {
    recovered.mockImplementation(() => { throw new Error('status refresh unavailable'); });
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockImplementationOnce(async (_url, options) => response({ ok: true, recovery: true, operationId: JSON.parse(options.body).submission.operationId, catalogRevision: 'same' }));
    await mount(f); await showPreview(); confirm(); await settle(); expect(renderToStaticMarkup(root())).toContain('slot release was confirmed'); expect(renderToStaticMarkup(root())).not.toContain('role="alert"');
  });
  it('rejects a future completion date without sending a request', async () => {
    data.providerCompletedAt = new Date(START + 1).toISOString(); const f = vi.fn(); await mount(f); await showPreview();
    expect(f).not.toHaveBeenCalled(); expect(renderToStaticMarkup(root())).toContain('not a future time');
  });
  it('does not reflect an authentication error payload', async () => {
    const f = vi.fn(async () => response({ error: 'private provider details' }, false, 403)); await mount(f); await showPreview();
    expect(renderToStaticMarkup(root())).toContain('Admin sign-in is required'); expect(renderToStaticMarkup(root())).not.toContain('private provider details');
    expect(button('Confirm exact slot release')).toBeUndefined();
  });
  it('never accepts a success receipt for a different operation', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockResolvedValueOnce(response({ ok: true, recovery: true, operationId: 'other-operation', catalogRevision: 'same' }));
    await mount(f); await showPreview(); confirm(); await settle(); expect(recovered).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(root())).toContain('response was incomplete'); expect(button('Confirm exact slot release')).toBeUndefined();
  });
  it('aborts a timed-out save without replaying it or claiming a release', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(preview())).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted transport details')));
    }));
    await mount(f); await showPreview(); confirm(); await vi.advanceTimersByTimeAsync(15_000); await settle();
    expect(f).toHaveBeenCalledTimes(2); expect(recovered).not.toHaveBeenCalled(); expect(renderToStaticMarkup(root())).toContain('No automatic retry');
    expect(renderToStaticMarkup(root())).not.toContain('aborted transport details');
  });

});

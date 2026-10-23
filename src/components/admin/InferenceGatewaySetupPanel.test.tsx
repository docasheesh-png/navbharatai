import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GATEWAY_ATTESTATIONS, GATEWAY_REVIEW_FIELDS, type GatewaySetupStatus } from '../../lib/inferenceGatewaySetup';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (v: unknown) => { hooks.values[n] = typeof v === 'function' ? v(hooks.values[n]) : v; }]; },
  useRef: (initial: unknown) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); }, useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => (() => void) | void) => hooks.effects.push(fn),
}));
import { InferenceGatewaySetupPanel } from './InferenceGatewaySetupPanel';
const START = 1_800_000_010_000;
let cleanup: (() => void)[] = [];
interface Element { type: unknown; props: Record<string, any> }
function elements(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!React.isValidElement(node)) return []; const e = node as Element; return [e, ...elements(e.props.children)]; }
const root = () => { hooks.cursor = 0; hooks.refCursor = 0; return InferenceGatewaySetupPanel({ adminToken: 'private-admin-token' }); };
const button = (label: string) => elements(root()).find(e => e.type === 'button' && e.props.children === label)!;
const form = () => elements(root()).find(e => e.type === 'form')!;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
const status = (): GatewaySetupStatus => ({ kind: 'gateway_setup_status', version: 1, observedAtMs: START, deploymentEnabled: false, catalogRevision: null, reviewState: 'missing', expiresAtMs: null,
  credentialEnvironments: ['INFERENCE_GATEWAY_TEST_KEY'], scopes: [{ key: 'chat:text', label: 'Free chat text', qualityTier: 'clinical', dataClass: 'health' }], profiles: [], paidAuthority: 'missing', paidCapUsd: null, upstreamRemaining: 'unknown', liveProviderVerified: false });
const preview = () => ({ kind: 'gateway_setup_preview', version: 1, previewBinding: 'a'.repeat(64), profileId: 'glm47', canonicalAccountId: 'canonical-account', policyKeys: ['chat:text'], billing: 'intrinsic-zero',
  expiresAtMs: START + 60_000, localTokensPerMinute: 100_000, reviewedPriority: 10, credentialAssociated: true, paidAuthority: 'missing', activationFlagChanged: false, deploymentEnabled: false });
function fields(): Record<string, string> {
  return { profileId: 'glm47', provider: 'GLM', modelId: 'glm-4.7-flash', modelRevision: 'v1', canonicalModelId: 'glm47flash', canonicalAccountId: 'canonical-account', credentialEnv: 'INFERENCE_GATEWAY_TEST_KEY', platformOwnerId: 'platform-owner',
    policyKeys: 'chat:text', termsPolicyId: 'terms-v1', qualityGateId: 'clinical-v1', qualityGateVersion: 'v1', privacyPolicyId: 'privacy-v1', processingRegions: 'reviewed-region', retentionHours: '0',
    maxInputTokens: '4096', maxOutputTokens: '512', maxContextTokens: '8192', localTokensPerMinute: '100000', billing: 'intrinsic-zero', expiresAt: new Date(START + 60_000).toISOString(), reason: 'Independent evidence checked',
    ...Object.fromEntries(GATEWAY_REVIEW_FIELDS.map(k => [`evidence.${k}`, `review:${k}-review`])), ...Object.fromEntries(GATEWAY_ATTESTATIONS.map(k => [`attest.${k}`, 'on'])) };
}
async function mount(f: ReturnType<typeof vi.fn>) { vi.stubGlobal('fetch', f); root(); for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); } await settle(); }
async function showPreview() { form().props.ref.current = {}; await form().props.onSubmit({ preventDefault: () => {} }); await settle(); }
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.refs = []; hooks.refCursor = 0; hooks.effects = []; vi.useFakeTimers(); vi.setSystemTime(START);
  vi.stubGlobal('FormData', class { get(key: string) { return fields()[key] ?? null; } getAll(key: string) { return [this.get(key)].filter(Boolean); } }); });
afterEach(() => { cleanup.forEach(fn => fn()); cleanup = []; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('typed gateway setup panel', () => {
  it('initial and missing review states never claim ready/free remaining balance', async () => {
    expect(renderToStaticMarkup(root())).toContain('Upstream remaining capacity is unknown');
    await mount(vi.fn(async () => response(status()))); const html = renderToStaticMarkup(root());
    expect(html).toContain('Saved review: missing'); expect(html).toContain('missing; no paid spending authorized'); expect(html).toContain('paid Doctor/SDA');
    expect(html).not.toContain('private-admin-token'); expect(elements(root()).filter(e => e.type === 'input' && e.props.type === 'checkbox').every(e => !e.props.checked && !e.props.defaultChecked)).toBe(true);
    expect(elements(root()).some(e => e.type === 'textarea' && e.props.name !== 'reason')).toBe(false);
  });
  it('only loads authenticated versioned saved status on mount, with no provider probes', async () => {
    const f = vi.fn(async () => response(status())); await mount(f); expect(f).toHaveBeenCalledOnce();
    expect(f).toHaveBeenCalledWith('/api/v1/admin/inference-gateway/setup', expect.objectContaining({ method: 'GET', headers: { 'x-admin-token': 'private-admin-token' } }));
  });
  it.each([response(null), response({}), response({ error: 'upstream secret' }, false, 403)])('bad/auth status leaves setup unavailable, not defaults %#', async result => {
    await mount(vi.fn(async () => result)); const html = renderToStaticMarkup(root()); expect(html).toContain('role="alert"'); expect(html).not.toContain('upstream secret');
    expect(button('Validate and preview review').props.disabled).toBe(true);
  });
  it('preview submits typed evidence with expected revision and server-secret reference only, never saves', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(preview())); await mount(f); await showPreview();
    expect(f).toHaveBeenCalledTimes(2); const [url, options] = f.mock.calls[1]; expect(String(url).endsWith('/preview')).toBe(true);
    const body = JSON.parse(options.body); expect(body).toMatchObject({ expectedCatalogRevision: null, credentialEnv: 'INFERENCE_GATEWAY_TEST_KEY', policyKeys: ['chat:text'], billing: 'intrinsic-zero' });
    expect(body).not.toHaveProperty('credentialBinding'); expect(body).not.toHaveProperty('apiKey');
    expect(renderToStaticMarkup(root())).toContain('Preview has not saved anything'); expect(button('Save this reviewed configuration').props.disabled).toBe(false);
  });
  it('editing any form field or cancelling removes the pending review and save control', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValue(response(preview())); await mount(f); await showPreview();
    form().props.onChange(); expect(button('Save this reviewed configuration')).toBeUndefined(); await showPreview(); button('Cancel review').props.onClick();
    expect(button('Save this reviewed configuration')).toBeUndefined(); expect(f).toHaveBeenCalledTimes(3);
  });
  it('double save performs one mutation and no automatic retry or routing/budget request', async () => {
    let complete: (value: unknown) => void = () => {};
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(preview())).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await mount(f); await showPreview(); const save = button('Save this reviewed configuration').props.onClick; save(); save(); await settle();
    expect(f).toHaveBeenCalledTimes(3); const body = JSON.parse(f.mock.calls[2][1].body); expect(String(f.mock.calls[2][0]).endsWith('/review')).toBe(true); expect(Object.keys(body).sort()).toEqual(['previewBinding', 'submission']);
    complete(response({ ok: true, catalogRevision: body.submission.operationId, operationId: body.submission.operationId })); await settle();
    expect(renderToStaticMarkup(root())).toContain('Review saved atomically'); expect(button('Save this reviewed configuration')).toBeUndefined(); expect(f).toHaveBeenCalledTimes(3);
  });
  it('expired review cannot be saved and active deployment warning states the eligibility effect', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response({ ...preview(), deploymentEnabled: true }));
    await mount(f); await showPreview(); expect(renderToStaticMarkup(root())).toContain('saving can make this model eligible immediately');
    vi.advanceTimersByTime(61_000); expect(button('Save this reviewed configuration').props.disabled).toBe(true);
    button('Save this reviewed configuration').props.onClick(); await settle(); expect(f).toHaveBeenCalledTimes(2);
  });
  it('uncertain save clears pending write and requests saved-state reconciliation, never successful or automatic retry', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(preview())).mockResolvedValueOnce(response({}, false, 503));
    await mount(f); await showPreview(); button('Save this reviewed configuration').props.onClick(); await settle(); const html = renderToStaticMarkup(root());
    expect(html).toContain('Refresh saved status'); expect(html).not.toContain('Review saved atomically'); expect(button('Validate and preview review').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(3);
  });
  it('unmount aborts a pending request and late results cannot show a stale preview', async () => {
    let complete: (value: unknown) => void = () => {};
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })); await mount(f);
    form().props.ref.current = {}; void form().props.onSubmit({ preventDefault: () => {} }); await settle(); cleanup.forEach(fn => fn()); cleanup = [];
    expect(f.mock.calls[1][1].signal.aborted).toBe(true); complete(response(preview())); await settle(); expect(button('Save this reviewed configuration')).toBeUndefined();
  });
});

it.each([
 { kind: 'embedding', provider: 'VERTEX', extra: { credentialEnv: 'ADC', project: 'my-project', location: 'us-central1', credentialPrincipal: 'runtime@my-project.iam.gserviceaccount.com', maxInputBytes: '4096', maxNanoUsdPerCharacter: '25' } },
 { kind: 'grounding-search', provider: 'BRAVE', extra: { maxQueryBytes: '1000', maxResults: '5', requestNanoUsd: '5000000' } },
 { kind: 'vision-pdf', provider: 'GLM', extra: { maxImages: '2', maxAttachmentBytes: '1000000', maxImageDimension: '2048' } },
])('submits typed $kind operation evidence and exact units without invented credentials', async ({ kind, provider, extra }) => {
 const data: Record<string, string> = { ...fields(), ...extra, provider, billing: kind === 'vision-pdf' ? 'intrinsic-zero' : 'metered' };
 vi.stubGlobal('FormData', class { get(key: string) { return data[key] ?? null; } getAll(key: string) { return [this.get(key)].filter(Boolean); } });
 const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(preview())); await mount(f);
 elements(root()).find(e => e.type === 'select' && e.props.name === 'operation')!.props.onChange({ target: { value: kind } });
 elements(root()).find(e => e.type === 'select' && e.props.name === 'provider')!.props.onChange({ target: { value: provider } });
 elements(root()).find(e => e.type === 'select' && e.props.name === 'billing')!.props.onChange({ target: { value: data.billing } });
 await showPreview(); const submitted = JSON.parse(f.mock.calls[1][1].body);
 expect(submitted.operation.kind).toBe(kind); expect(submitted).not.toHaveProperty('inputNanoUsdPerMillion');
 expect(submitted).not.toHaveProperty('apiKey'); expect(submitted.policyKeys).toEqual(['chat:text']);
 if (kind === 'embedding') expect(submitted.operation).toMatchObject({ maxNanoUsdPerCharacter: 25, project: 'my-project' });
 if (kind === 'grounding-search') expect(submitted.operation.requestNanoUsd).toBe(5000000);
 if (kind === 'vision-pdf') expect(submitted.operation.maxPdfPages).toBe(0);
});

it('submits paid Gemini PDF review with explicit full-context rates, never a free or estimated-page claim', async () => {
 const data: Record<string, string> = { ...fields(), provider: 'GEMINI', modelId: 'gemini-2.5-flash', billing: 'metered', maxInputTokens: '1048576', maxContextTokens: '1056768', maxOutputTokens: '8192', maxImages: '2', maxAttachmentBytes: '1000000', maxImageDimension: '2048', inputNanoUsdPerMillion: '300000000', outputNanoUsdPerMillion: '2500000000' };
 vi.stubGlobal('FormData', class { get(key: string) { return data[key] ?? null; } getAll(key: string) { return [this.get(key)].filter(Boolean); } });
 const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(preview())); await mount(f);
 elements(root()).find(e => e.type === 'select' && e.props.name === 'operation')!.props.onChange({ target: { value: 'vision-pdf' } });
 elements(root()).find(e => e.type === 'select' && e.props.name === 'provider')!.props.onChange({ target: { value: 'GEMINI' } });
 elements(root()).find(e => e.type === 'select' && e.props.name === 'billing')!.props.onChange({ target: { value: 'metered' } });
 await showPreview(); const submitted = JSON.parse(f.mock.calls[1][1].body);
 expect(submitted).toMatchObject({ provider: 'GEMINI', billing: 'metered', maxInputTokens: 1048576, inputNanoUsdPerMillion: 300000000, outputNanoUsdPerMillion: 2500000000, operation: { kind: 'vision-pdf', maxPdfPages: 1000 } });
 expect(submitted.operation).not.toHaveProperty('measuredPages');
});

it('submits image-only Gemini fallback with the reviewed common image request ceiling', async () => {
 const data: Record<string, string> = { ...fields(), mediaRequestKind: 'image', provider: 'GEMINI', modelId: 'gemini-2.5-flash', billing: 'metered', maxInputTokens: '4096', maxContextTokens: '1056768', maxOutputTokens: '8192', maxImages: '2', maxAttachmentBytes: '1000000', maxImageDimension: '2048', inputNanoUsdPerMillion: '300000000', outputNanoUsdPerMillion: '2500000000' };
 vi.stubGlobal('FormData', class { get(key: string) { return data[key] ?? null; } getAll(key: string) { return [this.get(key)].filter(Boolean); } });
 const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(preview())); await mount(f);
 elements(root()).find(e => e.type === 'select' && e.props.name === 'operation')!.props.onChange({ target: { value: 'vision-pdf' } });
 elements(root()).find(e => e.type === 'select' && e.props.name === 'provider')!.props.onChange({ target: { value: 'GEMINI' } });
 elements(root()).find(e => e.type === 'select' && e.props.name === 'billing')!.props.onChange({ target: { value: 'metered' } });
 await showPreview(); const submitted = JSON.parse(f.mock.calls[1][1].body);
 expect(submitted).toMatchObject({ provider: 'GEMINI', billing: 'metered', maxInputTokens: 4096, inputNanoUsdPerMillion: 300000000, outputNanoUsdPerMillion: 2500000000, operation: { kind: 'vision-pdf', maxPdfPages: 0 } });
 expect(submitted.operation).not.toHaveProperty('measuredPages');
});

it('requires explicit health recovery selection and displays the exact reviewed record count', async () => {
 const data: Record<string,string> = { ...fields(), recoverHealth: 'on' };
 vi.stubGlobal('FormData', class { get(key: string) { return data[key] ?? null; } getAll(key: string) { return [this.get(key)].filter(Boolean); } });
 const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response({ ...preview(), healthRecoveryRecords: 2 }));
 await mount(f); await showPreview();
 expect(JSON.parse(f.mock.calls[1][1].body).recoverHealth).toBe(true);
 expect(JSON.stringify(root())).toContain('Explicit health recovery: ');
});

it('master ON with no canary entries does not claim an active trial or expose account identifiers', async () => {
  await mount(vi.fn(async () => response({ ...status(), deploymentEnabled: true, rollout: { mode: 'canary', canaryCount: 0 } })));
  const html = renderToStaticMarkup(root()); expect(html).toContain('zero means nobody selected');
  expect(html).toContain('outside this trial budget'); expect(html).toContain('do not control this gateway');
});

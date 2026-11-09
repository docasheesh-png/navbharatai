import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_CHAT_DIAGNOSTIC_CODES, TEST_CHAT_FAILURE_CODES, TEST_CHAT_READINESS_GATES, TEST_CHAT_REVIEW_ERROR_CODES, TEST_CHAT_SYNTHETIC_PROMPT, type TestChatReadiness, type TestChatStatus } from '../../lib/testChatBot';

// Exercise actual handlers and rendered state without a browser or any provider network.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => (() => void) | void)[], mint: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (v: unknown) => { hooks.values[n] = typeof v === 'function' ? v(hooks.values[n]) : v; }]; },
  useRef: (initial: unknown) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => (() => void) | void) => { hooks.effects.push(fn); },
}));
vi.mock('../../lib/requestIdentity', () => ({ newRequestIdentity: hooks.mint }));
import { TestChatBotPanel } from './TestChatBotPanel';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const AT = Date.UTC(2026, 10, 9, 12);
const status = (override = {}): TestChatStatus => ({ providers: [{ id: 'qubax', label: 'Qubax', configured: true, enabled: true, model: null, ...override }], approvalRequired: true, noFallback: true });
function readiness(overrides: Partial<TestChatReadiness> = {}): TestChatReadiness {
  const body: NonNullable<TestChatReadiness['reviewRequest']>['body'] = {
    messages: [{ role: 'user', content: TEST_CHAT_SYNTHETIC_PROMPT }], max_tokens: 16, stream: false, model: 'reviewed-synthetic-model',
  };
  return {
    provider: 'qubax', requestId: FIRST_ID, checkedAtMs: AT, ready: true, readOnly: true, noProviderCall: true, noFallback: true,
    gates: Object.fromEntries(TEST_CHAT_READINESS_GATES.map(id => [id, { state: 'pass', code: `${id}-passed`, message: 'Verified in this offline test fixture.', action: '' }])) as TestChatReadiness['gates'],
    model: 'reviewed-synthetic-model', expiresAtMs: AT + 120_000, catalogDigest: 'a'.repeat(64), lastSafeDiagnostic: null, providerBalance: 'not-checked',
    reviewRequest: { kind: 'qubax-admin-review-request-v1', approvalId: 'a'.repeat(64), payloadDigest: 'b'.repeat(64), requestId: FIRST_ID,
      model: 'reviewed-synthetic-model', modelRevision: 'revision-1', evidenceBinding: 'c'.repeat(64), maximumNanoUsd: 100_000, expiresAtMs: AT + 120_000,
      body, wirePayload: JSON.stringify(body) },
    ...overrides,
  };
}
function missingApproval(): TestChatReadiness {
  const data = readiness({ ready: false, lastSafeDiagnostic: 'payload-approval-missing' });
  data.gates.payloadApproval = { state: 'blocked', code: 'payload-approval-missing', message: 'Exact payload has not been independently approved.', action: 'Obtain the signed independent review for this exact request.' };
  return data;
}
const envelope = JSON.stringify({ keyId: 'synthetic-reviewer', payload: 'synthetic-signed-payload', signature: 'a'.repeat(86) });
const receipt = () => ({ imported: true, requestId: FIRST_ID, expiresAtMs: AT + 120_000, noProviderCall: true, noFallback: true });
const reply = () => ({ requestId: FIRST_ID, provider: 'qubax', content: '4', model: 'reviewed-synthetic-model', latencyMs: 123, noFallback: true, usage: { inputTokens: 16, outputTokens: 1 } });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
let cleanup: (() => void)[] = [];
const root = (token = 'synthetic-admin-secret') => { hooks.cursor = 0; hooks.refCursor = 0; return TestChatBotPanel({ adminToken: token }); };
const html = () => renderToStaticMarkup(root());
const settle = async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); };
interface Element { type: unknown; props: Record<string, any> }
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function button(label: string) { return elements(root()).find(e => e.type === 'button' && e.props.children === label)!; }
function textarea(label: string) {
  const container = elements(root()).find(e => e.type === 'label' && Array.isArray(e.props.children) && e.props.children[0] === label)!;
  return elements(container).find(e => e.type === 'textarea')!;
}
function consent(value = true) { elements(root()).find(e => e.type === 'input' && e.props.type === 'checkbox')!.props.onChange({ target: { checked: value } }); }
function edit(value: string) { textarea('Test message').props.onChange({ target: { value } }); }
function submit() { elements(root()).find(e => e.type === 'form')!.props.onSubmit({ preventDefault() {} }); }
async function mount(f: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', f); root();
  for (const effect of hooks.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  await settle();
}
async function check() { button('Check Qubax Readiness').props.onClick(); await settle(); }
function mockServer() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/providers')) return response(status());
    const action = JSON.parse(String(init?.body));
    if (url.endsWith('/readiness')) {
      const data = readiness({ requestId: action.requestId });
      const body = { ...data.reviewRequest!.body, messages: action.messages };
      data.reviewRequest = { ...data.reviewRequest!, requestId: action.requestId, body, wirePayload: JSON.stringify(body) };
      return response(data);
    }
    if (url.endsWith('/chat')) return response({ ...reply(), requestId: action.requestId });
    throw new Error('Unexpected endpoint');
  });
}

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.refs = []; hooks.refCursor = 0; hooks.effects = [];
  hooks.mint.mockReset().mockReturnValueOnce(FIRST_ID).mockReturnValue(SECOND_ID);
  vi.useFakeTimers(); vi.setSystemTime(AT);
});
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Test Chat Bot readiness and independent review controls', () => {
  it('mount reads only configuration, prefills the exact synthetic question, and leaves send disabled', async () => {
    const f = mockServer(); await mount(f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/api/v1/admin/test-chat-bot/providers', expect.objectContaining({ headers: { 'x-admin-token': 'synthetic-admin-secret' }, cache: 'no-store' }));
    expect(textarea('Test message').props.value).toBe(TEST_CHAT_SYNTHETIC_PROMPT);
    expect(button('Send to Qubax only').props.disabled).toBe(true);
    for (const label of ['Provider configured: Yes', 'Provider enabled: Yes', 'Reviewed catalog: Not checked', 'Quality review: Not checked', 'Supplier ceiling verification: Not checked', 'Exact-payload approval: Not checked', 'Shared budget availability: Not checked', 'Last safe diagnostic:', 'Actual provider used: None for this request.', 'Last confirmed latency: Not available.']) expect(html()).toContain(label);
    expect(html()).not.toContain('synthetic-admin-secret');
  });
  it.each([{ configured: false }, { enabled: false }])('does not confuse configuration with readiness: %j', async override => {
    const f = vi.fn(async () => response(status(override))); await mount(f);
    expect(button('Send to Qubax only').props.disabled).toBe(true);
    expect(button('Check Qubax Readiness').props.disabled).toBe(false);
    expect(html()).toContain(override.configured === false ? 'Provider configured: No' : 'Provider enabled: No');
  });
  it('readiness is explicit, reuses one identity, and shows precise blockers and actions', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValue(response(missingApproval()));
    await mount(f); await check(); await check();
    expect(f.mock.calls.slice(1).every(c => c[0] === '/api/v1/admin/test-chat-bot/readiness')).toBe(true);
    const bodies = f.mock.calls.slice(1).map(c => JSON.parse(c[1].body));
    expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0].requestId).toBe(FIRST_ID); expect(hooks.mint).toHaveBeenCalledTimes(1);
    expect(html()).toContain('Exact-payload approval: Blocked'); expect(html()).toContain('Obtain the signed independent review for this exact request.');
    expect(html()).toContain('payload-approval-missing'); expect(button('Send to Qubax only').props.disabled).toBe(true);
    expect(html()).toContain('no approval consumption and no budget reservation');
  });
  it('a fresh complete review plus explicit consent dispatches once, even on a synchronous double submit', async () => {
    let finish!: (body: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness()))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); await check(); expect(button('Send to Qubax only').props.disabled).toBe(true);
    consent(); expect(button('Send to Qubax only').props.disabled).toBe(false);
    const handler = elements(root()).find(e => e.type === 'form')!.props.onSubmit;
    handler({ preventDefault() {} }); handler({ preventDefault() {} });
    expect(f).toHaveBeenCalledTimes(3); expect(f.mock.calls[2][0]).toBe('/api/v1/admin/test-chat-bot/chat');
    expect(f.mock.calls[2][1].body).toBe(f.mock.calls[1][1].body);
    finish(response(reply())); await settle();
    expect(html()).toContain('Response confirmed.'); expect(html()).toContain('Synthetic answer matched 4.');
    expect(html()).toContain('123 ms'); expect(html()).toContain('Actual charge not verified.');
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(3);
  });
  it('edits revoke checked authority synchronously, reject a stale send handler, and mint a different review identity', async () => {
    const f = mockServer(); await mount(f); await check(); consent();
    const oldSubmit = elements(root()).find(e => e.type === 'form')!.props.onSubmit;
    edit('A different synthetic question'); oldSubmit({ preventDefault() {} });
    expect(f).toHaveBeenCalledTimes(2); expect(button('Send to Qubax only').props.disabled).toBe(true); expect(html()).not.toContain('Exact review package');
    await check(); expect(JSON.parse(f.mock.calls[2][1]!.body as string).requestId).toBe(SECOND_ID);
    expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it('rejects an unregistered provider selection instead of inventing a provider or fallback', async () => {
    const f = mockServer(); await mount(f); await check();
    elements(root()).find(e => e.type === 'select')!.props.onChange({ target: { value: 'unregistered-provider' } });
    expect(elements(root()).find(e => e.type === 'select')!.props.value).toBe('qubax');
    consent(); submit(); await settle();
    expect(JSON.parse(f.mock.calls[2][1]!.body as string).provider).toBe('qubax');
  });
  it('unchecking consent also prevents a previously captured submit handler from sending', async () => {
    const f = mockServer(); await mount(f); await check(); consent();
    const oldSubmit = elements(root()).find(e => e.type === 'form')!.props.onSubmit;
    consent(false); oldSubmit({ preventDefault() {} }); expect(f).toHaveBeenCalledTimes(2);
  });
  it('expires visibly and checks the current clock even before the next render', async () => {
    const f = mockServer(); await mount(f); await check(); consent();
    const oldSubmit = elements(root()).find(e => e.type === 'form')!.props.onSubmit;
    vi.setSystemTime(AT + 120_001); oldSubmit({ preventDefault() {} }); expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(html()).toContain('This readiness snapshot has expired.');
  });
  it('ignores an older readiness response after a payload change', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); button('Check Qubax Readiness').props.onClick();
    edit('Replacement question'); finish(response(readiness())); await settle();
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(html()).toContain('Reviewed catalog: Not checked');
  });
  it.each([
    { body: null, ok: true }, { body: { error: 'synthetic-server-secret' }, ok: false },
    { body: readiness({ requestId: SECOND_ID }), ok: true },
    { body: { ...readiness(), provider: 'unexpected-provider' }, ok: true },
    { body: { ...readiness(), reviewRequest: { ...readiness().reviewRequest, body: { messages: [{ role: 'user', content: 'Wrong body' }], max_tokens: 16, stream: false } } }, ok: true },
  ])('rejects malformed, denied, or mismatched readiness without leaking its body', async ({ body, ok }) => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(body, ok));
    await mount(f); await check();
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(html()).toContain('Readiness could not be verified'); expect(html()).not.toContain('synthetic-server-secret');
  });
  it('never enables Send if ready is inconsistent with any blocked prerequisite', async () => {
    const data = missingApproval(); data.ready = true;
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(data));
    await mount(f); await check(); consent(); submit(); expect(f).toHaveBeenCalledTimes(2); expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it('imports an independent signed envelope against the same action, then requires a new read-only check', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(missingApproval()))
      .mockResolvedValueOnce(response(receipt())).mockResolvedValueOnce(response(readiness()));
    await mount(f); await check(); textarea('Signed reviewer envelope').props.onChange({ target: { value: envelope } });
    button('Verify and record independent approval').props.onClick(); await settle();
    const imported = JSON.parse(f.mock.calls[2][1].body);
    expect(f.mock.calls[2][0]).toBe('/api/v1/admin/test-chat-bot/approval');
    expect(imported.action).toEqual(JSON.parse(f.mock.calls[1][1].body)); expect(imported.attestation).toEqual(JSON.parse(envelope));
    expect(html()).toContain('Independent payload approval recorded'); expect(button('Send to Qubax only').props.disabled).toBe(true);
    await check(); expect(JSON.parse(f.mock.calls[3][1].body).requestId).toBe(FIRST_ID);
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f.mock.calls.some(c => c[0].endsWith('/chat'))).toBe(false);
  });
  it('invalid envelope text remains local and never becomes an error echo', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(missingApproval()));
    await mount(f); await check(); textarea('Signed reviewer envelope').props.onChange({ target: { value: 'synthetic-private-key-not-json' } });
    button('Verify and record independent approval').props.onClick(); await settle();
    expect(f).toHaveBeenCalledTimes(2); expect(html()).toContain('Paste the signed reviewer envelope');
    expect(elements(root()).find(e => e.props.role === 'alert')!.props.children).not.toContain('synthetic-private-key-not-json');
  });
  it.each(TEST_CHAT_REVIEW_ERROR_CODES)('shows the closed safe review diagnostic %s without echoing source data', async code => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(missingApproval()))
      .mockResolvedValueOnce(response({ code, error: 'synthetic-private-document' }, false));
    await mount(f); await check(); textarea('Signed reviewer envelope').props.onChange({ target: { value: envelope } });
    button('Verify and record independent approval').props.onClick(); await settle();
    expect(html()).toContain(`Review diagnostic: ${code}.`); expect(html()).not.toContain('synthetic-private-document');
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(3);
  });
  it('lost approval import responses are not retried or treated as saved', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(missingApproval())).mockRejectedValueOnce(new Error('synthetic-provider-secret'));
    await mount(f); await check(); textarea('Signed reviewer envelope').props.onChange({ target: { value: envelope } });
    button('Verify and record independent approval').props.onClick(); await settle();
    expect(f).toHaveBeenCalledTimes(3); expect(html()).toContain('Approval import outcome is uncertain'); expect(html()).not.toContain('synthetic-provider-secret');
    expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it('permits independently signed catalog import even before a payload review package exists', async () => {
    const data = missingApproval(); data.reviewRequest = null; data.catalogDigest = null;
    data.gates.catalog = { state: 'blocked', code: 'missing', message: 'No reviewed catalog.', action: 'Obtain independently signed supplier evidence.' };
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(receipt()));
    await mount(f); await check(); expect(html()).not.toContain('Exact review package');
    const largeCatalogEnvelope = JSON.stringify({ ...JSON.parse(envelope), payload: 's'.repeat(17_000) });
    textarea('Signed catalog envelope').props.onChange({ target: { value: largeCatalogEnvelope } }); button('Verify and record reviewed catalog').props.onClick(); await settle();
    expect(f.mock.calls[2][0]).toBe('/api/v1/admin/test-chat-bot/catalog'); expect(JSON.parse(f.mock.calls[2][1].body).action.requestId).toBe(FIRST_ID);
    expect(JSON.parse(f.mock.calls[2][1].body).attestation.payload).toHaveLength(17_000);
    expect(html()).toContain('Independently reviewed catalog recorded'); expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it.each([
    { label: 'Signed reviewer envelope', submit: 'Verify and record independent approval', path: 'approval', repetitions: 5000, formerLimit: 24_000 },
    { label: 'Signed catalog envelope', submit: 'Verify and record reviewed catalog', path: 'catalog', repetitions: 42_666, formerLimit: 256_000 },
  ])('does not clip a valid escaped $path envelope before validating its decoded payload', async ({ label, submit: submitLabel, path, repetitions, formerLimit }) => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(missingApproval())).mockResolvedValueOnce(response(receipt()));
    await mount(f); await check();
    const payload = String.fromCharCode(34, 92, 10).repeat(repetitions);
    const escaped = JSON.stringify({ ...JSON.parse(envelope), payload });
    expect(escaped.length).toBeGreaterThan(formerLimit);
    const field = textarea(label); expect(field.props.maxLength).toBeUndefined();
    field.props.onChange({ target: { value: escaped } }); button(submitLabel).props.onClick(); await settle();
    expect(f.mock.calls[2][0]).toBe(`/api/v1/admin/test-chat-bot/${path}`);
    expect(JSON.parse(f.mock.calls[2][1].body).attestation.payload).toBe(payload);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it.each([
    { label: 'Signed reviewer envelope', submit: 'Verify and record independent approval', limit: 16_000 },
    { label: 'Signed catalog envelope', submit: 'Verify and record reviewed catalog', limit: 128_000 },
  ])('still rejects an oversized decoded payload for $label without transmission', async ({ label, submit: submitLabel, limit }) => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(missingApproval()));
    await mount(f); await check();
    textarea(label).props.onChange({ target: { value: JSON.stringify({ ...JSON.parse(envelope), payload: 'x'.repeat(limit + 1) }) } });
    button(submitLabel).props.onClick(); await settle();
    expect(f).toHaveBeenCalledTimes(2); expect(html()).toContain('Paste the signed reviewer envelope');
  });
  it('checks provider balance only by explicit action and preserves integer precision', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response({ status: 'available', currency: 'USD', balanceMicros: '9007199254740991', checkedAtMs: AT }));
    await mount(f); expect(f).toHaveBeenCalledTimes(1);
    button('Check provider balance').props.onClick(); await settle();
    expect(f.mock.calls[1][0]).toBe('/api/v1/admin/test-chat-bot/balance'); expect(f.mock.calls[1][1].body).toBe('{}');
    expect(html()).toContain('USD 9007199254.740991'); expect(html()).toContain('does not verify the funded account identity'); expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it('shows missing billing-read permission without claiming a zero balance', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response({ status: 'unknown', code: 'permission' }));
    await mount(f); button('Check provider balance').props.onClick(); await settle();
    expect(html()).toContain('BILLING_READ'); expect(html()).toContain('Not verified (permission)'); expect(html()).not.toContain('USD 0.000000');
  });
});

describe('Test Chat Bot conservative dispatch outcomes', () => {
  it.each([response({ error: 'synthetic-server-secret' }, false), response({ ...reply(), requestId: SECOND_ID }), response({ ...reply(), provider: 'other' }), response({ ...reply(), content: '' })])('an unconfirmed response prevents another send, including after a successful readiness refresh', async result => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness())).mockResolvedValueOnce(result).mockResolvedValueOnce(response(readiness()));
    await mount(f); await check(); consent(); submit(); await settle();
    expect(html()).toContain('Uncertain. A provider charge may exist.'); expect(html()).not.toContain('synthetic-server-secret');
    expect(html()).toContain('Actual provider used: Not confirmed for this request.');
    await check(); consent(); submit(); await settle();
    expect(f).toHaveBeenCalledTimes(4); expect(f.mock.calls.filter(c => c[0].endsWith('/chat'))).toHaveLength(1);
    expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it.each(TEST_CHAT_FAILURE_CODES.filter(code => code !== 'unconfirmed'))('recognizes %s as a known pre-dispatch block and preserves its safe action', async code => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness()))
      .mockResolvedValueOnce(response({ code, error: 'synthetic-raw-provider-secret' }, false));
    await mount(f); await check(); consent(); submit(); await settle();
    expect(html()).toContain('Blocked before dispatch.'); expect(html()).toContain('No provider was called.');
    expect(html()).not.toContain('synthetic-raw-provider-secret'); expect(html()).not.toContain('Uncertain. A provider charge may exist.');
    expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(3);
  });
  it.each(TEST_CHAT_DIAGNOSTIC_CODES)('displays only the safe transport diagnostic %s without permitting replay', async diagnostic => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness()))
      .mockResolvedValueOnce(response({ code: 'unconfirmed', diagnostic, error: 'synthetic-raw-provider-secret' }, false));
    await mount(f); await check(); consent(); submit(); await settle();
    expect(html()).toContain(`Safe diagnostic: ${diagnostic}.`); expect(html()).toContain('Uncertain. A provider charge may exist.');
    expect(html()).not.toContain('synthetic-raw-provider-secret'); expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(3);
  });
  it('unknown failure codes and diagnostic strings are never displayed or assumed undispatched', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness()))
      .mockResolvedValueOnce(response({ code: 'synthetic-raw-secret-code', diagnostic: 'synthetic-raw-secret-diagnostic' }, false));
    await mount(f); await check(); consent(); submit(); await settle();
    expect(html()).not.toContain('synthetic-raw-secret'); expect(html()).toContain('Uncertain. A provider charge may exist.');
  });
  it('a definite pre-dispatch blocker allows read-only diagnosis without automatically resending', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness())).mockResolvedValueOnce(response({ code: 'approval-or-budget' }, false));
    await mount(f); await check(); consent(); submit(); await settle();
    expect(html()).toContain('Blocked before dispatch'); expect(html()).toContain('Check Qubax Readiness for the current blocker.'); expect(f).toHaveBeenCalledTimes(3);
    expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it('stop waiting aborts the wait but does not claim a refund or permit replay', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness()))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('Aborted')))));
    await mount(f); await check(); consent(); submit();
    button('Stop waiting').props.onClick(); await settle();
    expect(html()).toContain('Uncertain. A provider charge may exist.'); expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(3);
  });
  it('a timed out dispatched request remains uncertain without a second attempt', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness()))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('Timeout')))));
    await mount(f); await check(); consent(); submit(); await vi.advanceTimersByTimeAsync(100_001);
    expect(html()).toContain('Uncertain. A provider charge may exist.'); expect(f).toHaveBeenCalledTimes(3);
  });
  it('unmount aborts the request and discards even a late success', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(readiness())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); await check(); consent(); submit(); cleanup.forEach(dispose => dispose()); cleanup = [];
    expect(f.mock.calls[2][1].signal.aborted).toBe(true); finish(response(reply())); await settle();
    expect(html()).not.toContain('Synthetic answer matched'); expect(f).toHaveBeenCalledTimes(3);
  });
  it('a refreshed admin session clears conversation, review and balance and discards old responses', async () => {
    let finish!: (v: unknown) => void;
    const f = vi.fn().mockResolvedValueOnce(response(status())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response(status()));
    await mount(f); button('Check Qubax Readiness').props.onClick(); cleanup.forEach(dispose => dispose()); cleanup = [];
    root('new-admin-session'); const dispose = hooks.effects.at(-1)!(); if (dispose) cleanup.push(dispose);
    finish(response(readiness())); await settle();
    expect(f.mock.calls[2][1].headers).toEqual({ 'x-admin-token': 'new-admin-session' });
    expect(html()).toContain('Reviewed catalog: Not checked'); expect(button('Send to Qubax only').props.disabled).toBe(true);
  });
  it('retains generic multi-turn chat with fresh exact review and one new identity per turn', async () => {
    const f = mockServer(); await mount(f); await check(); consent(); submit(); await settle();
    edit('What is 3 + 3?'); await check();
    const action = JSON.parse(f.mock.calls[3][1]!.body as string);
    expect(action).toMatchObject({ requestId: SECOND_ID, messages: [{ role: 'user', content: TEST_CHAT_SYNTHETIC_PROMPT }, { role: 'assistant', content: '4' }, { role: 'user', content: 'What is 3 + 3?' }] });
    expect(button('Send to Qubax only').props.disabled).toBe(true); consent(); submit(); await settle(); expect(f).toHaveBeenCalledTimes(5);
  });
  it('new test chat drops old approval and clears in-memory messages', async () => {
    const f = mockServer(); await mount(f); await check(); consent(); button('New test chat').props.onClick();
    expect(textarea('Test message').props.value).toBe(''); expect(html()).not.toContain('Exact review package'); expect(button('Send to Qubax only').props.disabled).toBe(true); expect(f).toHaveBeenCalledTimes(2);
  });
  it('fails closed without a secure request ID and does not submit an invalid oversized message', async () => {
    const f = mockServer(); await mount(f); hooks.mint.mockReset().mockReturnValue(undefined); await check();
    expect(html()).toContain('A secure request ID is unavailable'); expect(f).toHaveBeenCalledTimes(1);
    hooks.mint.mockReturnValue(FIRST_ID); edit('x'.repeat(8001)); await check(); expect(html()).toContain('This conversation is invalid or too long'); expect(f).toHaveBeenCalledTimes(1);
  });
});

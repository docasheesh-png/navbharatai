import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { qubaxChatBinding, qubaxReviewedApprovalCeiling, runApprovedQubaxChat, type QubaxChatOptions } from '../src/server/lib/qubax';
import * as selector from '../src/server/lib/qubaxSelector';
const env = { QUBAX_ENABLED: '1', QUBAX_API_KEY: 'synthetic-never-live-qubax-secret' };
function fixture(stream = false) {
  const now = Date.now();
  const selection: selector.QubaxSelection = { modelId: 'reviewed-model', modelRevision: 'exact-v1', sku: 'text-standard', maximumNanoUsd: 1000,
    qubaxCostNanoUsd: 1000, officialCostNanoUsd: 10000, discountBps: 9000, expiresAtMs: now + 60_000, evidenceBinding: 'reviewed-selection', reviewRef: 'independent-review' };
  vi.spyOn(selector, 'getQubaxSelection').mockResolvedValue(selection);
  const body = { messages: [{ role: 'user', content: 'नमस्ते' }], max_tokens: 128, stream };
  const binding = qubaxChatBinding('owner', body, selection, env);
  let approval: any = { kind: 'qubax-exact-data-approval-v1', state: 'approved', uid: 'owner', payloadDigest: binding.payloadDigest, gateway: binding.gateway,
    reviewedAtMs: now - 100, expiresAtMs: now + 50_000,
    dataReview: { entirePayloadReviewed: true, gatewayAndAllDownstreamProcessorsReviewed: true, approvedDataClasses: ['private', 'health'], reviewRef: 'r', disclosureAuthorityRef: 'a', processorTermsRef: 't', protectionsRef: 'p' },
    supplierContract: { currency: 'USD', hardCeilingEnforced: true, includesInternalRetriesFailoversAndFees: true, evidenceRef: 'real-enforced-contract', perHttpRequestCeilingNanoUsd: 1000 } };
  let chain = Promise.resolve();
  const db = { doc: (path: string) => ({ path }), runTransaction: (run: any) => {
    const pending = chain.then(() => run({ get: async () => ({ data: () => approval }), update: (_: any, value: any) => { approval = { ...approval, ...value }; } }));
    chain = pending.then(() => {}, () => {}); return pending;
  } } as unknown as Firestore;
  const releaseUndispatched = vi.fn().mockResolvedValue(undefined), reserve = vi.fn().mockResolvedValue({ releaseUndispatched });
  const options: QubaxChatOptions = { db, uid: 'owner', requestId: 'request-one', privateTurn: true, healthTurn: true, body, signal: new AbortController().signal, reserve };
  return { options, binding, selection, reserve, releaseUndispatched, approval: () => approval, setApproval: (a: any) => { approval = a; } };
}
const answer = () => new Response(JSON.stringify({ model: 'reviewed-model', choices: [{ index: 0, message: { content: 'नमस्ते, कैसे मदद करूँ?' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
let network: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => { network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('Qubax exact evidence-bound single dispatch', () => {
  it('skips disabled or missing price evidence without transmission', async () => {
    const f = fixture(); expect(await runApprovedQubaxChat(f.options, {})).toMatchObject({ kind: 'skipped' });
    vi.mocked(selector.getQubaxSelection).mockResolvedValue(null);
    expect(await runApprovedQubaxChat(f.options, env)).toMatchObject({ kind: 'skipped', reason: 'qubax-price-or-quality-unverified' });
    expect(network).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled();
  });
  it.each(['0', '1'])('malformed optional config skips without affecting later fallbacks, enabled=%s', enabled => {
    const f = fixture(); return expect(runApprovedQubaxChat(f.options, { ...env, QUBAX_ENABLED: enabled, QUBAX_MAX_INFLIGHT: 'invalid' })).resolves.toMatchObject({ kind: 'skipped' }).then(() => {
      expect(network).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled();
    });
  });
  it.each(['review', 'payload', 'ceiling', 'discount', 'downstream', 'health', 'expired'])('rejects missing or changed %s proof', async kind => {
    const f = fixture(), a = f.approval();
    if (kind === 'review') a.dataReview.reviewRef = '';
    if (kind === 'payload') a.payloadDigest = 'different';
    if (kind === 'ceiling') a.supplierContract.hardCeilingEnforced = false;
    if (kind === 'discount') a.supplierContract.perHttpRequestCeilingNanoUsd = 1001;
    if (kind === 'downstream') a.dataReview.gatewayAndAllDownstreamProcessorsReviewed = false;
    if (kind === 'health') a.dataReview.approvedDataClasses = ['public'];
    if (kind === 'expired') a.expiresAtMs = Date.now() - 1;
    expect(await runApprovedQubaxChat(f.options, env)).toMatchObject({ kind: 'skipped' }); expect(network).not.toHaveBeenCalled();
  });
  it.each(['model', 'revision', 'ceiling'])('pins the Gateway %s before claiming or spending', async kind => {
    const f = fixture(); const expectedSelection = { modelId: f.selection.modelId, modelRevision: f.selection.modelRevision, maximumNanoUsd: f.selection.maximumNanoUsd };
    if (kind === 'model') expectedSelection.modelId = 'other'; if (kind === 'revision') expectedSelection.modelRevision = 'other'; if (kind === 'ceiling') expectedSelection.maximumNanoUsd = 999;
    expect(await runApprovedQubaxChat({ ...f.options, expectedSelection }, env)).toMatchObject({ kind: 'skipped', reason: 'qubax-selection-claim-mismatch' });
    expect(network).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled();
  });
  it('claims once, reserves once, sends only Qubax and never transmits local identity', async () => {
    const f = fixture(); expect(await runApprovedQubaxChat(f.options, env)).toMatchObject({ kind: 'response', model: 'reviewed-model' });
    expect(f.reserve).toHaveBeenCalledExactlyOnceWith(1000); expect(network).toHaveBeenCalledOnce(); expect(f.releaseUndispatched).not.toHaveBeenCalled();
    const [url, init] = network.mock.calls[0]; expect(url).toBe('https://api.qubax.ai/v1/chat/completions'); expect(init?.redirect).toBe('error');
    const wire = JSON.parse(init!.body as string); expect(wire.model).toBe('reviewed-model'); expect(Object.keys(wire)).toEqual(['messages', 'max_tokens', 'stream', 'model']);
    expect(await runApprovedQubaxChat({ ...f.options, requestId: 'request-two' }, env)).toMatchObject({ kind: 'skipped' }); expect(network).toHaveBeenCalledOnce();
  });
  it('one concurrent approval claim wins, not both requests', async () => {
    const f = fixture(); const results = await Promise.all([runApprovedQubaxChat(f.options, env), runApprovedQubaxChat({ ...f.options, requestId: 'request-two' }, env)]);
    expect(results.filter(r => r.kind === 'response')).toHaveLength(1); expect(network).toHaveBeenCalledOnce();
  });
  it('revalidates current catalog before dispatch and releases only undispatched holds', async () => {
    const f = fixture(); vi.mocked(selector.getQubaxSelection).mockResolvedValueOnce(f.selection).mockResolvedValue(null);
    await expect(runApprovedQubaxChat(f.options, env)).rejects.toMatchObject({ code: 'QUBAX_APPROVAL_REVOKED', dispatched: false });
    expect(network).not.toHaveBeenCalled(); expect(f.releaseUndispatched).toHaveBeenCalledOnce();
  });
  it.each([401, 402, 403, 429, 500, 503])('never retries %s or refunds ambiguous supplier liability', async status => {
    const f = fixture(); network.mockResolvedValue(new Response('untrusted error', { status }));
    await expect(runApprovedQubaxChat(f.options, env)).rejects.toMatchObject({ code: 'QUBAX_HTTP_ERROR', status, dispatched: true });
    expect(network).toHaveBeenCalledOnce(); expect(f.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('cannot activate three tries with approval fields or a self-reported zero-charge error', async () => {
    const f = fixture();
    f.approval().maxHttpAttempts = 3;
    Object.assign(f.approval().supplierContract, { zeroChargeOn429: true, generationRejected: true, billingReceiptRef: 'unverified-assertion' });
    network.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'rate_limit', actual_cost: 0, generation_rejected: true } }), { status: 429 }));
    await expect(runApprovedQubaxChat(f.options, env)).rejects.toMatchObject({ status: 429, dispatched: true });
    expect(f.approval().attemptsStarted).toBe(1); expect(network).toHaveBeenCalledOnce();
    expect(f.releaseUndispatched).not.toHaveBeenCalled();
    expect(await runApprovedQubaxChat({ ...f.options, requestId: 'fresh-request-id' }, env)).toMatchObject({ kind: 'skipped' });
    expect(network).toHaveBeenCalledOnce();
  });
  it('a network timeout remains terminal with held money', async () => {
    const f = fixture(); network.mockRejectedValue(new Error('raw provider secret'));
    await expect(runApprovedQubaxChat(f.options, env)).rejects.toMatchObject({ code: 'QUBAX_UNAVAILABLE', dispatched: true, message: 'Qubax request unavailable.' });
    expect(network).toHaveBeenCalledOnce(); expect(f.releaseUndispatched).not.toHaveBeenCalled();
  });
  it.each(['model', 'tool', 'refusal', 'finish', 'credential'])('rejects unsafe %s response', async kind => {
    const f = fixture(); const data: any = { model: 'reviewed-model', choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] };
    if (kind === 'model') data.model = 'unreviewed-model'; if (kind === 'tool') data.choices[0].message.tool_calls = [{}];
    if (kind === 'refusal') data.choices[0].message.refusal = 'blocked'; if (kind === 'finish') data.choices[0].finish_reason = 'length';
    if (kind === 'credential') data.choices[0].message.content = env.QUBAX_API_KEY;
    network.mockResolvedValue(new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
    await expect(runApprovedQubaxChat(f.options, env)).rejects.toMatchObject({ dispatched: true });
  });
  it('does not emit split credentials or incomplete SSE output', async () => {
    const f = fixture(true), onChunk = vi.fn();
    const event = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    network.mockResolvedValue(new Response(event(env.QUBAX_API_KEY.slice(0, 12)) + event(env.QUBAX_API_KEY.slice(12)) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    await expect(runApprovedQubaxChat({ ...f.options, onChunk }, env)).rejects.toMatchObject({ code: 'QUBAX_INVALID_RESPONSE', dispatched: true }); expect(onChunk).not.toHaveBeenCalled();
  });
  it('buffers complete SSE, validates stop + done then emits only answer text', async () => {
    const f = fixture(true), onChunk = vi.fn();
    network.mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    expect(await runApprovedQubaxChat({ ...f.options, onChunk }, env)).toMatchObject({ kind: 'response', content: 'hello' }); expect(onChunk).toHaveBeenCalledExactlyOnceWith('hello');
  });
  it.each(['complete', 'cancelled', 'http-error'])('settles %s promptly while noncooperative body cleanup retains capacity and spent money', async mode => {
    const f = fixture(true), onChunk = vi.fn(), controller = new AbortController();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    const cancel = vi.fn(() => cleanup);
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        if (mode === 'complete') stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      }, cancel,
    });
    network.mockResolvedValueOnce(new Response(body, { status: mode === 'http-error' ? 503 : 200, headers: { 'content-type': 'text/event-stream' } }));
    const limited = { ...env, QUBAX_MAX_INFLIGHT: '1' };
    let outcome: { result?: unknown; error?: unknown } | undefined;
    const pending = runApprovedQubaxChat({ ...f.options, signal: controller.signal, onChunk }, limited)
      .then(result => { outcome = { result }; }, error => { outcome = { error }; });
    try {
      await vi.waitFor(() => expect(network).toHaveBeenCalledOnce(), { timeout: 2_000, interval: 10 });
      if (mode === 'cancelled') controller.abort();
      await vi.waitFor(() => expect(outcome).toBeDefined(), { timeout: 2_000, interval: 10 });
      expect(cancel).toHaveBeenCalledOnce();
      if (mode === 'complete') { expect(outcome?.result).toMatchObject({ kind: 'response', content: 'hello' }); expect(onChunk).toHaveBeenCalledExactlyOnceWith('hello'); }
      else {
        expect(outcome?.error).toMatchObject({ code: mode === 'cancelled' ? 'QUBAX_CANCELLED' : 'QUBAX_HTTP_ERROR', dispatched: true });
        expect(onChunk).not.toHaveBeenCalled();
      }
      const next = fixture();
      expect(await runApprovedQubaxChat(next.options, limited)).toMatchObject({ kind: 'skipped', reason: 'qubax-capacity' });
      expect(next.reserve).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledOnce();
      expect(f.releaseUndispatched).not.toHaveBeenCalled();
    } finally { releaseCleanup(); await pending; }
    await new Promise(resolve => setTimeout(resolve, 0));
    const next = fixture(); network.mockResolvedValueOnce(answer());
    expect(await runApprovedQubaxChat(next.options, limited)).toMatchObject({ kind: 'response' });
  });
  it('observes rejected cleanup without hiding an approved response', async () => {
    const f = fixture(true), onChunk = vi.fn();
    const cancel = vi.fn().mockRejectedValue(new Error('synthetic cleanup failure'));
    network.mockResolvedValueOnce(new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); }, cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }));
    expect(await runApprovedQubaxChat({ ...f.options, onChunk }, env)).toMatchObject({ kind: 'response', content: 'hello' });
    expect(cancel).toHaveBeenCalledOnce(); expect(f.releaseUndispatched).not.toHaveBeenCalled();
  });
  it('rejects caller-specified models, endpoints and tools without network', async () => {
    const f = fixture(); for (const extra of [{ model: 'other' }, { baseURL: 'https://evil.invalid' }, { tools: [] }]) {
      expect(await runApprovedQubaxChat({ ...f.options, body: { ...f.options.body, ...extra } }, env)).toMatchObject({ kind: 'skipped', reason: 'qubax-capability-excluded' });
    } expect(network).not.toHaveBeenCalled();
  });
  it('accepts logically identical gateway fields regardless of Firestore key order', () => {
    const f = fixture(), a = f.approval(); a.gateway = Object.fromEntries(Object.entries(a.gateway).reverse());
    expect(qubaxReviewedApprovalCeiling(a, { uid: 'owner', binding: f.binding, selection: f.selection, privateTurn: true, healthTurn: true, now: Date.now() })).toBe(1000);
  });
});

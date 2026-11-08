import { SERVICE_IDENTITY_REPLY, SURPLUS_SERVICE_IDENTITY_INSTRUCTION } from './surplusNarrativeIdentity';
import { readScopeFailure } from '../scopeFailureDiagnostic';
import { PUBLIC_BUILD_ENGINE_UNAVAILABLE, PUBLIC_BUILD_ENGINE_TIMEOUT, publicBuildEngineSafeReason } from '../../lib/buildEngineError';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurplusReceiptDecision } from '../../AI/SurplusRegistry/receiptPolicy';
import type { RunTurnParams } from '../ClaudeClient';
import { parseOpenAiCompletion, type OpenAiCompletionLike } from './OpenAiToolAdapter';
import { clearReasoningStore, recalledReasoning } from '../reliability/reasoningPassback';
import { BuildStoppedError } from '../stopSignal';
import { AiMaintenanceError } from '../../lib/aiMaintenance';
import { BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE } from '../turnDeadline';
import { makeSurplusTurnRunner, type SurplusFailureResolution, type SurplusRunnerAuthority, type SurplusTurnPermit, type SurplusTurnFailure } from './SurplusTurnRunner';

const maintenance = vi.hoisted(() => ({ check: vi.fn(async () => {}), listeners: new Set<(state: { enabled: boolean }) => void>() }));
vi.mock('../../lib/aiMaintenance', () => ({
  assertAiAvailable: maintenance.check,
  AiMaintenanceError: class extends Error { constructor() { super('maintenance'); } },
  aiMaintenanceStore: { onChange: (fn: (state: { enabled: boolean }) => void) => { maintenance.listeners.add(fn); return () => maintenance.listeners.delete(fn); } },
}));
const params = (over: Partial<RunTurnParams> = {}): RunTurnParams => ({ model: 'legacy-never-used', messages: [{ role: 'user', content: 'build' }], tools: [{ name: 'write_file', input_schema: { type: 'object', properties: {} } }], maxTokens: 500, ...over });
const completion = (over: Partial<OpenAiCompletionLike> = {}): OpenAiCompletionLike => ({ model: 'reviewed-model', choices: [{ message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...over });
const permit = (over: Partial<SurplusTurnPermit> = {}): SurplusTurnPermit => ({
  buildId: 'build-1', callId: 'call-1', model: 'reviewed-model', providerId: 'reviewed-provider', offerId: 'reviewed-offer',
  endpoint: 'https://api.surplusintelligence.ai/min90/v1', priceGeneration: 'generation-1', policyVersion: 'policy-1', maxTokens: 400,
  requestRouting: { reviewedRouting: { objective: 'price', pin: 'reviewed-provider' } },
  validateResponse: raw => raw as OpenAiCompletionLike, ...over,
});
function setup(over: Partial<SurplusRunnerAuthority> = {}) {
  const authority = { authorize: vi.fn(async () => permit()), dispatch: vi.fn(async () => completion()), ...over };
  return { authority, runner: makeSurplusTurnRunner(authority) };
}
afterEach(() => { vi.unstubAllEnvs(); clearReasoningStore(); vi.useRealTimers(); vi.clearAllMocks(); maintenance.check.mockResolvedValue(undefined); maintenance.listeners.clear(); });

describe('Surplus native tool turns', () => {
  it.each([false, true])('distinguishes unavailable fallback from failed fallback authorization (throws=%s)', async throws => {
    const { runner, authority } = setup({
      dispatch: vi.fn(async () => { throw new Error('PRIVATE_DISPATCH'); }),
      onFailure: async () => ({ retry: true, receiptDurablyRecorded: true }),
      authorizeFallback: async () => { if (throws) throw new Error('PRIVATE_AUTHORIZATION'); return undefined; },
    });
    const error = await runner.runTurn(params()).catch(e => e);
    expect(readScopeFailure(error)).toEqual(throws ? { stage: 'authorization', reason: 'authorization_failed' }
      : { stage: 'dispatch', reason: 'dispatch_failed' });
    expect(authority.dispatch).toHaveBeenCalledTimes(1);
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
  });
  it.each(['authorization', 'response_validation'] as const)('preserves only the safe %s diagnostic across public error folding', async stage => {
    const secret = new Error('PRIVATE_UPSTREAM_ERROR');
    const { runner } = setup(stage === 'authorization'
      ? { authorize: async () => { throw secret; } }
      : { authorize: async () => permit({ validateResponse: () => { throw secret; } }) });
    const error = await runner.runTurn(params()).catch(e => e);
    expect(readScopeFailure(error)).toEqual({ stage, reason: stage === 'authorization' ? 'authorization_failed' : 'invalid_completion' });
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(JSON.stringify(error)).not.toContain('PRIVATE_');
    expect(error.stack).not.toContain('PRIVATE_');
  });
  it('authorizes the identity instruction before estimating and sends precisely that prompt', async () => {
    const { runner, authority } = setup();
    const original = params({ system: 'Original task instructions' });
    await runner.runTurn(original);
    const authorized = vi.mocked(authority.authorize).mock.calls[0][0];
    expect(authorized.system).toBe(SURPLUS_SERVICE_IDENTITY_INSTRUCTION + '\n\nOriginal task instructions');
    expect(vi.mocked(authority.dispatch).mock.calls[0][0].messages[0]).toEqual({ role: 'system', content: authorized.system });
    expect(original.system).toBe('Original task instructions');
  });
  it('guards full narrative once and canonical text while preserving raw accounting and native files', async () => {
    const text = 'I am reviewed-model.\n```ts\nconst identity = "I am Surplus.";\n```\nUse Surplus in your app integration.';
    const code = 'const identity = "I am Surplus.";';
    const raw = completion({ choices: [{ message: { role: 'assistant', content: text, tool_calls: [{ id: 'file', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/App.ts', content: code }) } }] }, finish_reason: 'tool_calls' }] });
    const onResponse = vi.fn(async () => undefined); const onText = vi.fn();
    const { runner } = setup({ dispatch: vi.fn(async () => raw), onResponse });
    const result = await runner.runTurn(params({ onText }));
    const guarded = SERVICE_IDENTITY_REPLY + '\n```ts\nconst identity = "I am Surplus.";\n```\nUse Surplus in your app integration.';
    expect(result.text).toBe(guarded);
    expect(result.rawContent[0]).toEqual({ type: 'text', text: guarded });
    expect(result.toolUses[0].input).toEqual({ path: 'src/App.ts', content: code });
    expect(result.rawContent[1]).toEqual({ type: 'tool_use', id: 'file', name: 'write_file', input: { path: 'src/App.ts', content: code } });
    expect(onText).toHaveBeenCalledExactlyOnceWith(guarded);
    expect(onResponse.mock.calls[0][0]).toBe(raw);
    expect(raw.choices[0].message.content).toBe(text);
    expect(raw.choices[0].message.tool_calls![0].function.arguments).toBe(JSON.stringify({ path: 'src/App.ts', content: code }));
  });

  it.each(['authorize', 'dispatch', 'validateResponse', 'onResponse'] as const)('redacts hostile errors from %s without forwarding nested causes or stack', async phase => {
    const secret = 'sk-secret PROMPT_PRIVATE Surplus https://api.surplusintelligence.ai reviewed-model buyer_cost_micro=123';
    const upstream = new Error(secret, { cause: new Error(secret) });
    upstream.name = secret; upstream.stack = secret;
    Object.assign(upstream, { body: secret, headers: { Authorization: secret }, provider: secret });
    const onFailure = vi.fn(async () => {});
    const overrides: Partial<SurplusRunnerAuthority> = { onFailure };
    if (phase === 'validateResponse') overrides.authorize = vi.fn(async () => permit({ validateResponse() { throw upstream; } }));
    else if (phase === 'authorize') overrides.authorize = vi.fn().mockRejectedValue(upstream);
    else if (phase === 'dispatch') overrides.dispatch = vi.fn().mockRejectedValue(upstream);
    else overrides.onResponse = vi.fn().mockRejectedValue(upstream);
    const { runner } = setup(overrides);
    const error = await runner.runTurn(params()).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(upstream);
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(error.name).toBe('Error');
    expect(error.stack).toBe(`Error: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`);
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(['message', 'name', 'stack']);
    expect(JSON.stringify(error)).not.toMatch(/sk-secret|PROMPT_PRIVATE|Surplus|surplusintelligence|buyer_cost|reviewed-model/);
    if (phase === 'validateResponse') expect(onFailure).toHaveBeenCalledExactlyOnceWith(expect.any(Object), expect.any(Object), upstream, expect.objectContaining({ stage: 'response_validation' }));
  });
  it('does not mistake hostile upstream budget text for a trusted deadline error', async () => {
    const { runner } = setup({ dispatch: vi.fn().mockRejectedValue(new Error(BUDGET_REACHED_MESSAGE + ' secret-provider')) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
  });
  it('keeps Stop and deadline classification while removing implementation paths from stacks', async () => {
    const { runner } = setup();
    const controller = new AbortController(); controller.abort();
    const stopped = await runner.runTurn(params({ signal: controller.signal })).catch(e => e);
    expect(stopped).toBeInstanceOf(BuildStoppedError);
    expect(stopped.buildStopped).toBe(true);
    expect(stopped.name).toBe('Error'); expect(stopped.stack).toBe(`Error: ${stopped.message}`);
    const expired = await runner.runTurn(params({ deadlineAt: Date.now() - 1 })).catch(e => e);
    expect(expired.message).toBe(BUDGET_EXHAUSTED_MESSAGE);
    expect(expired.stack).toBe(`Error: ${BUDGET_EXHAUSTED_MESSAGE}`);
  });

  it('uses exact reviewed routing and preserves parallel calls/results and ids in native history', async () => {
    const calls = ['a', 'b'].map(id => ({ id, type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: id }) } }));
    const { runner, authority } = setup({ dispatch: vi.fn(async () => completion({ choices: [{ message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: 'tool_calls' }] })) });
    const first = await runner.runTurn(params({ system: 'Build apps', tools: [{ name: 'write_file', input_schema: { type: 'object', properties: {} } }] }));
    expect(first.toolUses.map(t => t.id)).toEqual(['a', 'b']);
    expect(first.stopReason).toBe('tool_use');
    await runner.runTurn(params({ messages: [{ role: 'assistant', content: first.rawContent }, { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: 'ok' }, { type: 'tool_result', tool_use_id: 'b', content: 'ok too' },
    ] }] }));
    const request = vi.mocked(authority.dispatch).mock.calls[1][0];
    expect(request).toMatchObject({ model: 'reviewed-model', stream: false, max_tokens: 400, reviewedRouting: { objective: 'price' } });
    expect(request.messages).toEqual([{ role: 'system', content: SURPLUS_SERVICE_IDENTITY_INSTRUCTION }, { role: 'assistant', content: null, tool_calls: calls }, { role: 'tool', tool_call_id: 'a', content: 'ok' }, { role: 'tool', tool_call_id: 'b', content: 'ok too' }]);
  });
  it('preserves truncated tool path without turning partial content into a write', async () => {
    const { runner } = setup({ dispatch: vi.fn(async () => completion({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'cut', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/App.tsx","content":"cut' } }] }, finish_reason: 'length' }] })) });
    const result = await runner.runTurn(params());
    expect(result).toMatchObject({ truncated: true, stopReason: 'tool_use', toolUses: [{ id: 'cut', input: { path: 'src/App.tsx' } }] });
    expect(result.toolUses[0].input.content).toBeUndefined();
  });
  it('reports measured usage and never turns a reported price into a settled receipt', async () => {
    const onTurnComplete = vi.fn();
    const onText = vi.fn();
    const { runner } = setup({ onTurnComplete, dispatch: vi.fn(async () => ({ ...completion(), usage: { prompt_tokens: 10, completion_tokens: 5, buyer_cost_micro: 0 } })) });
    const result = await runner.runTurn(params({ onText }));
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, selectedMaxOutputTokens: 400 });
    expect(result.usage.surplusReceipt).toBeUndefined();
    expect(onTurnComplete).toHaveBeenCalledWith(result, 'SURPLUS');
    expect(onText).toHaveBeenCalledExactlyOnceWith('Done');
  });
  it('attaches only the trusted receipt mapper decision before completion accounting', async () => {
    const receipt: SurplusReceiptDecision = {
      policyId: 'surplus-build-10x-official-cap-v1', status: 'blocked', reason: 'missing_tariff',
      buildId: 'build-1', callId: 'call-1', accountingIdentity: null, evidenceFingerprint: null,
      receiptId: null, accountId: null, requestId: null, modelId: 'reviewed-model', modelVersion: null,
      providerId: 'reviewed-provider', expenseEvidence: 'unknown', tariffSnapshotId: null, usageMappingReviewId: null,
      actualCostUsd: null, userChargeUsd: '0', officialCeilingUsd: null, absorbedCostUsd: null, newSupplierExpenseUsd: null,
    };
    const onResponse = vi.fn(async () => receipt);
    const onTurnComplete = vi.fn();
    const { runner } = setup({ onResponse, onTurnComplete });
    const result = await runner.runTurn(params());
    expect(result.usage.surplusReceipt).toBe(receipt);
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onTurnComplete.mock.calls[0][0].usage.surplusReceipt).toBe(receipt);
  });
  it('preserves unmeasured usage rather than claiming measured zero', async () => {
    const { runner } = setup({ dispatch: vi.fn(async () => completion({ usage: undefined })) });
    expect((await runner.runTurn(params())).usage.measured).toBe(false);
  });
  it.each(['https://api.surplusintelligence.ai/v1', 'https://api.surplusintelligence.ai/min30/v1', 'https://evil.test/min90/v1'])('blocks endpoint %s before dispatch', async endpoint => {
    const { runner, authority } = setup({ authorize: vi.fn(async () => permit({ endpoint })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authority.dispatch).not.toHaveBeenCalled();
  });
  it.each([{ maxTokens: 501 }, { requestRouting: { model: 'override' } }, { providerId: '' }, { maxTokens: NaN }])('rejects malformed permit %j', async invalid => {
    const { runner, authority } = setup({ authorize: vi.fn(async () => permit(invalid)) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authority.dispatch).not.toHaveBeenCalled();
  });
  it('calls the reviewed response validator and rejects mismatched models', async () => {
    const validateResponse = vi.fn(() => completion({ model: 'wrong' }));
    const { runner } = setup({ authorize: vi.fn(async () => permit({ validateResponse })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(validateResponse).toHaveBeenCalledOnce();
  });
  it('retains failed response evidence once without publishing invalid output or retrying', async () => {
    const raw = completion({ model: 'wrong' });
    const onFailure = vi.fn(async () => {}); const onResponse = vi.fn(); const onTurnComplete = vi.fn();
    const { runner, authority } = setup({ dispatch: vi.fn(async () => raw), onFailure, onResponse, onTurnComplete });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(raw, expect.objectContaining({ callId: 'call-1' }), expect.any(Error), expect.any(Object));
    expect(authority.dispatch).toHaveBeenCalledOnce();
    expect(onResponse).not.toHaveBeenCalled(); expect(onTurnComplete).not.toHaveBeenCalled();
  });
  it('rejects duplicate call IDs before tools can execute', async () => {
    const call = { id: 'same', type: 'function' as const, function: { name: 'write_file', arguments: '{}' } };
    const { runner } = setup({ dispatch: vi.fn(async () => completion({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [call, call] }, finish_reason: 'tool_calls' }] })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
  });
  it('rejects malformed nontruncated arguments rather than executing an empty object', async () => {
    const { runner } = setup({ dispatch: vi.fn(async () => completion({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'bad', type: 'function', function: { name: 'write_file', arguments: '{broken' } }] }, finish_reason: 'tool_calls' }] })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
  });
  it('rejects negative token usage', async () => {
    const { runner } = setup({ dispatch: vi.fn(async () => completion({ usage: { prompt_tokens: -1 } })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
  });
  it('records unusable reasoning-only turns as failures rather than empty successes', async () => {
    const onFailure = vi.fn(async () => {});
    const { runner, authority } = setup({ onFailure, dispatch: vi.fn(async () => completion({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'thinking only' }, finish_reason: 'length' }] })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(onFailure).toHaveBeenCalledOnce(); expect(authority.dispatch).toHaveBeenCalledOnce();
  });
  it.each([undefined, []])('rejects unrequested tools and retains failed expense when requested tools are %j', async tools => {
    const raw = completion({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'unexpected', type: 'function', function: { name: 'delete_project', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
    const onFailure = vi.fn(async () => {}); const onTurnComplete = vi.fn();
    const { runner, authority } = setup({ onFailure, onTurnComplete, dispatch: vi.fn(async () => raw) });
    await expect(runner.runTurn(params({ tools }))).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(raw, expect.any(Object), expect.any(Error), expect.any(Object));
    expect(onTurnComplete).not.toHaveBeenCalled(); expect(authority.dispatch).toHaveBeenCalledOnce();
  });
  it('accounts a fully received response arriving after the deadline without publishing it', async () => {
    vi.useFakeTimers();
    let resolve!: (value: OpenAiCompletionLike) => void;
    const onFailure = vi.fn(async () => {}); const onText = vi.fn(); const onTurnComplete = vi.fn();
    const dispatch = vi.fn(() => new Promise<OpenAiCompletionLike>(r => { resolve = r; }));
    const { runner } = setup({ dispatch, onFailure, onTurnComplete, timeoutMs: 20 });
    const pending = runner.runTurn(params({ onText }));
    const rejected = expect(pending).rejects.toThrow(PUBLIC_BUILD_ENGINE_TIMEOUT);
    await vi.advanceTimersByTimeAsync(21); await rejected;
    const raw = completion(); resolve(raw); await vi.advanceTimersByTimeAsync(0);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(raw, expect.any(Object), expect.any(Error), expect.any(Object));
    expect(onText).not.toHaveBeenCalled(); expect(onTurnComplete).not.toHaveBeenCalled(); expect(dispatch).toHaveBeenCalledOnce();
  });
  it('does not accept a tool outside an explicitly supplied allowlist', async () => {
    const onFailure = vi.fn(async () => {});
    const { runner } = setup({ onFailure, dispatch: vi.fn(async () => completion({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'bad', type: 'function', function: { name: 'delete_project', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(onFailure).toHaveBeenCalledOnce();
  });
  it('absorbs response expense when Stop arrives during receipt mapping', async () => {
    const controller = new AbortController();
    let finishReceipt!: () => void;
    const onResponse = vi.fn(() => new Promise<undefined>(resolve => { finishReceipt = () => resolve(undefined); }));
    const onFailure = vi.fn(async () => {}); const onTurnComplete = vi.fn(); const onText = vi.fn();
    const { runner } = setup({ onResponse, onFailure, onTurnComplete });
    const pending = runner.runTurn(params({ signal: controller.signal, onText }));
    await vi.waitFor(() => expect(onResponse).toHaveBeenCalledOnce());
    controller.abort(); await expect(pending).rejects.toBeInstanceOf(BuildStoppedError);
    finishReceipt(); await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
    expect(onTurnComplete).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
  });
  it('does not duplicate accounting when the session receipt hook itself rejects', async () => {
    const onResponse = vi.fn().mockRejectedValue(new Error('receipt blocked'));
    const onFailure = vi.fn(async () => {}); const onTurnComplete = vi.fn();
    const { runner } = setup({ onResponse, onFailure, onTurnComplete });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(onResponse).toHaveBeenCalledOnce(); expect(onFailure).not.toHaveBeenCalled(); expect(onTurnComplete).not.toHaveBeenCalled();
  });
  it('makes no retry for provider failures', async () => {
    const { runner, authority } = setup({ dispatch: vi.fn().mockRejectedValue(new Error('provider failed')) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authority.dispatch).toHaveBeenCalledOnce();
  });
  it('does not dispatch if already stopped or parent deadline expired', async () => {
    const controller = new AbortController(); controller.abort();
    const { runner, authority } = setup();
    await expect(runner.runTurn(params({ signal: controller.signal }))).rejects.toBeInstanceOf(BuildStoppedError);
    await expect(runner.runTurn(params({ deadlineAt: Date.now() - 1 }))).rejects.toThrow(BUDGET_EXHAUSTED_MESSAGE);
    expect(authority.authorize).not.toHaveBeenCalled();
  });
  it('aborts transport on Stop and never publishes a late result', async () => {
    let resolve!: (value: OpenAiCompletionLike) => void;
    const onText = vi.fn(); const onResponse = vi.fn(); const onFailure = vi.fn(async () => {}); const onTurnComplete = vi.fn(); const onProviderUsed = vi.fn(); const controller = new AbortController();
    const dispatch = vi.fn((_request, _signal) => new Promise<OpenAiCompletionLike>(r => { resolve = r; }));
    const { runner } = setup({ dispatch, onResponse, onFailure, onTurnComplete, onProviderUsed });
    const pending = runner.runTurn(params({ signal: controller.signal, onText }));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BuildStoppedError);
    expect(dispatch.mock.calls[0][1].aborted).toBe(true);
    const raw = completion(); resolve(raw); await vi.waitFor(() => expect(onFailure).toHaveBeenCalledExactlyOnceWith(raw, expect.objectContaining({ callId: 'call-1' }), expect.any(BuildStoppedError), expect.any(Object)));
    expect(onTurnComplete).not.toHaveBeenCalled(); expect(onProviderUsed).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled(); expect(onResponse).not.toHaveBeenCalled();
    expect(maintenance.listeners.size).toBe(0);
  });
  it('blocks a late authorization after timeout without dispatching', async () => {
    vi.useFakeTimers();
    let resolve!: (value: SurplusTurnPermit) => void;
    const { runner, authority } = setup({ timeoutMs: 10, authorize: vi.fn(() => new Promise(r => { resolve = r; })) });
    const pending = runner.runTurn(params());
    const rejected = expect(pending).rejects.toThrow(PUBLIC_BUILD_ENGINE_TIMEOUT);
    await vi.advanceTimersByTimeAsync(11); await rejected;
    resolve(permit()); await vi.advanceTimersByTimeAsync(0);
    expect(authority.dispatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds transport by parent clock and aborts it', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn((_request, _signal) => new Promise<never>(() => {}));
    const { runner } = setup({ dispatch });
    const pending = runner.runTurn(params({ deadlineAt: Date.now() + 300 }));
    const rejected = expect(pending).rejects.toThrow(BUDGET_REACHED_MESSAGE);
    await vi.advanceTimersByTimeAsync(301); await rejected;
    expect(dispatch.mock.calls[0][1].aborted).toBe(true);
  });
  it('honors maintenance before authorization and live kill during transport', async () => {
    maintenance.check.mockRejectedValueOnce(new Error('maintenance'));
    const initial = setup();
    await expect(initial.runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(initial.authority.authorize).not.toHaveBeenCalled();
    const dispatch = vi.fn((_request, _signal) => new Promise<never>(() => {}));
    const { runner } = setup({ dispatch });
    const pending = runner.runTurn(params());
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    for (const listener of maintenance.listeners) listener({ enabled: true });
    await expect(pending).rejects.toThrow('maintenance');
    expect(dispatch.mock.calls[0][1].aborted).toBe(true);
    expect(maintenance.listeners.size).toBe(0);
  });
});

const retryAuthorized = async (): Promise<SurplusFailureResolution> => ({ retry: true, receiptDurablyRecorded: true });
const emptyCompletion = () => completion({ choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }] });
const nextPermit = (attempt: number) => permit({ callId: `call-${attempt}`, model: `reviewed-model-${attempt}` });

describe('Surplus bounded authorized fallback', () => {
  it('has no reasoning-cache side effect for a receipt-failed Surplus turn without changing the shared parser', async () => {
    vi.stubEnv('AGENTV3_REASONING_PASSBACK', 'true');
    const raw = completion({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'private plan', tool_calls: [
      { id: 'reasoning-test', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts","content":"done"}' } },
    ] }, finish_reason: 'tool_calls' }] });
    const { runner } = setup({ dispatch: vi.fn(async () => raw), onResponse: vi.fn().mockRejectedValue(new Error('receipt unknown')) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(recalledReasoning(['reasoning-test'])).toBeUndefined();
    expect(raw.choices[0].message.reasoning_content).toBe('private plan');
    parseOpenAiCompletion(raw);
    expect(recalledReasoning(['reasoning-test'])).toBe('private plan');
  });
  it('replays only original canonical context/tools and publishes only the winning turn', async () => {
    const onText = vi.fn(); const onThinking = vi.fn(); const onProviderUsed = vi.fn(); const onTurnComplete = vi.fn();
    const original = params({ system: 'Build a native app', onText, onThinking, messages: [
      { role: 'user', content: 'build' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'prior', name: 'write_file', input: { path: 'existing.ts', content: 'existing' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'prior', content: 'already written' }] },
    ] });
    const originalMessages = structuredClone(original.messages); const originalTools = structuredClone(original.tools);
    const firstRaw = emptyCompletion();
    const winner = completion({ model: 'reviewed-model-2', choices: [{ message: { role: 'assistant', content: 'Finished', tool_calls: [
      { id: 'winning-file', type: 'function', function: { name: 'write_file', arguments: '{"path":"new.ts","content":"new"}' } },
    ] }, finish_reason: 'tool_calls' }] });
    const order: string[] = [];
    const onFailure = vi.fn(async () => { order.push('failure durable'); return retryAuthorized(); });
    const onResponse = vi.fn(async () => { order.push('winner receipt'); return undefined; });
    const authorizeFallback = vi.fn(async (p: RunTurnParams) => {
      order.push('fallback permit');
      expect(p.messages).toEqual(originalMessages); expect(p.tools).toEqual(originalTools);
      return nextPermit(2);
    });
    let pristineRequest: unknown;
    const dispatch = vi.fn(async (request) => {
      if (dispatch.mock.calls.length === 1) {
        pristineRequest = structuredClone({ messages: request.messages, tools: request.tools });
        request.messages.push({ role: 'assistant', content: 'MUTATED FAILED OUTPUT' });
        request.tools[0].function.parameters.properties.injected = { type: 'string' };
        original.messages.push({ role: 'user', content: 'LATER MUTATION' });
        return firstRaw;
      }
      expect({ messages: request.messages, tools: request.tools }).toEqual(pristineRequest);
      order.push('second dispatch');
      return winner;
    });
    const { runner, authority } = setup({ dispatch, authorizeFallback, onFailure, onResponse, onProviderUsed, onTurnComplete });
    const result = await runner.runTurn(original);
    expect(result.model).toBe('reviewed-model-2');
    expect(result.toolUses).toEqual([{ id: 'winning-file', name: 'write_file', input: { path: 'new.ts', content: 'new' } }]);
    expect(authority.authorize).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(firstRaw, expect.objectContaining({ callId: 'call-1' }), expect.any(Error), {
      stage: 'response_validation', reason: 'empty_completion', attempt: 1, hasResponse: true,
    });
    expect(order).toEqual(['failure durable', 'fallback permit', 'second dispatch', 'winner receipt']);
    expect(onResponse).toHaveBeenCalledOnce(); expect(onProviderUsed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ callId: 'call-2' }));
    expect(onTurnComplete).toHaveBeenCalledExactlyOnceWith(result, 'SURPLUS');
    expect(onText).toHaveBeenCalledExactlyOnceWith('Finished'); expect(onThinking).not.toHaveBeenCalled();
    expect(original.tools).toEqual(originalTools);
  });

  it('caps every failed turn at three accounted attempts even with unlimited positive grants', async () => {
    const onFailure = vi.fn(retryAuthorized); const onTurnComplete = vi.fn(); const onText = vi.fn();
    const authorizeFallback = vi.fn(async (_p, _previous, failure: SurplusTurnFailure) => nextPermit(failure.attempt + 1));
    const dispatch = vi.fn(async (_request, _signal, p: SurplusTurnPermit) => ({ ...emptyCompletion(), model: p.model }));
    const { runner } = setup({ dispatch, onFailure, authorizeFallback, onTurnComplete });
    await expect(runner.runTurn(params({ onText }))).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(dispatch).toHaveBeenCalledTimes(3); expect(onFailure).toHaveBeenCalledTimes(3); expect(authorizeFallback).toHaveBeenCalledTimes(2);
    expect(onFailure.mock.calls.map(call => call[3].attempt)).toEqual([1, 2, 3]);
    expect(onTurnComplete).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { retry: true }, { retry: false, receiptDurablyRecorded: true }, { retry: true, receiptDurablyRecorded: false }])(
    'cannot retry without the explicit durable accounting grant %j', async resolution => {
      const authorizeFallback = vi.fn(async () => nextPermit(2));
      const { runner, authority } = setup({ dispatch: vi.fn(async () => emptyCompletion()), authorizeFallback,
        onFailure: vi.fn(async () => resolution as SurplusFailureResolution | undefined) });
      await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
      expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled();
    },
  );

  it('does not retry when accounting fails, or when the fallback hook is absent', async () => {
    const authorizeFallback = vi.fn(async () => nextPermit(2));
    const failedReceipt = setup({ dispatch: vi.fn(async () => emptyCompletion()), authorizeFallback,
      onFailure: vi.fn().mockRejectedValue(new Error('quarantined receipt PRIVATE')) });
    await expect(failedReceipt.runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authorizeFallback).not.toHaveBeenCalled(); expect(failedReceipt.authority.dispatch).toHaveBeenCalledOnce();
    const noHook = setup({ dispatch: vi.fn(async () => emptyCompletion()), onFailure: vi.fn(retryAuthorized) });
    await expect(noHook.runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(noHook.authority.dispatch).toHaveBeenCalledOnce();
  });

  it('can account a transport error, but never infers a retry from upstream error strings', async () => {
    const secret = new Error('no_sellers_for_model sk-SECRET provider private');
    const authorizeFallback = vi.fn(async () => nextPermit(2)); const onFailure = vi.fn(async () => undefined);
    const { runner, authority } = setup({ dispatch: vi.fn().mockRejectedValue(secret), onFailure, authorizeFallback });
    const error = await runner.runTurn(params()).catch(e => e);
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(Object), secret, {
      stage: 'dispatch', reason: 'dispatch_failed', attempt: 1, hasResponse: false,
    });
    expect(Object.isFrozen(onFailure.mock.calls[0][3])).toBe(true);
    expect(JSON.stringify(onFailure.mock.calls[0][3])).not.toMatch(/SECRET|provider|no_sellers/);
  });

  it('lets only the trusted parent authorize an independently reconciled transport failure', async () => {
    const authorizeFallback = vi.fn(async () => nextPermit(2)); const onFailure = vi.fn(retryAuthorized);
    const dispatch = vi.fn().mockRejectedValueOnce(new Error('opaque transport failure')).mockResolvedValueOnce(completion({ model: 'reviewed-model-2' }));
    const { runner } = setup({ dispatch, onFailure, authorizeFallback });
    expect((await runner.runTurn(params())).model).toBe('reviewed-model-2');
    expect(onFailure).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it.each([{ callId: 'call-1' }, { callId: 'fresh', buildId: 'other-build' }, { callId: 'fresh', endpoint: 'https://evil.test/min90/v1' }])(
    'rejects an unsafe fallback permit before another dispatch %j', async invalid => {
      const { runner, authority } = setup({ dispatch: vi.fn(async () => emptyCompletion()), onFailure: vi.fn(retryAuthorized),
        authorizeFallback: vi.fn(async () => permit(invalid)) });
      await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
      expect(authority.dispatch).toHaveBeenCalledOnce();
    },
  );

  it('keeps a content-filter refusal terminal despite an erroneous positive parent grant', async () => {
    const authorizeFallback = vi.fn(async () => nextPermit(2)); const onFailure = vi.fn(retryAuthorized);
    const { runner, authority } = setup({ authorizeFallback, onFailure, dispatch: vi.fn(async () => completion({ choices: [
      { message: { role: 'assistant', content: 'filtered' }, finish_reason: 'content_filter' },
    ] })) });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled();
    expect(onFailure.mock.calls[0][3].reason).toBe('content_filter');
  });

  it.each([false, true])('keeps populated refusal terminal with tools=%s despite an erroneous retry grant', async withTools => {
    const authorizeFallback = vi.fn(async () => nextPermit(2)), onFailure = vi.fn(retryAuthorized), onText = vi.fn();
    const onResponse = vi.fn(), onTurnComplete = vi.fn();
    const message = { role: 'assistant', content: withTools ? 'unpublished' : null, refusal: 'Policy refusal',
      ...(withTools ? { tool_calls: [{ id: 'refused-tool', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/App.ts', content: 'never execute' }) } }] } : {}) };
    const { runner, authority } = setup({ authorizeFallback, onFailure, onResponse, onTurnComplete,
      dispatch: vi.fn(async () => completion({ choices: [{ message, finish_reason: withTools ? 'tool_calls' : 'stop' }] })) });
    await expect(runner.runTurn(params({ onText }))).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce(); expect(onFailure.mock.calls[0][3].reason).toBe('content_filter');
    expect(onText).not.toHaveBeenCalled(); expect(onResponse).not.toHaveBeenCalled(); expect(onTurnComplete).not.toHaveBeenCalled();
  });

  it('never retries a receipt hook or publication callback failure', async () => {
    for (const hook of ['onResponse', 'onProviderUsed', 'onTurnComplete'] as const) {
      const authorizeFallback = vi.fn(async () => nextPermit(2)); const onFailure = vi.fn(retryAuthorized);
      const callback = vi.fn(() => { throw new Error('private callback failure'); });
      const { runner, authority } = setup({ onFailure, authorizeFallback, [hook]: callback });
      await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
      expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled(); expect(onFailure).not.toHaveBeenCalled();
    }
  });

  it('does not reinterpret a tool execution or user text callback exception as a retryable inference failure', async () => {
    const authorizeFallback = vi.fn(async () => nextPermit(2)); const onFailure = vi.fn(retryAuthorized);
    const onText = vi.fn(() => { throw new Error('downstream generated file effect failed'); });
    const { runner, authority } = setup({ onFailure, authorizeFallback });
    await expect(runner.runTurn(params({ onText }))).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(onText).toHaveBeenCalledOnce(); expect(authority.dispatch).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled(); expect(authorizeFallback).not.toHaveBeenCalled();
  });

  it.each(['stop', 'maintenance', 'deadline', 'timeout'] as const)('never falls back after %s during failed-attempt accounting', async kind => {
    vi.useFakeTimers();
    const controller = new AbortController(); let finish!: () => void;
    const onFailure = vi.fn(() => new Promise<SurplusFailureResolution>(resolve => { finish = () => resolve({ retry: true, receiptDurablyRecorded: true }); }));
    const authorizeFallback = vi.fn(async () => nextPermit(2)); const onText = vi.fn();
    const { runner, authority } = setup({ timeoutMs: kind === 'deadline' ? 1000 : 100, onFailure, authorizeFallback, dispatch: vi.fn(async () => emptyCompletion()) });
    const pending = runner.runTurn(params({ onText, signal: controller.signal, ...(kind === 'deadline' ? { deadlineAt: Date.now() + 500 } : {}) }));
    const rejected = expect(pending).rejects.toThrow(kind === 'stop' ? /stop/i : kind === 'maintenance' ? 'maintenance' : kind === 'deadline' ? BUDGET_REACHED_MESSAGE : PUBLIC_BUILD_ENGINE_TIMEOUT);
    await vi.advanceTimersByTimeAsync(0); expect(onFailure).toHaveBeenCalledOnce();
    if (kind === 'stop') controller.abort();
    else if (kind === 'maintenance') for (const listener of maintenance.listeners) listener({ enabled: true });
    else await vi.advanceTimersByTimeAsync(kind === 'deadline' ? 501 : 101);
    await rejected; finish(); await vi.advanceTimersByTimeAsync(0);
    expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([new BuildStoppedError(), new AiMaintenanceError(), Object.assign(new Error('unknown abort'), { name: 'AbortError' }),
    Object.assign(new Error('unknown timeout'), { name: 'TimeoutError' })])('denies terminal control errors even if parent mistakenly grants retry: %s', async error => {
    const authorizeFallback = vi.fn(async () => nextPermit(2));
    const { runner, authority } = setup({ dispatch: vi.fn().mockRejectedValue(error), onFailure: vi.fn(retryAuthorized), authorizeFallback });
    await expect(runner.runTurn(params())).rejects.toThrow();
    expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled();
  });

  it('checks wall-clock expiration before another dispatch even if timer callback has not fired', async () => {
    vi.useFakeTimers();
    const authorizeFallback = vi.fn(async () => nextPermit(2));
    const onFailure = vi.fn(async () => { vi.setSystemTime(Date.now() + 101); return retryAuthorized(); });
    const { runner, authority } = setup({ timeoutMs: 100, dispatch: vi.fn(async () => emptyCompletion()), onFailure, authorizeFallback });
    await expect(runner.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_TIMEOUT);
    expect(authority.dispatch).toHaveBeenCalledOnce(); expect(authorizeFallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reset the turn timeout for a fallback attempt or publish its late response', async () => {
    vi.useFakeTimers(); let secondResolve!: (value: OpenAiCompletionLike) => void;
    const onFailure = vi.fn(retryAuthorized); const onText = vi.fn(); const onResponse = vi.fn();
    const dispatch = vi.fn(async (_r, _s, p: SurplusTurnPermit) => {
      if (p.callId === 'call-1') { await new Promise(resolve => setTimeout(resolve, 60)); return emptyCompletion(); }
      return new Promise<OpenAiCompletionLike>(resolve => { secondResolve = resolve; });
    });
    const { runner } = setup({ timeoutMs: 100, dispatch, onFailure, onResponse, authorizeFallback: vi.fn(async () => nextPermit(2)) });
    const pending = runner.runTurn(params({ onText })); const rejected = expect(pending).rejects.toThrow(PUBLIC_BUILD_ENGINE_TIMEOUT);
    await vi.advanceTimersByTimeAsync(61); expect(dispatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40); await rejected;
    secondResolve(completion({ model: 'reviewed-model-2' })); await vi.advanceTimersByTimeAsync(0);
    expect(onFailure).toHaveBeenCalledTimes(2); expect(onResponse).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it('tags turn_timeout distinctly from terminal_fold without leaking own properties', async () => {
    vi.useFakeTimers();
    const { runner } = setup({ timeoutMs: 100, dispatch: vi.fn(async () => new Promise(() => {})) });
    const pending = runner.runTurn(params());
    const rejected = expect(pending).rejects.toThrow(PUBLIC_BUILD_ENGINE_TIMEOUT);
    await vi.advanceTimersByTimeAsync(101);
    const error = await pending.catch(e => e);
    await rejected;
    expect(publicBuildEngineSafeReason(error)).toBe('turn_timeout');
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(['message', 'name', 'stack']);
    expect(JSON.stringify(error)).not.toMatch(/turn_timeout|surplus|Surplus/i);
    expect(vi.getTimerCount()).toBe(0);
  });

});

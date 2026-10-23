import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
const m = vi.hoisted(() => ({ verify: vi.fn(), acquire: vi.fn(), release: vi.fn() }));
vi.mock('../../lib/authMiddleware', () => ({ verifyFirebaseToken: m.verify }));
vi.mock('../FreeChain/admissionQueue', () => ({ freeChainAdmissionQueue: { acquire: m.acquire } }));
import { runWithAuthenticatedInferenceGatewayRequest, runWithInferenceGatewayContext, runWithInferenceGatewayEntryAdmission } from './runtime';
import type { InferenceGatewayContext } from './context';
const context = (overrides: Partial<InferenceGatewayContext> = {}): InferenceGatewayContext => ({
  principalId: 'verified-user', tenantId: 'verified-user', surface: 'chat', policyKey: 'chat:text',
  qualityTier: 'clinical', dataClass: 'health', funding: 'platform-free-fallback', mode: 'free-first-authorized-paid',
  deadlineAtMs: Date.now() + 90000, ...overrides,
});
const trusted = <T>(run: () => Promise<T>, overrides: Partial<InferenceGatewayContext> = {}) =>
  runWithAuthenticatedInferenceGatewayRequest({} as Request, () => runWithInferenceGatewayContext(context(overrides), run));
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all'); vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat');
  m.verify.mockResolvedValue('verified-user'); m.acquire.mockResolvedValue({ admitted: true, waitedMs: 3, release: m.release }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('selected gateway early admission lifecycle', () => {
  it('acquires before prompt work and reuses the same live nested lease', async () => {
    const handler = vi.fn(async () => { expect(m.acquire).toHaveBeenCalledOnce(); return runWithInferenceGatewayEntryAdmission(async () => 'done'); });
    expect(await trusted(() => runWithInferenceGatewayEntryAdmission(handler))).toBe('done');
    expect(m.acquire).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
  });
  it('blocks rejected admission before expensive work', async () => {
    m.acquire.mockResolvedValue({ admitted: false, reason: 'queue-full', waitedMs: 0 }); const handler = vi.fn();
    await expect(trusted(() => runWithInferenceGatewayEntryAdmission(handler))).rejects.toMatchObject({ reason: 'admission-queue-full' });
    expect(handler).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'cancelled', 'expired'] as const)('rechecks %s after the queue before prompt assembly', async reason => {
    const abort = new AbortController(); const handler = vi.fn(); const deadline = Date.now() + 1000;
    m.acquire.mockImplementation(async () => {
      if (reason === 'disabled') vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
      if (reason === 'cancelled') abort.abort();
      if (reason === 'expired') vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
      return { admitted: true, waitedMs: 1000, release: m.release };
    });
    await expect(trusted(() => runWithInferenceGatewayEntryAdmission(handler), { signal: abort.signal, deadlineAtMs: deadline })).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect(handler).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
  });
  it('invalidates a released lease even in detached async descendants', async () => {
    let wake!: () => void; let detached!: Promise<unknown>;
    await trusted(() => runWithInferenceGatewayEntryAdmission(async () => {
      detached = new Promise<void>(resolve => { wake = resolve; }).then(() => runWithInferenceGatewayEntryAdmission(async () => 'late'));
    }));
    expect(m.release).toHaveBeenCalledOnce(); wake(); await expect(detached).resolves.toBe('late');
    expect(m.acquire).toHaveBeenCalledTimes(2); expect(m.release).toHaveBeenCalledTimes(2);
  });
  it('releases on handler error and cannot mint a lease from context UID alone', async () => {
    await expect(trusted(() => runWithInferenceGatewayEntryAdmission(async () => { throw Error('handler'); }))).rejects.toThrow('handler');
    expect(m.release).toHaveBeenCalledOnce(); m.acquire.mockClear();
    await expect(runWithInferenceGatewayContext(context(), () => runWithInferenceGatewayEntryAdmission(async () => 'untrusted'))).rejects.toMatchObject({ reason: 'context-unverified' });
    expect(m.acquire).not.toHaveBeenCalled();
  });
  it('OFF performs no extra queue work', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); expect(await trusted(() => runWithInferenceGatewayEntryAdmission(async () => 'legacy'))).toBe('legacy');
    expect(m.acquire).not.toHaveBeenCalled();
  });
});

it('revoking a selected canary during its queue wait blocks prompt work and releases the lease', async () => {
  vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'canary'); vi.stubEnv('INFERENCE_GATEWAY_CANARY_UIDS', 'verified-user');
  const handler = vi.fn(); m.acquire.mockImplementationOnce(async () => { vi.stubEnv('INFERENCE_GATEWAY_CANARY_UIDS', ''); return { admitted: true, waitedMs: 1, release: m.release }; });
  await expect(trusted(() => runWithInferenceGatewayEntryAdmission(handler))).rejects.toMatchObject({ reason: 'disabled-after-selection' });
  expect(handler).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
});

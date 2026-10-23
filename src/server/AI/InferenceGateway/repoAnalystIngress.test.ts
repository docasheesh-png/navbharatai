import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), fetchRepo: vi.fn(), gemini: vi.fn(), groq: vi.fn(), routed: vi.fn(), summary: vi.fn() }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseToken: m.verify }));
vi.mock('../../lib/aiCalls', () => ({ callGemini: m.gemini, callGroq: m.groq }));
vi.mock('../../repoAnalyst/githubFetch', async original => ({ ...await original<typeof import('../../repoAnalyst/githubFetch')>(), fetchPublicRepo: m.fetchRepo }));
vi.mock('../AIRouterManager', () => ({ AIRouterManager: { getRouter: () => ({ routeRaced: m.routed }) } }));
vi.mock('../../lib/AssistantSpendStore', () => ({ assistantSpendStore: { record: m.summary } }));
import { registerRepoAnalystRoutes } from '../../routes/repoAnalyst';
import { currentInferenceGatewayContext, InferenceGatewayTerminalError } from './runtime';
import { freeChainAdmissionQueue } from '../FreeChain/admissionQueue';
const route = (operation: 'chat' | 'generate') => captureRoutes(registerRepoAnalystRoutes).get(`POST /api/repo-analyst/${operation}`)!;
const snapshot = { ref: { owner: 'acme', repo: 'widget' }, url: 'https://github.com/acme/widget', defaultBranch: 'main', stars: 1, forks: 0, openIssues: 0,
  license: 'MIT', languages: ['TypeScript'], topics: [], tree: ['src/index.ts'], readme: 'Real fetched fixture content', keyFiles: [], notes: [] };
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all');
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'professional');
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('NODE_ENV', 'production');
  m.verify.mockResolvedValue('verified-user'); m.fetchRepo.mockResolvedValue(snapshot); m.summary.mockResolvedValue(undefined);
  m.gemini.mockResolvedValue('legacy answer'); m.groq.mockResolvedValue('legacy rescue');
  m.routed.mockResolvedValue({ response: { content: 'reviewed answer', provider: 'GROQ', model: 'reviewed-test-model', latencyMs: 1 }, telemetry: { success: true } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Free Mode Repo Analyst reaches the real text chokepoint', () => {
  it('binds verified identity and keeps real repo grounding plus its persona, never public-only privacy', async () => {
    let context: ReturnType<typeof currentInferenceGatewayContext>;
    m.routed.mockImplementationOnce(async () => { context = currentInferenceGatewayContext(); return { response: { content: 'reviewed answer', provider: 'GROQ', model: 'reviewed' }, telemetry: { success: true } }; });
    const res = mockRes();
    await route('chat')(mockReq({ headers: { 'x-github-token': 'non-secret-github-fixture' }, body: { message: 'analyse acme/widget', uid: 'attacker', qualityTier: 'weak', dataClass: 'public' } }), res);
    expect(res.body).toEqual({ reply: 'reviewed answer', professionalId: 'repo_analyst' });
    expect(context).toMatchObject({ principalId: 'verified-user', tenantId: 'verified-user', surface: 'professional', policyKey: 'mode:repo-analyst:chat',
      qualityTier: 'professional', dataClass: 'confidential', funding: 'platform-free-fallback', signal: expect.any(AbortSignal) });
    expect(m.fetchRepo).toHaveBeenCalledWith({ owner: 'acme', repo: 'widget' }, 'non-secret-github-fixture', expect.any(AbortSignal));
    expect(m.routed.mock.calls[0][0]).toContain('Real fetched fixture content');
    expect(m.routed.mock.calls[0][1]).toContain('license-respecting');
    expect(m.verify).toHaveBeenCalledOnce(); expect(m.gemini).not.toHaveBeenCalled(); expect(m.groq).not.toHaveBeenCalled();
    expect(freeChainAdmissionQueue.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });
  it('the improver keeps its actual delimited-file format and routes only once', async () => {
    m.routed.mockResolvedValueOnce({ response: { content: 'One improvement\n=== FILE: tests/check.ts ===\nexport const checked = true;\n=== END FILE ===', provider: 'GROQ', model: 'reviewed' }, telemetry: { success: true } });
    const res = mockRes(); await route('generate')(mockReq({ body: { message: 'add tests for acme/widget' } }), res);
    expect(res.body).toMatchObject({ summary: 'One improvement', files: [{ path: 'tests/check.ts', content: 'export const checked = true;\n' }] });
    expect(m.routed.mock.calls[0][1]).toContain('=== FILE: relative/path/here ===');
    expect(m.routed).toHaveBeenCalledOnce(); expect(m.gemini).not.toHaveBeenCalled(); expect(m.groq).not.toHaveBeenCalled();
  });
  it.each(['chat', 'generate'] as const)('%s terminal failure cannot reopen either direct SDK fallback', async operation => {
    m.routed.mockRejectedValueOnce(new InferenceGatewayTerminalError('policy-denied'));
    const res = mockRes(); await route(operation)(mockReq({ body: { message: 'analyse acme/widget' } }), res);
    expect(res.statusCode).toBe(503); expect(m.routed).toHaveBeenCalledOnce(); expect(m.gemini).not.toHaveBeenCalled(); expect(m.groq).not.toHaveBeenCalled();
  });
  it('unverified caller cannot borrow a body uid or start repo fetch before admission', async () => {
    m.verify.mockResolvedValueOnce(null); const res = mockRes();
    await route('chat')(mockReq({ body: { message: 'analyse acme/widget', uid: 'victim' } }), res);
    expect(res.statusCode).toBe(503); expect(m.fetchRepo).not.toHaveBeenCalled(); expect(m.routed).not.toHaveBeenCalled(); expect(m.gemini).not.toHaveBeenCalled();
  });
  it('queue denial happens before GitHub reads, prompt assembly or inference', async () => {
    vi.spyOn(freeChainAdmissionQueue, 'acquire').mockResolvedValueOnce({ admitted: false, reason: 'queue-full', waitedMs: 0 });
    const res = mockRes(); await route('generate')(mockReq({ body: { message: 'analyse acme/widget' } }), res);
    expect(res.statusCode).toBe(503); expect(m.fetchRepo).not.toHaveBeenCalled(); expect(m.routed).not.toHaveBeenCalled();
  });
  it('disconnect cancels the selected repo-read signal and never starts text inference', async () => {
    let signal: AbortSignal | undefined;
    m.fetchRepo.mockImplementationOnce((_ref, _token, value: AbortSignal) => { signal = value; return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); });
    const res = mockRes(); const pending = route('chat')(mockReq({ body: { message: 'analyse acme/widget' } }), res);
    await vi.waitFor(() => expect(m.fetchRepo).toHaveBeenCalledOnce()); res.emit('close'); await pending;
    expect(signal?.aborted).toBe(true); expect(m.routed).not.toHaveBeenCalled(); expect(m.gemini).not.toHaveBeenCalled(); expect(m.groq).not.toHaveBeenCalled();
    expect(freeChainAdmissionQueue.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });
  it('OFF retains the direct legacy chain and fetch contract without extra authentication', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); m.gemini.mockRejectedValueOnce(new Error('legacy outage'));
    const res = mockRes(); await route('chat')(mockReq({ body: { message: 'analyse acme/widget' } }), res);
    expect(res.body.reply).toBe('legacy rescue'); expect(m.fetchRepo).toHaveBeenCalledWith({ owner: 'acme', repo: 'widget' }, undefined);
    expect(m.verify).not.toHaveBeenCalled(); expect(m.routed).not.toHaveBeenCalled(); expect(m.gemini).toHaveBeenCalledOnce(); expect(m.groq).toHaveBeenCalledOnce();
  });
});

it.each(['chat', 'generate'] as const)('non-canary %s preserves legacy repo fetch and direct-model arguments', async operation => {
  vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'canary'); vi.stubEnv('INFERENCE_GATEWAY_CANARY_UIDS', 'other-owner');
  const admission = vi.spyOn(freeChainAdmissionQueue, 'acquire');
  m.gemini.mockImplementationOnce(async () => { expect(currentInferenceGatewayContext()).toBeUndefined(); return operation === 'chat' ? 'legacy answer' : 'One improvement\n=== FILE: tests/check.ts ===\nexport const checked = true;\n=== END FILE ==='; });
  const res = mockRes(); await route(operation)(mockReq({ body: { message: 'analyse acme/widget', uid: 'other-owner' } }), res);
  expect(res.statusCode).toBe(200); expect(m.fetchRepo).toHaveBeenCalledWith({ owner: 'acme', repo: 'widget' }, undefined);
  expect(m.gemini).toHaveBeenCalledOnce(); expect(m.routed).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled();
});

// These fixtures isolate routing/entitlements; shared quota behavior is covered by freeAnswerRoutes and quota store tests.
vi.mock('../../lib/freeAnswerQuota', () => ({
  withFreeAnswerQuota: async (_req: unknown, _res: unknown, run: () => Promise<unknown>) => run(),
  markFreeAnswer: () => {}, markFreeAnswerProviderFailure: () => {}, assertFreeAnswerActive: () => {}, freeAnswerSignal: () => undefined,
}));

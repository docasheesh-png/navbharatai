import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), pass: vi.fn(), used: vi.fn(), examUsed: vi.fn(), engine: vi.fn(), charge: vi.fn(), increment: vi.fn(), vision: vi.fn() }));
vi.mock('../../lib/authMiddleware', () => ({
  verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity,
  buildRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  enforceNotBanned: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../professionals/engine', () => ({ runProfessionalChatWithUsage: m.engine }));
// The entitlement gate is REAL. Only its external reads/writes are replaced.
vi.mock('../../professionals/ProfessionalPassStore', () => ({ professionalPassStore: { getStatus: m.pass } }));
vi.mock('../../professionals/ProfessionalUsageStore', () => ({ professionalUsageStore: { getTodayCount: m.used, increment: m.increment }, professionalExamUsageStore: { getTodayCount: m.examUsed, increment: m.increment } }));
vi.mock('../../lib/freeProgram', async original => ({ ...await original<typeof import('../../lib/freeProgram')>(), freeProgramPaused: async () => false }));
vi.mock('../../lib/aiTurnCharge', async original => ({ ...await original<typeof import('../../lib/aiTurnCharge')>(), chargeForAiTurn: m.charge }));
vi.mock('../../lib/attachmentText', async original => ({ ...await original<typeof import('../../lib/attachmentText')>(), buildDocumentContext: async () => '' }));
vi.mock('../../lib/visionDescribe', () => ({ describeVisionAttachments: m.vision }));
vi.mock('../../lib/serverDb', async original => ({ ...await original<typeof import('../../lib/serverDb')>(), getServerDb: () => null }));
import { registerProfessionalsRoutes } from '../../routes/professionals';
import { currentInferenceGatewayContext } from './runtime';
import { assertLegacyInferenceAllowed, strictFreeRequired } from '../inferencePolicy';

/** Invoke ALL registered middleware, not the last-handler shortcut that missed this regression. */
async function invoke(operation: 'chat' | 'exam', body: Record<string, unknown>) {
  const registered = new Map<string, Array<(...args: any[]) => unknown>>();
  registerProfessionalsRoutes({ get: () => {}, post: (path: string, ...handlers: Array<(...args: any[]) => unknown>) => registered.set(path, handlers) } as any);
  const handlers = registered.get(`/api/professional/:id/${operation}`)!;
  const req = mockReq({ params: { id: 'teacher_ai' }, body }); const res = mockRes();
  const dispatch = async (index: number): Promise<void> => {
    if (index >= handlers.length) return;
    let next: Promise<void> | undefined;
    await handlers[index](req, res, () => { next = dispatch(index + 1); return next; });
    if (next) await next;
  };
  await dispatch(0); return res;
}
const paper = JSON.stringify({ read: { subject: 'Physics', topic: '' }, questions: [{ question: 'Which is a unit of force?', options: ['Newton', 'Metre', 'Second', 'Kelvin'], correctIndex: 0, explanation: 'Force is measured in newtons.', topic: 'Units', level: 'low' }] });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'professional');
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on'); vi.stubEnv('PROFESSIONAL_FREE_QUOTA', 'on'); vi.stubEnv('AI_WALLET_SPEND', 'on');
  vi.stubEnv('SEMANTIC_MEMORY', 'off'); vi.stubEnv('NODE_ENV', 'production');
  m.identity.mockResolvedValue({ uid: 'verified-professional-user', email: null }); m.verify.mockResolvedValue('verified-professional-user');
  m.pass.mockResolvedValue({ active: false }); m.used.mockResolvedValue(0); m.examUsed.mockResolvedValue(0);
  m.engine.mockResolvedValue({ reply: 'answer', spend: { provider: 'GROQ', model: 'original-model', inputTokens: 20, outputTokens: 10 } });
  m.charge.mockResolvedValue({ charge: false }); m.increment.mockResolvedValue(undefined); m.vision.mockResolvedValue('original vision');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('server professional entitlements precede Free inference policy', () => {
  it.each(['chat', 'exam'] as const)('an active paid pass retains its original %s tier, legacy policy and charging context with both switches ON', async operation => {
    m.pass.mockResolvedValueOnce({ active: true });
    const spend = { provider: 'GROQ', model: 'original-paid-model', inputTokens: 20, outputTokens: 10 };
    m.engine.mockImplementationOnce(async (_config, _message, _history, uid, tier, opts) => {
      expect(uid).toBe('verified-professional-user'); expect(tier).toBe('paid'); expect(opts.freeProductGateway).toBe(false);
      expect(strictFreeRequired()).toBe(false); expect(currentInferenceGatewayContext()).toBeUndefined();
      expect(() => assertLegacyInferenceAllowed('direct-text-provider')).not.toThrow();
      return { reply: operation === 'exam' ? paper : 'paid answer', spend };
    });
    m.charge.mockImplementationOnce(async (_db, context, actualSpend) => {
      expect(strictFreeRequired()).toBe(false); expect(currentInferenceGatewayContext()).toBeUndefined();
      expect(context).toMatchObject({ userId: 'verified-professional-user', hasActivePass: true, billableFraction: 1 });
      expect(actualSpend).toEqual(spend); return { charge: false };
    });
    const res = await invoke(operation, { message: 'hello', subject: 'Physics', count: 1, tier: 'free', freeProductGateway: true });
    expect(res.statusCode).toBe(200); expect(m.pass).toHaveBeenCalledOnce(); expect(m.engine).toHaveBeenCalledOnce(); expect(m.charge).toHaveBeenCalledOnce();
    expect(m.verify).not.toHaveBeenCalled(); expect(m.used).not.toHaveBeenCalled(); expect(m.increment).not.toHaveBeenCalled();
  });
  it.each(['chat', 'exam'] as const)('a genuine Free %s allowance remains strict and gateway-selected despite a forged paid body tier', async operation => {
    m.engine.mockImplementationOnce(async (_config, _message, _history, _uid, tier, opts) => {
      expect(tier).toBe('free'); expect(opts.freeProductGateway).toBe(true); expect(strictFreeRequired()).toBe(true);
      expect(currentInferenceGatewayContext()).toMatchObject({ principalId: 'verified-professional-user', funding: 'platform-free-fallback', mode: 'strict-free', qualityTier: 'clinical', dataClass: 'health' });
      expect(() => assertLegacyInferenceAllowed('direct-text-provider')).toThrow();
      return { reply: operation === 'exam' ? paper : 'free answer', spend: {} };
    });
    const res = await invoke(operation, { message: 'hello', subject: 'Physics', count: 1, tier: 'paid', hasActivePass: true });
    expect(res.statusCode).toBe(200); expect(m.pass).toHaveBeenCalledOnce(); expect(m.verify).toHaveBeenCalledOnce(); expect(m.engine).toHaveBeenCalledOnce();
    expect(operation === 'chat' ? m.used : m.examUsed).toHaveBeenCalledOnce();
  });
  it('paid vision is not rejected by the Free flag before its original describe call', async () => {
    m.pass.mockResolvedValueOnce({ active: true });
    m.vision.mockImplementationOnce(async () => { expect(strictFreeRequired()).toBe(false); expect(() => assertLegacyInferenceAllowed('vision-description')).not.toThrow(); return 'original vision'; });
    const res = await invoke('chat', { message: 'read image', fileAttachments: [{ name: 'report.png', type: 'image/png', base64: 'AA==' }], tier: 'free' });
    expect(res.statusCode).toBe(200); expect(m.vision).toHaveBeenCalledOnce(); expect(m.engine.mock.calls[0][4]).toBe('paid'); expect(m.verify).not.toHaveBeenCalled();
  });
  it('Free vision reaches claimed description with strict policy and cannot enter legacy with both switches ON', async () => {
    m.vision.mockImplementationOnce(async () => { expect(strictFreeRequired()).toBe(true); expect(currentInferenceGatewayContext()).toMatchObject({ funding: 'platform-free-fallback', mode: 'strict-free' }); expect(() => assertLegacyInferenceAllowed('vision-description')).toThrow(); return 'claimed vision'; });
    const res = await invoke('chat', { message: 'read image', fileAttachments: [{ name: 'report.png', type: 'image/png', base64: 'AA==' }], tier: 'paid' });
    expect(res.statusCode).toBe(200); expect(m.vision).toHaveBeenCalledOnce(); expect(m.engine).toHaveBeenCalledOnce();
  });
});

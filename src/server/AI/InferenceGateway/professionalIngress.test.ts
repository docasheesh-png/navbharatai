import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), gate: vi.fn(), engine: vi.fn(), document: vi.fn(), vision: vi.fn(), charge: vi.fn(), increment: vi.fn() }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity }));
vi.mock('../../professionals/engine', () => ({ runProfessionalChatWithUsage: m.engine }));
vi.mock('../../professionals/passGate', async original => ({ ...await original<typeof import('../../professionals/passGate')>(), gateProfessionalTurn: m.gate, gateProfessionalExam: m.gate }));
vi.mock('../../lib/attachmentText', async original => ({ ...await original<typeof import('../../lib/attachmentText')>(), buildDocumentContext: m.document }));
vi.mock('../../lib/visionDescribe', () => ({ describeVisionAttachments: m.vision }));
vi.mock('../../lib/aiTurnCharge', async original => ({ ...await original<typeof import('../../lib/aiTurnCharge')>(), chargeForAiTurn: m.charge }));
vi.mock('../../professionals/ProfessionalUsageStore', () => ({ professionalUsageStore: { increment: m.increment }, professionalExamUsageStore: { increment: m.increment } }));
vi.mock('../../lib/serverDb', async original => ({ ...await original<typeof import('../../lib/serverDb')>(), getServerDb: () => null }));
import { registerProfessionalsRoutes } from '../../routes/professionals';
import { currentInferenceGatewayContext } from './runtime';
import { freeChainAdmissionQueue } from '../FreeChain/admissionQueue';
const route = () => captureRoutes(registerProfessionalsRoutes).get('POST /api/professional/:id/chat')!;
const req = (body: Record<string, unknown>) => mockReq({ params: { id: 'teacher_ai' }, body });
const freeGate = { allow: true, tier: 'free', countsAgainstFree: false, billableFraction: 0, isFreeListed: false, hasActivePass: false, freeQuestions: 5 };
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all');
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'professional');
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('NODE_ENV', 'production');
  m.verify.mockResolvedValue('verified-user'); m.identity.mockResolvedValue({ uid: 'verified-user', email: null }); m.gate.mockResolvedValue(freeGate);
  m.engine.mockResolvedValue({ reply: 'answer', spend: {} }); m.document.mockResolvedValue(''); m.vision.mockResolvedValue('vision description');
  m.charge.mockResolvedValue({ charge: false }); m.increment.mockResolvedValue(undefined); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('professional Free product early ingress', () => {
  it('enters verified clinical/health context before document extraction, then retains the same context in the engine', async () => {
    const seen: unknown[] = [];
    m.document.mockImplementationOnce(async () => { seen.push(currentInferenceGatewayContext()); return 'private document'; });
    m.engine.mockImplementationOnce(async () => { seen.push(currentInferenceGatewayContext()); return { reply: 'answer', spend: {} }; });
    const res = mockRes(); await route()(req({ message: 'hello', userId: 'forged', fileAttachments: [{ type: 'text/plain', name: 'note.txt', base64: 'AA==' }] }), res);
    expect(res.body).toEqual({ reply: 'answer', professionalId: 'teacher_ai' }); expect(seen).toHaveLength(2);
    for (const context of seen) expect(context).toMatchObject({ principalId: 'verified-user', tenantId: 'verified-user', policyKey: 'professional:teacher_ai', qualityTier: 'clinical', dataClass: 'health', funding: 'platform-free-fallback' });
    expect(m.verify).toHaveBeenCalledOnce(); expect(freeChainAdmissionQueue.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });
  it('denies capacity before document, vision, memory/engine or charge work', async () => {
    vi.spyOn(freeChainAdmissionQueue, 'acquire').mockResolvedValueOnce({ admitted: false, reason: 'queue-full', waitedMs: 0 });
    const res = mockRes(); await route()(req({ message: 'hello', fileAttachments: [{ type: 'text/plain', name: 'note.txt', base64: 'AA==' }] }), res);
    expect(res.statusCode).toBe(503); expect(m.document).not.toHaveBeenCalled(); expect(m.vision).not.toHaveBeenCalled(); expect(m.engine).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
  });
  it('selected vision failure cannot spend outside the gateway or silently degrade to text', async () => {
    m.vision.mockRejectedValueOnce(new Error('selected vision unavailable'));
    const res = mockRes(); await route()(req({ message: 'read this image', fileAttachments: [{ type: 'image/png', name: 'photo.png', base64: 'AA==' }] }), res);
    expect(res.statusCode).toBeGreaterThanOrEqual(500); expect(m.vision).toHaveBeenCalledOnce(); expect(m.engine).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
  });
  it('the separately funded paid professional path remains entirely legacy, including vision', async () => {
    m.gate.mockResolvedValueOnce({ ...freeGate, tier: 'paid', billableFraction: 1 });
    m.engine.mockImplementationOnce(async () => { expect(currentInferenceGatewayContext()).toBeUndefined(); return { reply: 'paid answer', spend: {} }; });
    const res = mockRes(); await route()(req({ message: 'read image', fileAttachments: [{ type: 'image/png', name: 'photo.png', base64: 'AA==' }] }), res);
    expect(res.body.reply).toBe('paid answer'); expect(m.verify).not.toHaveBeenCalled(); expect(m.vision).toHaveBeenCalledOnce();
    expect(m.engine.mock.calls[0][5].freeProductGateway).toBe(false);
  });
  it('OFF leaves the existing Free vision path and its inference behavior untouched', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); const res = mockRes();
    await route()(req({ message: 'read image', fileAttachments: [{ type: 'image/png', name: 'photo.png', base64: 'AA==' }] }), res);
    expect(res.body.reply).toBe('answer'); expect(m.vision).toHaveBeenCalledOnce(); expect(m.verify).not.toHaveBeenCalled();
  });
  it('image-generation guidance is not enrolled in the text gateway', async () => {
    const res = mockRes(); await route()(req({ message: 'generate an image of a cat' }), res);
    expect(res.statusCode).toBe(200); expect(m.verify).not.toHaveBeenCalled(); expect(m.engine).not.toHaveBeenCalled(); expect(m.vision).not.toHaveBeenCalled();
  });
  it('a changed authentication principal cannot borrow the earlier professional gate or profile identity', async () => {
    m.verify.mockResolvedValueOnce('different-user'); const res = mockRes();
    await route()(req({ message: 'hello' }), res);
    expect(res.statusCode).toBe(503); expect(m.engine).not.toHaveBeenCalled(); expect(m.document).not.toHaveBeenCalled();
  });
});

it('non-canary Free professionals retain legacy context, charge and model behavior', async () => {
  vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'canary'); vi.stubEnv('INFERENCE_GATEWAY_CANARY_UIDS', 'other-owner');
  m.engine.mockImplementationOnce(async () => { expect(currentInferenceGatewayContext()).toBeUndefined(); return { reply: 'legacy professional answer', spend: {} }; });
  const res = mockRes(); await route()(req({ message: 'hello', uid: 'other-owner' }), res);
  expect(res.body.reply).toBe('legacy professional answer'); expect(m.engine).toHaveBeenCalledOnce(); expect(m.charge).toHaveBeenCalledOnce();
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ identity: vi.fn(), verify: vi.fn(), gate: vi.fn(), gateway: vi.fn(), legacy: vi.fn(), burn: vi.fn(), charge: vi.fn(), document: vi.fn(), vertex: vi.fn(), context: vi.fn(), direct: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: m.direct }; } }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: m.direct } }; } }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseIdentity: m.identity, verifyFirebaseToken: m.verify }));
vi.mock('../../professionals/passGate', () => ({ gateProfessionalTurn: m.gate, burnFreeMessage: m.burn }));
vi.mock('./runtime', async original => ({ ...await original<typeof import('./runtime')>(), maybeGatewayText: m.gateway }));
vi.mock('../AIRouterManager', () => ({ AIRouterManager: { getRouter: () => ({ routeRaced: m.legacy }) } }));
vi.mock('../../lib/aiTurnCharge', () => ({ chargeForAiTurn: m.charge }));
vi.mock('../../lib/attachmentText', () => ({ extractDocumentText: m.document }));
vi.mock('../../lib/vertexGenAI', () => ({ vertexGenAI: () => ({ models: { generateContent: m.vertex } }) }));
vi.mock('../../AppContext/AppContextInjector', () => ({ AppContextInjector: { getRelevantContext: m.context } }));
import { registerSdaRoutes } from '../../routes/sda';
import { currentInferenceGatewayContext } from './runtime';
import { readFileSync } from 'node:fs';
const route = () => captureRoutes(registerSdaRoutes as any).get('POST /api/sda-chat')!;
let sequence = 0;
const request = (body: Record<string, unknown> = {}) => mockReq({ body: { message: 'Discuss assessment of fever', sessionId: `gateway-case-${++sequence}`, ...body } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'doctor');
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on'); vi.stubEnv('DOSE_DIRECT_ANSWER', 'off'); vi.stubEnv('SDA_VERIFY', '1');
  for (const key of ['GROK_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) vi.stubEnv(key, '');
  m.identity.mockResolvedValue({ uid: 'verified-doctor', email: null }); m.verify.mockResolvedValue('verified-doctor');
  m.gate.mockResolvedValue({ allow: true, tier: 'free', uid: 'verified-doctor', countsAgainstFree: true, billableFraction: 0 });
  m.gateway.mockResolvedValue({ ok: true, content: 'What is the duration?', provider: 'GROQ', model: 'test', usage: { inputTokens: 10, outputTokens: 5 } });
  m.legacy.mockResolvedValue({ response: { content: 'Legacy question?', provider: 'GLM', model: 'legacy' }, telemetry: { success: true } });
  m.vertex.mockResolvedValue({ text: 'Legacy report question?' }); m.document.mockResolvedValue('Extracted text'); m.context.mockReturnValue(''); m.charge.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Doctor AI retains its original routing, audit and billing', () => {
  it.each(['free', 'paid'])('both free-system flags never select direct SDA ingress for the existing %s tier', async tier => {
    m.gate.mockResolvedValue({ allow: true, tier, uid: 'verified-doctor', countsAgainstFree: tier === 'free', billableFraction: tier === 'free' ? 0 : 1 });
    m.legacy.mockImplementationOnce(async () => {
      expect(currentInferenceGatewayContext()).toBeUndefined();
      return { response: { content: 'Legacy question?', provider: 'GLM', model: 'legacy', usage: { inputTokens: 20, outputTokens: 10 } }, telemetry: { success: true } };
    });
    const res = mockRes(); await route()(request({ mode: 'doctor', policyKey: 'doctor:text', funding: 'platform-free-fallback', userId: 'forged' }), res);
    expect(res.statusCode).toBe(200); expect(res.body.reply).toBe('Legacy question?');
    expect(m.legacy).toHaveBeenCalledOnce(); expect(m.gateway).not.toHaveBeenCalled(); expect(m.verify).not.toHaveBeenCalled();
    expect(m.gate.mock.calls[0][0]).toBe('verified-doctor');
    expect(m.charge.mock.calls[0][1].billableFraction).toBe(tier === 'free' ? 0 : 1);
    expect(m.charge.mock.calls[0][2]).toMatchObject({ provider: 'GLM', model: 'legacy', inputTokens: 20, outputTokens: 10 });
    expect(m.burn).toHaveBeenCalledTimes(tier === 'free' ? 1 : 0);
  });
  it('retains the paid provider path and original independent clinical audit with both free-system flags ON', async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv('GEMINI_API_KEY', 'test-only-key');
      m.gate.mockResolvedValue({ allow: true, tier: 'paid', uid: 'verified-doctor', countsAgainstFree: false, billableFraction: 1 });
      m.direct.mockImplementationOnce(async () => {
        expect(currentInferenceGatewayContext()).toBeUndefined();
        return { text: 'Refer now.', usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 10 } };
      });
      m.direct.mockResolvedValueOnce({ text: 'OK, but check oxygen saturation.' });
      const res = mockRes(); await route()(request(), res);
      expect(res.statusCode).toBe(200); expect(res.body.reply).toContain('Automated safety cross-check');
      expect(res.body.reply).toContain('check oxygen saturation'); expect(m.direct).toHaveBeenCalledTimes(2);
      expect(m.direct.mock.calls[1][0].model).toBe('gemini-2.5-flash');
      expect(m.gateway).not.toHaveBeenCalled(); expect(m.verify).not.toHaveBeenCalled(); expect(m.burn).not.toHaveBeenCalled();
      expect(m.charge.mock.calls[0][1].billableFraction).toBe(1);
      expect(m.charge.mock.calls[0][2]).toMatchObject({ provider: 'GEMINI', inputTokens: 25, outputTokens: 10 });
    } finally { vi.useRealTimers(); }
  });
  it('retains sent and server-recalled report images with the original vision path', async () => {
    const handler = route(); const sessionId = `reports-${++sequence}`;
    const first = mockRes(); await handler(request({ sessionId, message: 'Read this ECG', fileData: 'AA==', fileType: 'image/png', fileName: 'ecg.png' }), first);
    const next = mockRes(); await handler(request({ sessionId, message: 'Look at lead V2 on the ECG report again' }), next);
    expect(first.body.fileAnalyzed).toBe('ecg.png'); expect(next.body.fileAnalyzed).toBe('ecg.png');
    expect(m.vertex).toHaveBeenCalledTimes(2); expect(JSON.stringify(m.vertex.mock.calls[1])).toContain('AA==');
    expect(m.gateway).not.toHaveBeenCalled(); expect(m.verify).not.toHaveBeenCalled();
  });
  it('cannot bypass the authenticated professional gate using a Doctor body label', async () => {
    m.identity.mockResolvedValue(null);
    m.gate.mockResolvedValue({ allow: false, status: 401, body: { code: 'login_required' } });
    const res = mockRes(); await route()(request({ mode: 'doctor', tier: 'paid', userId: 'forged' }), res);
    expect(res.statusCode).toBe(401); expect(m.gate.mock.calls[0][0]).toBeNull();
    expect(m.direct).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled(); expect(m.gateway).not.toHaveBeenCalled();
    expect(m.charge).not.toHaveBeenCalled(); expect(m.burn).not.toHaveBeenCalled();
  });
  it('has no Doctor gateway ingress, alternate text policy or audit selection in the route source', () => {
    const source = readFileSync(new URL('../../routes/sda.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/InferenceGateway|maybeGatewayText|doctor:text|doctor:audit|gatewaySelected|freeModuleInferenceScope|strictFreeRequired|strictFreeText|StrictFreeCapabilityError/);
  });
});

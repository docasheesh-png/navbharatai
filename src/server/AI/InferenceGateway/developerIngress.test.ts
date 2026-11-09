import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ key: vi.fn(), general: vi.fn(), expert: vi.fn(), charge: vi.fn(), spent: vi.fn(), record: vi.fn() }));
const auth = { userId: 'api-user', keyId: 'api-key', scopes: ['ai:chat', 'ai:professionals'], dailyCapInr: 50 };
vi.mock('../../lib/ApiKeyStore', () => ({ apiKeyStore: { findByHash: m.key } }));
vi.mock('../../routes/apiKeys', () => ({ apiAuthOf: () => auth, apiKeyAuth: () => {}, requireScope: () => () => {} }));
vi.mock('../../lib/professionalRouting', () => ({ callProfessionalAIWithUsage: m.general }));
vi.mock('../../professionals/engine', () => ({ runProfessionalChatWithUsage: m.expert }));
vi.mock('../../AgentV3/WalletBalance', () => ({ firestoreWalletReader: () => ({}), readWalletBalanceInr: async () => 1000 }));
vi.mock('../../lib/ApiKeyUsageStore', () => ({ apiKeyUsageStore: { spentToday: m.spent, record: m.record } }));
vi.mock('../../lib/aiTurnCharge', () => ({ chargeForAiTurns: m.charge }));
import { registerDeveloperApiRoutes } from '../../routes/developerApi';
import { currentInferenceGatewayContext } from './runtime';
const routes = () => captureRoutes(registerDeveloperApiRoutes);
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on');
  vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'off'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'chat');
  m.key.mockResolvedValue(auth); m.spent.mockResolvedValue({ spentInr: 0, calls: 0, known: true }); m.record.mockResolvedValue(undefined); m.charge.mockResolvedValue(undefined);
  m.general.mockImplementation(async () => { expect(currentInferenceGatewayContext()).toMatchObject({ principalId: 'api-user', surface: 'developer-api', policyKey: 'developer-api:text', funding: 'existing-professional' }); return { content: 'API answer', spend: {} }; });
  m.expert.mockImplementation(async () => { expect(currentInferenceGatewayContext()).toMatchObject({ principalId: 'api-user', surface: 'developer-api', policyKey: 'developer-api:professional:teacher_ai', funding: 'existing-professional' }); return { reply: 'Expert API answer', spend: {} }; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it.each(['general', 'expert-alias', 'expert-route'] as const)('fixed chain includes developer %s without borrowing Firebase identity', async variant => {
  const request = mockReq({ headers: { 'x-api-key': 'nbai_offline_test_key' }, params: { id: 'teacher_ai' }, body: { uid: 'forged', model: variant === 'expert-alias' ? 'navbharatai/teacher_ai' : 'navbharatai', messages: [{ role: 'user', content: 'Explain Newton laws' }] } });
  const response = mockRes(); await routes().get(variant === 'expert-route' ? 'POST /api/professionals/:id/chat' : 'POST /api/chat/completions')!(request, response);
  expect(response.statusCode).toBe(200); expect(m.key).toHaveBeenCalledOnce();
  expect(variant === 'general' ? m.general : m.expert).toHaveBeenCalledOnce();
});
it('fresh key revocation prevents inference and after-answer charge', async () => {
  m.key.mockResolvedValue(null); const response = mockRes();
  await routes().get('POST /api/chat/completions')!(mockReq({ headers: { 'x-api-key': 'nbai_offline_test_key' }, body: { messages: [{ role: 'user', content: 'Hello' }] } }), response);
  expect(response.statusCode).toBe(503); expect(m.general).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
});

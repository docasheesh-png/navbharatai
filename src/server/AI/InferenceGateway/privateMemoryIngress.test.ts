/** Real route → engine → memory orchestration, with only auth/storage/provider edges simulated. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ verify: vi.fn(), identity: vi.fn(), gate: vi.fn(), memory: vi.fn(), profiles: vi.fn(), save: vi.fn(), append: vi.fn(), embed: vi.fn(), answer: vi.fn() }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseToken: m.verify, verifyFirebaseIdentity: m.identity }));
vi.mock('../../professionals/passGate', async original => ({ ...await original<typeof import('../../professionals/passGate')>(), gateProfessionalTurn: m.gate }));
vi.mock('../../memory/ConversationMemoryStore', () => ({ loadMemory: m.memory, appendMemory: m.append }));
vi.mock('../../professionals/ClientProfileStore', () => ({ clientProfileStore: { load: m.profiles, save: m.save } }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { embedContent: m.embed }; } }));
vi.mock('../../lib/professionalRouting', () => ({ callProfessionalAIWithUsage: m.answer }));
vi.mock('../../lib/aiTurnCharge', async original => ({ ...await original<typeof import('../../lib/aiTurnCharge')>(), chargeForAiTurn: async () => ({ charge: false }) }));
vi.mock('../../lib/serverDb', async original => ({ ...await original<typeof import('../../lib/serverDb')>(), getServerDb: () => null }));
import { registerProfessionalsRoutes } from '../../routes/professionals';
const route = () => captureRoutes(registerProfessionalsRoutes).get('POST /api/professional/:id/chat')!;
const request = () => mockReq({ params: { id: 'teacher_ai' }, headers: { authorization: 'Bearer synthetic-token' }, body: { message: 'hello', userId: 'victim-user', uid: 'victim-user' } });
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all');
  vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); vi.stubEnv('INFERENCE_GATEWAY_SURFACES', 'professional'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('SEMANTIC_MEMORY', 'on'); vi.stubEnv('SEMANTIC_MEMORY_PROVIDER', 'gemini'); vi.stubEnv('GEMINI_API_KEY', 'synthetic-offline');
  m.verify.mockResolvedValue('verified-owner'); m.identity.mockResolvedValue({ uid: 'verified-owner', email: null });
  m.gate.mockResolvedValue({ allow: true, tier: 'free', countsAgainstFree: false, billableFraction: 0, isFreeListed: false, hasActivePass: false });
  m.memory.mockResolvedValue([{ role: 'user', text: 'My private remembered lesson concerns algebra.', ts: Date.now(), embedding: [1, 2] }]);
  m.profiles.mockResolvedValue({ name: 'Verified Owner' }); m.embed.mockResolvedValue({ embeddings: [{ values: [1, 2] }] });
  m.answer.mockResolvedValue({ content: 'Approved answer.', spend: {} }); m.save.mockResolvedValue(undefined); m.append.mockResolvedValue(undefined);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network')); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('actual professional private-memory account binding', () => {
  it('selected verified own-account nonempty recall loads only that account and cannot ignore an unavailable embedding operation', async () => {
    const res = mockRes(); await route()(request(), res);
    expect(res.statusCode).toBe(503); expect(m.memory).toHaveBeenCalledOnce(); expect(m.memory).toHaveBeenCalledWith('verified-owner', 'professional:teacher_ai');
    expect(m.profiles.mock.calls.every(([uid]) => uid === 'verified-owner')).toBe(true); expect(m.profiles).toHaveBeenCalled();
    expect(m.embed).not.toHaveBeenCalled(); expect(m.answer).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('OFF still uses verified identity, never a body UID, for nonempty recall and profile loading', async () => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); const res = mockRes(); await route()(request(), res);
    expect(res.statusCode).toBe(200); expect(res.body.reply).toBe('Approved answer.');
    expect(m.memory).toHaveBeenCalledWith('verified-owner', 'professional:teacher_ai'); expect(m.profiles.mock.calls.every(([uid]) => uid === 'verified-owner')).toBe(true);
    expect(m.embed).toHaveBeenCalled(); expect(m.answer).toHaveBeenCalledOnce(); expect(m.verify).not.toHaveBeenCalled();
  });
  it.each(['on', 'off'])('an unauthenticated body UID cannot select private memory with rollout %s', async enabled => {
    vi.stubEnv('INFERENCE_GATEWAY_ENABLED', enabled); m.identity.mockResolvedValue(null); m.verify.mockResolvedValue(null);
    m.gate.mockResolvedValue({ allow: false, status: 401, body: { error: 'Please sign in.' } });
    const res = mockRes(); await route()(request(), res);
    expect(res.statusCode).toBe(401); expect(m.gate).toHaveBeenCalledWith(null, null, 'professionals');
    expect(m.memory).not.toHaveBeenCalled(); expect(m.profiles).not.toHaveBeenCalled(); expect(m.answer).not.toHaveBeenCalled();
  });
});

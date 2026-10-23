import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../tests/helpers/routeTestUtils';
const m = vi.hoisted(() => ({ identity: vi.fn(), gate: vi.fn(), engine: vi.fn(), quota: vi.fn(), mark: vi.fn(), failure: vi.fn(), active: vi.fn(), charge: vi.fn(), increment: vi.fn(), document: vi.fn(), analyst: vi.fn(), generate: vi.fn() }));
vi.mock('../lib/authMiddleware', async original => ({ ...await original<typeof import('../lib/authMiddleware')>(), verifyFirebaseIdentity: m.identity }));
vi.mock('../lib/freeAnswerQuota', () => ({ withFreeAnswerQuota: m.quota, markFreeAnswer: m.mark, markFreeAnswerProviderFailure: m.failure, assertFreeAnswerActive: m.active, freeAnswerSignal: () => undefined }));
vi.mock('../professionals/passGate', async original => ({ ...await original<typeof import('../professionals/passGate')>(), gateProfessionalTurn: m.gate, gateProfessionalExam: m.gate }));
vi.mock('../professionals/engine', () => ({ runProfessionalChatWithUsage: m.engine }));
vi.mock('../lib/attachmentText', async original => ({ ...await original<typeof import('../lib/attachmentText')>(), buildDocumentContext: m.document }));
vi.mock('../lib/aiTurnCharge', async original => ({ ...await original<typeof import('../lib/aiTurnCharge')>(), chargeForAiTurn: m.charge }));
vi.mock('../professionals/ProfessionalUsageStore', () => ({ professionalUsageStore: { increment: m.increment }, professionalExamUsageStore: { increment: m.increment } }));
vi.mock('../repoAnalyst/analyst', () => ({ runRepoAnalystChat: m.analyst }));
vi.mock('../repoAnalyst/generate', () => ({ runRepoImprovementGen: m.generate }));
import { registerProfessionalsRoutes } from './professionals';
import { registerRepoAnalystRoutes } from './repoAnalyst';
const freeGate = { allow: true, uid: 'verified-user', tier: 'free', countsAgainstFree: true, billableFraction: 0, freeQuestions: 5, isFreeListed: false, hasActivePass: false };
const paper = JSON.stringify({ read: { subject: 'Physics', topic: '' }, questions: [{ question: 'Unit of force?', options: ['Newton', 'Metre', 'Second', 'Kelvin'], correctIndex: 0, explanation: 'Newtons.', topic: 'Units', level: 'low' }] });
async function professional(operation: 'chat' | 'exam', body = {}) {
 const req = mockReq({ params: { id: 'teacher_ai' }, body: { message: 'explain force', subject: 'Physics', count: 1, ...body } }); const res = mockRes();
 await captureRoutes(registerProfessionalsRoutes).get(`POST /api/professional/:id/${operation}`)!(req, res); return { req, res };
}
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('SEMANTIC_MEMORY', 'off');
 m.identity.mockResolvedValue({ uid: 'verified-user', email: null }); m.gate.mockResolvedValue({ ...freeGate });
 m.quota.mockImplementation(async (_req, _res, run) => run()); m.active.mockImplementation(() => {});
 m.engine.mockResolvedValue({ reply: 'A real answer', spend: {} }); m.document.mockResolvedValue('document'); m.increment.mockResolvedValue(undefined); m.charge.mockResolvedValue({ charge: false });
});
afterEach(() => { vi.unstubAllEnvs(); });
describe('shared Free quota at professional ingress', () => {
 it('reserves legacy Free chat using verified identity, then marks actual output', async () => {
  const { req, res } = await professional('chat', { uid: 'forged' });
  expect(m.quota).toHaveBeenCalledWith(req, res, expect.any(Function), { uid: 'verified-user' }); expect(m.mark).toHaveBeenCalledWith(req); expect(res.body.reply).toBe('A real answer');
 });
 it('rejects before document extraction, generation or charge', async () => {
  m.quota.mockImplementation(async (_req, res) => res.status(429).json({ code: 'FREE_ANSWER_LIMIT' }));
  const { res } = await professional('chat', { fileAttachments: [{ type: 'text/plain', name: 'x.txt', base64: 'AA==' }] });
  expect(res.statusCode).toBe(429); expect(m.document).not.toHaveBeenCalled(); expect(m.engine).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
 });
 it('does not enroll paid chat or change original charge', async () => {
  m.gate.mockResolvedValue({ ...freeGate, tier: 'paid', countsAgainstFree: false, billableFraction: 1 });
  await professional('chat'); expect(m.quota).not.toHaveBeenCalled(); expect(m.mark).not.toHaveBeenCalled(); expect(m.engine.mock.calls[0][4]).toBe('paid'); expect(m.charge.mock.calls[0][1].billableFraction).toBe(1);
 });
 it('exempts static image guidance', async () => {
  await professional('chat', { message: 'generate an image of a cat' }); expect(m.quota).not.toHaveBeenCalled(); expect(m.engine).not.toHaveBeenCalled();
 });
 it('marks provider failure, not an answer, and preserves money handling', async () => {
  m.engine.mockRejectedValue(new Error('provider failed')); const { req } = await professional('chat');
  expect(m.failure).toHaveBeenCalledWith(req); expect(m.mark).not.toHaveBeenCalled(); expect(m.increment).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
 });
 it('counts a usable Free paper once and keeps existing question accounting', async () => {
  m.engine.mockResolvedValue({ reply: paper, spend: {} }); await professional('exam'); expect(m.quota).toHaveBeenCalledOnce(); expect(m.mark).toHaveBeenCalledOnce(); expect(m.increment).toHaveBeenCalledOnce();
 });
 it('unusable paper restores credit without spending existing free questions', async () => {
  m.engine.mockResolvedValue({ reply: 'not a paper', spend: {} }); const { req, res } = await professional('exam');
  expect(res.statusCode).toBe(502); expect(m.failure).toHaveBeenCalledWith(req); expect(m.mark).not.toHaveBeenCalled(); expect(m.increment).not.toHaveBeenCalled();
 });
 it('paid papers bypass global Free admission', async () => {
  m.gate.mockResolvedValue({ ...freeGate, tier: 'paid' }); m.engine.mockResolvedValue({ reply: paper, spend: {} });
  await professional('exam'); expect(m.quota).not.toHaveBeenCalled(); expect(m.mark).not.toHaveBeenCalled(); expect(m.charge).toHaveBeenCalledOnce();
 });
});
describe('Repo Analyst shared Free ingress', () => {
 it.each(['chat', 'generate'])('reserves before %s and shares verified account key', async operation => {
  m.quota.mockImplementation(async (_req, res) => res.status(429).json({ code: 'FREE_ANSWER_LIMIT' }));
  const req = mockReq({ body: { message: 'inspect repo', userId: 'forged' } }); const res = mockRes();
  await captureRoutes(registerRepoAnalystRoutes).get(`POST /api/repo-analyst/${operation}`)!(req, res);
  expect(m.quota).toHaveBeenCalledWith(req, res, expect.any(Function), { uid: 'verified-user' }); expect(m.analyst).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
 });
});

it('fences a cancelled professional reservation before generation or output', async () => {
 m.active.mockImplementation(() => { throw new Error('lease ended'); });
 const { res } = await professional('chat'); expect(m.engine).not.toHaveBeenCalled(); expect(m.mark).not.toHaveBeenCalled(); expect(res.statusCode).toBe(503);
});
it.each(['chat', 'generate'])('marks Repo Analyst %s only from the engine success callback', async operation => {
 const model = operation === 'chat' ? m.analyst : m.generate;
 model.mockImplementation(async (_message, _history, _token, opts) => { opts.beforeGeneration(); opts.onAnswer(); return operation === 'chat' ? 'answer' : { summary: 'improvement', files: [] }; });
 const req = mockReq({ body: { message: 'analyse acme/widget' } }); const res = mockRes();
 await captureRoutes(registerRepoAnalystRoutes).get(`POST /api/repo-analyst/${operation}`)!(req, res);
 expect(m.mark).toHaveBeenCalledOnce(); expect(m.mark).toHaveBeenCalledWith(req); expect(res.statusCode).toBe(200);
});
it.each(['chat', 'generate'])('does not mark static/fetch-error Repo Analyst %s output', async operation => {
 (operation === 'chat' ? m.analyst : m.generate).mockResolvedValue(operation === 'chat' ? 'Could not fetch' : { summary: 'Paste a repository', files: [] });
 const req = mockReq({ body: { message: 'inspect repo' } }); const res = mockRes();
 await captureRoutes(registerRepoAnalystRoutes).get(`POST /api/repo-analyst/${operation}`)!(req, res);
 expect(m.mark).not.toHaveBeenCalled(); expect(res.statusCode).toBe(200);
});
it('retains anonymous Repo Analyst admission under the original shared guest middleware', async () => {
 m.identity.mockResolvedValue(null); m.analyst.mockResolvedValue('guest answer');
 const req = mockReq({ body: { message: 'inspect repo' } }); const res = mockRes();
 await captureRoutes(registerRepoAnalystRoutes).get('POST /api/repo-analyst/chat')!(req, res);
 expect(m.quota).not.toHaveBeenCalled(); expect(m.mark).not.toHaveBeenCalled(); expect(res.body.reply).toBe('guest answer');
});

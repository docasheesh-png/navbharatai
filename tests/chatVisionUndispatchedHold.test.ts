/** Chat vision must not dispatch or strand a confirmed budget hold after cancellation during reserve. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ vertex: vi.fn(), google: vi.fn(), client: vi.fn() }));
vi.mock('../src/server/lib/vertexGenAI', () => ({ vertexGenAI: m.client }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: m.google }; } }));
vi.mock('../src/server/AI/InferenceGateway/runtime', () => ({ isGatewayRouteSelected: () => false }));
vi.mock('../src/server/AI/inferencePolicy', () => ({ assertLegacyInferenceAllowed: () => {} }));
import { runVisionChain } from '../src/server/lib/visionChain';
import { setFreeTierPaidStoreForTests } from '../src/server/lib/freeTierPaidCap';
const atts = [{ name: 'synthetic.pdf', type: 'application/pdf', base64: 'AAAA' }];
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv('GLM_API_KEY', ''); vi.stubEnv('GEMINI_API_KEY', 'synthetic-only');
 vi.stubEnv('FREE_TIER_PAID_DAILY_CAP_USD', '10');
 m.client.mockReturnValue({ models: { generateContent: m.vertex } });
 m.vertex.mockResolvedValue({ text: 'Synthetic answer.' }); m.google.mockResolvedValue({ text: 'Synthetic answer.' });
 vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { setFreeTierPaidStoreForTests(undefined); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Chat vision hold lifecycle', () => {
 it.each(['vertex', 'google'] as const)('%s abort during reservation prevents SDK entry and closes confirmed hold at zero', async provider => {
  if (provider === 'google') m.client.mockReturnValue(null);
  const controller = new AbortController();
  const hold = { id: 'synthetic-id', day: '2026-10-26', uidHash: 'synthetic-owner', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true };
  const reservePaid = vi.fn(async () => { controller.abort(); return hold; }); const settlePaid = vi.fn(async () => true);
  setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
  await runVisionChain(atts, { prompt: 'Read this synthetic PDF.', systemPrompt: 'Synthetic system.', allowClaude: false, signal: controller.signal }).catch(() => null);
  expect(reservePaid).toHaveBeenCalledOnce(); expect(m.vertex).not.toHaveBeenCalled(); expect(m.google).not.toHaveBeenCalled();
  expect(settlePaid).toHaveBeenCalledExactlyOnceWith(hold, 0);
 });
 it.each(['vertex', 'google'] as const)('%s SDK entry keeps unknown cost held on abort', async provider => {
  if (provider === 'google') m.client.mockReturnValue(null);
  const controller = new AbortController();
  const hold = { id: 'synthetic-id', day: '2026-10-26', uidHash: 'synthetic-owner', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true };
  const reservePaid = vi.fn(async () => hold); const settlePaid = vi.fn(async () => true);
  setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
  m[provider].mockImplementation(async () => { controller.abort(); throw new Error('uncertain SDK cost'); });
  await runVisionChain(atts, { prompt: 'Read this synthetic PDF.', systemPrompt: 'Synthetic system.', allowClaude: false, signal: controller.signal }).catch(() => null);
  expect(m[provider]).toHaveBeenCalledOnce(); expect(settlePaid).not.toHaveBeenCalled();
  expect(m[provider].mock.calls[0][0]).toMatchObject({ model: 'gemini-2.5-flash-lite', config: { systemInstruction: 'Synthetic system.', abortSignal: controller.signal }, contents: [{ parts: expect.arrayContaining([{ text: 'Read this synthetic PDF.' }, { inlineData: { mimeType: 'application/pdf', data: 'AAAA' } }]) }] });
 });
});

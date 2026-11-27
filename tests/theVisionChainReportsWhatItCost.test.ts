// The vision chain returned only { text, provider }, so a caller that must BILL a vision call (the game photo judge,
// gamePhotoJudge.ts) had no real tokens to price and would have had to invent a cost. It now returns the model that
// answered and the tokens the provider REPORTED — and nothing at all when the provider reported none (never estimated).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class {
  chat: { completions: { create: (body: any, options?: any) => Promise<any> } };
  constructor() { this.chat = { completions: { create: (body, opts) => sdk.create(body, opts) } }; }
} }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync() {}, write: async () => {} } }));
vi.mock('../src/server/lib/vertexGenAI', () => ({ vertexGenAI: () => null }));
vi.mock('../src/server/AI/InferenceGateway/runtime', () => ({
  maybeGatewayText: async () => null, maybeGatewayVision: async () => null, isGatewayRouteSelected: () => false,
  InferenceGatewayTerminalError: class extends Error {},
}));
import { runVisionChain } from '../src/server/lib/visionChain';
import { _resetKeyPoolCursors } from '../src/server/lib/keyPool';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';

/* eslint-disable @typescript-eslint/no-explicit-any */
const IMAGE = [{ name: 'start.jpg', type: 'image/jpeg', base64: 'c3ludGhldGlj' }];
beforeEach(() => {
  _resetKeyPoolCursors(); resetAllBreakers(); sdk.create.mockReset();
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
  vi.stubEnv('GLM_API_KEY', 'k1'); vi.stubEnv('VISION_GLM_MODELS', 'glm-4.6v-flash');
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) vi.stubEnv(name, '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('runVisionChain carries the model and the reported tokens', () => {
  it('a reply with usage returns it, with the model that answered', async () => {
    sdk.create.mockResolvedValue({ choices: [{ message: { content: '1: YES' } }], usage: { prompt_tokens: 4100, completion_tokens: 9 } });
    const r = await runVisionChain(IMAGE, { prompt: 'q', allowClaude: false });
    expect(r).toEqual({ text: '1: YES', provider: 'GLM', model: 'glm-4.6v-flash', usage: { inputTokens: 4100, outputTokens: 9 } });
  });
  it('a reply with no usage carries none — the caller records it as unmeasured, never as an estimate', async () => {
    sdk.create.mockResolvedValue({ choices: [{ message: { content: '1: NO' } }] });
    const r = await runVisionChain(IMAGE, { prompt: 'q', allowClaude: false });
    expect(r).toEqual({ text: '1: NO', provider: 'GLM', model: 'glm-4.6v-flash' });
    expect(r && 'usage' in r).toBe(false);
  });
});

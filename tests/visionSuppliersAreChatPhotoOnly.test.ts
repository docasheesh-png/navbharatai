import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reviewer (PR #4261): the always-on vision suppliers are for CHAT photo analysis only. The profile-photo
// safety gate and screenshot-to-code must keep main's chain exactly, and a hung supplier must cost a short
// budget, not the 28s default, before GLM.
const supplier = vi.hoisted(() => ({ qubax: vi.fn(), cheap: vi.fn() }));
vi.mock('../src/server/lib/visionSuppliers', () => ({ tryQubaxVision: supplier.qubax, tryCheaperInferenceVision: supplier.cheap }));
vi.mock('../src/server/AI/InferenceGateway/runtime', async (orig) => ({ ...(await orig<object>()), isGatewayRouteSelected: () => false }));
vi.mock('../src/server/AI/inferencePolicy', async (orig) => ({ ...(await orig<object>()), assertLegacyInferenceAllowed: () => undefined }));
vi.mock('../src/server/lib/vertexGenAI', () => ({ vertexGenAI: () => null }));

import { runVisionChain, VISION_SUPPLIER_TIMEOUT_MS } from '../src/server/lib/visionChain';

const img = [{ name: 'a', type: 'image/png', base64: 'aGk=' }];
const NO_KEYS = ['GLM_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'ANTHROPIC_API_KEY'];

beforeEach(() => {
  supplier.qubax.mockReset().mockResolvedValue({ text: 'from supplier' });
  supplier.cheap.mockReset().mockResolvedValue(null);
  for (const k of NO_KEYS) vi.stubEnv(k, '');
});

describe('always-on vision suppliers are opt-in (chat photo analysis only)', () => {
  it.each([
    ['avatar safety gate', { prompt: 'SAFE?', allowClaude: false, tier: 'free' as const, timeoutMs: 15_000 }],
    ['screenshot-to-code', { prompt: 'clone', allowClaude: false, tier: 'free' as const }],
  ])('%s options never reach Qubax or CheaperInference', async (_name, opts) => {
    expect(await runVisionChain(img, opts)).toBeNull();
    expect(supplier.qubax).not.toHaveBeenCalled();
    expect(supplier.cheap).not.toHaveBeenCalled();
  });
  it('chat photo analysis (opt-in) asks the suppliers first, each with a short deadline', async () => {
    supplier.qubax.mockResolvedValue(null);
    supplier.cheap.mockResolvedValue({ text: 'seen' });
    const out = await runVisionChain(img, { prompt: 'what is this', allowClaude: false, tier: 'free', alwaysOnSuppliers: true });
    expect(out).toEqual({ text: 'seen', provider: 'CHEAPERINFERENCE' });
    for (const fn of [supplier.qubax, supplier.cheap]) {
      const opt = fn.mock.calls[0][1];
      expect(opt.timeoutMs).toBeLessThanOrEqual(VISION_SUPPLIER_TIMEOUT_MS);
      expect(opt.signal).toBeInstanceOf(AbortSignal);
    }
    expect(VISION_SUPPLIER_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
  it('a hung supplier is cut off at the short deadline and the chain moves on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let seen: AbortSignal | undefined;
      supplier.qubax.mockImplementation((_a: unknown, o: { signal: AbortSignal }) => { seen = o.signal; return new Promise(() => undefined); });
      supplier.cheap.mockResolvedValue({ text: 'seen' });
      const run = runVisionChain(img, { prompt: 'x', allowClaude: false, tier: 'free', alwaysOnSuppliers: true });
      await vi.advanceTimersByTimeAsync(VISION_SUPPLIER_TIMEOUT_MS - 1);
      expect(supplier.cheap).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(run).resolves.toEqual({ text: 'seen', provider: 'CHEAPERINFERENCE' });
      expect(seen?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('call sites: only chat opts in; avatar and screenshot-to-code keep main', () => {
    const src = (p: string) => readFileSync(new URL(`../src/server/${p}`, import.meta.url), 'utf8');
    expect(src('routes/chat.ts')).toMatch(/runVisionChain\(visionAttachments, \{[\s\S]{0,400}alwaysOnSuppliers: true/);
    expect(src('lib/profileAvatar.ts')).not.toContain('alwaysOnSuppliers');
    expect(src('routes/screenshotToPrompt.ts')).not.toContain('alwaysOnSuppliers');
  });
});

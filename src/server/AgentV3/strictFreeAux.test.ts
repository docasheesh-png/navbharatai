import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ create: vi.fn(), free: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mock.create } }; } }));
vi.mock('../AI/LiveRegistry/runtime', () => ({ strictFreeText: mock.free }));
import { runWithInferenceScope } from '../AI/inferencePolicy';
import { weakBuildAdmissionAsk } from './weakBuildAdmissionAsk';
import { clarityJudgeAsk } from './clarityJudgeAsk';
import { ClaudeClient } from './ClaudeClient';
import { OpenAiToolRunner } from './providers/OpenAiToolRunner';
import { GeminiToolRunner } from './providers/GeminiToolRunner';
import { EmbeddingStore } from './EmbeddingSearch';
import { issueVerifiedFreeProof } from '../AI/LiveRegistry/proof';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('Weak auxiliary inference policy', () => {
  it('blocks every legacy Builder SDK before network dispatch', async () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true');
    const dispatch = vi.fn(async () => { throw new Error('legacy dispatch'); });
    const runners = [new ClaudeClient({ messages: { create: dispatch } }), new OpenAiToolRunner({ chat: { completions: { create: dispatch } } }), new GeminiToolRunner({ models: { generateContent: dispatch } })];
    for (const runner of runners) await expect(runWithInferenceScope('weak', () => runner.runTurn({ model: 'paid', system: 'rules', messages: [], tools: [] }))).rejects.toMatchObject({ code: 'STRICT_FREE_CAPABILITY_UNAVAILABLE' });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('skips optional paid embeddings before creating a client', async () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); vi.stubEnv('AGENTV3_FILE_EMBEDDINGS', 'true');
    expect(await runWithInferenceScope('weak', () => new EmbeddingStore('mock-only').embed('file'))).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('routes admission and clarity to verified free with no legacy SDK calls', async () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); vi.stubEnv('GLM_API_KEY', 'mock-only');
    const proof = issueVerifiedFreeProof({ modelId: 'v/test:free', inputTokens: 10, outputTokens: 1, registryVersion: 'v', verifiedAt: 1, basis: 'explicit-zero-fees', estimatedInferenceUsd: '0', reportedCost: null });
    mock.free.mockResolvedValue({ content: 'simple', model: 'v/test:free', provider: 'OPENROUTER', usage: { inputTokens: 10, outputTokens: 1 }, pricingProof: proof });
    await runWithInferenceScope('weak', async () => {
      const admission = await weakBuildAdmissionAsk('rules', 'task', new AbortController().signal);
      expect(admission.usage).toMatchObject({ pricingProof: proof });
      expect(await clarityJudgeAsk('rules', 'task', new AbortController().signal)).toBe('simple');
    });
    expect(mock.free).toHaveBeenCalledTimes(2); expect(mock.create).not.toHaveBeenCalled();
  });
  it('propagates registry failure without paid fallback', async () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); vi.stubEnv('GLM_API_KEY', 'mock-only');
    mock.free.mockRejectedValue(new Error('NO_VERIFIED_FREE_MODEL'));
    await expect(runWithInferenceScope('weak', () => weakBuildAdmissionAsk('rules', 'task', new AbortController().signal))).rejects.toThrow('NO_VERIFIED_FREE_MODEL');
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('preserves Normal/Strong helpers even with both free flags enabled', async () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true'); vi.stubEnv('GLM_API_KEY', 'mock-only');
    mock.create.mockResolvedValue({ choices: [{ message: { content: 'simple' } }] });
    await runWithInferenceScope('paid-builder', () => weakBuildAdmissionAsk('rules', 'task', new AbortController().signal));
    expect(mock.create).toHaveBeenCalledOnce(); expect(mock.free).not.toHaveBeenCalled();
  });
  it('preserves Weak legacy behavior when its flag is off', async () => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'false'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true'); vi.stubEnv('GLM_API_KEY', 'mock-only');
    mock.create.mockResolvedValue({ choices: [{ message: { content: 'simple' } }] });
    await runWithInferenceScope('weak', () => weakBuildAdmissionAsk('rules', 'task', new AbortController().signal));
    expect(mock.create).toHaveBeenCalledOnce(); expect(mock.free).not.toHaveBeenCalled();
  });
});

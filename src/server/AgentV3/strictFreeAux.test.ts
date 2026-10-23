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
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('Weak auxiliary inference policy', () => {
  it('retains the Free-module protection on shared SDK adapters', async () => {
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true');
    const dispatch = vi.fn(async () => { throw new Error('legacy dispatch'); });
    const runners = [new ClaudeClient({ messages: { create: dispatch } }), new OpenAiToolRunner({ chat: { completions: { create: dispatch } } }), new GeminiToolRunner({ models: { generateContent: dispatch } })];
    for (const runner of runners) await expect(runWithInferenceScope('free-modules', () => runner.runTurn({ model: 'paid', system: 'rules', messages: [], tools: [] }))).rejects.toMatchObject({ code: 'STRICT_FREE_CAPABILITY_UNAVAILABLE' });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('skips optional paid embeddings before creating a client', async () => {
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true'); vi.stubEnv('AGENTV3_FILE_EMBEDDINGS', 'true');
    expect(await runWithInferenceScope('free-modules', () => new EmbeddingStore('mock-only').embed('file'))).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it.each(['weak', 'paid-builder'] as const)('keeps %s admission and clarity on the original SDK with retired flag on', async scope => {
    vi.stubEnv('STRICT_FREE_WEAK_ENABLED', 'true'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true'); vi.stubEnv('GLM_API_KEY', 'mock-only');
    mock.create.mockResolvedValue({ choices: [{ message: { content: 'simple' } }] });
    await runWithInferenceScope(scope, async () => {
      expect((await weakBuildAdmissionAsk('rules', 'task', new AbortController().signal)).text).toBe('simple');
      expect(await clarityJudgeAsk('rules', 'task', new AbortController().signal)).toBe('simple');
    });
    expect(mock.create).toHaveBeenCalledTimes(2); expect(mock.free).not.toHaveBeenCalled();
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

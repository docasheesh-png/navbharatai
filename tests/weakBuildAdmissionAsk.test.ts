import { afterEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocked.create } };
    constructor(options: unknown) { mocked.options(options); }
  },
}));
import { weakBuildAdmissionAsk } from '../src/server/AgentV3/weakBuildAdmissionAsk';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('bounded scope provider request', () => {
  it('uses one non-reasoning request with zero SDK retries and forwards usage', async () => {
    vi.stubEnv('GLM_API_KEY', 'scope-test-key');
    mocked.create.mockResolvedValue({ choices: [{ message: { content: 'complex' } }], usage: { prompt_tokens: 201, completion_tokens: 1 } });
    const signal = new AbortController().signal;
    const result = await weakBuildAdmissionAsk('scope rules', 'login and database app', signal);
    expect(mocked.create).toHaveBeenCalledTimes(1);
    expect(mocked.options).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 5_000 }));
    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'glm-4.7-flashx', max_tokens: 8, temperature: 0, thinking: { type: 'disabled' },
      messages: [{ role: 'system', content: 'scope rules' }, { role: 'user', content: 'login and database app' }],
    }), { signal });
    expect(result).toEqual({ text: 'complex', usage: { inputTokens: 201, outputTokens: 1 } });
  });
  it('does not substitute another paid provider when no classifier key exists', async () => {
    vi.stubEnv('GLM_API_KEY', '');
    await expect(weakBuildAdmissionAsk('rules', 'request', new AbortController().signal)).rejects.toThrow(/unavailable/);
    expect(mocked.create).not.toHaveBeenCalled();
  });
  it('reports missing usage as unknown rather than inventing a token count', async () => {
    vi.stubEnv('GLM_API_KEY', 'scope-test-key');
    mocked.create.mockResolvedValue({ choices: [] });
    expect(await weakBuildAdmissionAsk('rules', 'request', new AbortController().signal)).toEqual({ text: '' });
  });
});

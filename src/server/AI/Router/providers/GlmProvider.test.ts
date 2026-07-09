import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the OpenAI SDK so the provider is testable without a network call or key.
const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {}
  },
}));

import { GlmProvider } from './GlmProvider';

describe('GlmProvider', () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD };
    createMock.mockReset();
  });
  afterEach(() => { process.env = OLD; });

  it('has the GLM identity and leads the free chain (priority 0)', () => {
    const glm = new GlmProvider();
    expect(glm.name).toBe('GLM');
    expect(glm.priority).toBe(0);
  });

  it('healthCheck gates on GLM_API_KEY', async () => {
    const glm = new GlmProvider();
    delete process.env.GLM_API_KEY;
    expect(await glm.healthCheck()).toBe(false);
    process.env.GLM_API_KEY = 'k';
    expect(await glm.healthCheck()).toBe(true);
  });

  it('defers a vision turn (images) to the next provider instead of sending them', async () => {
    process.env.GLM_API_KEY = 'k';
    const glm = new GlmProvider();
    await expect(glm.execute('read this', undefined, undefined, undefined, ['b64img'])).rejects.toThrow(/text-only/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('executes a text turn, defaults to glm-4.7-flash, and reports provider GLM', async () => {
    process.env.GLM_API_KEY = 'k';
    delete process.env.GLM_CHAT_MODEL;
    createMock.mockResolvedValue({ choices: [{ message: { content: 'hello' } }] });
    const glm = new GlmProvider();
    const res = await glm.execute('hi', undefined, undefined, 'You are helpful');
    expect(createMock.mock.calls[0][0].model).toBe('glm-4.7-flash');
    expect(createMock.mock.calls[0][0].messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(res.provider).toBe('GLM');
    expect(res.content).toBe('hello');
  });

  it('honors the GLM_CHAT_MODEL override', async () => {
    process.env.GLM_API_KEY = 'k';
    process.env.GLM_CHAT_MODEL = 'glm-4.7-flashx';
    createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });
    const glm = new GlmProvider();
    await glm.execute('hi');
    expect(createMock.mock.calls[0][0].model).toBe('glm-4.7-flashx');
  });
});

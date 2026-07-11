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

  // Rock-solid hardening (admin 2026-07-11): a free tier that "succeeds" with nothing is a failure.
  it('throws on an HTTP-200 EMPTY reply so the chain falls through (never a blank answer)', async () => {
    process.env.GLM_API_KEY = 'k';
    createMock.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const glm = new GlmProvider();
    await expect(glm.execute('hi')).rejects.toThrow(/empty reply/);
    createMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    await expect(glm.execute('hi')).rejects.toThrow(/empty reply/); // whitespace-only too
  });

  it('trims the returned content (no stray whitespace shells)', async () => {
    process.env.GLM_API_KEY = 'k';
    createMock.mockResolvedValue({ choices: [{ message: { content: '  hello  ' } }] });
    const glm = new GlmProvider();
    const res = await glm.execute('hi');
    expect(res.content).toBe('hello');
  });

  it('a stream that completes with ZERO chunks throws (silent-empty stream = failure)', async () => {
    process.env.GLM_API_KEY = 'k';
    createMock.mockResolvedValue({ [Symbol.asyncIterator]: async function* () { /* no chunks */ } });
    const glm = new GlmProvider();
    await expect(glm.executeStream('hi', undefined, () => {})).rejects.toThrow(/no content/);
  });

  it('a healthy stream forwards chunks and returns the full text', async () => {
    process.env.GLM_API_KEY = 'k';
    createMock.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: 'hel' } }] };
        yield { choices: [{ delta: { content: 'lo' } }] };
      },
    });
    const glm = new GlmProvider();
    const chunks: string[] = [];
    const full = await glm.executeStream('hi', undefined, (c) => chunks.push(c));
    expect(full).toBe('hello');
    expect(chunks).toEqual(['hel', 'lo']);
  });
});

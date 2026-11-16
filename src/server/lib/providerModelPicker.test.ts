import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetProviderModelCache, pickProviderModels, rankChatModels } from './providerModelPicker';

const list = (ids: string[]) => vi.fn(async () => new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200 }));

describe('provider model picker (admin 2026-11-16: "andar se chune… 2nd and 3rd AI ko try kare")', () => {
  beforeEach(() => __resetProviderModelCache());

  it('keeps chat models, drops image/audio/embedding ones, and ranks known chat families first', () => {
    expect(rankChatModels(['flux-pro', 'text-embedding-3', 'zeta-chat', 'qwen/qwen3-coder', 'openai/gpt-oss-120b', 'whisper-1', 'deepseek-v4-flash']))
      .toEqual(['openai/gpt-oss-120b', 'deepseek-v4-flash', 'qwen/qwen3-coder', 'zeta-chat']);
  });

  it('puts the configured model first when the key can actually use it', () => {
    expect(rankChatModels(['deepseek-v4-flash', 'z-ai/glm4.6'], 'z-ai/glm4.6')[0]).toBe('z-ai/glm4.6');
    expect(rankChatModels(['deepseek-v4-flash'], 'z-ai/glm4.7')).toEqual(['deepseek-v4-flash']);
  });

  it('reads the key\'s list once, caches it for ten minutes, and returns at most three', async () => {
    const fetchImpl = list(['a-chat', 'deepseek-v4-flash', 'qwen/qwen3', 'moonshotai/kimi-k2.6', 'z-ai/glm4.6']);
    let t = 0;
    const first = await pickProviderModels('https://api.bluesminds.com/v1', 'synthetic-key', null, 3, fetchImpl as unknown as typeof fetch, () => t);
    expect(first).toEqual({ models: ['deepseek-v4-flash', 'qwen/qwen3', 'z-ai/glm4.6'], source: 'provider-list' });
    t = 9 * 60_000;
    await pickProviderModels('https://api.bluesminds.com/v1', 'synthetic-key', null, 3, fetchImpl as unknown as typeof fetch, () => t);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 11 * 60_000;
    await pickProviderModels('https://api.bluesminds.com/v1', 'synthetic-key', null, 3, fetchImpl as unknown as typeof fetch, () => t);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to the configured model alone, saying why, when the list cannot be read — never a guessed id', async () => {
    const refused = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await pickProviderModels('https://api.bluesminds.com/v1', 'k', 'openai/gpt-oss-20b', 3, refused as unknown as typeof fetch))
      .toEqual({ models: ['openai/gpt-oss-20b'], source: 'configured-only', note: 'model list HTTP 401' });
  });
});

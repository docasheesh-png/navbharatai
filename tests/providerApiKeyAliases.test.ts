import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  geminiKeys: [] as string[],
  generateContent: vi.fn(),
  anthropicOptions: [] as Array<{ apiKey?: string }>,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
    constructor(options: { apiKey?: string }) {
      mocks.geminiKeys.push(String(options.apiKey ?? ''));
    }
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn(), stream: vi.fn() };
    constructor(options: { apiKey?: string }) {
      mocks.anthropicOptions.push(options);
    }
  },
}));

import { GeminiProvider, resolveGeminiApiKey } from '../src/server/AI/Router/providers/GeminiProvider';
import { AnthropicProvider, resolveAnthropicApiKey } from '../src/server/AI/Router/providers/AnthropicProvider';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_API_KEY;
  mocks.geminiKeys.length = 0;
  mocks.anthropicOptions.length = 0;
  mocks.generateContent.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('shared provider API key aliases', () => {
  it('resolves Gemini aliases in the same priority order as SDA', () => {
    process.env.GOOGLE_API_KEY = ' google-alias ';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'other-alias';
    expect(resolveGeminiApiKey()).toBe('google-alias');
    process.env.GEMINI_API_KEY = 'primary-key';
    expect(resolveGeminiApiKey()).toBe('primary-key');
  });

  it('executes Gemini through GOOGLE_API_KEY when GEMINI_API_KEY is absent', async () => {
    process.env.GOOGLE_API_KEY = 'google-alias';
    mocks.generateContent.mockResolvedValue({
      text: 'answer',
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
    });
    const result = await new GeminiProvider().execute('hello');
    expect(mocks.geminiKeys).toEqual(['google-alias']);
    expect(result.content).toBe('answer');
    expect(await new GeminiProvider().healthCheck()).toBe(true);
  });

  it('uses GOOGLE_GENERATIVE_AI_API_KEY as the final Gemini alias', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-genai-alias';
    expect(resolveGeminiApiKey()).toBe('google-genai-alias');
    expect(await new GeminiProvider().healthCheck()).toBe(true);
  });

  it('resolves Claude alias and constructs the shared Anthropic client with it', async () => {
    process.env.CLAUDE_API_KEY = 'claude-alias';
    expect(resolveAnthropicApiKey()).toBe('claude-alias');
    const provider = new AnthropicProvider();
    expect(mocks.anthropicOptions.at(-1)).toEqual({ apiKey: 'claude-alias' });
    expect(await provider.healthCheck()).toBe(true);
  });

  it('prefers ANTHROPIC_API_KEY and stays disabled when neither Claude key exists', async () => {
    process.env.CLAUDE_API_KEY = 'claude-alias';
    process.env.ANTHROPIC_API_KEY = 'anthropic-primary';
    expect(resolveAnthropicApiKey()).toBe('anthropic-primary');
    expect(await new AnthropicProvider().healthCheck()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    expect(resolveAnthropicApiKey()).toBeUndefined();
    expect(() => new AnthropicProvider()).toThrow(/ANTHROPIC_API_KEY \/ CLAUDE_API_KEY/);
  });
});

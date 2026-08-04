import { describe, it, expect } from 'vitest';
import { generateAiIntegration, isAiProvider } from './AiGenerator';

describe('generateAiIntegration — OpenAI', () => {
  const c = generateAiIntegration('openai');

  it('emits a server-only helper with generateText + chat via Chat Completions', () => {
    const server = c.files['server/lib/ai.ts'];
    expect(server).toContain("import OpenAI from 'openai'");
    expect(server).toContain('export async function generateText(prompt: string)');
    expect(server).toContain('export async function chat(messages: ChatMessage[])');
    expect(server).toContain('client.chat.completions.create({ model: MODEL');
    expect(server).toContain("process.env.OPENAI_MODEL || 'gpt-4o-mini'"); // env-driven model, sensible default
    // key is server-side; there is no client file
    expect(c.files['src/lib/ai.ts']).toBeUndefined();
  });

  it('declares the key + env-driven model + openai dep + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['OPENAI_API_KEY', 'OPENAI_MODEL']);
    expect(c.dependency).toEqual({ name: 'openai', version: '^4' });
    expect(c.files['.env.example']).toContain('OPENAI_API_KEY=\n');
    expect(c.files['.env.example']).toContain('OPENAI_MODEL=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('own account is never used'); // BYO — not NavBharatAI's account
  });
});

describe('generateAiIntegration — Anthropic', () => {
  const c = generateAiIntegration('anthropic');

  it('emits a server helper that requires max_tokens and extracts text blocks', () => {
    const server = c.files['server/lib/ai.ts'];
    expect(server).toContain("import Anthropic from '@anthropic-ai/sdk'");
    expect(server).toContain('client.messages.create({ model: MODEL, max_tokens: 1024');
    expect(server).toContain("b.type === 'text'"); // pull text out of content blocks
    expect(server).toContain("process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest'");
    expect(server).toContain('chat(messages: ChatMessage[], system?: string)'); // system is separate in Anthropic
  });

  it('declares the key + model + the @anthropic-ai/sdk dependency', () => {
    expect(c.envKeys).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']);
    expect(c.dependency).toEqual({ name: '@anthropic-ai/sdk', version: '^0.30' });
    expect(c.files['.env.example']).toContain('ANTHROPIC_API_KEY=\n');
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['openai', 'anthropic'] as const) {
      const env = generateAiIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isAiProvider accepts the two supported providers, rejects everything else', () => {
    expect(isAiProvider('openai')).toBe(true);
    expect(isAiProvider('anthropic')).toBe(true);
    expect(isAiProvider('gemini')).toBe(false);
    expect(isAiProvider(undefined)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { TokenUsageManager } from '../src/server/TokenUsageManager';

describe('TokenUsageManager', () => {
  it('getUsage() returns empty object on a fresh instance', () => {
    const m = new TokenUsageManager();
    expect(m.getUsage()).toEqual({});
  });

  it('logUsage() creates a new entry for an unknown provider:model key', () => {
    const m = new TokenUsageManager();
    m.logUsage('grok', 'grok-3', 100, 200);
    const u = m.getUsage()['grok:grok-3'];
    expect(u).toBeDefined();
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(200);
    expect(u.requestCount).toBe(1);
  });

  it('logUsage() accumulates tokens and request count for subsequent calls', () => {
    const m = new TokenUsageManager();
    m.logUsage('anthropic', 'claude-3-5-sonnet', 50, 80);
    m.logUsage('anthropic', 'claude-3-5-sonnet', 30, 40);
    const u = m.getUsage()['anthropic:claude-3-5-sonnet'];
    expect(u.inputTokens).toBe(80);
    expect(u.outputTokens).toBe(120);
    expect(u.requestCount).toBe(2);
  });

  it('different provider:model keys are tracked independently', () => {
    const m = new TokenUsageManager();
    m.logUsage('grok', 'grok-3', 10, 20);
    m.logUsage('gemini', 'gemini-2.0-flash', 5, 15);
    const usage = m.getUsage();
    expect(usage['grok:grok-3'].inputTokens).toBe(10);
    expect(usage['gemini:gemini-2.0-flash'].inputTokens).toBe(5);
  });

  it('getUsage() returns the same accumulated state across multiple calls', () => {
    const m = new TokenUsageManager();
    m.logUsage('openai', 'gpt-4', 100, 100);
    expect(m.getUsage()).toStrictEqual(m.getUsage());
  });
});

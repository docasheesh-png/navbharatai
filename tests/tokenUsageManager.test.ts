import { describe, it, expect } from 'vitest';
import { TokenUsageManager } from '../src/server/TokenUsageManager';

describe('TokenUsageManager', () => {
  it('starts with empty usage', () => {
    const manager = new TokenUsageManager();
    expect(manager.getUsage()).toEqual({});
  });

  it('records token usage for a provider:model key', () => {
    const manager = new TokenUsageManager();
    manager.logUsage('openai', 'gpt-4', 100, 50);
    const usage = manager.getUsage();
    expect(usage['openai:gpt-4'].inputTokens).toBe(100);
    expect(usage['openai:gpt-4'].outputTokens).toBe(50);
    expect(usage['openai:gpt-4'].requestCount).toBe(1);
  });

  it('accumulates usage across multiple calls', () => {
    const manager = new TokenUsageManager();
    manager.logUsage('anthropic', 'claude', 200, 100);
    manager.logUsage('anthropic', 'claude', 300, 150);
    const usage = manager.getUsage();
    expect(usage['anthropic:claude'].inputTokens).toBe(500);
    expect(usage['anthropic:claude'].requestCount).toBe(2);
  });

  it('tracks separate keys for different providers', () => {
    const manager = new TokenUsageManager();
    manager.logUsage('grok', 'grok-3', 50, 25);
    manager.logUsage('anthropic', 'claude', 75, 40);
    const usage = manager.getUsage();
    expect(Object.keys(usage)).toHaveLength(2);
  });
});

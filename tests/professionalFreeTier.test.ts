/**
 * Professional free/paid two-tier ladder (admin 2026-07-09) — regression lock.
 *
 * Tier 1: 'professional-free' (GLM-4.7-Flash only) is tried first.
 * Tier 2: the paid 'professional' universe (RACE Grok × Gemini × Vertex → Haiku)
 *         runs ONLY when the free tier fails, errors, or returns empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRouterMock = vi.fn();
vi.mock('../src/server/AI/AIRouterManager', () => ({
  AIRouterManager: { getRouter: (ns: string) => getRouterMock(ns) },
}));

import { runProfessionalChat } from '../src/server/professionals/engine';
import type { ProfessionalConfig } from '../src/server/professionals/types';

const CONFIG: ProfessionalConfig = {
  id: 'test_ai',
  name: 'Test AI',
  systemPrompt: 'You are Test AI.',
  disclaimer: 'Test disclaimer.',
  knowledge: [],
};

function routerReturning(content: string, success = true) {
  return { routeRaced: vi.fn().mockResolvedValue({ response: { content }, telemetry: { success } }) };
}

function routerThrowing(msg: string) {
  return { routeRaced: vi.fn().mockRejectedValue(new Error(msg)) };
}

describe('professional two-tier ladder (free GLM-flash → paid race)', () => {
  beforeEach(() => getRouterMock.mockReset());

  it('a successful free-tier answer never touches the paid universe', async () => {
    const free = routerReturning('free answer');
    const paid = routerReturning('paid answer');
    getRouterMock.mockImplementation((ns: string) => (ns === 'professional-free' ? free : paid));

    const reply = await runProfessionalChat(CONFIG, 'hello');
    expect(reply).toBe('free answer');
    expect(free.routeRaced).toHaveBeenCalledTimes(1);
    expect(paid.routeRaced).not.toHaveBeenCalled();
  });

  it('a free-tier failure falls through to the paid universe', async () => {
    const free = routerThrowing('GLM rate-limited');
    const paid = routerReturning('paid answer');
    getRouterMock.mockImplementation((ns: string) => (ns === 'professional-free' ? free : paid));

    const reply = await runProfessionalChat(CONFIG, 'hello');
    expect(reply).toBe('paid answer');
    expect(paid.routeRaced).toHaveBeenCalledTimes(1);
  });

  it('an EMPTY free-tier reply (success but blank) also falls through to paid', async () => {
    const free = routerReturning('   ');
    const paid = routerReturning('paid answer');
    getRouterMock.mockImplementation((ns: string) => (ns === 'professional-free' ? free : paid));

    const reply = await runProfessionalChat(CONFIG, 'hello');
    expect(reply).toBe('paid answer');
  });

  it('a free-tier unsuccessful telemetry (graceful busy message) falls through to paid', async () => {
    const free = routerReturning('The AI service is temporarily busy…', false);
    const paid = routerReturning('paid answer');
    getRouterMock.mockImplementation((ns: string) => (ns === 'professional-free' ? free : paid));

    const reply = await runProfessionalChat(CONFIG, 'hello');
    expect(reply).toBe('paid answer');
  });

  it('throws only when BOTH tiers fail', async () => {
    const free = routerThrowing('free down');
    const paid = routerReturning('', false);
    getRouterMock.mockImplementation((ns: string) => (ns === 'professional-free' ? free : paid));

    await expect(runProfessionalChat(CONFIG, 'hello')).rejects.toThrow(/All AI providers failed/);
  });
});

import { describe, it, expect } from 'vitest';
import { PlannerAgent } from '../src/server/EngineerAI/PlannerAgent';
import type { AIRouter } from '../src/server/AI/Router/AIRouter';

function fakeRouter(response: string): AIRouter {
  return {
    route: async () => ({
      response: { content: response, latencyMs: 0, provider: 'TEST', model: 'test' },
      telemetry: { success: true } as any,
    }),
    hasHealthyProvider: async () => true,
  } as unknown as AIRouter;
}

describe('PlannerAgent', () => {
  it('returns parsed plan steps for a coding request', async () => {
    const agent = new PlannerAgent(fakeRouter(JSON.stringify({
      steps: [
        { description: 'scaffold project', focusHint: 'create project structure' },
        { description: 'implement UI', focusHint: 'build React components' },
      ],
    })));
    const steps = await agent.plan('build a todo app');
    expect(steps).toHaveLength(2);
    expect(steps[0].description).toBe('scaffold project');
    expect(steps[0].focusHint).toBe('create project structure');
    expect(steps[1].description).toBe('implement UI');
    expect(steps[1].focusHint).toBe('build React components');
  });

  it('returns empty array for a conversational turn', async () => {
    const agent = new PlannerAgent(fakeRouter(JSON.stringify({ conversational: true })));
    const steps = await agent.plan('hello there');
    expect(steps).toHaveLength(0);
  });

  it('returns single-step fallback when AI returns invalid JSON', async () => {
    const agent = new PlannerAgent(fakeRouter('not json at all'));
    const steps = await agent.plan('build something complex');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBeTruthy();
    expect(steps[0].focusHint).toBeTruthy();
  });

  it('uses description as focusHint when focusHint is missing', async () => {
    const agent = new PlannerAgent(fakeRouter(JSON.stringify({
      steps: [{ description: 'install dependencies' }],
    })));
    const steps = await agent.plan('set up the project');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('install dependencies');
    expect(steps[0].focusHint).toBe('install dependencies');
  });

  it('caps steps at 8 and truncates long strings', async () => {
    const manySteps = Array.from({ length: 12 }, (_, i) => ({
      description: `step ${i + 1}`,
      focusHint: `focus ${i + 1}`,
    }));
    const agent = new PlannerAgent(fakeRouter(JSON.stringify({ steps: manySteps })));
    const steps = await agent.plan('do many things');
    expect(steps.length).toBeLessThanOrEqual(8);
  });
});

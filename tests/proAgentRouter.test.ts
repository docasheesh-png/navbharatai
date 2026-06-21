import { describe, it, expect, vi } from 'vitest';
import { ProAgentRouter } from '../src/server/EngineerAI/AI/ProAgentRouter';
import type { ModelCall } from '../src/server/project/aiEdits';

function makeModelCall(response = 'test response'): ModelCall {
  return vi.fn().mockResolvedValue(response);
}

describe('ProAgentRouter', () => {
  it('hasHealthyProvider always returns true', async () => {
    const router = new ProAgentRouter(makeModelCall());
    expect(await router.hasHealthyProvider()).toBe(true);
  });

  it('route() calls the injected callModel function', async () => {
    const callModel = makeModelCall('Hello from model');
    const router = new ProAgentRouter(callModel);
    const { response } = await router.route('test prompt');
    expect(callModel).toHaveBeenCalled();
    expect(response.content).toBe('Hello from model');
  });

  it('route() returns a valid AIProviderResponse shape', async () => {
    const router = new ProAgentRouter(makeModelCall('result'));
    const { response, telemetry } = await router.route('test');
    expect(response.content).toBe('result');
    expect(typeof telemetry.success).toBe('boolean');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { runWithGatewaySelection } from '../src/server/AI/InferenceGateway/dispatchBoundary';
import { weakBuildAdmissionAsk } from '../src/server/AgentV3/weakBuildAdmissionAsk';
import { runWithSurplusBuild, assertLegacyInferenceAllowed } from '../src/server/AI/inferencePolicy';

const mock = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock('openai', () => ({ default: class {
  constructor(options: unknown) { mock.options(options); }
  chat = { completions: { create: mock.create } };
} }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('GLM scope with Surplus coding admitted', () => {
  it('calls the pinned classifier while every ordinary legacy builder stays blocked', async () => {
    vi.stubEnv('GLM_API_KEY', 'synthetic-test-key');
    mock.create.mockResolvedValue({ choices: [{ message: { content: 'simple' } }], usage: { prompt_tokens: 37, completion_tokens: 1 } });
    await runWithSurplusBuild(true, async () => {
      await expect(weakBuildAdmissionAsk('system', 'request', new AbortController().signal)).resolves.toEqual({ text: 'simple', usage: { inputTokens: 37, outputTokens: 1 } });
      expect(() => assertLegacyInferenceAllowed('builder-scope-classifier')).toThrow();
      expect(() => assertLegacyInferenceAllowed('builder')).toThrow();
    });
    expect(mock.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000, maxRetries: 0 }));
    expect(mock.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'glm-4.7-flashx', max_tokens: 8 }), expect.anything());
  });
  it('cannot bypass an existing gateway claim', async () => {
    vi.stubEnv('GLM_API_KEY', 'synthetic-test-key');
    await expect(runWithGatewaySelection(true, () => runWithSurplusBuild(true, () =>
      weakBuildAdmissionAsk('system', 'request', new AbortController().signal)))).rejects.toThrow('unavailable');
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('restricts the dedicated assertion to the fixed classifier client', () => {
    const callers = readdirSync('src/server', { recursive: true }).filter(p => typeof p === 'string' && p.endsWith('.ts') && !p.endsWith('.test.ts'))
      .filter(p => readFileSync(`src/server/${p}`, 'utf8').includes('assertWeakScopeClassificationAllowed'));
    expect(callers.sort()).toEqual(['AI/inferencePolicy.ts', 'AgentV3/weakBuildAdmissionAsk.ts']);
  });
  it('never injects the coding session into classification or consumes a classifier failure as a coding failure', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).not.toContain('createSurplusScopeAsk(');
    expect(route).not.toContain('earlySurplusFailure');
    expect(route).not.toContain('tryConsumeSurplusPreWriteFailOpen(');
  });
});

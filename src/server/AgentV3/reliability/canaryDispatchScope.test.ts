import { listRemoteTools } from '../mcpTransport';
import { probeCredentials, realProbeFetch, probeSmtpCredential } from '../credentialProbe';
import { describe, expect, it, vi } from 'vitest';
import { CanaryReservationStore, runWithCanarySpendGuard } from './canarySpendGuard';
import { assertLegacyInferenceAllowed, runWithSurplusBuild, runWithInferenceScope } from '../../AI/inferencePolicy';
import { assertNoUnclaimedGatewayDispatch, runWithGatewaySelection } from '../../AI/InferenceGateway/dispatchBoundary';
import { createSurplusBuildTransport } from '../../AI/SurplusRegistry/transport';
import { OpenAiCompatProvider } from '../../AI/FreeChain/providers/openAiCompatProvider';
import { CHEAPERINFERENCE_BASE_URL } from '../../lib/cheaperInferencePolicy';
import { clarityJudgeAsk } from '../clarityJudgeAsk';

const binding = { uid: 'synthetic', requestId: 'synthetic-canary', fixtureHash: 'a'.repeat(64), tier: 'weak' as const };
function scope<T>(run: () => T): T {
  // A denied capability must not even reach database authority/reservation work.
  const db = { doc: () => { throw Error('Unexpected database work'); }, runTransaction: async () => { throw Error('Unexpected transaction'); } };
  return runWithCanarySpendGuard('synthetic', binding, new CanaryReservationStore(db as never), run);
}
describe('real pilot scope at auxiliary dispatch doors (no mocked guard)', () => {
  it('does not introduce new clarity policy restrictions outside the pilot', async () => {
    vi.stubEnv('GLM_API_KEY', 'synthetic-test-key');
    vi.stubEnv('GLM_BASE_URL', 'https://api.z.ai/api/paas/v4');
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'simple' } }],
    }), { headers: { 'content-type': 'application/json' } }));
    try {
      const ask = () => clarityJudgeAsk('rules', 'synthetic task', new AbortController().signal);
      await expect(runWithSurplusBuild(true, ask)).resolves.toBe('simple');
      await expect(runWithGatewaySelection(true, ask)).resolves.toBe('simple');
      await expect(runWithInferenceScope('free-modules', ask)).resolves.toBe('simple');
      expect(fetcher).toHaveBeenCalledTimes(3);
      fetcher.mockClear();
      await expect(scope(ask)).rejects.toMatchObject({ cause: { code: 'BENCHMARK_CANARY_BLOCKED' } });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it.each([false, true])('blocks the CheaperInference adapter before HTTP (stream=%s)', async stream => {
    const provider = new OpenAiCompatProvider({
      provider: 'CHEAPERINFERENCE', model: 'beam', key: 'synthetic-test-key',
      baseURL: CHEAPERINFERENCE_BASE_URL, priority: 0, maxOutputTokens: 256,
      timeoutMs: 30000, streamUsage: true, envName: 'CHEAPERINFERENCE_API_KEY',
    });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP'));
    const onChunk = vi.fn();
    try {
      const input = { prompt: 'Synthetic canary', ...(stream ? { onChunk } : {}) };
      // Counterfactual: the same valid request reaches mocked HTTP outside the pilot.
      // This prevents an unrelated adapter validation error from faking fence coverage.
      await expect(provider.executeTurn(input)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockClear();
      await expect(scope(() => provider.executeTurn(input))).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(onChunk).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
  it.each(['builder-claude', 'builder-GeminiToolRunner', 'direct-text-provider', 'vision', 'vision-description', 'image-generation', 'image-edit', 'image-enhancement', 'paid-web-search', 'builder-file-embeddings'])('denies %s before any spend, even under Surplus media exemptions', capability => {
    expect(() => scope(() => runWithSurplusBuild(true, () => assertLegacyInferenceAllowed(capability)))).toThrow(/restricted benchmark/);
  });
  it('denies gateway-only embedding and image exception doors', () => {
    for (const capability of ['embedding', 'image-generation']) {
      expect(() => scope(() => runWithGatewaySelection(true, () => assertNoUnclaimedGatewayDispatch(capability)))).toThrow(/restricted benchmark/);
    }
  });
  it('blocks a Surplus transport created outside the scope before real HTTP', async () => {
    const fetcher = vi.fn();
    const send = createSurplusBuildTransport({ AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: 'synthetic-test-key' }, fetcher);
    await expect(scope(() => send({}, new AbortController().signal))).rejects.toThrow(/restricted benchmark/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});


it('denies external MCP discovery before DNS or HTTP', async () => {
  await expect(scope(() => listRemoteTools({ id: 'synthetic', url: 'https://example.com/mcp' }))).rejects.toThrow(/restricted benchmark/);
});
it('denies HTTP and SMTP credential probes before touching external accounts', async () => {
  const fetcher = vi.fn();
  await expect(scope(() => probeCredentials({}, fetcher))).rejects.toThrow(/restricted benchmark/);
  await expect(scope(() => realProbeFetch('https://example.com', { method: 'GET', headers: {} }))).rejects.toThrow(/restricted benchmark/);
  await expect(scope(() => probeSmtpCredential({}))).rejects.toThrow(/restricted benchmark/);
  expect(fetcher).not.toHaveBeenCalled();
});

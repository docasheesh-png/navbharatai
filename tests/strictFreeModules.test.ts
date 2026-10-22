import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAdmittedLegacyImageEdit, assertLegacyInferenceAllowed, runWithInferenceScope, setInferenceScopeForCurrentRequest, strictFreeRequired } from '../src/server/AI/inferencePolicy';
import { issueVerifiedFreeProof } from '../src/server/AI/LiveRegistry/proof';
import { chatTurnCost } from '../src/server/lib/chatSpend';
import { readFileSync } from 'node:fs';

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; vi.restoreAllMocks(); });
describe('strict-free server policy scopes', () => {
  it('defaults off and rejects no legacy call', () => {
    delete process.env.STRICT_FREE_MODULES_ENABLED; delete process.env.STRICT_FREE_WEAK_ENABLED;
    expect(strictFreeRequired()).toBe(false);
    expect(() => assertLegacyInferenceAllowed('test')).not.toThrow();
  });
  it('separates modules, weak, and paid builder even under concurrent awaits', async () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true'; process.env.STRICT_FREE_WEAK_ENABLED = 'false';
    expect(strictFreeRequired()).toBe(false);
    expect(await Promise.all([
      runWithInferenceScope('paid-builder', async () => { await Promise.resolve(); return strictFreeRequired(); }),
      runWithInferenceScope('weak', async () => { await Promise.resolve(); return strictFreeRequired(); }),
      runWithInferenceScope('free-modules', async () => { await Promise.resolve(); return strictFreeRequired(); }),
    ])).toEqual([false, false, true]);
  });
  it('weak flag is independent of free modules flag', () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'false'; process.env.STRICT_FREE_WEAK_ENABLED = 'true';
    expect(strictFreeRequired()).toBe(false);
    expect(runWithInferenceScope('weak', strictFreeRequired)).toBe(true);
    expect(runWithInferenceScope('paid-builder', strictFreeRequired)).toBe(false);
  });
  it('cannot install a mutable scope outside a server-created request', () => {
    expect(() => setInferenceScopeForCurrentRequest('paid-builder')).toThrow('Missing server inference scope');
  });
  it('allows authenticated tier resolution only inside its own scope', () => {
    process.env.STRICT_FREE_WEAK_ENABLED = 'true';
    runWithInferenceScope('paid-builder', () => {
      setInferenceScopeForCurrentRequest('weak');
      expect(strictFreeRequired()).toBe(true);
      expect(() => assertLegacyInferenceAllowed('vision')).toThrow('No paid fallback');
    });
  });
  it('strict flag remains closed even when registry master is off', () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true'; process.env.LIVE_MODEL_REGISTRY_ENABLED = 'false';
    expect(() => runWithInferenceScope('free-modules', () => assertLegacyInferenceAllowed('direct-sdk'))).toThrow();
  });
});

describe('verified free usage is not estimated at a paid default rate', () => {
  const data = { modelId: 'vendor/example:free', inputTokens: 100, outputTokens: 50, registryVersion: 'r1', verifiedAt: 1,
    basis: 'OPENROUTER_FREE_VARIANT_CONTRACT' as const, estimatedInferenceUsd: '0' as const, reportedCost: '0' };
  it('accepts server-issued proof and preserves measured usage', () => {
    expect(chatTurnCost({ provider: 'OPENROUTER', model: data.modelId, inputTokens: 100, outputTokens: 50, pricingProof: issueVerifiedFreeProof(data) }, 90))
      .toMatchObject({ measured: true, realUsd: 0, billedUsd: 0, billedInr: 0, inputTokens: 100, outputTokens: 50 });
  });
  it('rejects an unissued JSON lookalike', () => {
    expect(chatTurnCost({ provider: 'OPENROUTER', model: data.modelId, inputTokens: 100, outputTokens: 50, pricingProof: data }, 90).realUsd).toBeGreaterThan(0);
  });
  it('does not reuse a proof for a different model', () => {
    expect(chatTurnCost({ provider: 'OPENROUTER', model: 'vendor/paid', inputTokens: 100, outputTokens: 50, pricingProof: issueVerifiedFreeProof(data) }, 90).realUsd).toBeGreaterThan(0);
  });
  it('never infers free OpenRouter billing from another provider model name', () => {
    expect(chatTurnCost({ provider: 'OPENROUTER', model: 'z-ai/glm-4.7-flash', inputTokens: 100, outputTokens: 50 }, 90).realUsd).toBeGreaterThan(0);
  });
  it('rejects tokens exceeding the proof snapshot', () => {
    expect(chatTurnCost({ provider: 'OPENROUTER', model: data.modelId, inputTokens: 101, outputTokens: 50, pricingProof: issueVerifiedFreeProof(data) }, 90).realUsd).toBeGreaterThan(0);
  });
  it('retains unknown usage as unmeasured, not fabricated tokens', () => {
    expect(chatTurnCost({ provider: 'OPENROUTER', model: data.modelId, pricingProof: issueVerifiedFreeProof(data) }, 90).measured).toBe(false);
  });
});

describe('legacy network bypass census', () => {
  it.each(['AnthropicProvider', 'GeminiProvider', 'GlmProvider', 'GrokProvider', 'OpenAiChatProvider', 'VertexProvider'])('%s guards execute and streaming', (name) => {
    const source = readFileSync(`src/server/AI/Router/providers/${name}.ts`, 'utf8');
    expect(source.match(/assertLegacyInferenceAllowed\('direct-text-provider'\)/g)).toHaveLength(2);
  });
  it.each([
    ['src/server/lib/visionChain.ts', "assertLegacyInferenceAllowed('vision')"],
    ['src/server/lib/visionDescribe.ts', "assertLegacyInferenceAllowed('vision-description')"],
    ['src/server/lib/imageEditRun.ts', "assertLegacyInferenceAllowed('image-edit')"],
    ['src/server/lib/navbharatImageEngine.ts', "assertLegacyInferenceAllowed('image-generation')"],
    ['src/server/lib/braveSearch.ts', "assertLegacyInferenceAllowed('paid-web-search')"],
  ])('%s has an explicit unsupported-capability guard', (file, guard) => {
    expect(readFileSync(file, 'utf8')).toContain(guard);
  });
});


describe('explicit existing image-edit exception remains capability scoped', () => {
  it('permits admitted image editing but not text, vision, search or embeddings', () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true';
    runWithInferenceScope('free-modules', () => {
      expect(() => assertLegacyInferenceAllowed('image-edit')).toThrow();
      runAdmittedLegacyImageEdit(() => {
        expect(strictFreeRequired()).toBe(true);
        expect(() => assertLegacyInferenceAllowed('image-edit')).not.toThrow();
        for (const capability of ['direct-text-provider', 'vision', 'vision-description', 'paid-web-search', 'embeddings']) {
          expect(() => assertLegacyInferenceAllowed(capability)).toThrow();
        }
      });
      expect(() => assertLegacyInferenceAllowed('image-edit')).toThrow();
    });
  });
  it('cannot create this exception from Weak or absent request scopes', () => {
    expect(() => runAdmittedLegacyImageEdit(() => undefined)).toThrow();
    expect(() => runWithInferenceScope('weak', () => runAdmittedLegacyImageEdit(() => undefined))).toThrow();
  });
});

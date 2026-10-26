import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, freeChainConfig, isPaidRung, PAID_PROVIDER_IDS } from './config';
import { OpenAiCompatProvider, FreeChainProviderError } from './providers/openAiCompatProvider';
import { CHEAPERINFERENCE_BASE_URL } from '../../lib/cheaperInferencePolicy';

describe('CheaperInference FreeChain paid rung (simple mode)', () => {
  it('ranks cheapinf first among paid defaults and keeps it after every free rung', () => {
    expect(PAID_PROVIDER_IDS[0]).toBe('cheapinf');
    expect(isPaidRung('cheapinf')).toBe(true);
    const freeThenPaid = [...DEFAULT_ORDER];
    const firstPaid = freeThenPaid.findIndex(isPaidRung);
    expect(firstPaid).toBeGreaterThan(0);
    expect(freeThenPaid[firstPaid]).toBe('cheapinf');
    expect(freeThenPaid.slice(0, firstPaid).every(id => !isPaidRung(id))).toBe(true);
  });

  it('skips the rung by default (CHEAPERINFERENCE off)', () => {
    const rung = freeChainConfig({}).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBe('disabled');
    expect(rung.baseURL).toBe(CHEAPERINFERENCE_BASE_URL);
    expect(rung.model).toBe('beam');
  });

  it('stays disabled when only the API key is present', () => {
    const rung = freeChainConfig({ CHEAPERINFERENCE_API_KEY: 'ci_live_test_key_only' }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.configured).toBe(true);
    expect(rung.reason).toBe('disabled');
  });

  it('becomes configured under mode=admin or mode=all when a key is set', () => {
    for (const mode of ['admin', 'all'] as const) {
      const rung = freeChainConfig({
        CHEAPERINFERENCE: mode,
        CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
        CHEAPERINFERENCE_MODEL: 'beam',
      }).rungs.find(r => r.id === 'cheapinf')!;
      expect(rung.configured).toBe(true);
      expect(rung.reason).toBeUndefined();
      expect(rung.priceIn).toBe(0.006);
      expect(rung.priceOut).toBe(0.022);
      expect(rung.keyEnv).toBe('CHEAPERINFERENCE_API_KEY');
    }
  });

  it('accepts CheaperInference spelling for the mode env', () => {
    const rung = freeChainConfig({
      CheaperInference: 'all',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
    }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBeUndefined();
  });

  it('rejects unknown CheaperInference model ids', () => {
    const rung = freeChainConfig({
      CHEAPERINFERENCE: 'all',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
      CHEAPERINFERENCE_MODEL: 'not-a-real-model',
    }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBe('model-unverified');
  });

  it('builds an OpenAI-compatible adapter only for the documented base URL', () => {
    const provider = new OpenAiCompatProvider({
      provider: 'CHEAPERINFERENCE',
      model: 'beam',
      key: 'ci_live_test_key',
      baseURL: CHEAPERINFERENCE_BASE_URL,
      priority: 0,
      maxOutputTokens: 256,
      timeoutMs: 30000,
      streamUsage: true,
      envName: 'CHEAPERINFERENCE_API_KEY',
    });
    expect(provider.name).toBe('CHEAPERINFERENCE');
    expect(provider.pinnedModel).toBe('beam');
    expect(() => new OpenAiCompatProvider({
      provider: 'CHEAPERINFERENCE',
      model: 'beam',
      key: 'ci_live_test_key',
      baseURL: 'https://evil.example/v1',
      priority: 0,
      maxOutputTokens: 256,
      timeoutMs: 30000,
      streamUsage: true,
    })).toThrow(FreeChainProviderError);
  });
});

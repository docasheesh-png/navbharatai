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

  // Owner t357u (2026-11-16): CheaperInference is default-on for every user; no written-permission gate.
  it('is on with only the API key present; CHEAPERINFERENCE=off is the kill switch', () => {
    const rung = freeChainConfig({ CHEAPERINFERENCE_API_KEY: 'ci_live_test_key_only' }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.configured).toBe(true);
    expect(rung.reason).toBeUndefined();
    const off = freeChainConfig({ CHEAPERINFERENCE: 'off', CHEAPERINFERENCE_API_KEY: 'ci_live_test_key' }).rungs.find(r => r.id === 'cheapinf')!;
    expect(off.reason).toBe('disabled');
  });

  it('serves admin and all modes alike, with no Keak written-permission gate', () => {
    const admin = freeChainConfig({
      CHEAPERINFERENCE: 'admin',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
      CHEAPERINFERENCE_MODEL: 'beam',
    }).rungs.find(r => r.id === 'cheapinf')!;
    expect(admin.configured).toBe(true);
    expect(admin.reason).toBeUndefined();
    expect(admin.maxOutputTokens).toBe(2048);
    expect(admin.priceIn).toBe(0.006);
    expect(admin.priceOut).toBe(0.022);
    const shared = freeChainConfig({
      CHEAPERINFERENCE: 'all',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
    }).rungs.find(r => r.id === 'cheapinf')!;
    expect(shared.reason).toBeUndefined();
    expect(admin.keyEnv).toBe('CHEAPERINFERENCE_API_KEY');
  });

  // Owner t365u: ON for all users by default; the written-permission flag is not a gate; only off disables.
  it.each([
    [{}, undefined], [{ CHEAPERINFERENCE: 'all' }, undefined], [{ CHEAPERINFERENCE: 'admin' }, undefined],
    [{ CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION: 'off' }, undefined],
  ] as const)('t365u: cheapinf rung is open for every user with %j', (extra, reason) => {
    const rung = freeChainConfig({ CHEAPERINFERENCE_API_KEY: 'ci_live_test_key', ...extra }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBe(reason);
    expect(rung.reason).not.toBe('terms-shared-access');
  });
  it.each(['off', 'false', '0', 'no'])('t365u: only an explicit CHEAPERINFERENCE=%s disables the rung', off => {
    const rung = freeChainConfig({ CHEAPERINFERENCE: off, CHEAPERINFERENCE_API_KEY: 'ci_live_test_key' }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBeDefined();
  });

  it('accepts CheaperInference spelling for the mode env', () => {
    const rung = freeChainConfig({
      CheaperInference: 'all',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
      CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION: 'on',
    }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBeUndefined();
  });

  it('accepts the versioned Reflection beam catalog id', () => {
    const rung = freeChainConfig({
      CHEAPERINFERENCE: 'admin',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
      CHEAPERINFERENCE_MODEL: 'beam-1.0-501b-a23b',
    }).rungs.find(r => r.id === 'cheapinf')!;
    expect(rung.reason).toBeUndefined();
    expect(rung.model).toBe('beam-1.0-501b-a23b');
  });

  it('rejects unknown CheaperInference model ids', () => {
    const rung = freeChainConfig({
      CHEAPERINFERENCE: 'all',
      CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
      CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION: 'on',
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

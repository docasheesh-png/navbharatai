import { describe, expect, it } from 'vitest';
import { EMPTY_REGISTRY_FILTERS, effectiveRegistryStatus, filterRegistryModels, isRegistryView, registryActionReason, safeRegistrySource } from './liveModelRegistryView';

import { registryModelFixture, registryViewFixture } from '../../tests/liveModelRegistryFixtures';

describe('registry read and display safety', () => {
  it('accepts the complete shape and rejects errors as data', () => {
    expect(isRegistryView(registryViewFixture())).toBe(true);
    for (const v of [null, {}, { error: 'unauthorized' }, { models: [] }, { ...registryViewFixture(), manifest: {} }, { ...registryViewFixture(), models: [{ exactModelId: 'fake' }] }]) expect(isRegistryView(v)).toBe(false);
  });
  it.each(['pricing', 'supportedModalities', 'eligibilityStatus', 'recentLatency', 'metadataExpiresAt'])('rejects malformed %s before UI state', (field) => {
    const v = registryViewFixture(); (v.models[0] as unknown as Record<string, unknown>)[field] = { invalid: true }; expect(isRegistryView(v)).toBe(false);
  });
  it('expires apparent eligibility exactly at TTL, never promotes another state', () => {
    expect(effectiveRegistryStatus(registryModelFixture(), 1999)).toBe('VERIFIED_FREE');
    expect(effectiveRegistryStatus(registryModelFixture(), 2000)).toBe('STALE');
    expect(effectiveRegistryStatus({ ...registryModelFixture(), eligibilityStatus: 'PAID' }, 1000)).toBe('PAID');
  });
  it('unknown measurements do not pass positive health filters', () => {
    const models = [registryModelFixture()];
    expect(filterRegistryModels(models, { ...EMPTY_REGISTRY_FILTERS, maxLatency: 1000 }, 1000)).toEqual([]);
    expect(filterRegistryModels(models, { ...EMPTY_REGISTRY_FILTERS, minSuccess: 1 }, 1000)).toEqual([]);
    expect(filterRegistryModels(models, EMPTY_REGISTRY_FILTERS, 1000)).toHaveLength(1);
  });
  it('combines capability, provider, text, context and current-status filters', () => {
    const m = registryModelFixture();
    expect(filterRegistryModels([m], { ...EMPTY_REGISTRY_FILTERS, status: 'VERIFIED_FREE' }, 2000)).toEqual([]);
    expect(filterRegistryModels([m], { ...EMPTY_REGISTRY_FILTERS, query: 'EXAMPLE', capability: 'tools', provider: 'openrouter', minContext: 8192 }, 1000)).toEqual([m]);
    expect(filterRegistryModels([{ ...m, supportedModalities: { input: ['text', 'image'], output: ['text'] } }], { ...EMPTY_REGISTRY_FILTERS, capability: 'text-only' }, 1000)).toEqual([]);
  });
  it('does not accept script or embedded-credential source links', () => {
    expect(safeRegistrySource('javascript:alert(1)')).toBeNull(); expect(safeRegistrySource('https://attacker.example/pricing')).toBeNull(); expect(safeRegistrySource('https://openrouter.ai:444/models')).toBeNull(); expect(safeRegistrySource('https://secret@openrouter.ai')).toBeNull();
    expect(safeRegistrySource('https://openrouter.ai/models')).toBe('https://openrouter.ai/models');
  });
  it('requires a real bounded audit reason', () => {
    expect(registryActionReason(' ')).toBe(false); expect(registryActionReason('short')).toBe(false);
    expect(registryActionReason('Reviewed intended use')).toBe(true); expect(registryActionReason('a'.repeat(501))).toBe(false);
  });
});

describe('bounded supplemental registry evidence', () => {
  it('accepts safe image metadata without treating it as free inference', () => {
    expect(isRegistryView({ ...registryViewFixture(), history: [], recentRouting: [], imageDiscovery: { lastError: null, snapshot: { fetchedAt: 1, expiresAt: 2, models: [{ exactModelId: 'test/image', eligibilityStatus: 'UNKNOWN', eligibilityReason: 'Account verification missing' }] } } })).toBe(true);
  });
  it.each([{ history: [{ version: 'bad', fetchedAt: 'bad' }] }, { recentRouting: [{ reason: {} }] }, { imageDiscovery: { lastError: null, snapshot: { fetchedAt: 1, expiresAt: 2, models: [{ exactModelId: 'bad', eligibilityStatus: 'FREE' }] } } }])('rejects malformed supplemental data %j', value => expect(isRegistryView({ ...registryViewFixture(), ...value })).toBe(false));
});

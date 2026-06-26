import { describe, it, expect } from 'vitest';
import {
  listDeployProviders, getDeployProvider, registerDeployProvider,
  deployProviderStatus, DEFAULT_DEPLOY_PROVIDER, type DeployProvider,
} from './DeployProviders';

describe('DeployProviders registry (R5 §5.1 — no lock-in)', () => {
  it('always has Firebase as a built-in, always-configured static provider', () => {
    const fb = getDeployProvider('firebase');
    expect(fb).toBeTruthy();
    expect(fb?.kind).toBe('static');
    expect(fb?.isConfigured({})).toBe(true);
  });

  it('defaults to firebase', () => {
    expect(DEFAULT_DEPLOY_PROVIDER).toBe('firebase');
    expect(getDeployProvider(DEFAULT_DEPLOY_PROVIDER)).toBeTruthy();
  });

  it('lists providers and reports an honest configured status', () => {
    const status = deployProviderStatus({});
    const fb = status.find((p) => p.id === 'firebase');
    expect(fb?.configured).toBe(true);
    expect(typeof fb?.requirement).toBe('string');
  });

  it('returns undefined for an unknown provider id', () => {
    expect(getDeployProvider('does-not-exist')).toBeUndefined();
  });

  it('registerDeployProvider adds a new provider and replaces a same-id one', () => {
    const before = listDeployProviders().length;
    const fake: DeployProvider = {
      id: 'unit-test-provider',
      name: 'Unit Test Host',
      kind: 'static',
      requirement: 'Set UNIT_TEST_TOKEN',
      isConfigured: () => false,
      deploy: async () => 'https://example.test',
    };
    registerDeployProvider(fake);
    expect(listDeployProviders().length).toBe(before + 1);
    expect(getDeployProvider('unit-test-provider')?.name).toBe('Unit Test Host');

    // Re-registering the same id replaces (does not duplicate).
    registerDeployProvider({ ...fake, name: 'Renamed Host' });
    expect(listDeployProviders().length).toBe(before + 1);
    expect(getDeployProvider('unit-test-provider')?.name).toBe('Renamed Host');

    // A not-configured provider surfaces honestly in the status.
    const st = deployProviderStatus({}).find((p) => p.id === 'unit-test-provider');
    expect(st?.configured).toBe(false);
    expect(st?.requirement).toContain('UNIT_TEST_TOKEN');
  });

  it('deployProviderStatus never throws even if a provider isConfigured throws', () => {
    registerDeployProvider({
      id: 'throwing-provider',
      name: 'Throwing Host',
      kind: 'static',
      requirement: 'n/a',
      isConfigured: () => { throw new Error('boom'); },
      deploy: async () => '',
    });
    const st = deployProviderStatus({}).find((p) => p.id === 'throwing-provider');
    expect(st?.configured).toBe(false); // failure → treated as not configured, no throw
  });
});

import { describe, it, expect } from 'vitest';
import { generateFeatureFlagIntegration, isFeatureFlagProvider } from './FeatureFlagGenerator';

describe('generateFeatureFlagIntegration — LaunchDarkly', () => {
  const c = generateFeatureFlagIntegration('launchdarkly');

  it('emits a per-user isFeatureEnabled that falls back to false on trouble', () => {
    const server = c.files['server/lib/featureFlags.ts'];
    expect(server).toContain("import * as ld from '@launchdarkly/node-server-sdk'");
    expect(server).toContain('ld.init(process.env.LAUNCHDARKLY_SDK_KEY');
    expect(server).toContain('export async function isFeatureEnabled(flag: string, userKey: string)');
    expect(server).toContain("client.variation(flag, { kind: 'user', key: userKey }, false)"); // default false
    expect(server).toContain('LAUNCHDARKLY_SDK_KEY');
  });

  it('declares the SDK key + dependency + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['LAUNCHDARKLY_SDK_KEY']);
    expect(c.dependency).toEqual({ name: '@launchdarkly/node-server-sdk', version: '^9' });
    expect(c.files['.env.example']).toBe('LAUNCHDARKLY_SDK_KEY=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('falls back to false'); // never breaks on flag trouble
  });
});

describe('generateFeatureFlagIntegration — Unleash', () => {
  const c = generateFeatureFlagIntegration('unleash');

  it('emits an Unleash-backed isFeatureEnabled that waits for ready and targets by user', () => {
    const server = c.files['server/lib/featureFlags.ts'];
    expect(server).toContain("import { initialize, isEnabled } from 'unleash-client'");
    expect(server).toContain('customHeaders: { Authorization: process.env.UNLEASH_API_TOKEN');
    expect(server).toContain("unleash.on('ready', resolve)");
    expect(server).toContain('isEnabled(flag, { userId: userKey })');
  });

  it('declares URL + token + app name + the unleash-client dependency + blank .env.example', () => {
    expect(c.envKeys).toEqual(['UNLEASH_URL', 'UNLEASH_API_TOKEN', 'UNLEASH_APP_NAME']);
    expect(c.dependency).toEqual({ name: 'unleash-client', version: '^6' });
    expect(c.files['.env.example']).toContain('UNLEASH_URL=\n');
    expect(c.files['.env.example']).toContain('UNLEASH_API_TOKEN=\n');
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['launchdarkly', 'unleash'] as const) {
      const env = generateFeatureFlagIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isFeatureFlagProvider accepts the two supported providers, rejects everything else', () => {
    expect(isFeatureFlagProvider('launchdarkly')).toBe(true);
    expect(isFeatureFlagProvider('unleash')).toBe(true);
    expect(isFeatureFlagProvider('flagsmith')).toBe(false);
    expect(isFeatureFlagProvider(undefined)).toBe(false);
  });
});

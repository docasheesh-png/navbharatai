import { describe, it, expect } from 'vitest';
import { serverStats } from '../src/server/lib/serverStats';

describe('serverStats singleton', () => {
  it('has totalHits initialized to 0', () => {
    expect(serverStats.totalHits).toBe(0);
  });

  it('has maintenanceMode initialized to false', () => {
    expect(serverStats.maintenanceMode).toBe(false);
  });

  it('featureFlags has doctorAI enabled', () => {
    expect(serverStats.featureFlags.doctorAI).toBe(true);
  });

  it('featureFlags has appBuilder enabled', () => {
    expect(serverStats.featureFlags.appBuilder).toBe(true);
  });

  it('pricingConfig has coinsPerRupee = 100', () => {
    expect(serverStats.pricingConfig.coinsPerRupee).toBe(100);
  });

  it('all providers are enabled by default', () => {
    expect(serverStats.providerEnabled.gemini).toBe(true);
    expect(serverStats.providerEnabled.anthropic).toBe(true);
    expect(serverStats.providerEnabled.grok).toBe(true);
  });

  it('is mutable — changes reflect on next access', () => {
    serverStats.totalHits += 1;
    expect(serverStats.totalHits).toBeGreaterThan(0);
  });
});

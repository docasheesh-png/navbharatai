import type { RegistryModelView } from '../src/lib/liveModelRegistryView';
export const registryModelFixture = (): RegistryModelView => ({
  provider: 'openrouter', exactModelId: 'example/text:free', displayName: 'Example', pricing: { prompt: '0', completion: '0' }, inputPricePerMillion: '0', outputPricePerMillion: '0',
  supportedModalities: { input: ['text'], output: ['text'] }, supportedCapabilities: ['tools'], contextWindow: 8192, maximumOutputTokens: 1024,
  pricingVerificationSource: 'https://openrouter.ai/api/v1/models', pricingVerificationMethod: 'official-catalog-and-endpoints', verificationBasis: 'explicit-zero-fees',
  pricingVerifiedAt: 1000, catalogFetchedAt: 1000, metadataExpiresAt: 2000, eligibilityStatus: 'VERIFIED_FREE', eligibilityReason: 'Verified', accountAvailable: true, endpointTag: 'example', registryVersion: 'v1',
  routable: true, cooldownUntil: 0, recentLatency: null, recentSuccessRate: null, lastErrorCode: null,
});
export const registryViewFixture = () => ({
  enabled: true, configured: true, strictFreeModulesEnabled: false, strictFreeWeakEnabled: false, syncIntervalMs: 300000, limitations: ['No unlimited quota guarantee'],
  manifest: { version: 'v1', count: 1, fetchedAt: 1000, expiresAt: 2000, accountVerified: true, transitions: { discovered: 1 } }, models: [registryModelFixture()],
  controls: {}, health: {}, lastSyncAttemptAt: 1000, lastSyncError: null,
});

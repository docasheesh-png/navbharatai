import { describe, it, expect } from 'vitest';
import { providerStateStore } from './ProviderStateStore';

describe('ProviderStateStore (VITEST-skip: no Firestore)', () => {
  it('set() is a best-effort no-op in tests and never throws', async () => {
    await expect(providerStateStore.set('agentv3-u1-s1', 'netlify', { siteId: 'abc', url: 'https://x.netlify.app' }))
      .resolves.toBeUndefined();
  });

  it('get() returns null in tests', async () => {
    expect(await providerStateStore.get('agentv3-u1-s1', 'netlify')).toBeNull();
  });

  it('get() returns null for empty ids without throwing', async () => {
    expect(await providerStateStore.get('', 'netlify')).toBeNull();
    expect(await providerStateStore.get('ws', '')).toBeNull();
  });
});

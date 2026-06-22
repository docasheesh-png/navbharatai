import { describe, it, expect, vi } from 'vitest';
import { providerCooldownStore } from '../src/server/lib/ProviderCooldownStore';

describe('ProviderCooldownStore (VITEST-skip mode)', () => {
  it('write() does not throw in test environment', async () => {
    await expect(providerCooldownStore.write('GROK', Date.now() + 60_000)).resolves.not.toThrow();
  });

  it('write() with empty provider name is a safe no-op', async () => {
    await expect(providerCooldownStore.write('', Date.now() + 1000)).resolves.not.toThrow();
  });

  it('readAll() returns an empty object when Firestore is unavailable (tests)', async () => {
    const all = await providerCooldownStore.readAll();
    expect(all).toEqual({});
  });

  it('startSync() is a no-op under tests and never schedules a timer', () => {
    const spy = vi.spyOn(global, 'setInterval');
    providerCooldownStore.startSync(() => { /* merge */ });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stopSync() is safe to call when no timer is running', () => {
    expect(() => providerCooldownStore.stopSync()).not.toThrow();
  });
});

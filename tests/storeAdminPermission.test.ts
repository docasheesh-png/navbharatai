import { describe, it, expect } from 'vitest';
import { explicitStoreAdmin } from '../src/server/lib/storeAdminPermission';
describe('explicit Store moderation authority', () => {
  it('denies absent identity and absent or empty explicit configuration', () => {
    expect(explicitStoreAdmin(null, 'owner@example.test')).toBe(false);
    expect(explicitStoreAdmin('owner@example.test', undefined)).toBe(false);
    expect(explicitStoreAdmin('owner@example.test', ' , ')).toBe(false);
  });
  it('matches only exact emails after config normalization', () => {
    expect(explicitStoreAdmin('Owner@Example.test', ' other@example.test, owner@example.test ')).toBe(true);
    expect(explicitStoreAdmin('otherowner@example.test', 'owner@example.test')).toBe(false);
    expect(explicitStoreAdmin('owner@example.test.evil', 'owner@example.test')).toBe(false);
  });
  it('never consults the free-build grant environment', () => {
    const old = process.env.AGENTV3_FREE_LIST;
    try {
      process.env.AGENTV3_FREE_LIST = 'free@example.test';
      expect(explicitStoreAdmin('free@example.test', undefined)).toBe(false);
      expect(explicitStoreAdmin('free@example.test', 'owner@example.test')).toBe(false);
    } finally {
      if (old === undefined) delete process.env.AGENTV3_FREE_LIST;
      else process.env.AGENTV3_FREE_LIST = old;
    }
  });
});

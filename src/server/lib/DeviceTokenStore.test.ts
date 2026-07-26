import { describe, it, expect } from 'vitest';
import { deviceTokenStore, MAX_TOKENS_PER_USER } from './DeviceTokenStore';

// VITEST=true (set by the test runner) makes getDb() return null, matching the same contract every
// other store in this family (MentionNotificationStore, UserCostStore) is tested against: no real
// Firestore in unit tests, and every public method must degrade to a safe default instead of throwing.

describe('deviceTokenStore (VITEST — no live Firestore)', () => {
  it('saveToken returns false without throwing', async () => {
    await expect(deviceTokenStore.saveToken('u1', 'tok-1', 'android')).resolves.toBe(false);
  });

  it('saveToken returns false for an empty token or uid (never writes a junk doc)', async () => {
    await expect(deviceTokenStore.saveToken('u1', '', 'android')).resolves.toBe(false);
    await expect(deviceTokenStore.saveToken('', 'tok-1', 'android')).resolves.toBe(false);
  });

  it('removeToken returns false without throwing', async () => {
    await expect(deviceTokenStore.removeToken('u1', 'tok-1')).resolves.toBe(false);
  });

  it('listTokensForUser returns [] without throwing', async () => {
    await expect(deviceTokenStore.listTokensForUser('u1')).resolves.toEqual([]);
  });

  it('removeTokens resolves without throwing for a real or empty list', async () => {
    await expect(deviceTokenStore.removeTokens('u1', ['tok-1', 'tok-2'])).resolves.toBeUndefined();
    await expect(deviceTokenStore.removeTokens('u1', [])).resolves.toBeUndefined();
  });

  it('MAX_TOKENS_PER_USER is a sane positive bound', () => {
    expect(MAX_TOKENS_PER_USER).toBeGreaterThan(0);
    expect(MAX_TOKENS_PER_USER).toBeLessThanOrEqual(50);
  });
});

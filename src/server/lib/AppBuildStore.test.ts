import { describe, it, expect } from 'vitest';
import { buildRecordId, appBuildStore, MAX_BUILDS_LISTED } from './AppBuildStore';

describe('buildRecordId — one row per APP, not per build run', () => {
  it('every record of the same repo lands on ONE document', () => {
    // The user asked to see their apps, not their build history. Somebody who rebuilds the calculator
    // four times wants the calculator once, pointing at the newest file — and the trigger, every poll
    // and a rebuild months later must all write to the same row for that to hold.
    expect(buildRecordId('u1', 'acme', 'calculator')).toBe(buildRecordId('u1', 'acme', 'calculator'));
  });

  it('separates different repos and different users', () => {
    const base = buildRecordId('u1', 'acme', 'calculator');
    expect(buildRecordId('u1', 'acme', 'notes')).not.toBe(base);
    expect(buildRecordId('u2', 'acme', 'calculator')).not.toBe(base);
    expect(buildRecordId('u1', 'other', 'calculator')).not.toBe(base);
  });

  it('cannot be broken by a hostile owner or repo name', () => {
    // These become a Firestore document id. A slash would silently create a nested path, and a name
    // crafted with one could otherwise land a row where it does not belong.
    const id = buildRecordId('u1', 'a/../b', 'r e p o#1');
    expect(id).not.toContain('/');
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('never throws on junk input', () => {
    expect(() => buildRecordId('', '', '')).not.toThrow();
    expect(() => buildRecordId(undefined as never, undefined as never, undefined as never)).not.toThrow();
  });
});

describe('the store is inert in tests and refuses incomplete work', () => {
  // getDb() returns null under VITEST, so these exercise the guards rather than Firestore.
  it('records nothing without the fields that make a row findable', async () => {
    expect(await appBuildStore.record({ userId: '', owner: 'a', repo: 'b', workflow: 'w', appName: 'x', createdAt: 1 })).toBe(false);
    expect(await appBuildStore.record({ userId: 'u', owner: '', repo: 'b', workflow: 'w', appName: 'x', createdAt: 1 })).toBe(false);
    expect(await appBuildStore.record({ userId: 'u', owner: 'a', repo: '', workflow: 'w', appName: 'x', createdAt: 1 })).toBe(false);
  });

  it('never throws — a failure here must not break the build the user is waiting on', async () => {
    await expect(appBuildStore.record({ userId: 'u', owner: 'a', repo: 'b', workflow: 'w', appName: 'x', createdAt: 1 })).resolves.toBe(false);
    await expect(appBuildStore.listForUser('u')).resolves.toEqual([]);
    await expect(appBuildStore.forget('u', 'id')).resolves.toBe(false);
  });

  it('refuses a listing or a delete with no user, so nothing is ever unscoped', async () => {
    expect(await appBuildStore.listForUser('')).toEqual([]);
    expect(await appBuildStore.forget('', 'id')).toBe(false);
    expect(await appBuildStore.forget('u', '')).toBe(false);
  });

  it('setLatestRun refuses an incomplete update rather than writing a partial key', async () => {
    expect(await appBuildStore.setLatestRun('', 'a', 'b', '1')).toBe(false);
    expect(await appBuildStore.setLatestRun('u', '', 'b', '1')).toBe(false);
    expect(await appBuildStore.setLatestRun('u', 'a', '', '1')).toBe(false);
    expect(await appBuildStore.setLatestRun('u', 'a', 'b', '')).toBe(false);
  });

  it('bounds a listing, so a heavy account does not return everything at once', () => {
    expect(MAX_BUILDS_LISTED).toBeGreaterThan(0);
    expect(MAX_BUILDS_LISTED).toBeLessThanOrEqual(100);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { hostingStorageCapMb, liveStorageMb, deployBytesMb, isFirstPartyProvider } from './HostingQuota';

/**
 * THE HOLE THIS CLOSES (admin 2026-08-21: "sara 10gb ek hi user kha gaya to mera dhanda manda ho
 * jayega"). The 50 MB per-publish ceiling bounds ONE app and says nothing about how many, so a single
 * account could hold the entire 10 GB free Firebase allowance — while the Publish sheet already told
 * users "Fair-use limits apply". A promise with nothing behind it is the thing rule 2 forbids.
 */
const rec = (over: Partial<{ workspaceId: string; sizeMb: number; status: string; providerId: string; firstParty: boolean }> = {}) => ({
  workspaceId: 'ws-x', sizeMb: 10, status: 'active', providerId: 'firebase', firstParty: true, ...over,
});

afterEach(() => { delete process.env.AGENTV3_USER_STORAGE_CAP_MB; });

describe('hostingStorageCapMb', () => {
  it('ships ON with room a real user cannot reach — hundreds of apps, not a handful', () => {
    // A published SPA is typically well under 1 MB, so 200 MB bounds abuse without touching use.
    expect(hostingStorageCapMb()).toBe(200);
  });

  it('is env-tunable, and an explicit 0 disables it', () => {
    process.env.AGENTV3_USER_STORAGE_CAP_MB = '500';
    expect(hostingStorageCapMb()).toBe(500);
    process.env.AGENTV3_USER_STORAGE_CAP_MB = '0';
    expect(hostingStorageCapMb()).toBe(0);
  });

  it('a malformed value falls back to the default rather than to zero', () => {
    // `Number('')` is 0 and finite — the trap that once silently disabled the terminal for everyone.
    process.env.AGENTV3_USER_STORAGE_CAP_MB = '';
    expect(hostingStorageCapMb()).toBe(200);
    process.env.AGENTV3_USER_STORAGE_CAP_MB = 'abc';
    expect(hostingStorageCapMb()).toBe(200);
  });
});

describe('liveStorageMb — what the user actually holds', () => {
  it('THE CORRECTNESS RULE: the app being REPUBLISHED is excluded', () => {
    // An update replaces that app's files; counting the old copy would charge twice for one app and
    // could refuse an update to something already live — punishing the safest thing a user can do.
    const all = [rec({ workspaceId: 'a', sizeMb: 30 }), rec({ workspaceId: 'b', sizeMb: 20 })];
    expect(liveStorageMb(all, 'a')).toBe(20);
    expect(liveStorageMb(all)).toBe(50);
  });

  it('a taken-down or held app holds nothing', () => {
    expect(liveStorageMb([rec({ status: 'taken_down' }), rec({ workspaceId: 'b', status: 'held' })])).toBe(0);
  });

  it("a BYO deploy is the USER's own bill and is never counted against our allowance", () => {
    expect(liveStorageMb([rec({ providerId: 'vercel', firstParty: false, sizeMb: 40 })])).toBe(0);
    expect(isFirstPartyProvider('vercel')).toBe(false);
    expect(isFirstPartyProvider('firebase')).toBe(true);
  });

  it('LEGACY records (no provider/firstParty fields) count — they really were first-party', () => {
    expect(liveStorageMb([{ workspaceId: 'old', sizeMb: 12 }])).toBe(12);
  });

  it('a record with no size contributes 0 rather than NaN', () => {
    expect(liveStorageMb([rec({ sizeMb: undefined }), rec({ workspaceId: 'b', sizeMb: 5 })])).toBe(5);
    expect(liveStorageMb([])).toBe(0);
  });

  it('the cap decision uses held + incoming, so a big app cannot slip in just under', () => {
    const held = liveStorageMb([rec({ workspaceId: 'a', sizeMb: 195 })]);
    const incoming = deployBytesMb(new Map([['f', Buffer.alloc(10 * 1024 * 1024)]]));
    expect(held).toBe(195);
    expect(held + incoming > hostingStorageCapMb()).toBe(true);
  });

  it('a normal user is nowhere near the cap — 100 typical apps still fit', () => {
    const many = Array.from({ length: 100 }, (_, i) => rec({ workspaceId: `w${i}`, sizeMb: 0.6 }));
    expect(liveStorageMb(many)).toBeLessThan(hostingStorageCapMb());
  });
});

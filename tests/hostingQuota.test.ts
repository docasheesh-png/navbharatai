import { describe, it, expect, afterEach } from 'vitest';
import {
  isFirstPartyProvider,
  hostingDeployCap,
  maxDeployMb,
  hostingWithinCap,
  deployBytesMb,
  enforceHostingQuota,
} from '../src/server/lib/HostingQuota';

const ENV = ['AGENTV3_USER_MONTHLY_DEPLOY_CAP', 'AGENTV3_DEPLOY_MAX_MB'];
afterEach(() => { for (const k of ENV) delete process.env[k]; });

const filesOfMb = (mb: number): Map<string, Buffer> =>
  new Map([['dist/bundle.js', Buffer.alloc(Math.round(mb * 1024 * 1024))]]);

describe('HostingQuota — pure policy', () => {
  it('classifies first-party vs BYO providers', () => {
    expect(isFirstPartyProvider('firebase')).toBe(true);
    expect(isFirstPartyProvider('cloudflare')).toBe(true);
    expect(isFirstPartyProvider('FIREBASE')).toBe(true);
    expect(isFirstPartyProvider('vercel')).toBe(false);
    expect(isFirstPartyProvider('netlify')).toBe(false);
    expect(isFirstPartyProvider('github')).toBe(false);
    expect(isFirstPartyProvider(null)).toBe(false);
    expect(isFirstPartyProvider(undefined)).toBe(false);
  });

  it('count cap is DISABLED by default and reads a positive env', () => {
    expect(hostingDeployCap()).toBe(0);
    process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP = '30';
    expect(hostingDeployCap()).toBe(30);
    process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP = '0';
    expect(hostingDeployCap()).toBe(0);
    process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP = 'abc';
    expect(hostingDeployCap()).toBe(0);
  });

  it('size cap defaults to 50MB, honours an env override, and 0 disables it', () => {
    expect(maxDeployMb()).toBe(50);
    process.env.AGENTV3_DEPLOY_MAX_MB = '100';
    expect(maxDeployMb()).toBe(100);
    process.env.AGENTV3_DEPLOY_MAX_MB = '0';
    expect(maxDeployMb()).toBe(0);
  });

  it('hostingWithinCap: disabled cap always within; else strict less-than', () => {
    expect(hostingWithinCap(999, 0)).toBe(true);   // disabled
    expect(hostingWithinCap(999, -1)).toBe(true);  // disabled
    expect(hostingWithinCap(4, 5)).toBe(true);
    expect(hostingWithinCap(5, 5)).toBe(false);     // at cap → blocked
    expect(hostingWithinCap(6, 5)).toBe(false);
  });

  it('deployBytesMb sums the file map', () => {
    expect(deployBytesMb(new Map())).toBe(0);
    expect(deployBytesMb(null)).toBe(0);
    expect(Math.round(deployBytesMb(filesOfMb(3)))).toBe(3);
  });
});

describe('enforceHostingQuota', () => {
  it('BYO provider → always allowed (no size/count quota; user pays their own host)', async () => {
    const v = await enforceHostingQuota({ userId: 'u1', workspaceId: 'ws', providerId: 'vercel', files: filesOfMb(200) });
    expect(v.allowed).toBe(true);
  });

  it('first-party + default cap disabled → allowed (zero behaviour change until admin opts in)', async () => {
    const v = await enforceHostingQuota({ userId: 'u1', workspaceId: 'ws', providerId: 'firebase', files: filesOfMb(5) });
    expect(v.allowed).toBe(true);
    expect(v.cap).toBe(0);
  });

  it('first-party oversized bundle → DENIED with an honest size message (ships ON, no config)', async () => {
    const v = await enforceHostingQuota({ userId: 'u1', workspaceId: 'ws', providerId: 'firebase', files: filesOfMb(60) });
    expect(v.allowed).toBe(false);
    expect(v.message).toMatch(/MB/);
    expect(v.message).toMatch(/own host|GitHub|Netlify|Vercel/i);
  });

  it('size boundary: exactly at the cap passes, just over fails', async () => {
    const at = await enforceHostingQuota({ userId: 'u1', workspaceId: 'ws', providerId: 'firebase', files: filesOfMb(50) });
    expect(at.allowed).toBe(true);
    const over = await enforceHostingQuota({ userId: 'u1', workspaceId: 'ws', providerId: 'firebase', files: filesOfMb(50.5) });
    expect(over.allowed).toBe(false);
  });

  it('under VITEST the count store is skipped → count cap fails OPEN even when enabled', async () => {
    process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP = '3';
    // hostingUsageStore.get returns null under VITEST (getDb null) → used=0 → allowed.
    const v = await enforceHostingQuota({ userId: 'u1', workspaceId: 'ws', providerId: 'firebase', files: filesOfMb(2) });
    expect(v.allowed).toBe(true);
    expect(v.cap).toBe(3);
    expect(v.used).toBe(0);
  });

  it('anonymous (no userId) → count cap cannot apply, still allowed', async () => {
    process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP = '3';
    const v = await enforceHostingQuota({ userId: null, workspaceId: 'ws', providerId: 'firebase', files: filesOfMb(2) });
    expect(v.allowed).toBe(true);
  });
});

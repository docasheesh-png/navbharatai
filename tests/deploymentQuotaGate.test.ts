import { describe, it, expect, afterEach } from 'vitest';
import { withDeploymentPersistence } from '../src/server/AgentV3/DeploymentStore';

// Slice 2 — the hosting quota is ENFORCED at the withDeploymentPersistence choke point. Under VITEST
// the Firestore stores are skipped, so the monthly COUNT cap fails open (used=0). The SIZE ceiling is
// deterministic (no store) so it is fully testable here; and BYO providers must always pass through.
afterEach(() => { delete process.env.AGENTV3_DEPLOY_MAX_MB; });

const filesOfMb = (mb: number): Map<string, Buffer> =>
  new Map([['dist/index.js', Buffer.alloc(Math.round(mb * 1024 * 1024))]]);

describe('withDeploymentPersistence — hosting quota gate', () => {
  it('passes a normal first-party deploy through and returns the published URL', async () => {
    let called = false;
    const wrapped = withDeploymentPersistence(async () => { called = true; return 'https://site.web.app'; }, 'u1', 'firebase');
    const url = await wrapped('ws-1', filesOfMb(3));
    expect(url).toBe('https://site.web.app');
    expect(called).toBe(true);
  });

  it('BLOCKS an oversized first-party deploy BEFORE publishing (base never called, honest throw)', async () => {
    let called = false;
    const wrapped = withDeploymentPersistence(async () => { called = true; return 'https://x'; }, 'u1', 'firebase');
    await expect(wrapped('ws-1', filesOfMb(60))).rejects.toThrow(/MB/);
    expect(called).toBe(false); // nothing published — no fake success
  });

  it('honours a lowered size cap via env', async () => {
    process.env.AGENTV3_DEPLOY_MAX_MB = '2';
    const wrapped = withDeploymentPersistence(async () => 'https://x', 'u1', 'firebase');
    await expect(wrapped('ws-1', filesOfMb(3))).rejects.toThrow(/2 MB/);
  });

  it('NEVER blocks a BYO deploy (user\'s own host/cost), even oversized', async () => {
    const wrapped = withDeploymentPersistence(async () => 'https://user.vercel.app', 'u1', 'vercel');
    await expect(wrapped('ws-1', filesOfMb(300))).resolves.toBe('https://user.vercel.app');
  });

  it('first-party count cap fails OPEN under VITEST (store skipped) — a real deploy is never wrongly blocked', async () => {
    process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP = '1';
    try {
      const wrapped = withDeploymentPersistence(async () => 'https://ok.web.app', 'u1', 'firebase');
      await expect(wrapped('ws-1', filesOfMb(1))).resolves.toBe('https://ok.web.app');
    } finally {
      delete process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP;
    }
  });
});

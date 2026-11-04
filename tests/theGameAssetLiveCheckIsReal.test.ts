/**
 * L3 step 1 (admin 2026-11-04). The production network had never downloaded a game asset; this check runs the
 * real transports from the server. Locked here: each stage reports what really happened (timing included — the
 * first version reported every stage as 0 ms), a wrong hash or an unexpected answer is a failure, the check writes
 * nothing and never reads or changes the L3 flag.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describeFailure, runGameAssetLiveCheck, LIVE_CHECK_ASSET_ID } from '../src/server/AgentV3/gameAssets/liveCheck';
import { paddedSyntheticGlb } from './fixtures/gameAssetFixtures';

const glb = Buffer.from(paddedSyntheticGlb());
const asset: any = { id: LIVE_CHECK_ASSET_ID, provider: 'github', downloadUrl: 'https://raw.githubusercontent.com/x/fox.glb', sha256: createHash('sha256').update(glb).digest('hex') };
const okMeta = { get: async () => ({ results: [{ slug: 'table' }] }) };
const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a real stage-by-stage answer', () => {
  it('all four stages pass with real bytes, and the timing is measured after the work', async () => {
    const r = await runGameAssetLiveCheck({ catalogue: [asset], metadata: okMeta, download: async () => { await slow(25); return glb; } });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(['Poly Haven search (live discovery)', 'Reviewed model download (GitHub raw)', 'Hash matches the reviewed pin', 'GLB passes the model validator']);
    expect(r.steps[1].ms).toBeGreaterThanOrEqual(20);
  });
  it('a DNS failure is reported with its code, and the rest still runs', async () => {
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const r = await runGameAssetLiveCheck({ catalogue: [asset], metadata: { get: async () => { throw dns; } }, download: async () => glb });
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toMatchObject({ ok: false, detail: 'ENOTFOUND: fetch failed' });
    expect(r.steps[1].ok).toBe(true);
  });
  it('🔴 bytes that are not the reviewed pin fail the hash stage', async () => {
    const r = await runGameAssetLiveCheck({ catalogue: [asset], metadata: okMeta, download: async () => Buffer.concat([glb, Buffer.from([0])]) });
    expect(r.steps.find((s) => s.name.startsWith('Hash'))).toMatchObject({ ok: false });
    expect(r.ok).toBe(false);
  });
  it('an empty or odd search answer is a failure, not a pass', async () => {
    for (const body of [{ results: [] }, { hits: 3 }, null]) {
      const r = await runGameAssetLiveCheck({ catalogue: [asset], metadata: { get: async () => body }, download: async () => glb });
      expect(r.steps[0].ok, JSON.stringify(body)).toBe(false);
    }
  });
  it('a missing reviewed asset says so', async () => {
    const r = await runGameAssetLiveCheck({ catalogue: [], metadata: okMeta, download: async () => glb });
    expect(r.steps[1]).toMatchObject({ ok: false });
    expect(r.steps[1].detail).toContain(LIVE_CHECK_ASSET_ID);
  });
  it('two presses at once share one check (single-flight)', async () => {
    let downloads = 0;
    const deps = { catalogue: [asset], metadata: okMeta, download: async () => { downloads++; await slow(20); return glb; } };
    const [a, b] = await Promise.all([runGameAssetLiveCheck(deps), runGameAssetLiveCheck(deps)]);
    expect(a).toBe(b);
    expect(downloads).toBe(1);
  });
  it('describeFailure never returns a body, only a code and a short message', () => {
    expect(describeFailure({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN api.polyhaven.com' })).toBe('EAI_AGAIN: getaddrinfo EAI_AGAIN api.polyhaven.com');
    expect(describeFailure({ message: 'x'.repeat(500) }).length).toBe(160);
  });
});

describe('🔒 safe by construction', () => {
  it('the check never reads the L3 flag, and never writes cache, bucket or workspace', () => {
    const src = readFileSync('src/server/AgentV3/gameAssets/liveCheck.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/AGENTV3_EXTERNAL_GAME_ASSETS/);
    expect(src).not.toMatch(/writeFile|writeBinary|saveBinary|persist|createDurableAssetCache|\.write\(/);
  });
  it('the route accepts only an empty body and is admin-only', () => {
    const src = readFileSync('src/server/routes/gameAssetsAdmin.ts', 'utf8');
    expect(src).toContain("app.post('/api/admin/game-assets/live-check', verifyAdminToken,");
    expect(src).toContain('Object.keys(body).length > 0');
  });
});

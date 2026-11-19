/**
 * Maintainer-only LIVE admission for a library batch (admin request 2026-11-19). For every entry it:
 *   1. downloads the pinned public source + resources through the production transport (downloadReviewedAsset),
 *   2. runs the production acquisition engine (hash, license, GLB validation) with a real browser render proof
 *      (assetBrowserProofModule — texture check, visible pixels, and observable motion for each animation role),
 *   3. restores the bytes from the durable cache format in a second acquisition (cacheHit must be true).
 * Writes the batch's admission JSON under docs/game-engine/asset-candidates/. Never publishes or enables anything.
 * Usage: node --import tsx scripts/library/admitLibraryBatch.mts <work dir> <playwright index.mjs> [chromium path] [only ids,comma] [batch number, default 2]
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, symlink, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createAssetProviders, validateCatalogue, REVIEWED_GAME_ASSETS, type ReviewedAsset } from '../../src/server/AgentV3/gameAssets/providers';
import { downloadReviewedAsset } from '../../src/server/AgentV3/gameAssets/assetTransport';
import { createDurableAssetCache } from '../../src/server/AgentV3/gameAssets/assetCache';
import { acquireGameAsset } from '../../src/server/AgentV3/gameAssets/assetEngine';
import { assetBrowserProofModule, ASSET_PROOF_MARKER } from '../../src/server/AgentV3/gameAssets/assetBrowserProof';

const [workArg, playwrightArg, chromiumArg, onlyArg, batchArg] = process.argv.slice(2);
assert.ok(workArg && playwrightArg, 'Supply a work directory and the Playwright module path');
const batch = Number(batchArg || 2); assert.ok(Number.isInteger(batch) && batch >= 2, 'Invalid batch number');
const BATCH = (await import(`../../src/server/AgentV3/gameAssets/reviewedLibraryBatch${batch}.ts`))[`REVIEWED_LIBRARY_BATCH_${batch}`] as readonly ReviewedAsset[];
assert.ok(BATCH?.length, 'Batch not found');
validateCatalogue(REVIEWED_GAME_ASSETS);
const work = resolve(workArg); const fixture = join(work, 'fixture'); await mkdir(fixture, { recursive: true });
try { await symlink(resolve('node_modules'), join(fixture, 'node_modules')); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
const importLine = `import { chromium } from ${JSON.stringify(pathToFileURL(resolve(playwrightArg)).href)};`;
const save = async (p: string, b: Uint8Array | string) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, b); };
const store = {
  async read(key: string, max: number) { try { const p = join(work, 'cache', key); assert.ok((await stat(p)).size <= max); return await readFile(p); } catch { return null; } },
  async write(key: string, bytes: Uint8Array) { await save(join(work, 'cache', key), bytes); },
};
const only = onlyArg ? new Set(onlyArg.split(',')) : null;
const results: unknown[] = []; let failed = 0;
for (const c of BATCH) {
  if (only && !only.has(c.id)) continue;
  const roles = Object.keys(c.animationRoles ?? {}).filter(r => r !== 'idle');
  const proofs: Record<string, unknown>[] = [];
  const parse = async (bytes: Uint8Array, requirement: { animation?: string }) => {
    await save(join(fixture, `.nbai-asset-${c.sha256}.glb`), bytes);
    await save(join(fixture, 'proof.mjs'), assetBrowserProofModule(c.sha256, requirement.animation, importLine, chromiumArg ? resolve(chromiumArg) : undefined));
    const out = execFileSync(process.execPath, ['proof.mjs'], { cwd: fixture, encoding: 'utf8', timeout: 45_000 });
    const line = out.split('\n').find(l => l.startsWith(ASSET_PROOF_MARKER)); assert.ok(line, 'no proof line');
    const proof = JSON.parse(line.slice(ASSET_PROOF_MARKER.length));
    assert.equal(proof.hash, c.sha256); assert.equal(proof.rendered, true); if (requirement.animation) assert.equal(proof.animated, true);
    proofs.push({ animation: requirement.animation ?? null, triangles: proof.triangles, changedPixels: proof.changedPixels, animated: proof.animated });
  };
  const persisted: string[] = [];
  const deps = (cache: ReturnType<typeof createDurableAssetCache>) => ({
    cache, providers: createAssetProviders([c]), parse,
    download: (candidate: typeof c, signal: AbortSignal) => downloadReviewedAsset(candidate, signal),
    persist: async (entry: { sha256: string }) => { persisted.push(entry.sha256); },
  });
  try {
    const requirements = roles.length ? roles.map(animation => ({ subject: c.subjects[0], animation })) : [{ subject: c.subjects[0] }];
    let downloaded = 0; let cacheHits = 0;
    for (const requirement of requirements) {
      for (const pass of ['live', 'cache'] as const) {
        const cache = createDurableAssetCache(store, [c]);
        const outcome = await acquireGameAsset(requirement, deps(cache), new AbortController().signal);
        assert.equal(outcome.kind, 'model', `${c.id} ${pass}: ${outcome.kind === 'procedural' ? outcome.reason : ''}`);
        if (outcome.kind === 'model') { assert.equal(outcome.entry.sha256, c.sha256); if (outcome.cacheHit) cacheHits++; else downloaded = outcome.downloadedBytes; }
        if (pass === 'cache') assert.ok(outcome.kind === 'model' && outcome.cacheHit, `${c.id}: second acquisition did not come from the cache`);
      }
    }
    assert.equal(downloaded || c.bytes, c.bytes);
    results.push({ id: c.id, sha256: c.sha256, bytes: c.bytes, liveDownload: true, cacheRestores: cacheHits, proofs, verdict: 'admitted' });
    console.log('PASS', c.id, JSON.stringify(proofs[0]));
  } catch (e) {
    failed++; results.push({ id: c.id, verdict: 'rejected', reason: String((e as Error).message).slice(0, 300) });
    console.log('FAIL', c.id, String((e as Error).message).slice(0, 300));
  }
}
if (!only) await writeFile(batch === 2 ? 'docs/game-engine/asset-candidates/2026-11-19-admission.json' : `docs/game-engine/asset-candidates/library-batch-${batch}-admission.json`, JSON.stringify({ checkedAt: new Date().toISOString().slice(0, 10), renderer: 'Chromium headless, SwiftShader WebGL, 390x844 viewport', results }, null, 2) + '\n');
console.log(`${results.length - failed} admitted, ${failed} rejected`);
process.exit(failed ? 1 : 0);

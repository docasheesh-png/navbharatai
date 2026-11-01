import { describe, it, expect, vi } from 'vitest';
import { createDurableAssetCache } from './assetCache';
import { createAssetProviders, validateCatalogue, polyHavenContainsFile, REVIEWED_GAME_ASSETS } from './providers';
import { syntheticGlb, syntheticCandidate, paddedSyntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';
import { compactGlb } from './assetOptimize';
import { acquireGameAsset } from './assetEngine';
import { persistProjectAsset, type GameAssetWorkspace } from './assetProject';
import { prepareGameAssets } from './assetSeed';
import { externalGameAssetsEnabled, gameAssetRequirements } from './assetPlan';
import { materializeAssets } from '../WorkspaceAssetStore';
import { contentTypeFor } from '../bucketPublish';

function rig(bytes = syntheticGlb(), candidate = syntheticCandidate(bytes)) {
  const objects = new Map<string, Uint8Array>(); const binary = new Map<string, string>(); const texts = new Map<string, string>();
  const disk = new Map<string, string>();
  const objectStore = { read: async (key: string) => objects.get(key) ?? null, write: async (key: string, data: Uint8Array) => { objects.set(key, data); } };
  const cache = () => createDurableAssetCache(objectStore, [candidate]);
  const workspace: GameAssetWorkspace = { writeFile: async (_id, p, c) => { disk.set(p, c); }, writeBinaryFile: async (_id,p,c) => { disk.set(p,c); }, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
  const persistence = {
    saveBinary: async (_id: string, files: Record<string,string>) => { for (const [p,c] of Object.entries(files)) binary.set(p,c); },
    readBinary: async (_id: string, p: string) => binary.has(p) ? Buffer.from(binary.get(p)!.split(',')[1], 'base64') : null,
    saveText: async (_id: string, files: Record<string,string>) => { for (const [p,c] of Object.entries(files)) texts.set(p,c); },
  };
  const download = vi.fn(async () => bytes); const parse = vi.fn(async () => {});
  const deps = { cache: cache(), providers: createAssetProviders([candidate]), download, parse, persist: persistProjectAsset(workspace, 'fixture-workspace', persistence) };
  return { bytes, candidate, cache, objects, binary, texts, disk, workspace, persistence, deps, download, parse };
}

describe('L3 acquisition, durable restore and bundle contract (synthetic)', () => {
  it('is off by default, and the release catalogue contains no invented assets', async () => {
    expect(externalGameAssetsEnabled({})).toBe(false); expect(REVIEWED_GAME_ASSETS).toEqual([]);
    const r = rig(); const result = await prepareGameAssets({ prompt:'3D car game', workspaceId:'fixture-workspace', workspace:r.workspace, signal:new AbortController().signal, dependencies:r.deps, catalogue:[r.candidate], env:{} });
    expect(result.status).toBe('off'); expect(r.download).not.toHaveBeenCalled(); expect(r.disk.size).toBe(0);
  });
  it.each([
    ['3D train and railway station game', ['train','railway station']],
    ['3D flying bird game', ['bird']], ['3D moving ship game', ['ship']],
    ['3D human walking game', ['human']], ['3D racing car game', ['car']],
    ['3D dog cow tree building game', ['dog','cow','tree','building']],
  ])('prepares requested exact subjects for %s, survives a fresh cache and sandbox', async (prompt, expected) => {
    const r = rig();
    const options = { prompt, workspaceId:'fixture-workspace', workspace:r.workspace, signal:new AbortController().signal, dependencies:r.deps, persistence:r.persistence, catalogue:[r.candidate], env:{ AGENTV3_EXTERNAL_GAME_ASSETS:'on' } };
    const result = await prepareGameAssets(options);
    expect(result.status).toBe('prepared'); expect(result.outcomes.map(o => o.subject)).toEqual(expected);
    expect(r.download).toHaveBeenCalledTimes(1); // Shared bytes are content-deduplicated within the request.
    expect(r.texts.get('public/game-assets/manifest.json')).toContain(r.candidate.sha256);
    expect(r.texts.get('public/game-assets/ATTRIBUTION.txt')).toContain('CC0-1.0');
    expect(r.texts.get('src/game/three/assetModels.ts')).toContain('loadGameAsset');
    const restored = new Map<string,string>();
    await materializeAssets({ writeBinaryFile: async (_id,p,c) => { restored.set(p,c); } }, 'fixture-workspace', Object.fromEntries(r.binary));
    expect(Buffer.from([...restored.values()][0], 'base64')).toEqual(r.bytes);
    const again = await acquireGameAsset({ subject: expected[0] }, { ...r.deps, cache: r.cache() }, options.signal);
    expect(again.kind).toBe('model'); if (again.kind === 'model') expect(again.cacheHit).toBe(true);
    expect(r.download).toHaveBeenCalledTimes(1);
    for (const p of restored.keys()) { expect(p.startsWith('public/game-assets/')).toBe(true); expect(contentTypeFor(p)).toBe('model/gltf-binary'); }
  });
  it('rejects an unacknowledged storage write before model materialization', async () => {
    const r = rig();
    const result = await acquireGameAsset({ subject:'car' }, { ...r.deps, persist: persistProjectAsset(r.workspace, 'fixture-workspace', { ...r.persistence, readBinary: async () => null }) }, new AbortController().signal);
    expect(result.kind).toBe('procedural'); expect(r.disk.size).toBe(0);
  });
  it('does not hand off a manifest when its durable text write fails', async () => {
    const r = rig();
    const result = await prepareGameAssets({ prompt:'3D car game',workspaceId:'fixture-workspace',workspace:r.workspace,signal:new AbortController().signal,catalogue:[r.candidate],dependencies:r.deps,persistence:{...r.persistence,saveText:async()=>{throw Error('offline');}},env:{AGENTV3_EXTERNAL_GAME_ASSETS:'on'} });
    expect(result.status).toBe('procedural'); expect(result.handoff).toBe(''); expect(result.files).toEqual({});
  });
  it('checks real clip names through semantic roles and never substitutes a statue for an animal', async () => {
    const r = rig();
    await acquireGameAsset({ subject:'human', animation:'walk' }, r.deps, new AbortController().signal);
    expect(r.parse).toHaveBeenCalledWith(r.bytes, { subject:'human', animation:'Move' });
    expect(gameAssetRequirements('3D flying bird game',[r.candidate])).toEqual([{subject:'bird',animation:'fly'}]);
    expect((await acquireGameAsset({ subject:'horse statue' },r.deps,new AbortController().signal)).kind).toBe('procedural');
  });
  it('rejects cache poisoning and credential-bearing catalogue URLs', async () => {
    const r = rig();
    await acquireGameAsset({subject:'car'},r.deps,new AbortController().signal);
    for (const key of r.objects.keys()) r.objects.set(key, Buffer.from('bad'));
    expect(await r.cache().read(r.candidate.sha256)).toBeNull();
    expect(() => validateCatalogue([{ ...r.candidate, downloadUrl:'https://models.example/f.glb?token=secret' }])).toThrow();
    expect(() => validateCatalogue([{ ...r.candidate, provider:'sketchfab' }])).toThrow('authorized');
  });
  it('uses documented Poly Haven metadata only for already reviewed exact revisions', async () => {
    const r = rig(); const c = {...r.candidate,provider:'polyhaven' as const,id:'reviewed_model',revision:'abc',serviceCredit:'Models: Poly Haven'};
    const get = vi.fn().mockResolvedValueOnce({type:2,files_hash:'abc'}).mockResolvedValueOnce({glb:{'1k':{url:c.downloadUrl,size:r.bytes.length}}});
    const p = createAssetProviders([c],{get})[0];
    expect(await p.search({subject:'car'},new AbortController().signal)).toEqual([c]);
    expect(get.mock.calls.map(c=>c[0])).toEqual(['https://api.polyhaven.com/info/reviewed_model','https://api.polyhaven.com/files/reviewed_model']);
    expect(polyHavenContainsFile({url:c.downloadUrl,size:999999999},c.downloadUrl)).toBe(false);
  });
});

it('preserves a GLB at the existing decoded-byte limit without raising the cap', async () => {
  const { MAX_BUILD_ASSET_BYTES, persistBuildAssets } = await import('../buildAssets');
  const { ASSET_LIMITS } = await import('./assetPolicy');
  expect(ASSET_LIMITS.bytes).toBeLessThanOrEqual(MAX_BUILD_ASSET_BYTES);
  const save = vi.fn(async () => {});
  const result = await persistBuildAssets({ listFiles:async()=>['public/game-assets/boundary.glb'],readBinaryFile:async()=>Buffer.alloc(MAX_BUILD_ASSET_BYTES).toString('base64') },'fixture-workspace',{heldPaths:async()=>[],save});
  expect(result.saved).toEqual(['public/game-assets/boundary.glb']); expect(save).toHaveBeenCalledOnce();
  const over = await persistBuildAssets({ listFiles:async()=>['public/game-assets/over.glb'],readBinaryFile:async()=>Buffer.alloc(MAX_BUILD_ASSET_BYTES+1).toString('base64') },'fixture-workspace',{heldPaths:async()=>[],save});
  expect(over.skipped).toEqual(['public/game-assets/over.glb']); expect(save).toHaveBeenCalledOnce();
});

it('persists optimized provenance and reuses derived bytes from the durable cache', async () => {
  const { downloadReviewedAsset } = await import('./assetTransport');
  const original=paddedSyntheticGlb(); const optimized=compactGlb(original); const bytes=Buffer.from(optimized.bytes);
  const c={...syntheticCandidate(bytes),optimization:'compact-v1' as const,sourceSha256:optimized.sourceSha256};
  const r=rig(bytes,c); const fetch=vi.fn(async()=>new Response(original));vi.stubGlobal('fetch',fetch);
  r.download.mockImplementation(async()=>Buffer.from(await downloadReviewedAsset(c,new AbortController().signal)));
  try {
    const options={prompt:'3D human walking game',workspaceId:'fixture-workspace',workspace:r.workspace,signal:new AbortController().signal,catalogue:[c],dependencies:r.deps,persistence:r.persistence,env:{AGENTV3_EXTERNAL_GAME_ASSETS:'on'}};
    expect((await prepareGameAssets(options)).status).toBe('prepared');
    const manifest=JSON.parse(r.texts.get('public/game-assets/manifest.json')!);
    expect(manifest.assets[0].candidate.sourceSha256).toBe(optimized.sourceSha256);
    expect(manifest.assets[0].candidate.optimization).toBe('compact-v1');
    expect(manifest.assets[0].sha256).toBe(optimized.sha256);
    expect(r.texts.get('public/game-assets/ATTRIBUTION.txt')).toContain('lossless GLB buffer compaction');
    expect(r.texts.get('public/game-assets/ATTRIBUTION.txt')).toContain(optimized.sourceSha256);
    expect((await prepareGameAssets(options)).outcomes[0].outcome).toMatchObject({kind:'model',cacheHit:true});
    expect(fetch).toHaveBeenCalledOnce();
    expect(Buffer.from([...r.binary.values()][0].split(',')[1],'base64')).toEqual(bytes);
  } finally {vi.unstubAllGlobals();}
});

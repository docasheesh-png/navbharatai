import { it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compactGlb } from './assetOptimize';
import { validateGlb } from './assetPolicy';
import { validateCatalogue } from './providers';
import { encodeFixtureGlb, paddedSyntheticGlb, syntheticCandidate, syntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';

function parts(bytes: Uint8Array) {
  const b = Buffer.from(bytes); const n = b.readUInt32LE(12);
  return { doc: JSON.parse(b.subarray(20, 20 + n).toString()), bin: b.subarray(28 + n) };
}
it('losslessly compacts embedded textures/animation and preserves every buffer view byte', () => {
  const original = paddedSyntheticGlb(); const result = compactGlb(original);
  expect(result.savedBytes).toBeGreaterThan(64_000); expect(result.deduplicatedViews).toBe(1);
  expect(result.sourceSha256).not.toBe(result.sha256);
  expect(validateGlb(result.bytes)).toMatchObject({ triangles: 4, animations: ['Move'] });
  const before = parts(original), after = parts(result.bytes);
  expect(after.doc.accessors).toEqual(before.doc.accessors); expect(after.doc.animations).toEqual(before.doc.animations);
  expect(after.doc.images).toEqual(before.doc.images); expect(after.doc.nodes).toEqual(before.doc.nodes);
  expect(after.doc.meshes).toEqual(before.doc.meshes); expect(after.doc.materials).toEqual(before.doc.materials);
  for (let i = 0; i < before.doc.bufferViews.length; i++) {
    const a = before.doc.bufferViews[i], b = after.doc.bufferViews[i];
    expect(after.bin.subarray(b.byteOffset, b.byteOffset + b.byteLength)).toEqual(before.bin.subarray(a.byteOffset ?? 0, (a.byteOffset ?? 0) + a.byteLength));
  }
  expect(compactGlb(result.bytes).bytes).toEqual(result.bytes);
  expect(compactGlb(result.bytes).savedBytes).toBe(0);
});
it('bounds optimizer work for overlapping ranges and refuses unsafe input before processing', () => {
  const original = paddedSyntheticGlb(); const { doc, bin } = parts(original);
  for (let i = 0; i < 300; i++) doc.bufferViews.push({buffer:0,byteOffset:1000+i,byteLength:60000});
  const overlapping = encodeFixtureGlb(doc, bin);
  const result = compactGlb(overlapping);
  expect(result.skippedReason).toBe('work-budget'); expect(result.bytes).toEqual(overlapping);
  doc.buffers[0].uri='https://metadata.google.internal/';
  expect(()=>compactGlb(encodeFixtureGlb(doc,bin))).toThrow('references');
  expect(compactGlb(syntheticGlb()).savedBytes).toBeGreaterThanOrEqual(0);
});
it('requires pinned source and output hashes and verifies source before optimization', async () => {
  vi.resetModules(); const { downloadReviewedAsset } = await import('./assetTransport');
  const original = paddedSyntheticGlb(), result = compactGlb(original);
  const c = {...syntheticCandidate(result.bytes), optimization:'compact-v1' as const, sourceSha256:result.sourceSha256};
  expect(()=>validateCatalogue([c])).not.toThrow();
  expect(()=>validateCatalogue([{...c,sourceSha256:undefined}])).toThrow('Unreviewed optimization');
  const fetch = vi.fn(async()=>new Response(original)); vi.stubGlobal('fetch',fetch);
  try {
    expect(await downloadReviewedAsset(c,new AbortController().signal)).toEqual(result.bytes);
    await expect(downloadReviewedAsset({...c,sourceSha256:'f'.repeat(64)},new AbortController().signal)).rejects.toThrow('source/version mismatch');
  } finally { vi.unstubAllGlobals(); }
});

it('offline admission CLI writes the exact derived bytes, reports hashes and refuses overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(),'nbai-compact-cli-'));
  try {
    const input=join(dir,'source.glb'), output=join(dir,'derived.glb'); const source=paddedSyntheticGlb();
    writeFileSync(input,source);
    const args=['--experimental-strip-types','scripts/gameAssetCompact.mjs',input,output];
    const report=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8',stdio:'pipe'}));
    const expected=compactGlb(source);
    expect(report.sourceSha256).toBe(expected.sourceSha256);expect(report.sha256).toBe(expected.sha256);
    expect(readFileSync(output)).toEqual(expected.bytes);
    expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
it('compacts reviewed glTF resources only after checking JSON and resource hashes', async () => {
  const { createHash } = await import('node:crypto');
  const { bundleGltf } = await import('./gltfBundle');
  vi.resetModules(); const { downloadReviewedAsset } = await import('./assetTransport');
  const { doc, bin } = parts(paddedSyntheticGlb()); doc.buffers[0].uri='source.bin';
  const json=Buffer.from(JSON.stringify(doc)); const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  const expected=compactGlb(bundleGltf(json,new Map([['source.bin',bin]])));
  const c={...syntheticCandidate(expected.bytes), format:'gltf' as const, optimization:'compact-v1' as const,
    downloadUrl:'https://models.example/source.gltf',sourceSha256:hash(json),
    resources:[{path:'source.bin',url:'https://models.example/source.bin',sha256:hash(bin)}]};
  validateCatalogue([c]);
  const fetch=vi.fn(async(url:URL|string)=>new Response(String(url).endsWith('.gltf')?json:bin));vi.stubGlobal('fetch',fetch);
  try {
    expect(await downloadReviewedAsset(c,new AbortController().signal)).toEqual(expected.bytes);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(downloadReviewedAsset({...c,resources:[{...c.resources[0],sha256:'f'.repeat(64)}]},new AbortController().signal)).rejects.toThrow('hash/budget mismatch');
  } finally {vi.unstubAllGlobals();}
});

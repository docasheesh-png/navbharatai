import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { selectGlbAnimations } from './assetAnimationSelection';
import { validateGlb } from './assetPolicy';
import { validateCatalogue } from './providers';
import { encodeFixtureGlb, syntheticCandidate, paddedSyntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function source() {
  const b = Buffer.from(paddedSyntheticGlb()); const n = b.readUInt32LE(12);
  const doc = JSON.parse(b.subarray(20, 20 + n).toString());
  doc.animations.push({ ...structuredClone(doc.animations[0]), name: 'Unused' });
  return { doc, bin: b.subarray(28 + n) };
}
it('keeps selected animation data and mesh/texture data, removing unused clips and ranges', () => {
  const { doc, bin } = source(); const b = encodeFixtureGlb(doc, bin);
  const output = selectGlbAnimations(b, hash(b), ['Move']);
  expect(validateGlb(output)).toMatchObject({ triangles: 4, animations: ['Move'] });
  expect(output.byteLength).toBeLessThan(b.byteLength - 64000);
  const after = JSON.parse(Buffer.from(output).subarray(20, 20 + Buffer.from(output).readUInt32LE(12)).toString());
  expect(after.nodes).toEqual(doc.nodes); expect(after.materials).toEqual(doc.materials);
  expect(after.animations[0].channels).toEqual(doc.animations[0].channels);
});
it('rejects wrong source hash, missing/duplicate clip names and malformed source envelopes', () => {
  const { doc, bin } = source(); const b = encodeFixtureGlb(doc, bin);
  for (const names of [[], ['Missing'], ['Move', 'Move']]) expect(() => selectGlbAnimations(b, hash(b), names)).toThrow();
  expect(() => selectGlbAnimations(b, '0'.repeat(64), ['Move'])).toThrow();
  const bad = Buffer.from(b); bad.writeUInt32LE(0xffffffff, 12);
  expect(() => selectGlbAnimations(bad, hash(bad), ['Move'])).toThrow();
  doc.animations.push(structuredClone(doc.animations[0]));
  const duplicate = encodeFixtureGlb(doc, bin);
  expect(() => selectGlbAnimations(duplicate, hash(duplicate), ['Move'])).toThrow();
});
it('rejects external references even in discarded metadata and invalid retained ranges', () => {
  const { doc, bin } = source(); doc.animations[1].extras = { uri: 'https://example.com/file' };
  let b = encodeFixtureGlb(doc, bin);
  expect(() => selectGlbAnimations(b, hash(b), ['Move'])).toThrow();
  delete doc.animations[1].extras; doc.bufferViews[0].byteLength = bin.length + 1;
  b = encodeFixtureGlb(doc, bin);
  expect(() => selectGlbAnimations(b, hash(b), ['Move'])).toThrow();
});
it('requires reviewed GLB clip selection and source/output pins in the live transport', async () => {
  const { doc, bin } = source(); const b = encodeFixtureGlb(doc, bin);
  const output = selectGlbAnimations(b, hash(b), ['Move']);
  const c = { ...syntheticCandidate(output), optimization: 'animation-selection-v1' as const,
    sourceSha256: hash(b), retainedAnimations: ['Move'] };
  validateCatalogue([c]);
  expect(() => validateCatalogue([{ ...c, retainedAnimations: [] }])).toThrow();
  expect(() => validateCatalogue([{ ...c, format: 'gltf' }])).toThrow();
  vi.resetModules(); const { downloadReviewedAsset } = await import('./assetTransport');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(b)));
  try { expect(await downloadReviewedAsset(c, new AbortController().signal)).toEqual(output); }
  finally { vi.unstubAllGlobals(); }
});

import { createHash } from 'node:crypto';
import { ASSET_LIMITS, validateGlb } from './assetPolicy.ts';
import { compactGlb } from './assetOptimize.ts';

/**
 * A reviewed source can contain many unused animation clips. Only hash-pinned GLB sources enter
 * this bounded preprocessing step; the smaller result must pass the unchanged runtime validator.
 * Retained geometry, skin, image and animation bytes are copied exactly, never decoded or retargeted.
 */
/**
 * Bounded-work guard for a hash-pinned SOURCE before clip selection (the served result still passes validateGlb).
 * 2026-11-19: 10,000 → 16,384. KayKit's skeleton characters (95 clips, 4.6 MiB) carry 10,941 accessors; the
 * source byte ceiling (5 MiB) already bounds the work, so the count limit only needed headroom, not removal.
 */
export const SOURCE_RECORD_LIMIT = 16_384;
export function selectGlbAnimations(input: Uint8Array, sourceSha256: string, names: readonly string[]): Uint8Array {
  const reject = (): never => { throw new Error('Invalid reviewed animation selection'); };
  if (input.byteLength < 28 || input.byteLength > ASSET_LIMITS.bytes
    || !/^[a-f0-9]{64}$/.test(sourceSha256)
    || createHash('sha256').update(input).digest('hex') !== sourceSha256
    || !names.length || names.length > 16 || new Set(names).size !== names.length
    || names.some(n => typeof n !== 'string' || !n.length || n.length > 128)) reject();
  const b = Buffer.from(input);
  const jsonLength = b.readUInt32LE(12);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length
    || jsonLength % 4 || b.readUInt32LE(16) !== 0x4e4f534a || 28 + jsonLength > b.length) reject();
  const binLength = b.readUInt32LE(20 + jsonLength);
  if (b.readUInt32LE(24 + jsonLength) !== 0x004e4942 || binLength % 4 || 28 + jsonLength + binLength !== b.length) reject();
  const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(20, 20 + jsonLength)));
  if (!doc || doc.asset?.version !== '2.0' || !Array.isArray(doc.animations) || doc.animations.length > 128
    || !Array.isArray(doc.accessors) || doc.accessors.length > SOURCE_RECORD_LIMIT
    || !Array.isArray(doc.bufferViews) || doc.bufferViews.length > SOURCE_RECORD_LIMIT
    || !Array.isArray(doc.buffers) || doc.buffers.length !== 1 || doc.buffers[0].uri
    || !Number.isSafeInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength < 0
    || binLength - doc.buffers[0].byteLength < 0 || binLength - doc.buffers[0].byteLength > 3) reject();
  // No extensions or external references, even in discarded clips or extras. Bounded iterative walk.
  const pending: unknown[] = [doc]; let work = 0;
  while (pending.length) {
    if (++work > 250000) reject();
    const value = pending.pop();
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['uri', 'extensions', 'extensionsUsed', 'extensionsRequired', '__proto__', 'constructor', 'prototype'].includes(key)) reject();
      pending.push(child);
    }
  }
  doc.animations = names.map(name => {
    const matches = doc.animations.filter((a: any) => a?.name === name);
    if (matches.length !== 1) reject();
    return matches[0];
  });
  const accessors: any[] = []; const accessorMap = new Map<number, number>();
  const retainAccessor = (index: number): number => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= doc.accessors.length) return reject();
    if (!accessorMap.has(index)) { accessorMap.set(index, accessors.length); accessors.push({ ...doc.accessors[index] }); }
    return accessorMap.get(index)!;
  };
  for (const mesh of doc.meshes ?? []) for (const p of mesh.primitives ?? []) {
    if (p.indices !== undefined) p.indices = retainAccessor(p.indices);
    for (const attributes of [p.attributes, ...(p.targets ?? [])]) {
      if (!attributes || typeof attributes !== 'object') reject();
      for (const key of Object.keys(attributes)) attributes[key] = retainAccessor(attributes[key]);
    }
  }
  for (const skin of doc.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = retainAccessor(skin.inverseBindMatrices);
  for (const animation of doc.animations) for (const sampler of animation.samplers ?? []) {
    sampler.input = retainAccessor(sampler.input); sampler.output = retainAccessor(sampler.output);
  }
  const views: any[] = []; const viewMap = new Map<number, number>(); const chunks: Buffer[] = [];
  const bin = b.subarray(28 + jsonLength); let offset = 0;
  const retainView = (index: number): number => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= doc.bufferViews.length) return reject();
    if (!viewMap.has(index)) {
      const v = doc.bufferViews[index]; const start = v.byteOffset ?? 0;
      if (v.buffer !== 0 || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(v.byteLength)
        || v.byteLength < 0 || start + v.byteLength > doc.buffers[0].byteLength) reject();
      const padding = (4 - v.byteLength % 4) % 4;
      if (offset + v.byteLength + padding > ASSET_LIMITS.bytes) reject();
      viewMap.set(index, views.length); views.push({ ...v, byteOffset: offset });
      chunks.push(bin.subarray(start, start + v.byteLength), Buffer.alloc(padding));
      offset += v.byteLength + padding;
    }
    return viewMap.get(index)!;
  };
  for (const a of accessors) { if (a.sparse) reject(); a.bufferView = retainView(a.bufferView); }
  for (const image of doc.images ?? []) image.bufferView = retainView(image.bufferView);
  doc.accessors = accessors; doc.bufferViews = views; doc.buffers[0].byteLength = offset;
  const raw = Buffer.from(JSON.stringify(doc)); const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const size = 28 + json.length + offset; if (size > ASSET_LIMITS.bytes) reject();
  const output = Buffer.alloc(size);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(size, 8);
  output.writeUInt32LE(json.length, 12); output.writeUInt32LE(0x4e4f534a, 16); json.copy(output, 20);
  output.writeUInt32LE(offset, 20 + json.length); output.writeUInt32LE(0x004e4942, 24 + json.length);
  Buffer.concat(chunks, offset).copy(output, 28 + json.length);
  validateGlb(output);
  return compactGlb(output).bytes;
}

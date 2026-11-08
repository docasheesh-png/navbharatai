import { createHash } from 'node:crypto';
import { ASSET_LIMITS, validateGlb } from './assetPolicy.ts';

export interface GlbCompaction {
  bytes: Uint8Array;
  version: 'compact-v1';
  sourceSha256: string;
  sha256: string;
  savedBytes: number;
  deduplicatedViews: number;
  skippedReason?: 'work-budget' | 'no-saving';
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Lossless packing only: preserve every buffer view's exact bytes, accessor, material, node and
 * animation. Repack/deduplicate views and remove unaddressed buffer bytes. No image decoding,
 * quantization, topology changes or codecs. Version/hash pinning is part of catalogue admission.
 */
export function compactGlb(input: Uint8Array): GlbCompaction {
  validateGlb(input);
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const sourceSha256 = digest(source);
  const unchanged = (skippedReason: GlbCompaction['skippedReason']): GlbCompaction => ({
    bytes: input, version: 'compact-v1', sourceSha256, sha256: sourceSha256,
    savedBytes: 0, deduplicatedViews: 0, skippedReason,
  });
  const jsonLength = source.readUInt32LE(12);
  const doc = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = source.subarray(28 + jsonLength);
  const blocks = new Map<string, { bytes: Buffer; offset: number }>();
  const ranges = new Map<string, number>();
  const chunks: Buffer[] = [];
  let offset = 0; let inspectedBytes = 0; let deduplicatedViews = 0;
  for (const view of doc.bufferViews) {
    const start = view.byteOffset ?? 0;
    const rangeKey = `${start}:${view.byteLength}`;
    let destination = ranges.get(rangeKey);
    if (destination !== undefined) {
      deduplicatedViews++;
    } else {
      inspectedBytes += view.byteLength;
      // Overlapping, differently ranged views must not turn a 5 MiB file into gigabytes of work.
      if (inspectedBytes > ASSET_LIMITS.bytes * 2) return unchanged('work-budget');
      const bytes = bin.subarray(start, start + view.byteLength);
      const key = `${bytes.length}:${digest(bytes)}`;
      const existing = blocks.get(key);
      if (existing && existing.bytes.equals(bytes)) {
        destination = existing.offset; deduplicatedViews++;
      } else {
        const padding = (4 - bytes.length % 4) % 4;
        if (offset + bytes.length + padding > bin.length) return unchanged('no-saving');
        destination = offset;
        blocks.set(key, { bytes, offset });
        chunks.push(bytes);
        if (padding) chunks.push(Buffer.alloc(padding));
        offset += bytes.length + padding;
      }
      ranges.set(rangeKey, destination);
    }
    view.byteOffset = destination;
  }
  doc.buffers[0].byteLength = offset;
  const raw = Buffer.from(JSON.stringify(doc));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const size = 28 + json.length + offset;
  if (size >= source.length) return unchanged('no-saving');
  const output = Buffer.alloc(size);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(size, 8);
  output.writeUInt32LE(json.length, 12); output.writeUInt32LE(0x4e4f534a, 16); json.copy(output, 20);
  output.writeUInt32LE(offset, 20 + json.length); output.writeUInt32LE(0x004e4942, 24 + json.length);
  Buffer.concat(chunks, offset).copy(output, 28 + json.length);
  validateGlb(output);
  return { bytes: output, version: 'compact-v1', sourceSha256, sha256: digest(output),
    savedBytes: source.length - size, deduplicatedViews };
}

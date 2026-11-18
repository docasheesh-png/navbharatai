import { createHash } from 'node:crypto';
import { validateGlb } from './assetPolicy';

// Not a general extension allowlist. Only pinned supplied originals and reviewed clothing-only derivatives qualify.
const ORIGINAL_HASHES = new Set([
  'd67c8ab51a1d482f1ac1f341e0911baed618015bb9f327786bd2be8d03b02e28',
  'cb61d382726a4fe9506a7ea66e262addc321b79939eb9659b6fc2a61a6155c82',
  'eb6b890f17af196b4bb04d3d5e8a29cb446bb22d189dafa5da9b1f21689fd357',
  '7dbe7b32310b89398a8e21ebceb9723986f3109e8c358583647303f038548180',
  '72896823eef0c702d4479e02fc9bc2306ddbd4cd4310200422aa58710a42c9c3',
  '86233496f6f4a87cc7e519877002bbf9b33faa1e0295721fdf8089b6d0b86cd1',
]);

/** Validate a structural projection; NEVER emit this projection as a model.
 * Original render/persistence bytes are unchanged. Only scalar specular material
 * metadata is accounted for here; every other field still meets strict GLB policy. */
export function validateRecoveredHumanGlb(bytes: Buffer) {
  if (bytes.length > 3_000_000 || !ORIGINAL_HASHES.has(createHash('sha256').update(bytes).digest('hex'))) throw new Error('Unrecognized recovered human bytes');
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  if (JSON.stringify(doc.extensionsUsed) !== '["KHR_materials_specular"]' || doc.extensionsRequired !== undefined) throw new Error('Unsupported human extension declaration');
  delete doc.extensionsUsed;
  for (const material of doc.materials ?? []) {
    if (!material.extensions) continue;
    if (Object.keys(material.extensions).join() !== 'KHR_materials_specular') throw new Error('Unsupported human material extension');
    const specular = material.extensions.KHR_materials_specular;
    if (Object.keys(specular).join() !== 'specularFactor' || !Number.isFinite(specular.specularFactor) || specular.specularFactor < 0 || specular.specularFactor > 1) throw new Error('Unsafe human specular value');
    delete material.extensions;
  }
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const binaryChunk = bytes.subarray(20 + length);
  const projected = Buffer.alloc(20 + padded.length + binaryChunk.length);
  bytes.copy(projected, 0, 0, 20);
  projected.writeUInt32LE(projected.length, 8);
  projected.writeUInt32LE(padded.length, 12);
  padded.copy(projected, 20);
  binaryChunk.copy(projected, 20 + padded.length);
  const result = validateGlb(projected);
  return { ...result, bytes: bytes.length };
}

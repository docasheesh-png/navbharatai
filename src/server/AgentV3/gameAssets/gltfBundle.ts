import { ASSET_LIMITS, validateGlb, type GlbLimits } from './assetPolicy';

/** Only pack-relative reviewed resources. Never resolve a glTF URI against a network URL. */
export function safeGltfResourcePath(path: string): boolean {
  return typeof path === 'string' && path.length <= 240 && /^[A-Za-z0-9_][A-Za-z0-9_./ -]*$/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** Deterministic, bounded glTF+BIN+PNG/JPEG → self-contained GLB. No native code or archive extraction. */
export function bundleGltf(json: Uint8Array, resources: ReadonlyMap<string, Uint8Array>, limits: GlbLimits = ASSET_LIMITS, allowedExtensions: readonly string[] = []): Uint8Array {
  if (json.byteLength > 1024 * 1024 || resources.size > 16) throw new Error('glTF resource budget');
  let total = json.byteLength;
  for (const [path, bytes] of resources) {
    if (!safeGltfResourcePath(path)) throw new Error('Unsafe glTF resource path');
    total += bytes.byteLength;
    if (total > limits.bytes) throw new Error('glTF byte budget');
  }
  const doc = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(json));
  if (doc?.asset?.version !== '2.0' || !Array.isArray(doc.buffers) || doc.buffers.length > 16
    || (doc.bufferViews !== undefined && !Array.isArray(doc.bufferViews)) || (doc.images !== undefined && !Array.isArray(doc.images))) throw new Error('Unsupported glTF document');
  const used = new Set<string>(); const chunks: Buffer[] = []; let offset = 0;
  const resource = (uri: unknown): Uint8Array => {
    if (typeof uri !== 'string' || !safeGltfResourcePath(uri)) throw new Error('Unsafe glTF URI');
    const bytes = resources.get(uri); if (!bytes) throw new Error('Missing reviewed glTF resource');
    used.add(uri); return bytes;
  };
  const append = (bytes: Uint8Array) => {
    const start = offset; const padded = Buffer.alloc(Math.ceil(bytes.byteLength / 4) * 4);
    padded.set(bytes); chunks.push(padded); offset += padded.length;
    if (offset > limits.bytes) throw new Error('Bundled glTF byte budget');
    return start;
  };
  const bufferOffsets = doc.buffers.map((buffer: {uri?:unknown;byteLength?:number}) => {
    const bytes = resource(buffer?.uri);
    if (buffer.byteLength !== bytes.byteLength) throw new Error('glTF buffer length mismatch');
    return append(bytes);
  });
  const views = doc.bufferViews ?? [];
  for (const view of views) {
    if (!view || !Number.isInteger(view.buffer) || view.buffer < 0 || view.buffer >= doc.buffers.length
      || !Number.isSafeInteger(view.byteOffset ?? 0) || (view.byteOffset ?? 0) < 0 || !Number.isSafeInteger(view.byteLength)
      || view.byteLength < 0 || (view.byteOffset ?? 0) + view.byteLength > doc.buffers[view.buffer].byteLength) throw new Error('glTF buffer view bounds');
    view.byteOffset = bufferOffsets[view.buffer] + (view.byteOffset ?? 0); view.buffer = 0;
  }
  for (const image of doc.images ?? []) {
    if (image.uri !== undefined) {
      if (image.bufferView !== undefined) throw new Error('Ambiguous image source');
      const bytes = resource(image.uri);
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const mime = jpeg ? 'image/jpeg' : 'image/png';
      if (image.mimeType !== undefined && image.mimeType !== mime) throw new Error('Image MIME mismatch');
      image.mimeType = mime; // Final policy checks dimensions/markers; browser admission must decode every image.
      image.bufferView = views.length; views.push({buffer:0,byteOffset:append(bytes),byteLength:bytes.byteLength});
      delete image.uri;
    }
  }
  if (used.size !== resources.size) throw new Error('Unreferenced pack resource');
  doc.buffers = [{byteLength:offset}]; doc.bufferViews = views;
  const raw = Buffer.from(JSON.stringify(doc)); const paddedJson = Buffer.alloc(Math.ceil(raw.length / 4) * 4,32); raw.copy(paddedJson);
  const size = 28 + paddedJson.length + offset;
  if (size > limits.bytes) throw new Error('Bundled GLB exceeds budget');
  const glb = Buffer.alloc(size);
  glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(size,8);
  glb.writeUInt32LE(paddedJson.length,12);glb.writeUInt32LE(0x4e4f534a,16);paddedJson.copy(glb,20);
  glb.writeUInt32LE(offset,20+paddedJson.length);glb.writeUInt32LE(0x004e4942,24+paddedJson.length);
  Buffer.concat(chunks,offset).copy(glb,28+paddedJson.length);
  validateGlb(glb, limits, allowedExtensions);
  return glb;
}

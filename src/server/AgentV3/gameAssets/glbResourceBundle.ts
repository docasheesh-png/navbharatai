import { ASSET_LIMITS } from './assetPolicy';
import { bundleGltf } from './gltfBundle';

/** Embed reviewed PNG dependencies of a hash-pinned GLB without ever resolving its URIs online. */
export function bundleGlbResources(input: Uint8Array, resources: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const fail = (): never => { throw new Error('Unsupported reviewed GLB resources'); };
  const b = Buffer.from(input);
  if (b.length < 28 || b.length > ASSET_LIMITS.bytes) fail();
  const n = b.readUInt32LE(12);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length
    || n > 1024 * 1024 || n % 4 || b.readUInt32LE(16) !== 0x4e4f534a || 28 + n > b.length) fail();
  const length = b.readUInt32LE(20 + n);
  if (length % 4 || b.readUInt32LE(24 + n) !== 0x004e4942 || 28 + n + length !== b.length) fail();
  const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(20, 20 + n)));
  if (doc?.asset?.version !== '2.0' || doc.buffers?.length !== 1 || doc.buffers[0].uri !== undefined
    || !Number.isSafeInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength < 0
    || length - doc.buffers[0].byteLength < 0 || length - doc.buffers[0].byteLength > 3) fail();
  // The Kenney exporter declares identity UV transforms. Only this exact no-op is removed;
  // nonidentity transforms/alternate UV channels and every other extension remain unsupported.
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (doc[key] !== undefined) {
      if (!Array.isArray(doc[key]) || doc[key].some((v: unknown) => v !== 'KHR_texture_transform')) fail();
      delete doc[key];
    }
  }
  const pending: unknown[] = [doc]; let visited = 0;
  while (pending.length) {
    if (++visited > 100000) fail();
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    const node = value as Record<string, any>;
    if (Object.hasOwn(node, 'extensions')) {
      const ext = node.extensions; const t = ext?.KHR_texture_transform;
      if (!ext || Object.keys(ext).length !== 1 || !t || typeof t !== 'object' || Array.isArray(t)
        || Object.keys(t).some(k => !['offset', 'scale', 'rotation', 'texCoord'].includes(k))
        || !Number.isSafeInteger(node.index) || node.index < 0 || (node.texCoord ?? 0) !== 0
        || (t.texCoord ?? 0) !== 0 || (t.rotation ?? 0) !== 0
        || (t.offset !== undefined && JSON.stringify(t.offset) !== '[0,0]')
        || (t.scale !== undefined && JSON.stringify(t.scale) !== '[1,1]')) fail();
      delete node.extensions;
    }
    pending.push(...Object.values(node));
  }
  const name = 'nbai-reviewed-embedded.bin';
  if (resources.has(name)) fail();
  const supplied = new Map(resources);
  supplied.set(name, b.subarray(28 + n, 28 + n + doc.buffers[0].byteLength));
  doc.buffers[0].uri = name;
  // Existing bundler validates exact resource use, safe relative paths and the unchanged GLB policy.
  return bundleGltf(Buffer.from(JSON.stringify(doc)), supplied);
}

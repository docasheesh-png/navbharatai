/**
 * Maintainer-only GLB editing for library assembly (2026-11-25, the Indian garments). Reads a GLB into its JSON and BIN,
 * reads any accessor (interleaved or not, any component type) as floats, appends new accessors, and writes a valid GLB
 * back. Editing at this level keeps everything else in the file — skins, the 16 animation clips, textures — byte for byte.
 */
import { createHash } from 'node:crypto';

export interface Glb { json: any; bin: Buffer }
export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export function readGlb(bytes: Uint8Array): Glb {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.readUInt32LE(0) !== 0x46546c67) throw Error('not a GLB');
  const n = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
  const binLen = b.readUInt32LE(20 + n);
  return { json, bin: Buffer.from(b.subarray(28 + n, 28 + n + binLen)) };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Any accessor as floats (normalized integers are scaled to 0..1). */
export function readAccessor(g: Glb, index: number): { data: Float32Array; components: number; count: number } {
  const a = g.json.accessors[index];
  const v = g.json.bufferViews[a.bufferView];
  const components = COMPONENTS[a.type]; const size = SIZES[a.componentType];
  const stride = v.byteStride || components * size;
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * components);
  const scale = a.normalized ? ({ 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 } as Record<number, number>)[a.componentType] ?? 1 : 1;
  for (let e = 0; e < a.count; e++) for (let c = 0; c < components; c++) {
    const o = base + e * stride + c * size;
    const raw = a.componentType === 5126 ? g.bin.readFloatLE(o) : a.componentType === 5123 ? g.bin.readUInt16LE(o)
      : a.componentType === 5121 ? g.bin.readUInt8(o) : a.componentType === 5125 ? g.bin.readUInt32LE(o)
      : a.componentType === 5122 ? g.bin.readInt16LE(o) : g.bin.readInt8(o);
    out[e * components + c] = raw / scale;
  }
  return { data: out, components, count: a.count };
}

/** Append tightly packed data as a new bufferView + accessor; returns the accessor index. */
export function appendAccessor(g: Glb, data: Float32Array | Uint16Array | Uint32Array | Uint8Array, type: keyof typeof COMPONENTS, target?: 34962 | 34963): number {
  const componentType = data instanceof Float32Array ? 5126 : data instanceof Uint32Array ? 5125 : data instanceof Uint16Array ? 5123 : 5121;
  const pad = (4 - (g.bin.length % 4)) % 4;
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const byteOffset = g.bin.length + pad;
  g.bin = Buffer.concat([g.bin, Buffer.alloc(pad), bytes]);
  g.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, ...(target ? { target } : {}) });
  const components = COMPONENTS[type];
  const accessor: Record<string, unknown> = { bufferView: g.json.bufferViews.length - 1, componentType, count: data.length / components, type };
  if (type === 'VEC3' && data instanceof Float32Array) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], data[i + c]); max[c] = Math.max(max[c], data[i + c]); }
    accessor.min = min; accessor.max = max;
  }
  g.json.accessors.push(accessor);
  return g.json.accessors.length - 1;
}

export function writeGlb(g: Glb): Uint8Array {
  g.json.buffers = [{ byteLength: g.bin.length }];
  let json = Buffer.from(JSON.stringify(g.json), 'utf8');
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat([g.bin, Buffer.alloc((4 - (g.bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([header, jh, json, bh, bin]));
}

/**
 * Drop what nothing references any more — meshes no node shows, accessors no primitive, skin or animation reads, buffer
 * views no accessor or image uses — and rebuild the BIN from what is left. Detaching a node only takes it out of the
 * scene; its geometry stayed in the file and counted against the library's storage budget (batch 16: ~0.4 MB a model).
 */
export function pruneGlb(g: Glb): void {
  const j = g.json;
  const meshMap = new Map<number, number>(); const meshes: any[] = [];
  for (const n of j.nodes) if (n.mesh !== undefined) { if (!meshMap.has(n.mesh)) { meshMap.set(n.mesh, meshes.length); meshes.push(j.meshes[n.mesh]); } n.mesh = meshMap.get(n.mesh); }
  j.meshes = meshes;
  // Materials no kept primitive draws, then textures, images and samplers no kept material reads (the old outfit's
  // texture was ~0.35 MB of each villager file).
  if (j.materials) {
    const matMap = new Map<number, number>(); const materials: any[] = [];
    for (const m of meshes) for (const p of m.primitives) if (p.material !== undefined) { if (!matMap.has(p.material)) { matMap.set(p.material, materials.length); materials.push(j.materials[p.material]); } p.material = matMap.get(p.material); }
    j.materials = materials;
    const infos = (m: any): any[] => [m.pbrMetallicRoughness?.baseColorTexture, m.pbrMetallicRoughness?.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture].filter(Boolean);
    const texMap = new Map<number, number>(); const textures: any[] = [];
    for (const m of materials) for (const info of infos(m)) { if (!texMap.has(info.index)) { texMap.set(info.index, textures.length); textures.push(j.textures[info.index]); } info.index = texMap.get(info.index); }
    j.textures = textures;
    const imgMap = new Map<number, number>(); const images: any[] = []; const smpMap = new Map<number, number>(); const samplers: any[] = [];
    for (const t of textures) {
      if (t.source !== undefined) { if (!imgMap.has(t.source)) { imgMap.set(t.source, images.length); images.push(j.images[t.source]); } t.source = imgMap.get(t.source); }
      if (t.sampler !== undefined) { if (!smpMap.has(t.sampler)) { smpMap.set(t.sampler, samplers.length); samplers.push(j.samplers[t.sampler]); } t.sampler = smpMap.get(t.sampler); }
    }
    j.images = images; j.samplers = samplers;
    for (const k of ['textures', 'images', 'samplers']) if (!j[k].length) delete j[k];
  }
  const used = new Set<number>();
  for (const m of meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach((a) => used.add(a as number)); if (p.indices !== undefined) used.add(p.indices); for (const t of p.targets ?? []) Object.values(t).forEach((a) => used.add(a as number)); }
  for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) used.add(s.inverseBindMatrices);
  for (const a of j.animations ?? []) for (const s of a.samplers) { used.add(s.input); used.add(s.output); }
  const accMap = new Map<number, number>(); const accessors: any[] = [];
  [...used].sort((x, y) => x - y).forEach((i) => { accMap.set(i, accessors.length); accessors.push(j.accessors[i]); });
  const re = (i: number) => accMap.get(i)!;
  for (const m of meshes) for (const p of m.primitives) { for (const k of Object.keys(p.attributes)) p.attributes[k] = re(p.attributes[k]); if (p.indices !== undefined) p.indices = re(p.indices); for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = re(t[k]); }
  for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = re(s.inverseBindMatrices);
  for (const a of j.animations ?? []) for (const s of a.samplers) { s.input = re(s.input); s.output = re(s.output); }
  j.accessors = accessors;
  const views = new Set<number>(accessors.map((a: any) => a.bufferView).filter((v: unknown) => v !== undefined));
  for (const im of j.images ?? []) if (im.bufferView !== undefined) views.add(im.bufferView);
  const viewMap = new Map<number, number>(); const bufferViews: any[] = []; const chunks: Buffer[] = []; let offset = 0;
  [...views].sort((x, y) => x - y).forEach((i) => {
    const v = j.bufferViews[i]; const bytes = g.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    viewMap.set(i, bufferViews.length); bufferViews.push({ ...v, byteOffset: offset }); chunks.push(bytes); offset += bytes.length;
  });
  for (const a of accessors) if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
  for (const im of j.images ?? []) if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView);
  j.bufferViews = bufferViews; g.bin = Buffer.concat(chunks);
}

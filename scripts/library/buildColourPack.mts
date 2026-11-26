/**
 * Admit the owner's later Drive packs and the colour variants (2026-11-23).
 * Kenney Retro Urban Kit 2.0 (every GLB), Quaternius Stylized Nature MegaKit (glTF under the caps),
 * a curated Medieval Village MegaKit subset, and recolours of models already in the catalogue.
 * Usage: node --import tsx scripts/library/buildColourPack.mts
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { validateGlb, ASSET_LIMITS } from '../../src/server/AgentV3/gameAssets/assetPolicy';
import { bundleGltf } from '../../src/server/AgentV3/gameAssets/gltfBundle';
import { compactGlb } from '../../src/server/AgentV3/gameAssets/assetOptimize';
import { selectGlbAnimations } from '../../src/server/AgentV3/gameAssets/assetAnimationSelection';
import { REVIEWED_GAME_ASSETS, CATALOGUE_STORAGE_BUDGET_BYTES, catalogueStorageBytes, type ReviewedAsset } from '../../src/server/AgentV3/gameAssets/providers';

const ROOT = '/tmp/drive-packs-14';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const textOf = (b: Uint8Array) => new TextDecoder().decode(b);
const NUM: Record<string, string> = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen', 20: 'twenty' };
const LOOK_ONLY = new Set(['KHR_materials_specular', 'KHR_materials_emissive_strength', 'KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_clearcoat', 'KHR_materials_ior']);

function subjectOf(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').toLowerCase().replace(/\d+/g, (d) => NUM[d] ?? [...d].map((ch) => NUM[ch] ?? '').join(' ')).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return words.slice(0, 64);
}
function idSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function toRgbaPng(bytes: Buffer): Buffer {
  const sig = bytes.subarray(0, 8).toString('hex');
  if (sig === '89504e470d0a1a0a' && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes[25] === 6 && bytes[24] === 8) return bytes;
  const dir = tmpdir();
  const inn = join(dir, `nb-in-${sha(bytes).slice(0, 12)}.img`);
  const out = join(dir, `nb-out-${sha(bytes).slice(0, 12)}.png`);
  writeFileSync(inn, bytes);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inn, '-pix_fmt', 'rgba', out], { stdio: 'pipe' });
  return readFileSync(out);
}
/** Keep colour textures inside the 5 MiB model and the 2048 px texture cap. */
function shrinkTexture(bytes: Buffer, edge: number): Buffer {
  const dir = tmpdir();
  const inn = join(dir, `nb-shrink-${sha(bytes).slice(0, 12)}.img`);
  const out = join(dir, `nb-shrink-${sha(bytes).slice(0, 12)}-${edge}.png`);
  writeFileSync(inn, bytes);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inn, '-vf', `scale=${edge}:${edge}:force_original_aspect_ratio=decrease`, '-pix_fmt', 'rgba', out], { stdio: 'pipe' });
  return readFileSync(out);
}
function decodeRgba(png: Buffer): { w: number; h: number; px: Buffer } {
  const file = toRgbaPng(png);
  if (file.toString('ascii', 12, 16) !== 'IHDR' || file[24] !== 8 || file[25] !== 6) throw new Error('png is not 8-bit rgba');
  const w = file.readUInt32BE(16), h = file.readUInt32BE(20);
  const idat: Buffer[] = [];
  let p = 8;
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('ascii', p + 4, p + 8);
    const data = file.subarray(p + 8, p + 8 + len);
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
  let s = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[s++]; const row = px.subarray(y * stride, (y + 1) * stride); const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const x = raw[s++]; const a = i >= bpp ? row[i - bpp] : 0; const b = prev ? prev[i] : 0; const c = prev && i >= bpp ? prev[i - bpp] : 0;
      row[i] = filter === 0 ? x : filter === 1 ? (x + a) & 255 : filter === 2 ? (x + b) & 255 : filter === 3 ? (x + ((a + b) >> 1)) & 255 : filter === 4 ? (x + paeth(a, b, c)) & 255 : x;
    }
  }
  return { w, h, px };
}
function encodeRgba(w: number, h: number, px: Buffer): Buffer {
  const stride = w * 4; const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

type Rgb = [number, number, number];
function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return r > 145 && g > 85 && b > 55 && r >= g && g >= b * 0.8 && r - b < 95 && sat < 0.58;
}
function toward(r: number, g: number, b: number, target: Rgb, amount: number): [number, number, number] {
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return [
    Math.max(0, Math.min(255, Math.round(r * (1 - amount) + target[0] * L * amount))),
    Math.max(0, Math.min(255, Math.round(g * (1 - amount) + target[1] * L * amount))),
    Math.max(0, Math.min(255, Math.round(b * (1 - amount) + target[2] * L * amount))),
  ];
}
/** Recolour a colour texture. Clothing leaves skin and metal alone. Walls and roofs take the new colour and a pattern. */
export function recolourTexture(png: Buffer, kind: 'cloth' | 'wall' | 'roof' | 'body', target: Rgb, pattern: 'solid' | 'bands' | 'check'): Buffer {
  const { w, h, px } = decodeRgba(png);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3] < 8) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (kind === 'cloth' && (isSkin(r, g, b) || sat < 0.08)) continue;
    const shade = pattern === 'bands' ? (Math.floor(y / 6) % 2 === 0 ? 1 : 0.72) : pattern === 'check' ? ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 1 : 0.78) : 1;
    const next = toward(r, g, b, target, kind === 'cloth' ? 0.82 : 0.74);
    px[i] = Math.round(next[0] * shade); px[i + 1] = Math.round(next[1] * shade); px[i + 2] = Math.round(next[2] * shade);
  }
  return encodeRgba(w, h, px);
}

function stripLookOnly(value: unknown, seen = new Set<unknown>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const item of value) stripLookOnly(item, seen); return; }
  const obj = value as Record<string, unknown>;
  const ext = obj.extensions;
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    for (const key of Object.keys(ext)) if (LOOK_ONLY.has(key)) delete (ext as Record<string, unknown>)[key];
    if (!Object.keys(ext).length) delete obj.extensions;
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (Array.isArray(obj[key])) {
      obj[key] = (obj[key] as string[]).filter((name) => !LOOK_ONLY.has(name));
      if (!(obj[key] as string[]).length) delete obj[key];
    }
  }
  for (const child of Object.values(obj)) stripLookOnly(child, seen);
}

function packGlb(doc: Record<string, unknown>, bin: Buffer): Buffer {
  doc.buffers = [{ byteLength: bin.length }];
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPad = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(jsonPad);
  const binPad = Buffer.alloc(Math.ceil(bin.length / 4) * 4); bin.copy(binPad);
  const size = 28 + jsonPad.length + binPad.length;
  const glb = Buffer.alloc(size);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(size, 8);
  glb.writeUInt32LE(jsonPad.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonPad.copy(glb, 20);
  glb.writeUInt32LE(binPad.length, 20 + jsonPad.length); glb.writeUInt32LE(0x004e4942, 24 + jsonPad.length);
  binPad.copy(glb, 28 + jsonPad.length);
  return glb;
}
function readGlb(bytes: Buffer): { doc: Record<string, any>; bin: Buffer } {
  const jsonLen = bytes.readUInt32LE(12);
  return { doc: JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')), bin: Buffer.from(bytes.subarray(28 + jsonLen)) };
}
function baseColourViews(doc: Record<string, any>): number[] {
  const out: number[] = [];
  for (const material of doc.materials ?? []) {
    const index = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const source = doc.textures?.[index]?.source;
    const view = doc.images?.[source]?.bufferView;
    if (typeof view === 'number') out.push(view);
  }
  return [...new Set(out)];
}
function repackViews(doc: Record<string, any>, bin: Buffer, views: Map<number, Buffer>): Buffer {
  const parts = (doc.bufferViews as Array<{ byteOffset?: number; byteLength: number }>).map((view, index) => views.get(index) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  const chunks: Buffer[] = []; let offset = 0;
  parts.forEach((part, index) => {
    const pad = (4 - (offset % 4)) % 4; offset += pad;
    doc.bufferViews[index].byteOffset = offset; doc.bufferViews[index].byteLength = part.length; doc.bufferViews[index].buffer = 0;
    if (pad) chunks.push(Buffer.alloc(pad));
    chunks.push(part); offset += part.length;
  });
  const pad = (4 - (offset % 4)) % 4;
  return Buffer.concat([...chunks, Buffer.alloc(pad)]);
}
function finishGlb(bytes: Buffer): Buffer {
  const { doc, bin } = readGlb(bytes);
  stripLookOnly(doc);
  let packed = packGlb(doc, bin.subarray(0, doc.buffers?.[0]?.byteLength ?? bin.length));
  try { const compact = compactGlb(packed); if (compact.bytes.byteLength <= packed.length) packed = Buffer.from(compact.bytes); } catch { /* the uncompacted file already validated or will say why */ }
  validateGlb(packed);
  return packed;
}
function paintGlb(bytes: Buffer, kind: 'cloth' | 'wall' | 'roof' | 'body', target: Rgb, pattern: 'solid' | 'bands' | 'check'): Buffer {
  const { doc, bin } = readGlb(bytes);
  stripLookOnly(doc);
  const views = new Map<number, Buffer>();
  for (const index of baseColourViews(doc)) {
    const view = doc.bufferViews[index];
    const png = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    views.set(index, recolourTexture(Buffer.from(png), kind, target, pattern));
  }
  if (!views.size) {
    for (const material of doc.materials ?? []) {
      const pbr = material.pbrMetallicRoughness ?? (material.pbrMetallicRoughness = {});
      const alpha = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor[3] ?? 1 : 1;
      pbr.baseColorFactor = [target[0] / 255, target[1] / 255, target[2] / 255, alpha];
    }
    return finishGlb(packGlb(doc, bin.subarray(0, doc.buffers?.[0]?.byteLength ?? bin.length)));
  }
  return finishGlb(packGlb(doc, repackViews(doc, bin, views)));
}

async function loadZip(name: string): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(await readFile(join(ROOT, name)));
  const out = new Map<string, Uint8Array>();
  await Promise.all(Object.keys(zip.files).map(async (path) => {
    const entry = zip.files[path]; if (entry.dir) return;
    out.set(path, await entry.async('uint8array'));
  }));
  return out;
}
function zipText(files: Map<string, Uint8Array>, suffix: string): string {
  const hit = [...files.keys()].find((path) => path.endsWith(suffix));
  if (!hit) throw new Error(`missing ${suffix}`);
  return textOf(files.get(hit)!);
}

interface Kept { id: string; subjects: string[]; category: ReviewedAsset['libraryCategory']; height: number; provider: ReviewedAsset['provider']; author: string; attribution: string; revision: string; evidence: string; bytes: Buffer; animations: string[]; animationRoles?: Record<string, string>; yaw: number }
const kept: Kept[] = [];
const skipped: { pack: string; file: string; reason: string }[] = [];
const seenIds = new Set(REVIEWED_GAME_ASSETS.map((asset) => asset.id));
function takeId(base: string): string {
  let id = base.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'model';
  if (!/^[a-z]/.test(id)) id = `m-${id}`;
  let next = id; let n = 2;
  while (seenIds.has(next)) next = `${id.slice(0, 50)}-${n++}`;
  seenIds.add(next); return next;
}
function bboxHeight(bytes: Buffer): number {
  try {
    const { doc } = readGlb(bytes);
    let min = Infinity, max = -Infinity;
    for (const mesh of doc.meshes ?? []) for (const prim of mesh.primitives ?? []) {
      const acc = doc.accessors?.[prim.attributes?.POSITION];
      if (acc?.min && acc?.max) { min = Math.min(min, acc.min[1]); max = Math.max(max, acc.max[1]); }
    }
    const height = max - min;
    return Number.isFinite(height) && height > 0.05 && height < 80 ? Math.round(height * 100) / 100 : 1.6;
  } catch { return 1.6; }
}
function admit(row: Omit<Kept, 'bytes' | 'height'> & { raw: Buffer; pack: string; height?: number }): void {
  try {
    const bytes = finishGlb(row.raw);
    const stats = validateGlb(bytes);
    if (stats.bytes > ASSET_LIMITS.bytes || stats.triangles > ASSET_LIMITS.triangles) throw new Error(`over limit ${stats.bytes} ${stats.triangles}`);
    const subjects = [...new Set(row.subjects.map(subjectOf).filter((s) => /^[a-z][a-z -]{0,63}$/.test(s)))].slice(0, 16);
    if (!subjects.length) throw new Error('no subject');
    kept.push({ ...row, id: takeId(row.id), subjects, bytes, height: row.height ?? bboxHeight(bytes) });
  } catch (error) { skipped.push({ pack: row.pack, file: row.id, reason: String((error as Error).message).slice(0, 180) }); }
}

function bundleFrom(files: Map<string, Uint8Array>, gltfPath: string): Buffer {
  const json = files.get(gltfPath);
  if (!json) throw new Error('missing gltf');
  const doc = JSON.parse(textOf(json));
  // Normal and roughness maps are look-only and are what pushes a small prop over 5 MiB. The colour texture stays.
  for (const material of doc.materials ?? []) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
    const pbr = material.pbrMetallicRoughness; if (pbr) delete pbr.metallicRoughnessTexture;
  }
  const usedImages = new Set<number>();
  for (const material of doc.materials ?? []) {
    const index = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const source = doc.textures?.[index]?.source;
    if (typeof source === 'number') usedImages.add(source);
  }
  const dir = gltfPath.split('/').slice(0, -1).join('/');
  const resources = new Map<string, Uint8Array>();
  for (const buffer of doc.buffers ?? []) {
    if (!buffer.uri) continue;
    const full = `${dir}/${buffer.uri}`.replace(/\/+/g, '/');
    const hit = files.get(full) ?? files.get(decodeURIComponent(full));
    if (!hit) throw new Error(`missing ${buffer.uri}`);
    resources.set(buffer.uri, hit);
  }
  for (const source of usedImages) {
    const image = doc.images[source];
    if (!image?.uri) continue;
    const full = `${dir}/${image.uri}`.replace(/\/+/g, '/');
    const hit = files.get(full) ?? files.get(decodeURIComponent(full));
    if (!hit) throw new Error(`missing ${image.uri}`);
    let png = Buffer.from(hit);
    const wide = png.length > 33 && png.toString('ascii', 12, 16) === 'IHDR' && (png.readUInt32BE(16) > 1024 || png.readUInt32BE(20) > 1024);
    if (wide || png.length > 700_000) png = shrinkTexture(png, 1024);
    if (png.length > 1_200_000) png = shrinkTexture(png, 512);
    resources.set(image.uri, png);
  }
  // Drop images the colour doesn't use so a normal map cannot be pulled in by a stale URI.
  const usedTextures = new Set<number>();
  for (const material of doc.materials ?? []) {
    const index = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (typeof index === 'number') usedTextures.add(index);
  }
  const textureOrder = [...usedTextures];
  const textureRemap = new Map(textureOrder.map((index, next) => [index, next]));
  doc.textures = textureOrder.map((index) => doc.textures[index]);
  for (const material of doc.materials ?? []) {
    const texture = material?.pbrMetallicRoughness?.baseColorTexture;
    if (texture) texture.index = textureRemap.get(texture.index);
  }
  const order = [...usedImages];
  const remap = new Map(order.map((source, index) => [source, index]));
  doc.images = order.map((source) => doc.images[source]);
  for (const texture of doc.textures ?? []) if (remap.has(texture.source)) texture.source = remap.get(texture.source);
  stripLookOnly(doc);
  return Buffer.from(bundleGltf(Buffer.from(JSON.stringify(doc)), resources));
}

const kenney = await loadZip('kenney.zip');
const kenneyLic = zipText(kenney, 'License.txt');
if (!/Creative Commons Zero, CC0/.test(kenneyLic)) throw new Error('Kenney Retro Urban licence is not CC0');
const kenneyRev = sha(new TextEncoder().encode(kenneyLic)).slice(0, 40);
const kenneyEvidence = sha(new TextEncoder().encode(kenneyLic));
for (const [path, raw] of kenney) {
  if (!path.includes('GLB format/') || !path.endsWith('.glb')) continue;
  const base = path.split('/').pop()!.replace(/\.glb$/i, '');
  try {
    const { doc, bin } = readGlb(Buffer.from(raw));
    stripLookOnly(doc);
    const declared = doc.buffers?.[0]?.byteLength ?? bin.length;
    let body = Buffer.from(bin.subarray(0, declared));
    for (const image of doc.images ?? []) {
      if (typeof image.uri !== 'string') continue;
      const tex = kenney.get(`Models/GLB format/${image.uri}`) ?? kenney.get(`Models/GLB format/${decodeURIComponent(image.uri)}`);
      if (!tex) throw new Error(`kenney texture ${image.uri}`);
      const offset = Math.ceil(body.length / 4) * 4;
      body = Buffer.concat([body, Buffer.alloc(offset - body.length), Buffer.from(tex)]);
      image.bufferView = doc.bufferViews.length; image.mimeType = 'image/png'; delete image.uri;
      doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: tex.byteLength });
    }
    doc.buffers = [{ byteLength: body.length }];
    const category = /wall|roof|door|window|balcony|building/.test(base) ? 'building' : /car|truck|van/.test(base) ? 'vehicle-land' : /tree|grass|bush|cliff|rock/.test(base) ? 'vegetation' : 'street-prop';
    admit({ pack: 'kenney', id: `urban-${idSlug(base)}`, subjects: [subjectOf(base)], category, provider: 'kenney', author: 'Kenney', attribution: `${subjectOf(base)}: Kenney (kenney.nl), Retro Urban Kit 2.0 (${base}). CC0 1.0 Universal per License.txt in the archive.`, revision: kenneyRev, evidence: kenneyEvidence, raw: packGlb(doc, body), animations: [], yaw: 0 });
  } catch (error) { skipped.push({ pack: 'kenney', file: base, reason: String((error as Error).message).slice(0, 160) }); }
}

const nature = await loadZip('nature.zip');
const natureLic = zipText(nature, 'License_Standard.txt');
if (!/CC0 1\.0 Universal/.test(natureLic)) throw new Error('Nature MegaKit licence is not CC0');
const natureRev = sha(new TextEncoder().encode(natureLic)).slice(0, 40);
const natureEvidence = sha(new TextEncoder().encode(natureLic));
for (const path of [...nature.keys()].filter((name) => name.startsWith('glTF/') && name.endsWith('.gltf')).sort()) {
  const base = path.split('/').pop()!.replace(/\.gltf$/, '');
  try {
    const raw = bundleFrom(nature, path);
    admit({ pack: 'nature', id: `nature-${idSlug(base)}`, subjects: [subjectOf(base)], category: /tree|bush|clover|grass|plant|flower|rock|mushroom/.test(base.toLowerCase()) ? 'vegetation' : 'street-prop', provider: 'quaternius', author: 'Quaternius', attribution: `${subjectOf(base)}: Quaternius, Stylized Nature MegaKit standard (${base}). CC0 1.0 Universal per License_Standard.txt in the archive.`, revision: natureRev, evidence: natureEvidence, raw, animations: [], yaw: 0 });
  } catch (error) { skipped.push({ pack: 'nature', file: base, reason: String((error as Error).message).slice(0, 160) }); }
}

const MEDIEVAL = ['Wall_Plaster_Straight', 'Wall_Plaster_Door_Flat', 'Wall_Plaster_Window_Wide_Flat', 'Wall_UnevenBrick_Straight', 'Wall_UnevenBrick_Door_Flat', 'Wall_Arch', 'Roof_RoundTiles_4x4', 'Roof_Wooden_2x1', 'Roof_Tower_RoundTiles', 'Roof_Dormer_RoundTile', 'Door_1_Flat', 'Door_1_Round', 'Prop_Crate', 'Prop_Wagon', 'Prop_Chimney', 'Prop_WoodenFence_Single', 'Prop_MetalFence_Simple', 'Window_Wide_Flat1', 'WindowShutters_Wide_Flat_Open'];
const medieval = await loadZip('medieval.zip');
const medievalLic = zipText(medieval, 'License_Standard.txt');
if (!/CC0 1\.0 Universal/.test(medievalLic)) throw new Error('Medieval MegaKit licence is not CC0');
const medievalRev = sha(new TextEncoder().encode(medievalLic)).slice(0, 40);
const medievalEvidence = sha(new TextEncoder().encode(medievalLic));
const medievalGlb = new Map<string, Buffer>();
for (const base of MEDIEVAL) {
  const path = [...medieval.keys()].find((name) => name.endsWith(`/glTF/${base}.gltf`) || name.endsWith(`glTF/${base}.gltf`));
  if (!path) { skipped.push({ pack: 'medieval', file: base, reason: 'missing' }); continue; }
  try {
    const raw = bundleFrom(medieval, path);
    medievalGlb.set(base, raw);
    const category = /wall|roof|door|window/.test(base.toLowerCase()) ? 'building' : 'street-prop';
    admit({ pack: 'medieval', id: `village-${idSlug(base)}`, subjects: [subjectOf(base)], category, provider: 'quaternius', author: 'Quaternius', attribution: `${subjectOf(base)}: Quaternius, Medieval Village MegaKit standard (${base}). CC0 1.0 Universal per License_Standard.txt in the archive. A curated subset of the free standard pack.`, revision: medievalRev, evidence: medievalEvidence, raw, animations: [], yaw: 0 });
  } catch (error) { skipped.push({ pack: 'medieval', file: base, reason: String((error as Error).message).slice(0, 160) }); }
}

const CLOTH: Array<{ id: string; label: string; rgb: Rgb; extra?: string[] }> = [
  { id: 'saffron', label: 'saffron', rgb: [224, 122, 31], extra: ['saffron kurta'] },
  { id: 'indigo', label: 'indigo', rgb: [31, 58, 138] },
  { id: 'maroon', label: 'maroon', rgb: [122, 31, 43], extra: ['red kurta'] },
  { id: 'gold', label: 'white gold', rgb: [232, 206, 140] },
];
const WALLS: Array<{ id: string; label: string; rgb: Rgb; pattern: 'solid' | 'bands' | 'check'; extra?: string[] }> = [
  { id: 'indigo', label: 'indigo', rgb: [31, 58, 138], pattern: 'solid', extra: ['blue house'] },
  { id: 'saffron', label: 'saffron', rgb: [224, 122, 31], pattern: 'bands' },
  { id: 'forest', label: 'forest', rgb: [27, 94, 59], pattern: 'check' },
];
const ROOF: Record<string, Rgb> = { indigo: [224, 122, 31], saffron: [122, 31, 43], forest: [90, 70, 48] };

async function sourceBytes(asset: ReviewedAsset): Promise<Buffer> {
  const local = `assets/game-models/${asset.sha256}.glb`;
  if (asset.packaged || (asset.format !== 'gltf' && asset.format !== 'glb-resources' && existsSync(local))) {
    if (existsSync(local)) return Buffer.from(await readFile(local));
  }
  const json = Buffer.from(await (await fetch(asset.downloadUrl)).arrayBuffer());
  if (asset.format === 'gltf' || asset.format === 'glb-resources' || asset.downloadUrl.endsWith('.gltf')) {
    const resources = new Map<string, Uint8Array>();
    const doc = JSON.parse(json.toString('utf8'));
    const byBase = new Map((asset.resources ?? []).map((item) => [item.path.split('/').pop()!, item.url]));
    for (const uri of [...(doc.buffers ?? []), ...(doc.images ?? [])].map((item: { uri?: string }) => item.uri).filter((uri): uri is string => !!uri && !uri.startsWith('data:'))) {
      const url = byBase.get(uri.split('/').pop()!) ?? new URL(uri, asset.downloadUrl).href;
      resources.set(uri, new Uint8Array(await (await fetch(url)).arrayBuffer()));
    }
    stripLookOnly(doc);
    return Buffer.from(bundleGltf(Buffer.from(JSON.stringify(doc)), resources));
  }
  return json.length > 1024 * 1024 && asset.animations.length
    ? Buffer.from(selectGlbAnimations(json, sha(json), asset.animations.slice(0, 16)))
    : json;
}

const catalogue = new Map(REVIEWED_GAME_ASSETS.map((asset) => [asset.id, asset]));
const characters = ['library-barbarian', 'library-mage', 'library-rogue', 'library-rogue-hooded', 'k8-bowman', 'k13-ranger', 'lib4-man-a', 'lib4-woman-a', 'lib4-old-man', 'lib4-man-b', 'lib4-woman-b', 'lib4-old-woman', 'lib12-young-man', 'lib12-young-woman', 'lib12-bearded-man', 'lib12-bald-man', 'q7-villager-man', 'q7-villager-woman', 'vuena-blocky-01-hero', 'vuena-blocky-03-knight', 'vuena-blocky-05-wizard', 'vuena-blocky-06-pirate', 'vuena-blocky-07-astronaut', 'vuena-blocky-08-robot', 'vuena-blocky-09-zombie', 'vuena-blocky-19-princess'];
const buildings = ['lib2-castle', 'lib2-market', 'lib2-tavern', 'lib2-church', 'lib2-watermill', 'lib2-tower', 'lib2-barracks', 'lib12-terraced-houses', 'lib12-shop-house', 'lib12-house-with-yard', 'lib12-porch-house', 'lib12-townhouse', 'lib12-small-house', 'lib12-bungalow', 'lib12-two-storey-house', 'lib12-flat-roof-house', 'lib5-school', 'lib5-hospital', 'lib5-police-station', 'lib5-fire-station', 'lib5-bank', 'lib5-hotel', 'lib5-apartment', 'lib5-bakery', 'lib5-town-hall', 'lib5-restaurant', 'lib5-warehouse', 'lib5-supermarket', 'lib5-factory'];
const VARIANT_BUDGET = 100 * 1024 * 1024;
let variantBytes = 0;
function roomFor(bytes: number): boolean { return variantBytes + bytes <= VARIANT_BUDGET; }
async function dye(asset: ReviewedAsset, raw: Buffer, id: string, subjects: string[], kind: 'cloth' | 'wall' | 'roof' | 'body', target: Rgb, pattern: 'solid' | 'bands' | 'check', category: ReviewedAsset['libraryCategory']): Promise<void> {
  try {
    if (!roomFor(raw.length)) { skipped.push({ pack: 'variant', file: id, reason: 'variant budget' }); return; }
    const painted = paintGlb(raw, kind, target, pattern);
    if (!roomFor(painted.length)) { skipped.push({ pack: 'variant', file: id, reason: 'variant budget' }); return; }
    variantBytes += painted.length;
    admit({ pack: 'variant', id, subjects, category, provider: asset.provider, author: asset.license.author, attribution: `${subjects[0]}: recolour of ${asset.id} (${asset.license.attribution})`, revision: asset.revision.slice(0, 40), evidence: asset.review.evidenceRevision, raw: painted, animations: [...asset.animations], animationRoles: asset.animationRoles ? { ...asset.animationRoles } : undefined, yaw: asset.yaw, height: asset.height });
  } catch (error) { skipped.push({ pack: 'variant', file: id, reason: String((error as Error).message).slice(0, 160) }); }
}

for (const id of characters) {
  const asset = catalogue.get(id); if (!asset) { skipped.push({ pack: 'variant', file: id, reason: 'not in catalogue' }); continue; }
  let raw: Buffer;
  try { raw = await sourceBytes(asset); } catch (error) { skipped.push({ pack: 'variant', file: id, reason: String((error as Error).message).slice(0, 140) }); continue; }
  const primary = asset.subjects[0];
  for (const colour of CLOTH) {
    const extra = id === 'k13-ranger' || id === 'lib4-man-a' ? colour.extra ?? [] : [];
    await dye(asset, raw, `dye-${colour.id}-${idSlug(id)}`, [subjectOf(`${colour.label} ${primary}`), ...extra], 'cloth', colour.rgb, 'solid', 'character');
  }
}
for (const id of buildings) {
  const asset = catalogue.get(id); if (!asset) { skipped.push({ pack: 'variant', file: id, reason: 'not in catalogue' }); continue; }
  let raw: Buffer;
  try { raw = await sourceBytes(asset); } catch (error) { skipped.push({ pack: 'variant', file: id, reason: String((error as Error).message).slice(0, 140) }); continue; }
  const primary = asset.subjects[0];
  const roofish = /roof|tower|castle|church/.test(primary);
  for (const colour of WALLS) {
    const extra = id === 'lib12-small-house' && colour.id === 'indigo' ? colour.extra ?? [] : [];
    await dye(asset, raw, `dye-${colour.id}-${idSlug(id)}`, [subjectOf(`${colour.label} ${primary}`), ...extra], roofish ? 'roof' : 'wall', roofish ? ROOF[colour.id] : colour.rgb, colour.pattern, 'building');
  }
}
const urbanBases = kept.filter((row) => row.id.startsWith('urban-') && row.category === 'building').slice(0, 30);
for (const row of urbanBases) {
  for (const colour of WALLS) {
    const kind = row.subjects[0].includes('roof') ? 'roof' : 'wall';
    await dye({ provider: 'kenney', license: { author: 'Kenney', attribution: row.attribution, spdx: 'CC0-1.0', evidenceUrl: CC0, reviewedAt: '2026-11-23', commercial: true, redistributeInGame: true, redistributeSource: true }, review: { reviewer: 'NavBharatAI asset admission', evidenceRevision: row.evidence, freeDownload: true }, revision: row.revision, animations: [], yaw: 0, height: row.height, subjects: row.subjects, id: row.id } as ReviewedAsset, row.bytes, `dye-${colour.id}-${row.id}`, [subjectOf(`${colour.label} ${row.subjects[0]}`)], kind, kind === 'roof' ? ROOF[colour.id] : colour.rgb, colour.pattern, 'building');
  }
}
const megaBases = ['Prop_Crate', 'Prop_Wagon', 'Prop_Chimney', 'Prop_WoodenFence_Single', 'Wall_Plaster_Straight', 'Wall_UnevenBrick_Straight', 'Roof_RoundTiles_4x4', 'Roof_Wooden_2x1', 'Door_1_Flat', 'Wall_Arch'];
for (const base of megaBases) {
  const raw = medievalGlb.get(base); if (!raw) continue;
  const admitted = kept.find((row) => row.attribution.includes(`(${base})`));
  if (!admitted) continue;
  for (const colour of WALLS) {
    const kind = /roof/i.test(base) ? 'roof' : 'wall';
    await dye({ provider: 'quaternius', license: { author: 'Quaternius', attribution: admitted.attribution, spdx: 'CC0-1.0', evidenceUrl: CC0, reviewedAt: '2026-11-23', commercial: true, redistributeInGame: true, redistributeSource: true }, review: { reviewer: 'NavBharatAI asset admission', evidenceRevision: admitted.evidence, freeDownload: true }, revision: admitted.revision, animations: [], yaw: 0, height: admitted.height, subjects: admitted.subjects, id: admitted.id } as ReviewedAsset, raw, `dye-${colour.id}-village-${idSlug(base)}`, [subjectOf(`${colour.label} ${admitted.subjects[0]}`)], kind, kind === 'roof' ? ROOF[colour.id] : colour.rgb, colour.pattern, admitted.category ?? 'building');
  }
}
for (const asset of REVIEWED_GAME_ASSETS.filter((item) => item.id.startsWith('psx-car-'))) {
  const raw = await sourceBytes(asset);
  for (const colour of [{ id: 'saffron', label: 'saffron', rgb: [224, 122, 31] as Rgb }, { id: 'indigo', label: 'indigo', rgb: [31, 58, 138] as Rgb }]) {
    await dye(asset, raw, `dye-${colour.id}-${asset.id}`, [subjectOf(`${colour.label} car`), asset.subjects[0]], 'body', colour.rgb, 'solid', 'vehicle-land');
  }
}

const headroom = 300 * 1024 * 1024;
const total = catalogueStorageBytes(REVIEWED_GAME_ASSETS) + kept.reduce((sum, row) => sum + row.bytes.length, 0);
if (total > CATALOGUE_STORAGE_BUDGET_BYTES) throw new Error(`catalogue would exceed ${CATALOGUE_STORAGE_BUDGET_BYTES / 1048576} MiB (${total})`);
if (total > headroom) console.log('HEADROOM', total, 'over the 300 MiB comfort line');

await mkdir('assets/game-models', { recursive: true });
const entries: ReviewedAsset[] = [];
for (const row of kept) {
  const digest = sha(row.bytes);
  await writeFile(join('assets/game-models', `${digest}.glb`), row.bytes);
  entries.push({
    provider: row.provider, id: row.id, revision: row.revision, sourceUrl: CC0, downloadUrl: CC0, packaged: true,
    sha256: digest, bytes: row.bytes.length, libraryCategory: row.category, subjects: row.subjects, animations: row.animations,
    ...(row.animationRoles ? { animationRoles: row.animationRoles } : {}), height: row.height, yaw: row.yaw,
    downloadOrigins: ['https://creativecommons.org'],
    review: { reviewer: 'NavBharatAI asset admission', evidenceRevision: row.evidence, freeDownload: true },
    license: { spdx: 'CC0-1.0', evidenceUrl: CC0, reviewedAt: '2026-11-23', author: row.author, attribution: row.attribution, commercial: true, redistributeInGame: true, redistributeSource: true },
  });
}
const body = `import type { ReviewedAsset } from './providers';\n/** Colour packs and recolours admitted 2026-11-23. Generated by scripts/library/buildColourPack.mts. */\nexport const REVIEWED_LIBRARY_BATCH_14: readonly ReviewedAsset[] = ${JSON.stringify(entries, null, 2)};\n`;
await writeFile('src/server/AgentV3/gameAssets/reviewedLibraryBatch14.ts', body);
const report = {
  checkedAt: '2026-11-23', added: entries.length, skipped,
  counts: {
    urban: entries.filter((entry) => entry.id.startsWith('urban-')).length,
    nature: entries.filter((entry) => entry.id.startsWith('nature-')).length,
    village: entries.filter((entry) => entry.id.startsWith('village-')).length,
    dye: entries.filter((entry) => entry.id.startsWith('dye-')).length,
  },
  bytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
  variantBytes, totalWithCatalogue: total,
};
await mkdir('docs/game-engine/asset-candidates', { recursive: true });
await writeFile('docs/game-engine/asset-candidates/library-batch-14.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ counts: report.counts, bytes: report.bytes, variantBytes, total, skipped: skipped.length }, null, 2));
console.log(skipped.slice(0, 30));

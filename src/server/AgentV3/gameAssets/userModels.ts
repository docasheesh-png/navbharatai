/**
 * THE USER'S OWN 3D MODELS INTO THEIR GAME (admin 2026-11-20: "user koi apna module add karna ho to bhi kar sake —
 * attach file → zip ya jo bhi file ho, woh navbharatai me user ke game me blend/merge/sync ho").
 *
 * 🔴 WHAT WAS THERE. A .glb attached in Pro went to private storage with a receipt telling the builder NOT to use it as
 * an app asset; a .zip was always a whole-project import (refused once the chat held an app), and its .glb entries were
 * read as TEXT, corrupting them. So a user could not put their own character or car into their own game at all.
 *
 * 🧬 WHAT THIS DOES (pure, no network, no native code):
 *   - takes model files attached loose or inside a zip of models (`zipIsModelPack` tells a model pack from a project),
 *   - turns each into ONE self-contained GLB: .glb as is; .gltf with its .bin and textures bundled; .obj with its .mtl
 *     colours and textures converted; .fbx is refused with the exact export step (no converter we can trust yet),
 *   - checks it with the same validator as the library, at a user's larger limits (12 MB, 200k triangles, 4096 px
 *     textures, material-only extensions; external files and compressed geometry stay refused — the game could not load them),
 *   - names it by its file name, lands it at public/models/<name>.glb, and tells the builder exactly how to use it
 *     (assetCustomizations.ts `source`, or a plain GLTFLoader for a game without the kit) with its parts and animations,
 *     so every part stays changeable in plain words like the library's.
 * A model that cannot be used is never dropped silently: each one comes back with a plain reason.
 */
import { createHash } from 'node:crypto';
import { validateGlb, type GlbLimits } from './assetPolicy';
import { bundleGltf, safeGltfResourcePath } from './gltfBundle';
import type { GameAssetPersistence } from './assetProject';

export const USER_MODEL_LIMITS: GlbLimits = Object.freeze({
  // 8 MB: the workspace store keeps a file this size durably (a 12 MB data URI ≈ 9 MB of bytes); a larger limit would
  // accept a model that silently vanishes on the next sandbox recycle.
  bytes: 8 * 1024 * 1024, triangles: 200_000, nodes: 2048, meshes: 512, animations: 256,
  texturePixels: 4096 * 4096, totalTexturePixels: 16 * 2048 * 2048,
});
/** Extensions that only change how a surface looks; three.js GLTFLoader reads every one without an extra decoder. */
export const USER_MODEL_EXTENSIONS: readonly string[] = Object.freeze([
  'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_materials_specular', 'KHR_materials_ior',
  'KHR_materials_transmission', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_volume', 'KHR_lights_punctual',
]);
export const USER_MODELS_DIR = 'public/models';
export const USER_MODEL_MAX_COUNT = 8;
const ZIP_MAX_ENTRIES = 500;
const ZIP_MAX_DECLARED_BYTES = 80 * 1024 * 1024;

const MODEL_EXT = /\.(glb|gltf|obj|fbx)$/i;
const PROJECT_MARKER = /(^|\/)(package\.json|index\.html?|vite\.config\.[cm]?[jt]s|tsconfig\.json)$/i;

export interface UserModel {
  /** The file it came from, as the user named it (inside a zip: its path there). */
  from: string;
  /** The name the game uses for it — from the file name: "Hero Car.glb" → "hero-car". */
  subject: string;
  path: string;
  bytes: Uint8Array;
  sha256: string;
  triangles: number;
  animations: string[];
  materials: string[];
  parts: string[];
  /** What was left out so it could load (a missing texture) — always told to the user. */
  warnings: string[];
}
export interface UserModelRefusal { from: string; reason: string }

/** Is this a 3D model file a game can take (by name)? PURE. */
export function isModelFileName(name: unknown): boolean {
  return typeof name === 'string' && MODEL_EXT.test(name);
}

/** A file name as a game subject: lower-case words joined by "-", never empty, never a path. PURE. */
export function userModelSubject(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '');
  const slug = stem.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'model';
}

type ZipLike = { forEach(cb: (path: string, entry: { dir: boolean; name: string; async(t: 'uint8array'): Promise<Uint8Array>; _data?: { uncompressedSize?: number } }) => void): void };
async function loadZip(buf: Uint8Array): Promise<ZipLike> {
  const JSZip = (await import('jszip')).default;
  return await JSZip.loadAsync(buf) as unknown as ZipLike;
}

/**
 * A zip that holds 3D models and no app (no package.json / index.html / vite or ts config) is a MODEL PACK: it is merged
 * into the current game, not imported as a project. A zip with both is a project — the existing import path. PURE+async.
 */
export async function zipIsModelPack(buf: Uint8Array): Promise<boolean> {
  let zip: ZipLike;
  try { zip = await loadZip(buf); } catch { return false; }
  let model = false; let project = false; let entries = 0;
  zip.forEach((path, entry) => {
    if (entry.dir || ++entries > ZIP_MAX_ENTRIES) return;
    if (/(^|\/)(__MACOSX|node_modules)\//.test(path)) return;
    if (PROJECT_MARKER.test(path)) project = true;
    if (MODEL_EXT.test(path)) model = true;
  });
  return model && !project;
}

/** Path inside a pack: forward slashes, no "..", no absolute root. Null when unsafe. PURE. */
function safePackPath(raw: string): string | null {
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  return parts.some(s => s === '' || s === '..') ? null : parts.join('/');
}

/**
 * Every file of the attached models as one map, path → bytes: loose attachments by their names, and each model-pack
 * zip's entries under their paths (a single shared root folder stripped). Bounded against archive bombs.
 */
export async function userModelFilesFromAttachments(atts: ReadonlyArray<{ name?: unknown; base64?: unknown }>): Promise<{ files: Map<string, Uint8Array>; refused: UserModelRefusal[] }> {
  const files = new Map<string, Uint8Array>(); const refused: UserModelRefusal[] = [];
  for (const a of atts ?? []) {
    const name = typeof a?.name === 'string' ? a.name : '';
    if (typeof a?.base64 !== 'string' || !a.base64) continue;
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(Buffer.from(a.base64.replace(/^data:[^,]*,/, ''), 'base64')); } catch { continue; }
    if (/\.zip$/i.test(name)) {
      let zip: ZipLike;
      try { zip = await loadZip(bytes); } catch { refused.push({ from: name, reason: 'this zip could not be opened' }); continue; }
      const entries: Array<{ path: string; entry: Parameters<Parameters<ZipLike['forEach']>[0]>[1] }> = [];
      let declared = 0; let bomb = false;
      zip.forEach((path, entry) => {
        if (entry.dir || bomb) return;
        if (entries.length >= ZIP_MAX_ENTRIES) { bomb = true; return; }
        declared += Math.max(0, Number(entry._data?.uncompressedSize) || 0);
        if (declared > ZIP_MAX_DECLARED_BYTES) { bomb = true; return; }
        const safe = safePackPath(path);
        if (safe && !/(^|\/)__MACOSX\//.test(safe)) entries.push({ path: safe, entry });
      });
      if (bomb) { refused.push({ from: name, reason: `this zip is too big to unpack safely (more than ${ZIP_MAX_ENTRIES} files or ${ZIP_MAX_DECLARED_BYTES / 1024 / 1024} MB)` }); continue; }
      const roots = new Set(entries.map(e => e.path.split('/')[0]));
      const strip = entries.length > 1 && roots.size === 1 && entries.every(e => e.path.includes('/')) ? [...roots][0].length + 1 : 0;
      for (const e of entries) {
        const data = await e.entry.async('uint8array');
        if (data.byteLength > USER_MODEL_LIMITS.bytes * 2) continue; // far beyond any model this can take
        files.set(e.path.slice(strip), data);
      }
    } else {
      const safe = safePackPath(name.replace(/\\/g, '/').split('/').pop() ?? '');
      if (safe) files.set(safe, bytes);
    }
  }
  return { files, refused };
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
/** A resource named by a model, looked up next to it, then anywhere in the pack by base name (exporters flatten folders). */
function findResource(files: ReadonlyMap<string, Uint8Array>, modelPath: string, uri: string): Uint8Array | undefined {
  let rel: string;
  try { rel = decodeURIComponent(uri); } catch { rel = uri; }
  rel = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const near = files.get(dirOf(modelPath) + rel); if (near) return near;
  const base = rel.split('/').pop()!.toLowerCase();
  for (const [p, b] of files) if (p.split('/').pop()!.toLowerCase() === base) return b;
  return undefined;
}

/**
 * glTF + its .bin and textures → one GLB (the library's bundler, at a user's limits). A missing BUFFER refuses the model
 * (there is no geometry without it). A missing TEXTURE does not: exporters often name a normal or roughness map they
 * never shipped, so that picture is left out — its textures and the material slots that used them are removed — and the
 * model arrives without it, with a warning the user is told about.
 */
function gltfToGlb(files: ReadonlyMap<string, Uint8Array>, path: string, json: Uint8Array, warnings: string[]): Uint8Array {
  type Doc = { buffers?: { uri?: string }[]; images?: { uri?: string }[]; textures?: { source?: number }[]; materials?: Record<string, unknown>[] };
  let doc: Doc;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); } catch { throw new UserModelError('the .gltf file is not valid JSON'); }
  const resources = new Map<string, Uint8Array>();
  const look = (uri: string): Uint8Array | undefined => {
    if (uri.startsWith('data:')) throw new UserModelError('it embeds its data inside the .gltf text — export it as a single .glb file instead');
    if (!safeGltfResourcePath(uri)) throw new UserModelError(`it points to a file outside its own folder (${uri.slice(0, 60)})`);
    return findResource(files, path, uri);
  };
  for (const b of doc.buffers ?? []) {
    if (typeof b?.uri !== 'string') continue;
    const bytes = look(b.uri);
    if (!bytes) throw new UserModelError(`a file it needs is missing: ${b.uri.slice(0, 80)} — attach it too, or put everything in one zip`);
    resources.set(b.uri, bytes);
  }
  const dropped = new Set<number>();
  (doc.images ?? []).forEach((img, i) => {
    if (typeof img?.uri !== 'string') return;
    const bytes = look(img.uri);
    if (bytes) resources.set(img.uri, bytes); else { dropped.add(i); warnings.push(`its texture ${img.uri.slice(0, 80)} was not in the files, so the model is shown without it`); }
  });
  if (dropped.size) {
    const imageMap = new Map<number, number>(); let n = 0;
    (doc.images ?? []).forEach((_, i) => { if (!dropped.has(i)) imageMap.set(i, n++); });
    doc.images = (doc.images ?? []).filter((_, i) => !dropped.has(i));
    const textureMap = new Map<number, number>(); let t = 0;
    const kept = (doc.textures ?? []).filter((tex, i) => { const ok = tex?.source === undefined || imageMap.has(tex.source); if (ok) textureMap.set(i, t++); return ok; });
    for (const tex of kept) if (tex.source !== undefined) tex.source = imageMap.get(tex.source);
    doc.textures = kept;
    // Every material slot is a { index } under a key ending in "Texture": keep it renumbered, or remove it.
    const fix = (o: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(o)) {
        if (!value || typeof value !== 'object') continue;
        const info = value as Record<string, unknown>;
        if (/Texture$/.test(key) && typeof info.index === 'number') { const to = textureMap.get(info.index); if (to === undefined) delete o[key]; else info.index = to; }
        else fix(info);
      }
    };
    for (const m of doc.materials ?? []) fix(m);
    if (!doc.images.length) { delete doc.images; delete doc.textures; }
  }
  return bundleGltf(new TextEncoder().encode(JSON.stringify(doc)), resources, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS);
}

class UserModelError extends Error {}

/** A plain reason for a refused model, from the validator's code. PURE. */
export function userModelRefusalReason(error: unknown, bytes?: number): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UserModelError) return message;
  // "size" also means TOO SMALL to be a model: only a file really over the limit is told it is too big.
  if (/byte budget|exceeds budget/.test(message) || (/: size$/.test(message) && (bytes ?? 0) > USER_MODEL_LIMITS.bytes)) return `it is larger than ${USER_MODEL_LIMITS.bytes / 1024 / 1024} MB — reduce its textures or polygons and attach it again`;
  if (/triangle|geometry work budget/.test(message)) return `it has more than ${USER_MODEL_LIMITS.triangles.toLocaleString('en-US')} triangles, too heavy for phones — reduce it (Blender: Modifiers → Decimate) and attach it again`;
  if (/references or extensions/.test(message)) return 'it uses compressed geometry (Draco/Meshopt) or files outside itself, which the game cannot load — export it as a plain .glb without compression';
  if (/texture budget/.test(message)) return 'its textures are larger than 4096 px — resize them and attach it again';
  if (/resource|URI/.test(message)) return 'a file it needs is missing or outside its folder — attach everything in one zip';
  return 'it is not a valid 3D model file the game can load (' + message.replace(/^Unsafe GLB: /, '').slice(0, 80) + ')';
}

/** Names of materials and of mesh nodes, for the builder's note: what the user can recolour or hide. PURE. */
function glbParts(glb: Uint8Array): { materials: string[]; parts: string[] } {
  const b = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
  const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { materials?: { name?: string }[]; nodes?: { name?: string; mesh?: number }[] };
  const named = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, 40);
  return { materials: named((doc.materials ?? []).map(m => m.name)), parts: named((doc.nodes ?? []).filter(n => n.mesh !== undefined).map(n => n.name)) };
}

/**
 * Every model in the files → a checked GLB, or a plain refusal. Resources (.bin, .mtl, textures) are used by the model
 * that names them and are never models themselves. At most USER_MODEL_MAX_COUNT models per message. PURE.
 */
export function userModelsFromFiles(files: ReadonlyMap<string, Uint8Array>, taken: ReadonlySet<string> = new Set()): { models: UserModel[]; refused: UserModelRefusal[] } {
  const models: UserModel[] = []; const refused: UserModelRefusal[] = [];
  const used = new Set(taken);
  const paths = [...files.keys()].filter(p => MODEL_EXT.test(p)).sort();
  for (const from of paths) {
    if (models.length >= USER_MODEL_MAX_COUNT) { refused.push({ from, reason: `only ${USER_MODEL_MAX_COUNT} models are added per message — attach the rest in the next one` }); continue; }
    const raw = files.get(from)!; const warnings: string[] = [];
    try {
      let glb: Uint8Array;
      if (/\.glb$/i.test(from)) glb = raw;
      else if (/\.gltf$/i.test(from)) glb = gltfToGlb(files, from, raw, warnings);
      else if (/\.obj$/i.test(from)) glb = objToGlb(files, from, raw);
      // An .fbx reaches here only when it was not converted first (convertFbxFiles runs before this in planUserModels).
      else throw new UserModelError('this FBX was not converted — open it in Blender and use File → Export → glTF 2.0 (.glb), then attach the .glb');
      const checked = validateGlb(glb, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS);
      let subject = userModelSubject(from);
      for (let i = 2; used.has(subject); i++) subject = `${userModelSubject(from)}-${i}`;
      used.add(subject);
      models.push({ from, subject, path: `${USER_MODELS_DIR}/${subject}.glb`, bytes: glb, sha256: createHash('sha256').update(glb).digest('hex'),
        triangles: checked.triangles, animations: checked.animations.filter(Boolean), ...glbParts(glb), warnings });
    } catch (error) {
      refused.push({ from, reason: userModelRefusalReason(error, raw.byteLength) });
    }
  }
  return { models, refused };
}

// ───────────────────────────── OBJ (+MTL) → GLB ─────────────────────────────
// Positions, texture coordinates, normals (computed when the file has none), n-gon faces (fan), one primitive per
// material; MTL diffuse colour, opacity and diffuse texture (PNG/JPEG). That is what an OBJ export from Blender, Kenney or
// Quaternius carries. Never reads a path outside the attached files.

interface ObjMaterial { color: [number, number, number, number]; texture?: Uint8Array }

function parseMtl(text: string, files: ReadonlyMap<string, Uint8Array>, mtlPath: string): Map<string, ObjMaterial> {
  const out = new Map<string, ObjMaterial>(); let cur: ObjMaterial | null = null;
  for (const line of text.split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'newmtl') { cur = { color: [0.8, 0.8, 0.8, 1] }; out.set(rest.join(' '), cur); }
    else if (!cur) continue;
    else if (key === 'Kd') { const [r, g, b] = rest.map(Number); if ([r, g, b].every(Number.isFinite)) cur.color = [r, g, b, cur.color[3]]; }
    else if (key === 'd') { const d = Number(rest[0]); if (Number.isFinite(d)) cur.color[3] = Math.min(1, Math.max(0, d)); }
    else if (key === 'Tr') { const t = Number(rest[0]); if (Number.isFinite(t)) cur.color[3] = Math.min(1, Math.max(0, 1 - t)); }
    else if (key === 'map_Kd') {
      const file = rest.filter(t => !t.startsWith('-')).pop();
      const bytes = file ? findResource(files, mtlPath, file) : undefined;
      if (bytes && ((bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8))) cur.texture = bytes;
    }
  }
  return out;
}

function objToGlb(files: ReadonlyMap<string, Uint8Array>, path: string, raw: Uint8Array): Uint8Array {
  const text = new TextDecoder('utf-8').decode(raw);
  const v: number[] = []; const vt: number[] = []; const vn: number[] = [];
  const groups = new Map<string, { keys: Map<string, number>; pos: number[]; uv: number[]; nrm: number[]; idx: number[]; hasNormals: boolean }>();
  let mtlName = ''; let mtlFile = '';
  const group = (name: string) => { let g = groups.get(name); if (!g) { g = { keys: new Map(), pos: [], uv: [], nrm: [], idx: [], hasNormals: true }; groups.set(name, g); } return g; };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t[0] === '#') continue;
    const parts = t.split(/\s+/); const key = parts[0];
    if (key === 'v') v.push(+parts[1], +parts[2], +parts[3]);
    else if (key === 'vt') vt.push(+parts[1], +(parts[2] ?? 0));
    else if (key === 'vn') vn.push(+parts[1], +parts[2], +parts[3]);
    else if (key === 'usemtl') mtlName = parts.slice(1).join(' ');
    else if (key === 'mtllib') mtlFile = parts.slice(1).join(' ');
    else if (key === 'f') {
      const g = group(mtlName);
      const corner = (tok: string): number => {
        const known = g.keys.get(tok); if (known !== undefined) return known;
        const [a, b, c] = tok.split('/');
        const at = (s: string | undefined, n: number) => { if (!s) return -1; const i = parseInt(s, 10); return i < 0 ? n + i : i - 1; };
        const pi = at(a, v.length / 3), ti = at(b, vt.length / 2), ni = at(c, vn.length / 3);
        if (pi < 0 || pi * 3 + 2 >= v.length) throw new UserModelError('the .obj file refers to a vertex it does not have');
        const id = g.pos.length / 3;
        g.pos.push(v[pi * 3], v[pi * 3 + 1], v[pi * 3 + 2]);
        g.uv.push(ti >= 0 && ti * 2 + 1 < vt.length ? vt[ti * 2] : 0, ti >= 0 && ti * 2 + 1 < vt.length ? 1 - vt[ti * 2 + 1] : 0);
        if (ni >= 0 && ni * 3 + 2 < vn.length) g.nrm.push(vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]); else { g.nrm.push(0, 0, 0); g.hasNormals = false; }
        g.keys.set(tok, id); return id;
      };
      const ids = parts.slice(1).map(corner);
      for (let i = 1; i + 1 < ids.length; i++) g.idx.push(ids[0], ids[i], ids[i + 1]);
      if (g.idx.length > USER_MODEL_LIMITS.triangles * 3) throw new UserModelError(`it has more than ${USER_MODEL_LIMITS.triangles.toLocaleString('en-US')} triangles, too heavy for phones — reduce it and attach it again`);
    }
  }
  if (!groups.size) throw new UserModelError('the .obj file has no faces');
  const mtlBytes = mtlFile ? findResource(files, path, mtlFile) : undefined;
  const materials = mtlBytes ? parseMtl(new TextDecoder('utf-8').decode(mtlBytes), files, path) : new Map<string, ObjMaterial>();

  const chunks: Buffer[] = []; let offset = 0;
  const views: Record<string, number>[] = []; const accessors: Record<string, unknown>[] = [];
  const add = (bytes: Buffer, target?: number) => {
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); bytes.copy(padded);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(padded); offset += padded.length; return views.length - 1;
  };
  const f32 = (xs: number[]) => Buffer.from(new Float32Array(xs).buffer);
  const images: Record<string, unknown>[] = []; const textures: Record<string, unknown>[] = []; const gltfMaterials: Record<string, unknown>[] = [];
  const primitives: Record<string, unknown>[] = [];
  for (const [name, g] of groups) {
    if (!g.idx.length) continue;
    if (!g.hasNormals) { // area-weighted vertex normals, so the model is lit instead of black
      g.nrm.fill(0);
      for (let i = 0; i < g.idx.length; i += 3) {
        const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
        const e1 = [0, 1, 2].map(k => g.pos[b * 3 + k] - g.pos[a * 3 + k]); const e2 = [0, 1, 2].map(k => g.pos[c * 3 + k] - g.pos[a * 3 + k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        for (const id of [a, b, c]) for (let k = 0; k < 3; k++) g.nrm[id * 3 + k] += n[k];
      }
    }
    for (let i = 0; i < g.nrm.length; i += 3) {
      const l = Math.hypot(g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]);
      if (l > 0 && Number.isFinite(l)) { g.nrm[i] /= l; g.nrm[i + 1] /= l; g.nrm[i + 2] /= l; } else { g.nrm[i] = 0; g.nrm[i + 1] = 1; g.nrm[i + 2] = 0; }
    }
    // A loop, not Math.min(...array): a big model would overflow the call stack.
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.pos.length; i++) { const k = i % 3; if (!Number.isFinite(g.pos[i])) throw new UserModelError('the .obj file has a broken vertex'); if (g.pos[i] < min[k]) min[k] = g.pos[i]; if (g.pos[i] > max[k]) max[k] = g.pos[i]; }
    const count = g.pos.length / 3;
    const pos = accessors.push({ bufferView: add(f32(g.pos), 34962), componentType: 5126, count, type: 'VEC3', min, max }) - 1;
    const nrm = accessors.push({ bufferView: add(f32(g.nrm), 34962), componentType: 5126, count, type: 'VEC3' }) - 1;
    const uv = accessors.push({ bufferView: add(f32(g.uv), 34962), componentType: 5126, count, type: 'VEC2' }) - 1;
    const idx = accessors.push({ bufferView: add(Buffer.from(new Uint32Array(g.idx).buffer), 34963), componentType: 5125, count: g.idx.length, type: 'SCALAR' }) - 1;
    const m = materials.get(name) ?? { color: [0.8, 0.8, 0.8, 1] as [number, number, number, number] };
    const material: Record<string, unknown> = { name: name || 'Material', pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: 0, roughnessFactor: 1 }, ...(m.color[3] < 1 ? { alphaMode: 'BLEND' } : {}) };
    if (m.texture) {
      const jpeg = m.texture[0] === 0xff;
      images.push({ bufferView: add(Buffer.from(m.texture)), mimeType: jpeg ? 'image/jpeg' : 'image/png' });
      textures.push({ source: images.length - 1, sampler: 0 });
      (material.pbrMetallicRoughness as Record<string, unknown>).baseColorTexture = { index: textures.length - 1 };
      (material.pbrMetallicRoughness as Record<string, unknown>).baseColorFactor = [1, 1, 1, m.color[3]];
    }
    gltfMaterials.push(material);
    primitives.push({ attributes: { POSITION: pos, NORMAL: nrm, TEXCOORD_0: uv }, indices: idx, material: gltfMaterials.length - 1 });
  }
  const doc: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'NavBharatAI OBJ import' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: userModelSubject(path), mesh: 0 }], meshes: [{ name: userModelSubject(path), primitives }],
    materials: gltfMaterials, accessors, bufferViews: views, buffers: [{ byteLength: offset }],
    ...(images.length ? { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
  };
  const json = Buffer.from(JSON.stringify(doc)); const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(paddedJson);
  const size = 28 + paddedJson.length + offset;
  if (size > USER_MODEL_LIMITS.bytes) throw new UserModelError(`it is larger than ${USER_MODEL_LIMITS.bytes / 1024 / 1024} MB once converted — reduce its textures or polygons`);
  const glb = Buffer.alloc(size);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(size, 8);
  glb.writeUInt32LE(paddedJson.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); paddedJson.copy(glb, 20);
  glb.writeUInt32LE(offset, 20 + paddedJson.length); glb.writeUInt32LE(0x004e4942, 24 + paddedJson.length);
  Buffer.concat(chunks, offset).copy(glb, 28 + paddedJson.length);
  return new Uint8Array(glb);
}

/** What the builder is told: each model's name, file, size, parts and animations, and how to put it in the game. PURE. */
export function userModelNote(models: readonly UserModel[], refused: readonly UserModelRefusal[]): string {
  if (!models.length && !refused.length) return '';
  const lines: string[] = [];
  if (models.length) {
    lines.push(`[USER MODELS ADDED] The user attached their own 3D models; each is now a checked, self-contained file in this project. Put them in the game the user asked for, as the user's own — not as a library model:`);
    for (const m of models) {
      lines.push(`- "${m.subject}" → ${m.path} (from ${JSON.stringify(m.from)}; ${m.triangles.toLocaleString('en-US')} triangles; sha256 ${m.sha256}`
        + `${m.animations.length ? `; animations: ${m.animations.slice(0, 24).map(a => JSON.stringify(a)).join(', ')}` : '; no animations'}`
        + `${m.materials.length ? `; materials: ${m.materials.slice(0, 16).join(', ')}` : ''}${m.parts.length ? `; parts: ${m.parts.slice(0, 16).join(', ')}` : ''}${m.warnings.length ? `; tell the user: ${m.warnings.slice(0, 4).join('; ')}` : ''})`);
    }
    lines.push(`HOW: in a game with src/game/three/assetCustomizations.ts, add an entry per model, e.g. ${models[0].subject}: { source: { file: '${models[0].path}', sha256: '${models[0].sha256}' } }, then load it with loadRequestedAsset('${models[0].subject}', fallback) like any other model; recolour a part with colors: { <material>: '#rrggbb' }, hide one with hide: [<part>], pick a clip with animation / roles. In any other three.js game, load '/${models[0].path.replace(/^public\//, '')}' with GLTFLoader. Never rewrite these files; if the user asks for a change, change it in code.`);
  }
  if (refused.length) lines.push(`[USER MODELS NOT ADDED] Tell the user plainly, in their language, which file and why: ${refused.slice(0, 12).map(r => `${JSON.stringify(r.from)}: ${r.reason}`).join(' · ')}`);
  return lines.join('\n');
}

const LOOSE_RESOURCE = /\.(bin|mtl)$/i;
const TEXTURE = /\.(png|jpe?g)$/i;
/**
 * Which attachments are the user's models. A loose model file (.glb/.gltf/.obj/.fbx) or a model-pack zip makes this a
 * model message: the models, their .bin/.mtl, and — only then — their pictures (textures, not a design to copy) go to the
 * model path; everything else keeps its existing path (documents, a project zip, a mockup without a model).
 */
export async function splitUserModelAttachments<T extends { name?: unknown; base64?: unknown }>(atts: readonly T[]): Promise<{ models: T[]; rest: T[] }> {
  const name = (a: T) => (typeof a?.name === 'string' ? a.name : '');
  const packs = new Set<T>();
  for (const a of atts) {
    if (!/\.zip$/i.test(name(a)) || typeof a.base64 !== 'string') continue;
    try { if (await zipIsModelPack(new Uint8Array(Buffer.from(a.base64.replace(/^data:[^,]*,/, ''), 'base64')))) packs.add(a); } catch { /* not a pack */ }
  }
  const loose = atts.some(a => isModelFileName(name(a)));
  if (!loose && !packs.size) return { models: [], rest: [...atts] };
  const isModelPart = (a: T) => packs.has(a) || isModelFileName(name(a)) || LOOSE_RESOURCE.test(name(a)) || (loose && TEXTURE.test(name(a)));
  return { models: atts.filter(isModelPart), rest: atts.filter(a => !isModelPart(a)) };
}

/**
 * Put checked models into the project: durable bytes first, an exact read-back second, the live sandbox last — the
 * library's order, so a model is never reported added and then lost on the next sandbox recycle. Each failure is named.
 */
export async function landUserModels(models: readonly UserModel[], workspaceId: string,
  workspace: { writeBinaryFile(workspaceId: string, path: string, base64: string): Promise<void> },
  store: Pick<GameAssetPersistence, 'saveBinary' | 'readBinary'>): Promise<{ landed: UserModel[]; failed: UserModelRefusal[] }> {
  const landed: UserModel[] = []; const failed: UserModelRefusal[] = [];
  for (const m of models) {
    try {
      const base64 = Buffer.from(m.bytes).toString('base64');
      await store.saveBinary(workspaceId, { [m.path]: `data:model/gltf-binary;base64,${base64}` });
      const saved = await store.readBinary(workspaceId, m.path, USER_MODEL_LIMITS.bytes);
      if (!saved || createHash('sha256').update(saved).digest('hex') !== m.sha256) throw new Error('not saved');
      await workspace.writeBinaryFile(workspaceId, m.path, base64);
      landed.push(m);
    } catch {
      failed.push({ from: m.from, reason: 'it could not be saved into the project this time — attach it again in a moment' });
    }
  }
  return { landed, failed };
}

/** Everything the chat handler needs before routing, in ONE call (the handler is at its branch budget, Q-979 / TS2563). */
export async function planUserModels<T extends { name?: unknown; base64?: unknown }>(atts: readonly T[]): Promise<{ rest: T[]; attached: boolean; models: UserModel[]; refused: UserModelRefusal[]; pendingNote: string }> {
  const split = await splitUserModelAttachments(atts);
  if (!split.models.length) return { rest: split.rest, attached: false, models: [], refused: [], pendingNote: '' };
  const files = await userModelFilesFromAttachments(split.models);
  const fbx = await convertFbxFiles(files.files);
  const plan = userModelsFromFiles(fbx.files);
  for (const m of plan.models) { const w = fbx.warnings.get(m.from); if (w) { m.warnings.push(...w); m.from = m.from.replace(/\.glb$/i, '.fbx'); } }
  const refused = [...files.refused, ...fbx.refused, ...plan.refused];
  // Until they are really in the project, the note says only that they were attached (a chat answer writes nothing).
  const pendingNote = `[USER MODELS ATTACHED] ${plan.models.length} 3D model(s) the user attached (${plan.models.map(m => JSON.stringify(m.from)).slice(0, 8).join(', ') || 'none usable'}) are added to the project when the game is built or edited in this turn — not before.`
    + (refused.length ? ` Not usable: ${refused.slice(0, 8).map(r => `${JSON.stringify(r.from)}: ${r.reason}`).join(' · ')}` : '');
  return { rest: split.rest, attached: true, models: plan.models, refused, pendingNote };
}

type LandIssue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };
/**
 * On the build path, once the workspace exists: land the planned models inside the caller's timed step, record the
 * outcome, and return the attachment context with the pending note replaced by what REALLY landed. One call, no branch
 * in the handler. Never throws: a failure is a named "not added", never a claimed success.
 */
export async function landPlannedUserModels(
  plan: { attached: boolean; models: readonly UserModel[]; refused: readonly UserModelRefusal[]; pendingNote: string },
  context: string,
  io: {
    workspaceId: string;
    actuator: { writeBinaryFile?: (workspaceId: string, path: string, base64: string) => Promise<void> };
    store: Pick<GameAssetPersistence, 'saveBinary' | 'readBinary'>;
    step: (label: string, run: () => Promise<unknown>) => Promise<unknown>;
    record: (issue: LandIssue) => void;
  },
): Promise<string> {
  if (!plan.attached) return context;
  const notSaved = (reason: string) => plan.models.map(m => ({ from: m.from, reason }));
  let landing: { landed: UserModel[]; failed: UserModelRefusal[] } = { landed: [], failed: notSaved('it could not be saved into the project this time — attach it again in a moment') };
  const write = io.actuator.writeBinaryFile;
  try {
    await io.step('user models', async () => {
      landing = typeof write === 'function'
        ? await landUserModels(plan.models, io.workspaceId, { writeBinaryFile: (id, p, b) => write.call(io.actuator, id, p, b) }, io.store)
        : { landed: [], failed: notSaved('this project cannot take binary files right now') };
    });
  } catch { /* landing keeps its "not saved" default */ }
  const notAdded = [...plan.refused, ...landing.failed];
  try {
    io.record(landing.landed.length && !notAdded.length
      ? { phase: 'build', severity: 'info', code: 'USER_MODELS_ADDED', autoResolved: true, message: `The user's own 3D model(s) were added to the project: ${landing.landed.map(m => m.path).join(', ')}.` }
      : { phase: 'build', severity: 'warning', code: 'USER_MODELS_NOT_ALL_ADDED', autoResolved: false, message: `Added: ${landing.landed.map(m => m.path).join(', ') || 'none'}. Not added: ${notAdded.map(r => `${r.from} (${r.reason})`).join('; ')}.` });
  } catch { /* observation only */ }
  const real = userModelNote(landing.landed, notAdded);
  return plan.pendingNote && context.includes(plan.pendingNote) ? context.replace(plan.pendingNote, real) : [context, real].filter(Boolean).join('\n\n');
}

// ───────────────────────────── FBX → GLB (server, no browser, no native code) ─────────────────────────────
// Admin 2026-11-20: "FBX file seedha lena … ok banao". three.js's own FBXLoader parses FBX (binary and ASCII) in Node;
// its GLTFExporter writes the GLB with skin and animations. Two defects found converting real packs are fixed here too:
// FBXLoader reads some packs' TransparencyFactor as fully transparent (the model exported invisible), and FBX keeps one
// group per polygon run (a cow became 106 primitives, over the validator's 64). Node cannot decode pictures, so an FBX's
// textures are not carried over — the model keeps its colours and the user is told, with the .glb route for the full look.
const FBX_MAX_BYTES = 25 * 1024 * 1024;

/** GLTFExporter reads its own Blob through FileReader, which Node does not have. Only what it calls, installed once. */
function ensureFileReader(): void {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  g.FileReader = class {
    result: ArrayBuffer | string | null = null;
    onloadend: ((this: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob) { blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.call(this); }, e => this.onerror?.(e)); }
    readAsDataURL(blob: Blob) { blob.arrayBuffer().then(b => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.call(this); }, e => this.onerror?.(e)); }
  };
}

/** One FBX → GLB bytes, or a plain refusal. Warnings say what did not come across. */
export async function fbxToGlb(bytes: Uint8Array, warnings: string[], files: ReadonlyMap<string, Uint8Array> = new Map(), fbxPath = ''): Promise<Uint8Array> {
  if (bytes.byteLength > FBX_MAX_BYTES) throw new UserModelError(`this FBX is larger than ${FBX_MAX_BYTES / 1024 / 1024} MB — export it as .glb (Blender: File → Export → glTF 2.0) and attach that`);
  ensureFileReader();
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  type Node3 = { geometry?: { index: { array: ArrayLike<number> } | null; attributes: { position: { count: number } }; groups: { start: number; count: number; materialIndex?: number }[]; setIndex(i: number[]): void; clearGroups(): void; addGroup(s: number, c: number, m: number): void };
    material?: unknown; traverse(cb: (n: Node3) => void): void };
  // FBXLoader decodes texture pictures with browser APIs (`document`), which Node lacks: a textured FBX failed to parse.
  // A loading manager whose handler only hands back an empty Texture lets it parse; the slots are cleared below anyway.
  // (three by a variable specifier: a typed `declare module 'three'` here would shadow the client's own three imports.)
  const threeSpecifier = 'three';
  const THREE = await import(threeSpecifier) as { LoadingManager: new () => { addHandler(re: RegExp, loader: unknown): void }; Texture: new () => { userData?: Record<string, unknown> } };
  const manager = new THREE.LoadingManager();
  const noPictures = { path: '', setPath(p: string) { this.path = p; return this; }, load: (url: string) => Object.assign(new THREE.Texture(), { userData: { fileName: String(url ?? '') } }) };
  manager.addHandler(/./, noPictures);
  let root: Node3 & { animations: { name: string }[] };
  try {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    root = new FBXLoader(manager).parse(ab, '') as unknown as typeof root;
  } catch { throw new UserModelError('this FBX file could not be read — export it as .glb (Blender: File → Export → glTF 2.0) and attach that'); }
  const TEXTURE_SLOTS = ['map', 'normalMap', 'specularMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'lightMap', 'displacementMap', 'roughnessMap', 'metalnessMap'];
  let texturesDropped = false;
  // The base-colour picture each material named, by material: put back into the GLB after export when the user
  // attached that picture beside the FBX (Node cannot hand pictures to the exporter, so they go in afterwards).
  const wantedPicture = new Map<string, string>();
  let materialSeq = 0;
  root.traverse((n) => {
    for (const m of ([] as Record<string, unknown>[]).concat((n.material as Record<string, unknown>) ?? [])) {
      m.transparent = false; m.opacity = 1;
      const map = m.map as { userData?: { fileName?: string } } | null | undefined;
      if (map?.userData?.fileName) {
        if (typeof m.name !== 'string' || !m.name) m.name = `Material_${++materialSeq}`;
        wantedPicture.set(m.name as string, map.userData.fileName);
      }
      for (const slot of TEXTURE_SLOTS) if (m[slot]) { m[slot] = null; texturesDropped = true; }
    }
    const g = n.geometry;
    if (!g || !Array.isArray(n.material) || !g.groups.length) return;
    const src = g.index ? Array.from(g.index.array) : Array.from({ length: g.attributes.position.count }, (_, i) => i);
    const byMaterial = new Map<number, number[]>();
    for (const grp of g.groups) { const list = byMaterial.get(grp.materialIndex ?? 0) ?? []; for (let i = grp.start; i < grp.start + grp.count; i++) list.push(src[i]); byMaterial.set(grp.materialIndex ?? 0, list); }
    const out: number[] = []; g.clearGroups();
    for (const [mi, list] of [...byMaterial].sort((a, b) => a[0] - b[0])) { g.addGroup(out.length, list.length, mi); for (const v of list) out.push(v); }
    g.setIndex(out);
  });
  for (const clip of root.animations) clip.name = clip.name.replace(/^.*\|/, '');
  // FBX stores its own axis and unit settings, which do not always survive conversion: say so once, with the exact way out.
  warnings.push('it was converted from FBX — if it looks turned on its side or the wrong size, ask to turn or resize it, or export it as .glb for the exact look');
  const pictures = new Map<string, Uint8Array>(); const missing = new Set<string>();
  for (const [material, file] of wantedPicture) {
    const bytes = findResource(files, fbxPath, file.replace(/\\/g, '/').split('/').pop() ?? file);
    const isPicture = bytes && ((bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8));
    if (isPicture) pictures.set(material, bytes!); else missing.add(file.replace(/\\/g, '/').split('/').pop() ?? file);
  }
  // three.js counts texture rows from the bottom (FBXLoader's UVs assume a flipped picture); glTF from the top. The
  // exporter would flip the picture itself, but here the picture goes in untouched afterwards — so the UVs flip instead,
  // on exactly the meshes that will get one (the first try showed a silver sword's blade in its grip's brown).
  root.traverse((n) => {
    const mats = ([] as { name?: string }[]).concat((n.material as { name?: string }) ?? []);
    const uv = (n.geometry as unknown as { attributes?: { uv?: { count: number; getY(i: number): number; setY(i: number, v: number): void; needsUpdate?: boolean } } } | undefined)?.attributes?.uv;
    if (!uv || !mats.some(m => m?.name && pictures.has(m.name))) return;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    uv.needsUpdate = true;
  });
  let glb: Uint8Array;
  try {
    glb = new Uint8Array(await new GLTFExporter().parseAsync(root as never, { binary: true, animations: root.animations as never, onlyVisible: true }) as ArrayBuffer);
  } catch { throw new UserModelError('this FBX could not be converted — export it as .glb (Blender: File → Export → glTF 2.0) and attach that'); }
  if (pictures.size) glb = embedBaseColorPictures(glb, pictures);
  if (missing.size) warnings.push(`its picture(s) ${[...missing].slice(0, 6).join(', ')} were not attached, so those parts show their plain colours — attach the picture files with the FBX (or all in one zip) for the full look`);
  else if (texturesDropped && !pictures.size) warnings.push('its textures could not be carried over from FBX, so it shows its plain colours — for the full look, export it as .glb (Blender: File → Export → glTF 2.0) and attach that');
  return glb;
}

/** Every .fbx in the files becomes a .glb beside it (same name) before the models are checked; failures are refusals. */
export async function convertFbxFiles(files: ReadonlyMap<string, Uint8Array>): Promise<{ files: Map<string, Uint8Array>; warnings: Map<string, string[]>; refused: UserModelRefusal[] }> {
  const out = new Map(files); const warnings = new Map<string, string[]>(); const refused: UserModelRefusal[] = [];
  for (const [path, bytes] of files) {
    if (!/\.fbx$/i.test(path)) continue;
    out.delete(path);
    const w: string[] = [];
    try {
      const glbPath = path.replace(/\.fbx$/i, '.glb');
      out.set(glbPath, await fbxToGlb(bytes, w, files, path));
      warnings.set(glbPath, w);
    } catch (error) { refused.push({ from: path, reason: userModelRefusalReason(error, bytes.byteLength) }); }
  }
  return { files: out, warnings, refused };
}

/**
 * Put base-colour pictures into an exported GLB, by material name: each picture is appended to the binary chunk with its
 * own buffer view, image and texture, and the material's baseColorTexture points at it (its colour becomes white, so the
 * picture shows as drawn). The UVs are already in the GLB — the exporter writes them whether or not a map was set. PURE.
 */
export function embedBaseColorPictures(glb: Uint8Array, byMaterial: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const b = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = b.readUInt32LE(12);
  const doc = JSON.parse(b.subarray(20, 20 + jsonLength).toString('utf8')) as {
    materials?: { name?: string; pbrMetallicRoughness?: Record<string, unknown> }[]; images?: unknown[]; textures?: unknown[]; samplers?: unknown[];
    bufferViews?: unknown[]; buffers?: { byteLength: number }[];
  };
  const binStart = 20 + jsonLength;
  const binLength = binStart + 8 <= b.length ? b.readUInt32LE(binStart) : 0;
  const parts: Buffer[] = [binLength ? Buffer.from(b.subarray(binStart + 8, binStart + 8 + binLength)) : Buffer.alloc(0)];
  let offset = parts[0].length;
  doc.images ??= []; doc.textures ??= []; doc.bufferViews ??= []; doc.samplers ??= [];
  if (!doc.samplers.length) doc.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
  const done = new Map<string, number>();
  for (const material of doc.materials ?? []) {
    const picture = material.name ? byMaterial.get(material.name) : undefined;
    if (!picture) continue;
    let texture = done.get(material.name!);
    if (texture === undefined) {
      const padded = Buffer.alloc(Math.ceil(picture.byteLength / 4) * 4); padded.set(picture);
      doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: picture.byteLength });
      parts.push(padded); offset += padded.length;
      doc.images.push({ bufferView: doc.bufferViews.length - 1, mimeType: picture[0] === 0xff ? 'image/jpeg' : 'image/png' });
      doc.textures.push({ source: doc.images.length - 1, sampler: 0 });
      texture = doc.textures.length - 1; done.set(material.name!, texture);
    }
    material.pbrMetallicRoughness = { ...(material.pbrMetallicRoughness ?? {}), baseColorTexture: { index: texture }, baseColorFactor: [1, 1, 1, 1] };
  }
  if (!done.size) return glb;
  doc.buffers = [{ byteLength: offset }];
  const bin = Buffer.concat(parts, offset);
  const json = Buffer.from(JSON.stringify(doc)); const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(paddedJson);
  const out = Buffer.alloc(28 + paddedJson.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(paddedJson.length, 12); out.writeUInt32LE(0x4e4f534a, 16); paddedJson.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + paddedJson.length); out.writeUInt32LE(0x004e4942, 24 + paddedJson.length); bin.copy(out, 28 + paddedJson.length);
  return new Uint8Array(out);
}

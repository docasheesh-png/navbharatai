/** Build-time policy for externally authored models. Never trust provider metadata as validation. */
export const ASSET_LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, triangles: 60_000, nodes: 512, meshes: 128, animations: 128, texturePixels: 2048 * 2048, totalTexturePixels: 8 * 2048 * 2048 });

export interface AssetLicense {
  spdx: 'CC0-1.0' | 'CC-BY-4.0';
  evidenceUrl: string;
  reviewedAt: string;
  author: string;
  attribution: string;
  commercial: true;
  redistributeInGame: true;
  redistributeSource: true;
}
export interface AssetCandidate {
  provider: string;
  id: string;
  revision: string;
  sourceUrl: string;
  downloadUrl: string;
  sha256: string;
  /** Curated canonical object names, not broad categories such as "vehicle". */
  subjects: readonly string[];
  animations: readonly string[];
  animationRoles?: Readonly<Record<string, string>>;
  license: AssetLicense;
  height: number;
  yaw: number;
}
export interface AssetRequirement { subject: string; animation?: string }
export interface ValidatedModel { triangles: number; animations: string[]; bytes: number }

export function licenseAccepted(license: AssetLicense): boolean {
  return !!license && ['CC0-1.0', 'CC-BY-4.0'].includes(license.spdx)
    && license.commercial === true && license.redistributeInGame === true && license.redistributeSource === true
    && /^https:\/\//.test(license.evidenceUrl) && Number.isFinite(Date.parse(license.reviewedAt))
    && !!license.author?.trim() && (license.spdx !== 'CC-BY-4.0' || !!license.attribution?.trim());
}

export function candidateMatches(c: AssetCandidate, r: AssetRequirement): boolean {
  return licenseAccepted(c.license) && /^[a-f0-9]{64}$/.test(c.sha256) && !!c.revision
    && Number.isFinite(c.height) && c.height > 0 && c.height <= 1000 && Number.isFinite(c.yaw)
    && c.subjects.includes(r.subject.toLowerCase().trim())
    && (!r.animation || c.animations.includes(c.animationRoles?.[r.animation] ?? r.animation));
}

function fail(message: string): never { throw new Error(`Unsafe GLB: ${message}`); }
function integer(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) fail('invalid integer or resource budget');
  return value as number;
}
function records(value: unknown, max: number): Record<string, any>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(v => !v || typeof v !== 'object' || Array.isArray(v))) fail('invalid collection');
  return value;
}

/**
 * Conservative self-contained glTF 2 GLB subset. Reject external/data URIs, extensions, compressed
 * geometry and archives rather than invoking untrusted codecs. PNG textures only, dimensions
 * checked before the browser decodes them. Full scene parsing remains part of the delivery test.
 */
export function validateGlb(bytes: Uint8Array): ValidatedModel {
  if (bytes.byteLength < 28 || bytes.byteLength > ASSET_LIMITS.bytes) fail('size');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) fail('header');
  const jsonLength = b.readUInt32LE(12);
  if (jsonLength > 1024 * 1024 || jsonLength % 4 || b.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > b.length) fail('JSON chunk');
  let doc: Record<string, any>;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(20, 20 + jsonLength))); } catch { fail('JSON'); }
  if (!doc || doc.asset?.version !== '2.0') fail('version');
  const offset = 20 + jsonLength;
  const binLength = b.readUInt32LE(offset);
  if (b.readUInt32LE(offset + 4) !== 0x004e4942 || binLength % 4 || offset + 8 + binLength !== b.length) fail('binary chunk');
  const bin = b.subarray(offset + 8);
  // Iterative traversal avoids call-stack exhaustion from malicious nested extras.
  const pending: unknown[] = [doc]; let visited = 0;
  while (pending.length) {
    if (++visited > 100_000) fail('document complexity');
    const value = pending.pop();
    if (typeof value === 'number' && !Number.isFinite(value)) fail('non-finite number');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['uri', 'extensions', 'extensionsUsed', 'extensionsRequired', '__proto__', 'constructor', 'prototype'].includes(key)) fail('references or extensions');
      pending.push(child);
    }
  }
  const buffers = records(doc.buffers, 1);
  if (buffers.length !== 1 || buffers[0].byteLength > binLength || binLength - buffers[0].byteLength > 3) fail('buffer length');
  integer(buffers[0].byteLength, binLength);
  const views = records(doc.bufferViews, 4096);
  for (const v of views) {
    if (v.buffer !== 0) fail('buffer index');
    if (integer(v.byteOffset ?? 0, binLength) + integer(v.byteLength, binLength) > buffers[0].byteLength) fail('buffer view bounds');
    if (v.byteStride !== undefined && (integer(v.byteStride, 252) < 4 || v.byteStride % 4)) fail('stride');
  }
  const accessors = records(doc.accessors, 4096);
  for (const a of accessors) {
    if (a.sparse) fail('sparse accessor');
    const v = views[integer(a.bufferView, views.length - 1)];
    const componentBytes = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType];
    const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type];
    if (!componentBytes || !components) fail('accessor type');
    const count = integer(a.count, 1_000_000); if (!count) fail('empty accessor');
    const stride = v.byteStride ?? componentBytes * components;
    if (stride < componentBytes * components || integer(a.byteOffset ?? 0, v.byteLength) + (count - 1) * stride + componentBytes * components > v.byteLength) fail('accessor bounds');
  }
  const meshes = records(doc.meshes, ASSET_LIMITS.meshes); let triangles = 0; let verticesChecked = 0;
  const meshTriangles = new Map<Record<string, any>, number>();
  for (const mesh of meshes) for (const p of records(mesh.primitives, 64)) {
    if ((p.mode ?? 4) !== 4) fail('non-triangle primitive');
    const position = accessors[integer(p.attributes?.POSITION, accessors.length - 1)];
    if (position.type !== 'VEC3' || position.componentType !== 5126) fail('position type');
    const index = p.indices === undefined ? undefined : accessors[integer(p.indices, accessors.length - 1)];
    if (index && (index.type !== 'SCALAR' || ![5121, 5123, 5125].includes(index.componentType))) fail('index type');
    const count = index?.count ?? position.count;
    if (count % 3) fail('triangle count');
    triangles += count / 3;
    meshTriangles.set(mesh, (meshTriangles.get(mesh) ?? 0) + count / 3);
    verticesChecked += position.count;
    if (triangles > ASSET_LIMITS.triangles || verticesChecked > ASSET_LIMITS.triangles * 3) fail('geometry work budget');
    const pv = views[position.bufferView];
    const start = (pv.byteOffset ?? 0) + (position.byteOffset ?? 0);
    for (let i = 0; i < position.count; i++) for (let axis = 0; axis < 3; axis++) {
      const coordinate = bin.readFloatLE(start + i * (pv.byteStride ?? 12) + axis * 4);
      if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 1_000_000) fail('position coordinates');
    }
    if (index) {
      const iv = views[index.bufferView];
      const base = (iv.byteOffset ?? 0) + (index.byteOffset ?? 0);
      const width = index.componentType === 5121 ? 1 : index.componentType === 5123 ? 2 : 4;
      for (let i = 0; i < index.count; i++) {
        const at = base + i * (iv.byteStride ?? width);
        const value = width === 1 ? bin.readUInt8(at) : width === 2 ? bin.readUInt16LE(at) : bin.readUInt32LE(at);
        if (value >= position.count) fail('vertex index');
      }
    }

  }
  if (!triangles || triangles > ASSET_LIMITS.triangles) fail('triangle budget');
  const nodes = records(doc.nodes, ASSET_LIMITS.nodes);
  const parents = new Set<number>();
  let instancedTriangles = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.mesh !== undefined) {
      const index = integer(n.mesh, meshes.length - 1);
      instancedTriangles += meshTriangles.get(meshes[index]) ?? 0;
      if (instancedTriangles > ASSET_LIMITS.triangles) fail('instanced triangle budget');
    }
    if (n.children !== undefined && !Array.isArray(n.children)) fail('children');
    for (const child of n.children ?? []) {
      integer(child, nodes.length - 1);
      if (child === i || parents.has(child)) fail('scene graph');
      parents.add(child);
    }
    const stack = [i]; const seen = new Set<number>();
    while (stack.length) {
      const id = stack.pop()!; if (seen.has(id)) fail('node cycle'); seen.add(id);
      const children = nodes[id]?.children;
      if (children !== undefined && !Array.isArray(children)) fail('children');
      for (const child of children ?? []) { integer(child, nodes.length - 1); stack.push(child); }
    }
  }
  let pixels = 0;
  for (const img of records(doc.images, 16)) {
    const v = views[integer(img.bufferView, views.length - 1)];
    const data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    // PNG is the initial audited codec. JPEG and compressed texture support requires a decoder gate.
    if (img.mimeType !== 'image/png' || data.length < 33 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || data.toString('ascii', 12, 16) !== 'IHDR') fail('texture format');
    const w = integer(data.readUInt32BE(16), 2048), h = integer(data.readUInt32BE(20), 2048);
    if (!w || !h || w * h > ASSET_LIMITS.texturePixels) fail('texture budget');
    pixels += w * h;
  }
  if (pixels > ASSET_LIMITS.totalTexturePixels) fail('total texture budget');
  const animations = records(doc.animations, ASSET_LIMITS.animations).map(a => typeof a.name === 'string' ? a.name.slice(0, 128) : '');
  if (!instancedTriangles) fail('no renderable mesh nodes');
  return { bytes: bytes.byteLength, triangles: instancedTriangles, animations };
}

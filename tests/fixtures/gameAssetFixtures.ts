import { createHash } from 'node:crypto';
import type { ReviewedAsset } from '../../src/server/AgentV3/gameAssets/providers';

/** Authored synthetic tetrahedron with observable translation. Never included in the production catalogue. */
export function syntheticGlb(animated = true, textured = false): Buffer {
  const positions = [
    -.5,0,.5, .5,0,.5, 0,1,0,
    .5,0,.5, 0,0,-.5, 0,1,0,
    0,0,-.5, -.5,0,.5, 0,1,0,
    -.5,0,.5, 0,0,-.5, .5,0,.5,
  ];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64');
  const bin = Buffer.alloc(textured ? 272 + Math.ceil(png.length / 4) * 4 : 176);
  positions.forEach((n, i) => bin.writeFloatLE(n, i * 4));
  bin.writeFloatLE(0, 144); bin.writeFloatLE(1, 148);
  [0,0,0, 0,.3,0].forEach((n,i) => bin.writeFloatLE(n, 152 + i * 4));
  if (textured) {
    for (let i = 0; i < 12; i++) { bin.writeFloatLE(i % 3 === 1 ? 1 : 0, 176 + i * 8); bin.writeFloatLE(i % 3 === 2 ? 1 : 0, 180 + i * 8); }
    png.copy(bin, 272);
  }
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteLength: 144 }, { buffer: 0, byteOffset: 144, byteLength: 8 }, { buffer: 0, byteOffset: 152, byteLength: 24 }, ...(textured ? [{buffer:0,byteOffset:176,byteLength:96},{buffer:0,byteOffset:272,byteLength:png.length}] : [])],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 12, min: [-.5,0,-.5], max: [.5,1,.5] },
      { bufferView: 1, componentType: 5126, type: 'SCALAR', count: 2, min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, type: 'VEC3', count: 2 }, ...(textured ? [{bufferView:3,componentType:5126,type:'VEC2',count:12}] : [])],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1,.3,.1,1], metallicFactor: 0, ...(textured ? {baseColorTexture:{index:0}} : {}) } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, ...(textured ? {TEXCOORD_0:3} : {}) }, material: 0 }] }],
    ...(textured ? {images:[{bufferView:4,mimeType:'image/png'}],textures:[{source:0}]} : {}),
    ...(animated ? { animations: [{ name: 'Move', samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }] } : {}),
  };
  const raw = Buffer.from(JSON.stringify(doc)); const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const result = Buffer.alloc(28 + json.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(result, 28 + json.length);
  return result;
}
export function syntheticCandidate(bytes: Uint8Array): ReviewedAsset {
  return {
    provider: 'github', id: 'synthetic-test-only', revision: 'test-v1', sourceUrl: 'https://models.example/fixture', downloadUrl: 'https://models.example/fixture.glb',
    sha256: createHash('sha256').update(bytes).digest('hex'), subjects: ['train','railway station','bird','ship','human','car','dog','cow','tree','building'],
    animations: ['Move'], animationRoles: { walk: 'Move', fly: 'Move' }, height: 1.8, yaw: 0,
    license: { spdx: 'CC0-1.0', evidenceUrl: 'https://models.example/license', reviewedAt: '2026-11-01', author: 'NavBharatAI synthetic test fixture', attribution: '', commercial: true, redistributeInGame: true, redistributeSource: true },
    downloadOrigins: ['https://models.example'], review: { reviewer: 'automated-test-only', evidenceRevision: 'test-v1', freeDownload: true },
  };
}

/** Synthetic duplicate/unused bytes exercise compaction without third-party downloads. */
export function paddedSyntheticGlb(): Buffer {
  const source = syntheticGlb(true, true);
  const n = source.readUInt32LE(12);
  const doc = JSON.parse(source.subarray(20, 20 + n).toString('utf8'));
  const bin = source.subarray(28 + n);
  doc.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: 144 });
  const expanded = Buffer.concat([bin, bin.subarray(0, 144), Buffer.alloc(64 * 1024)]);
  doc.buffers[0].byteLength = expanded.length;
  return encodeFixtureGlb(doc, expanded);
}

export function encodeFixtureGlb(doc: unknown, bin: Uint8Array): Buffer {
  const raw = Buffer.from(JSON.stringify(doc)); const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const result = Buffer.alloc(28 + json.length + bin.byteLength);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  result.writeUInt32LE(bin.byteLength, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length); result.set(bin, 28 + json.length);
  return result;
}

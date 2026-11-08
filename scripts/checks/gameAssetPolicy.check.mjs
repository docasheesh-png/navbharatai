// Dependency-free smoke verification when package installation is unavailable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateGlb, candidateMatches } from '../../src/server/AgentV3/gameAssets/assetPolicy.ts';
import { acquireGameAsset } from '../../src/server/AgentV3/gameAssets/assetEngine.ts';

function fixture(change = () => {}) {
  const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  change(doc);
  const raw = JSON.stringify(doc); const json = Buffer.from(raw + ' '.repeat((4 - Buffer.byteLength(raw) % 4) % 4));
  const b = Buffer.alloc(28 + json.length + 36);
  b.writeUInt32LE(0x46546c67, 0); b.writeUInt32LE(2, 4); b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(json.length, 12); b.writeUInt32LE(0x4e4f534a, 16); json.copy(b, 20);
  b.writeUInt32LE(36, 20 + json.length); b.writeUInt32LE(0x004e4942, 24 + json.length);
  return b;
}
const repeated = fixture(d => {
  d.meshes = Array.from({length:128},()=>({primitives:Array.from({length:64},()=>({attributes:{POSITION:0}}))}));
  d.nodes = Array.from({length:512},()=>({mesh:0}));
  d.scenes=[{nodes:Array.from({length:512},(_,i)=>i)}];
});
// The geometry has 8192 triangles, but 512 nodes repeat the 64-triangle first mesh:
// 32768 rendered triangles. Validate the actual instance count, not just stored primitives.
assert.equal(validateGlb(repeated).triangles,32768);
const overInstanced = fixture(d => {
  d.meshes = [{primitives:Array.from({length:64},()=>({attributes:{POSITION:0}}))}];
  // 512 nodes * 64 primitives * 3 triangles = 98304; each POSITION reuses 9 vertices.
  d.accessors[0].count=9; d.accessors[0].byteOffset=0;
  d.bufferViews[0].byteLength=108; d.buffers[0].byteLength=108;
});
// Build a bounded fixture with a larger BIN chunk; no external asset is involved.
const expanded=Buffer.concat([overInstanced,Buffer.alloc(72)]);
expanded.writeUInt32LE(expanded.length,8);
expanded.writeUInt32LE(108,20+expanded.readUInt32LE(12));
// A separate fixture helper below rebuilds JSON to add the repeated nodes safely.
function replaceJson(input, change) {
  const oldLength=input.readUInt32LE(12); const doc=JSON.parse(input.subarray(20,20+oldLength).toString()); change(doc);
  const raw=Buffer.from(JSON.stringify(doc)); const json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
  const out=Buffer.concat([input.subarray(0,12),Buffer.alloc(8),json,input.subarray(20+oldLength)]);
  out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);return out;
}
assert.throws(()=>validateGlb(replaceJson(expanded,d=>{d.nodes=Array.from({length:512},()=>({mesh:0}));d.scenes=[{nodes:Array.from({length:512},(_,i)=>i)}];})),/instanced triangle budget/);
const bytes = fixture();
assert.equal(validateGlb(bytes).triangles, 1);
const rejects = [
  d => { d.buffers[0].uri = 'http://169.254.169.254/'; },
  d => { d.buffers[0].uri = 'data:application/octet-stream;base64,AAAA'; },
  d => { d.nodes[0].children = [0]; },
  d => { d.nodes.push({ children: [0] }); d.nodes[0].children = [1]; },
  d => { d.accessors[0].count = 900000; },
  d => { d.bufferViews[0].byteLength = 500; },
  d => { d.extensionsRequired = ['KHR_draco_mesh_compression']; },
  d => { d.meshes[0].primitives[0].mode = 1; },
  d => { d.asset.version = '1.0'; },
  d => { d.accessors[0].sparse = {}; },
];
for (const change of rejects) assert.throws(() => validateGlb(fixture(change)), /Unsafe GLB/);
const candidate = { provider: 'curated', id: 'triangle-fixture', revision: 'test-only', sourceUrl: 'https://example.com/test', downloadUrl: 'https://example.com/test.glb', sha256: createHash('sha256').update(bytes).digest('hex'), subjects: ['car'], animations: [], height: 1.5, yaw: 0, license: { spdx: 'CC0-1.0', evidenceUrl: 'https://example.com/license', reviewedAt: '2026-11-01', author: 'Test fixture', attribution: '', commercial: true, redistributeInGame: true, redistributeSource: true } };
assert.equal(candidateMatches(candidate, { subject: 'ship' }), false);
assert.equal(candidateMatches(candidate, { subject: 'car', animation: 'walk' }), false);
assert.equal(candidateMatches({ ...candidate, license: { ...candidate.license, commercial: false } }, { subject: 'car' }), false);
let downloads = 0, searches = 0, saves = 0, parses = 0;
const entries = []; const signal = new AbortController().signal;
const deps = {
  cache: { find: async () => entries, read: async () => bytes, put: async entry => { entries.push(entry); } },
  providers: [{ id: 'curated', search: async () => { searches++; return [candidate]; } }],
  download: async () => { downloads++; return bytes; },
  parse: async () => { parses++; },
  persist: async () => { saves++; },
};
const first = await acquireGameAsset({ subject: 'car' }, deps, signal);
assert.equal(first.kind, 'model'); assert.equal(first.cacheHit, false);
const second = await acquireGameAsset({ subject: 'car' }, deps, signal);
assert.equal(second.cacheHit, true); assert.equal(second.downloadedBytes, 0);
assert.deepEqual([downloads, searches, saves, parses], [1, 1, 2, 2]);
assert.equal((await acquireGameAsset({ subject: 'car' }, { ...deps, persist: async () => { throw Error('storage unavailable'); } }, signal)).kind, 'procedural');
assert.equal((await acquireGameAsset({ subject: 'car' }, { ...deps, parse: async () => { throw Error('invalid scene'); } }, signal)).kind, 'procedural');
assert.equal((await acquireGameAsset({ subject: 'ship' }, deps, signal)).kind, 'procedural');
assert.equal((await acquireGameAsset({ subject: 'car' }, deps, AbortSignal.abort())).kind, 'procedural');
console.log('PASS: GLB policy (10 malicious fixtures), exact semantic/license selection, cache reuse, durable/parse failure fallback, cancellation. Synthetic fixtures only; no render or live-provider claim.');

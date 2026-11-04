// Offline catalogue-ADMISSION tool for a pinned glTF + BIN + PNG model (KayKit packs). It downloads the exact
// pinned revision, hashes every file, bundles and compacts with the PRODUCTION code (bundleGltf, compactGlb),
// validates with validateGlb, and prints the evidence a catalogue entry needs. It writes nothing into the
// catalogue and infers no licence: the reviewer reads the pack's LICENSE.txt at the same revision.
// Usage: node --import ./node_modules/tsx/dist/loader.mjs scripts/gameAssetAdmitGltf.mjs <raw.githubusercontent.com pinned .gltf URL>
import { createHash } from 'node:crypto';
import { bundleGltf } from '../src/server/AgentV3/gameAssets/gltfBundle.ts';
import { compactGlb } from '../src/server/AgentV3/gameAssets/assetOptimize.ts';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy.ts';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const url = process.argv[2];
if (!/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\/.+\.gltf$/.test(url ?? '')) throw Error('Give a raw.githubusercontent.com URL pinned to a 40-character commit, ending in .gltf');
const get = async (u) => { const r = await fetch(u, { redirect: 'error' }); if (!r.ok) throw Error(`HTTP ${r.status} for ${u}`); return new Uint8Array(await r.arrayBuffer()); };
const json = await get(url);
const doc = JSON.parse(new TextDecoder().decode(json));
const uris = [...(doc.buffers ?? []), ...(doc.images ?? [])].map((x) => x.uri).filter((u) => typeof u === 'string' && !u.startsWith('data:'));
const base = url.slice(0, url.lastIndexOf('/') + 1);
const resources = new Map(); const listed = [];
for (const path of [...new Set(uris)]) {
  const ru = new URL(path, base).href;
  const bytes = await get(ru);
  resources.set(path, bytes); listed.push({ path, url: ru, sha256: sha(bytes) });
}
const glb = bundleGltf(json, resources);
const { bytes: derived } = compactGlb(glb);
const v = validateGlb(derived);
console.log(JSON.stringify({ downloadUrl: url, sourceSha256: sha(json), resources: listed, sha256: sha(derived), derivedBytes: derived.byteLength, triangles: v.triangles, animations: v.animations }, null, 2));

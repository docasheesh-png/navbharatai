// Offline catalogue-admission tool. No network, licence inference or catalogue activation.
import { stat, readFile, writeFile } from 'node:fs/promises';
import { compactGlb } from '../src/server/AgentV3/gameAssets/assetOptimize.ts';
import { ASSET_LIMITS } from '../src/server/AgentV3/gameAssets/assetPolicy.ts';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node --experimental-strip-types scripts/gameAssetCompact.mjs source.glb derived.glb');
if ((await stat(input)).size > ASSET_LIMITS.bytes) throw Error('Input exceeds reviewed model byte budget');
const result = compactGlb(await readFile(input));
await writeFile(output, result.bytes, {flag:'wx'});
const {bytes, ...report} = result;
console.log(JSON.stringify({...report, outputBytes:bytes.byteLength, notice:'Review exact licence, provenance and derived rendering before catalogue admission.'},null,2));

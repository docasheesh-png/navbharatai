// Offline reviewed-source admission. No network or licence inference; output never overwrites a file.
import { stat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectGlbAnimations } from '../src/server/AgentV3/gameAssets/assetAnimationSelection.ts';
import { ASSET_LIMITS } from '../src/server/AgentV3/gameAssets/assetPolicy.ts';
const [input, output, sourceSha256, ...clips] = process.argv.slice(2);
if (!input || !output || !sourceSha256 || !clips.length) throw Error('Usage: node --experimental-strip-types scripts/gameAssetSelectAnimations.mjs source.glb derived.glb reviewed-source-sha256 ClipName ...');
if ((await stat(input)).size > ASSET_LIMITS.bytes) throw Error('Source exceeds byte budget');
const source = await readFile(input);
const bytes = selectGlbAnimations(source, sourceSha256, clips);
await writeFile(output, bytes, { flag: 'wx' });
console.log(JSON.stringify({ version: 'animation-selection-v1', sourceSha256, sha256: createHash('sha256').update(bytes).digest('hex'), clips, sourceBytes: source.length, outputBytes: bytes.length, savedBytes: source.length - bytes.length, notice: 'Review exact licence and prove derived rendering/animation before admission.' }, null, 2));

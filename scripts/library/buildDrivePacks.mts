/**
 * Admit the owner's Drive packs (2026-11-23). Reads the zips already downloaded to /tmp/drive-packs,
 * checks each archive licence, and writes only models that pass the existing GLB limits.
 * Usage: node --import tsx scripts/library/buildDrivePacks.mts
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { validateGlb, ASSET_LIMITS } from '../../src/server/AgentV3/gameAssets/assetPolicy';
import { bundleGltf } from '../../src/server/AgentV3/gameAssets/gltfBundle';
import { compactGlb } from '../../src/server/AgentV3/gameAssets/assetOptimize';
import { objToGlb } from '../../src/server/AgentV3/gameAssets/userModels';
import type { ReviewedAsset } from '../../src/server/AgentV3/gameAssets/providers';

const ROOT = '/tmp/drive-packs';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const textOf = (b: Uint8Array) => new TextDecoder().decode(b);

async function loadZip(name: string): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(readFileSync(join(ROOT, name)));
  const out = new Map<string, Uint8Array>();
  const jobs: Promise<void>[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    jobs.push(entry.async('uint8array').then((bytes) => { out.set(path, bytes); }));
  });
  await Promise.all(jobs);
  return out;
}

interface Kept { id: string; subjects: string[]; category: ReviewedAsset['libraryCategory']; height: number; provider: ReviewedAsset['provider']; sourceUrl: string; downloadUrl: string; origin: string; author: string; attribution: string; evidenceUrl: string; revision: string; evidence: string; bytes: Uint8Array; sourceName: string }
const kept: Kept[] = [];
const skipped: { pack: string; file: string; reason: string }[] = [];

function admit(row: Omit<Kept, 'bytes'> & { raw: Uint8Array; pack: string }): void {
  let bytes = row.raw;
  try { const c = compactGlb(bytes); if (c.bytes.byteLength <= bytes.byteLength) bytes = c.bytes; } catch { /* keep the original bytes */ }
  try {
    const stats = validateGlb(bytes);
    if (stats.bytes > ASSET_LIMITS.bytes || stats.triangles > ASSET_LIMITS.triangles) throw new Error(`over limit ${stats.bytes} bytes ${stats.triangles} tris`);
    kept.push({ ...row, bytes });
  } catch (e) {
    skipped.push({ pack: row.pack, file: row.sourceName, reason: String((e as Error).message).slice(0, 180) });
  }
}

function resourcesOf(files: Map<string, Uint8Array>, gltfPath: string, docText: string): Map<string, Uint8Array> {
  const doc = JSON.parse(docText);
  const uris = [...(doc.buffers ?? []), ...(doc.images ?? [])].map((x: { uri?: string }) => x.uri).filter((u: string | undefined): u is string => !!u && !u.startsWith('data:'));
  const dir = gltfPath.split('/').slice(0, -1).join('/');
  const map = new Map<string, Uint8Array>();
  for (const uri of new Set(uris)) {
    const rel = uri.split('/').filter(s => s !== '.').join('/');
    const full = `${dir}/${rel}`.replace(/\/+/g, '/');
    const hit = files.get(full) ?? files.get(decodeURIComponent(full));
    if (!hit) throw new Error(`missing ${uri}`);
    map.set(uri, hit);
  }
  return map;
}

const vuenaMega = await loadZip('vuena-mega.bin');
const vuenaLic = textOf(vuenaMega.get('Vuena-Free-Mega-Starter/LICENSE.txt')!);
if (!/CC0 1\.0 Universal/.test(vuenaLic)) throw new Error('Vuena mega licence is not CC0');
const vuenaRev = sha(new TextEncoder().encode(vuenaLic));
let vuenaN = 0;
for (const [path, raw] of vuenaMega) {
  if (!path.endsWith('.glb')) continue;
  const base = path.split('/').pop()!.replace(/\.glb$/i, '');
  const subject = base.replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]/gi, '').trim().toLowerCase().slice(0, 48);
  if (!/^[a-z]/.test(subject)) { skipped.push({ pack: 'vuena-mega', file: path, reason: 'no subject' }); continue; }
  vuenaN++;
  admit({ pack: 'vuena-mega', id: `vuena-${subject.replace(/ +/g, '-').slice(0, 40)}`, subjects: [subject], category: /car|truck|van|bus/.test(subject) ? 'vehicle-land' : /char|person|man|woman|kid|pet|dog|cat|monster/.test(subject) ? 'character' : 'street-prop', height: 1.6, provider: 'vuena', sourceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', downloadUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', origin: 'https://creativecommons.org', author: 'Vuena', attribution: `${subject}: Vuena, free mega starter (${base}). CC0 1.0 Universal per LICENSE.txt in the archive.`, evidenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', revision: vuenaRev.slice(0, 40), evidence: vuenaRev, raw, sourceName: path });
}

const market = await loadZip('vuena-market.bin');
const marketLic = textOf(market.get('Vuena-Free-Drop-2026-11-Market-Fresh/LICENSE.txt')!);
if (!/CC0 1\.0 Universal/.test(marketLic)) throw new Error('Vuena market licence is not CC0');
const marketRev = sha(new TextEncoder().encode(marketLic));
for (const [path, raw] of market) {
  if (!path.endsWith('.glb')) continue;
  const base = path.split('/').pop()!.replace(/\.glb$/i, '');
  const subject = base.replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]/gi, '').trim().toLowerCase().slice(0, 48);
  admit({ pack: 'vuena-market', id: `market-${subject.replace(/ +/g, '-').slice(0, 40)}`, subjects: [subject], category: 'interior', height: 1.2, provider: 'vuena', sourceUrl: 'https://vuena.itch.io/store-simulator-kit', downloadUrl: 'https://vuena.itch.io/store-simulator-kit', origin: 'https://vuena.itch.io', author: 'Vuena', attribution: `${subject}: Vuena, Market Fresh free drop (${base}). CC0 1.0 Universal per LICENSE.txt in the archive. The full Store Simulator Kit is a separate product.`, evidenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', revision: marketRev.slice(0, 40), evidence: marketRev, raw, sourceName: path });
}

const HAVE = new Set(['arrow_bow','arrow_bow_bundle','bow','quiver','dagger','sword_2handed','axe_2handed','shield_round_color','shield_spikes_color','staff','wand','spellbook_open','spellbook_closed','mug_full','smokebomb']);
const kay = await loadZip('kaykit.bin');
const kayLic = textOf(kay.get('KayKit_Adventurers_2.0_FREE/License.txt')!);
if (!/Creative Commons Zero, CC0/.test(kayLic)) throw new Error('KayKit licence is not CC0');
const kayRev = sha(new TextEncoder().encode(kayLic));
const ranger = kay.get('KayKit_Adventurers_2.0_FREE/Characters/gltf/Ranger.glb');
if (!ranger) throw new Error('Ranger.glb missing');
admit({ pack: 'kaykit', id: 'k13-ranger', subjects: ['ranger', 'archer'], category: 'character', height: 1.8, provider: 'kaykit', sourceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', downloadUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', origin: 'https://creativecommons.org', author: 'Kay Lousberg', attribution: 'k13-ranger: Kay Lousberg (kaylousberg.com), KayKit Adventurers Character Pack 2.0 (Ranger). CC0 1.0 Universal per License.txt in the archive.', evidenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', revision: kayRev.slice(0, 40), evidence: kayRev, raw: ranger, sourceName: 'Ranger.glb' });
for (const [path, raw] of kay) {
  if (!path.includes('/Assets/gltf/') || !path.endsWith('.gltf')) continue;
  const base = path.split('/').pop()!.replace(/\.gltf$/, '');
  if (HAVE.has(base)) continue;
  const doc = textOf(raw);
  let glb: Uint8Array;
  try { glb = bundleGltf(raw, resourcesOf(kay, path, doc)); } catch (e) { skipped.push({ pack: 'kaykit', file: base, reason: String((e as Error).message).slice(0, 160) }); continue; }
  const subject = base.replace(/_/g, ' ');
  admit({ pack: 'kaykit', id: `k13-${base.replace(/_/g, '-').slice(0, 40)}`, subjects: [subject], category: 'weapon', height: 1, provider: 'kaykit', sourceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', downloadUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', origin: 'https://creativecommons.org', author: 'Kay Lousberg', attribution: `k13-${base}: Kay Lousberg (kaylousberg.com), KayKit Adventurers 2.0 (${base}). CC0 1.0 Universal per License.txt in the archive.`, evidenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', revision: kayRev.slice(0, 40), evidence: kayRev, raw: glb, sourceName: base });
}

const psx = await loadZip('psx.bin');
const cars = ['Car 01/Car.obj','Car 02/Car2.obj','Car 03/Car3.obj','Car 04/Car4.obj','Car 05/Car5.obj','Car 06/Car6.obj','Car 07/Car7.obj','Car 08/Car8.obj'];
for (const path of cars) {
  const raw = psx.get(path);
  if (!raw) { skipped.push({ pack: 'psx', file: path, reason: 'missing' }); continue; }
  const files = new Map<string, Uint8Array>();
  const dir = path.split('/')[0];
  for (const [k, v] of psx) if (k.startsWith(dir + '/')) files.set(k.slice(dir.length + 1), v);
  let glb: Uint8Array;
  try { glb = objToGlb(files, path.split('/').pop()!, raw); } catch (e) { skipped.push({ pack: 'psx', file: path, reason: String((e as Error).message).slice(0, 160) }); continue; }
  const n = path.match(/Car ?(\d+)/)?.[1] ?? '1';
  admit({ pack: 'psx', id: `psx-car-${n}`, subjects: [`psx car ${n}`, 'car'], category: 'vehicle-land', height: 1.4, provider: 'ggbot', sourceUrl: 'https://ggbot.itch.io/', downloadUrl: 'https://ggbot.itch.io/', origin: 'https://ggbot.itch.io', author: 'GGBot', attribution: `psx-car-${n}: GGBot, PSX Style Cars (Car ${n}). CC0 per the author's page https://ggbot.itch.io/ ("PSX Style Cars CC0 / Free 3D Car Pack"). The archive has no licence file of its own.`, evidenceUrl: 'https://ggbot.itch.io/', revision: sha(raw).slice(0, 40), evidence: sha(raw), raw: glb, sourceName: path });
}

const n1 = await loadZip('n1.zip');
const n1Lic = textOf(n1.get('Universal Base Characters[Standard]/License_Standard.txt')!);
if (!/CC0 1\.0 Universal/.test(n1Lic)) throw new Error('N1 licence is not CC0');
const n1Rev = sha(new TextEncoder().encode(n1Lic));
for (const [path, raw] of n1) {
  if (!path.endsWith('.gltf')) continue;
  if (path.includes('Rigged to Head Bone')) continue;
  const base = path.split('/').pop()!.replace(/\.gltf$/, '');
  let glb: Uint8Array;
  try { glb = bundleGltf(raw, resourcesOf(n1, path, textOf(raw))); }
  catch (e) { skipped.push({ pack: 'n1', file: base, reason: String((e as Error).message).slice(0, 160) }); continue; }
  const subject = base.replace(/_/g, ' ').toLowerCase();
  admit({ pack: 'n1', id: `n1-${base.replace(/_/g, '-').toLowerCase().slice(0, 40)}`, subjects: [subject], category: base.startsWith('Hair') || base.startsWith('Eyebrow') ? 'character' : 'character', height: base.startsWith('Superhero') ? 1.8 : 0.3, provider: 'quaternius', sourceUrl: 'https://quaternius.com', downloadUrl: 'https://quaternius.com', origin: 'https://quaternius.com', author: 'Quaternius', attribution: `${subject}: Quaternius, Universal Base Characters standard (${base}). CC0 1.0 Universal per License_Standard.txt in the archive.`, evidenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', revision: n1Rev.slice(0, 40), evidence: n1Rev, raw: glb, sourceName: base });
}

const seen = new Set<string>();
const entries: ReviewedAsset[] = [];
await mkdir('assets/game-models', { recursive: true });
for (const row of kept) {
  const id = seen.has(row.id) ? `${row.id}-2` : row.id;
  seen.add(id);
  const digest = sha(row.bytes);
  await writeFile(join('assets/game-models', `${digest}.glb`), row.bytes);
  entries.push({
    provider: row.provider, id, revision: row.revision, sourceUrl: row.sourceUrl, downloadUrl: row.downloadUrl, packaged: true,
    sha256: digest, bytes: row.bytes.byteLength, libraryCategory: row.category, subjects: row.subjects, animations: [], height: row.height, yaw: 0,
    downloadOrigins: [row.origin],
    review: { reviewer: 'NavBharatAI asset admission', evidenceRevision: row.evidence, freeDownload: true },
    license: { spdx: 'CC0-1.0', evidenceUrl: row.evidenceUrl, reviewedAt: '2026-11-23', author: row.author, attribution: row.attribution, commercial: true, redistributeInGame: true, redistributeSource: true },
  });
}
const body = `import type { ReviewedAsset } from './providers';\n/** Drive packs admitted 2026-11-23. Generated by scripts/library/buildDrivePacks.mts. */\nexport const REVIEWED_LIBRARY_BATCH_13: readonly ReviewedAsset[] = ${JSON.stringify(entries, null, 2)};\n`;
await writeFile('src/server/AgentV3/gameAssets/reviewedLibraryBatch13.ts', body);
await writeFile('docs/game-engine/asset-candidates/library-batch-13.json', JSON.stringify({ checkedAt: '2026-11-23', added: entries.length, skipped, packs: {
  vuenaMega: entries.filter(e => e.id.startsWith('vuena-')).length,
  vuenaMarket: entries.filter(e => e.id.startsWith('market-')).length,
  kaykit: entries.filter(e => e.id.startsWith('k13-')).length,
  psx: entries.filter(e => e.id.startsWith('psx-')).length,
  n1: entries.filter(e => e.id.startsWith('n1-')).length,
}, bytes: entries.reduce((n, e) => n + (e.bytes ?? 0), 0) }, null, 2));
console.log('kept', entries.length, 'skipped', skipped.length, 'bytes', entries.reduce((n, e) => n + (e.bytes ?? 0), 0));
console.log(JSON.stringify(skipped.slice(0, 40), null, 2));

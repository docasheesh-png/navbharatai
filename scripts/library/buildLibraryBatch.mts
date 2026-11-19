/**
 * Maintainer-only library batch builder (admin request 2026-11-19). Offline: reads LOCAL clones of the pinned
 * public repositories, refuses any clone whose HEAD is not the pinned revision, derives each served GLB with the
 * SAME functions the live downloader uses (assetTransport.ts), validates it, and writes:
 *   - src/server/AgentV3/gameAssets/reviewedLibraryBatch2.ts (reviewed catalogue entries, with exact `bytes`)
 *   - docs/game-engine/asset-candidates/2026-11-19-batch.json (evidence)
 * It never activates anything by itself; `scripts/library/admitLibraryBatch.mts` proves each entry live.
 * Usage: node --import tsx scripts/library/buildLibraryBatch.mts <directory holding the clones>
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { bundleGltf } from '../../src/server/AgentV3/gameAssets/gltfBundle';
import { bundleGlbResources } from '../../src/server/AgentV3/gameAssets/glbResourceBundle';
import { compactGlb } from '../../src/server/AgentV3/gameAssets/assetOptimize';
import { selectGlbAnimations } from '../../src/server/AgentV3/gameAssets/assetAnimationSelection';
import { validateGlb, ASSET_LIMITS } from '../../src/server/AgentV3/gameAssets/assetPolicy';
import type { ReviewedAsset } from '../../src/server/AgentV3/gameAssets/providers';
import type { ObjectCategory } from '../../src/server/lib/objectCatalogTypes';

interface Pack { owner: string; repo: string; revision: string; provider: 'kaykit' | 'kenney'; spdx: 'CC0-1.0' | 'MIT'; author: string; attribution: string; licenseFile: string; root: string }
const KAYKIT = (repo: string, revision: string, root: string): Pack => ({ owner: 'KayKit-Game-Assets', repo, revision, provider: 'kaykit', spdx: 'CC0-1.0', author: 'Kay Lousberg', attribution: 'KayKit by Kay Lousberg. CC0 1.0 Universal.', licenseFile: 'LICENSE.txt', root });
const KENNEY = (repo: string, revision: string, year: number, licenseFile: string): Pack => ({ owner: 'KenneyNL', repo, revision, provider: 'kenney', spdx: 'MIT', author: 'Kenney', attribution: `Copyright (c) ${year} Kenney`, licenseFile, root: 'models' });
const P = {
  city: KAYKIT('KayKit-City-Builder-Bits-1.0', '63976910ca04d16f0fc531b9c614244be8128713', 'addons/kaykit_city_builder_bits/Assets/gltf'),
  medieval: KAYKIT('KayKit-Medieval-Hexagon-Pack-1.0', '84fa4e91af6a88989be7c99e0891cede11f2ca38', 'addons/kaykit_medieval_hexagon_pack/Assets/gltf'),
  furniture: KAYKIT('KayKit-Furniture-Bits-1.0', '96d5930a8dbdb363409bbc2d3341718b00e17c9c', 'addons/kaykit_furniture_bits/Assets/gltf'),
  proto: KAYKIT('KayKit-Prototype-Bits-1.0', 'bb159596f4f5106b663741d002c8eb45c80c0f41', 'addons/kaykit_prototype_bits/Assets/gltf'),
  skeletons: KAYKIT('KayKit-Character-Pack-Skeletons-1.0', '15b62b9bad122f72926c10fb14d622c73819fa54', 'addons/kaykit_character_pack_skeletons'),
  racing: KENNEY('Starter-Kit-Racing', '2f2e5f2646dda89cb21d4e8539bab60c6e955dc8', 2023, 'LICENSE'),
  platformer: KENNEY('Starter-Kit-3D-Platformer', '3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0', 2023, 'LICENSE.md'),
  fps: KENNEY('Starter-Kit-FPS', '185fd2326d74a5cf858cffc616f87cf9696f9cc0', 2025, 'LICENSE.md'),
};
/** height = target bounding-box height in metres at runtime; tiles keep their thin native height. */
interface Row { id: string; pack: Pack; file: string; subjects: string[]; category: ObjectCategory; height: number; clips?: { walk: string; run: string; idle: string } }
const ROWS: Row[] = [
  // Vehicles
  { id: 'lib2-motorcycle', pack: P.racing, file: 'vehicle-motorcycle.glb', subjects: ['motorcycle'], category: 'vehicle-land', height: 1.2 },
  { id: 'lib2-truck-red', pack: P.racing, file: 'vehicle-truck-red.glb', subjects: ['truck'], category: 'vehicle-land', height: 2.6 },
  { id: 'lib2-truck-green', pack: P.racing, file: 'vehicle-truck-green.glb', subjects: ['truck'], category: 'vehicle-land', height: 2.6 },
  { id: 'lib2-truck-yellow', pack: P.racing, file: 'vehicle-truck-yellow.glb', subjects: ['truck'], category: 'vehicle-land', height: 2.6 },
  // Roads and tracks
  { id: 'lib2-road-junction', pack: P.city, file: 'road_junction.gltf', subjects: ['road junction tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-road-tsplit', pack: P.city, file: 'road_tsplit.gltf', subjects: ['road t junction tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-road-crossing', pack: P.city, file: 'road_straight_crossing.gltf', subjects: ['road crossing tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-road-curve', pack: P.city, file: 'road_corner_curved.gltf', subjects: ['curved road tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-track-straight', pack: P.racing, file: 'track-straight.glb', subjects: ['race track straight tile'], category: 'terrain', height: 0.5 },
  { id: 'lib2-track-corner', pack: P.racing, file: 'track-corner.glb', subjects: ['race track corner tile'], category: 'terrain', height: 0.5 },
  { id: 'lib2-track-finish', pack: P.racing, file: 'track-finish.glb', subjects: ['race finish line'], category: 'terrain', height: 3 },
  // Characters (animated enemies)
  ...(['Warrior', 'Minion', 'Mage', 'Rogue'] as const).map((n): Row => ({ id: `lib2-skeleton-${n.toLowerCase()}`, pack: P.skeletons, file: `Characters/gltf/Skeleton_${n}.glb`, subjects: ['skeleton'], category: 'character', height: 1.8, clips: { walk: 'Walking_A', run: 'Running_A', idle: 'Idle' } })),
  // Weapons and gear
  { id: 'lib2-axe', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Axe.gltf', subjects: ['axe'], category: 'weapon', height: 0.8 },
  { id: 'lib2-crossbow', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Crossbow.gltf', subjects: ['crossbow'], category: 'weapon', height: 0.4 },
  { id: 'lib2-blade', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Blade.gltf', subjects: ['sword'], category: 'weapon', height: 1.0 },
  { id: 'lib2-shield', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Shield_Large_A.gltf', subjects: ['shield'], category: 'weapon', height: 0.9 },
  { id: 'lib2-blaster', pack: P.fps, file: 'blaster.glb', subjects: ['blaster'], category: 'weapon', height: 0.3 },
  { id: 'lib2-blaster-repeater', pack: P.fps, file: 'blaster-repeater.glb', subjects: ['blaster'], category: 'weapon', height: 0.35 },
  // Pickups and markers
  { id: 'lib2-coin', pack: P.platformer, file: 'coin.glb', subjects: ['coin'], category: 'collectible', height: 0.5 },
  { id: 'lib2-coin-block', pack: P.platformer, file: 'block-coin.glb', subjects: ['coin block'], category: 'collectible', height: 1 },
  { id: 'lib2-coin-gold', pack: P.proto, file: 'Coin_A.gltf', subjects: ['coin'], category: 'collectible', height: 0.5 },
  { id: 'lib2-flag', pack: P.platformer, file: 'flag.glb', subjects: ['flag'], category: 'collectible', height: 1.6 },
  { id: 'lib2-flying-enemy', pack: P.fps, file: 'enemy-flying.glb', subjects: ['flying enemy'], category: 'character', height: 1 },
  // Furniture
  { id: 'lib2-bed', pack: P.furniture, file: 'bed_double_A.gltf', subjects: ['bed'], category: 'interior', height: 0.9 },
  { id: 'lib2-sofa', pack: P.furniture, file: 'couch.gltf', subjects: ['sofa'], category: 'interior', height: 0.9 },
  { id: 'lib2-armchair', pack: P.furniture, file: 'armchair.gltf', subjects: ['armchair'], category: 'interior', height: 0.9 },
  { id: 'lib2-chair', pack: P.furniture, file: 'chair_A.gltf', subjects: ['chair'], category: 'interior', height: 0.9 },
  { id: 'lib2-stool', pack: P.furniture, file: 'chair_stool.gltf', subjects: ['stool'], category: 'interior', height: 0.6 },
  { id: 'lib2-table', pack: P.furniture, file: 'table_medium.gltf', subjects: ['table'], category: 'interior', height: 0.75 },
  { id: 'lib2-lamp', pack: P.furniture, file: 'lamp_standing.gltf', subjects: ['lamp'], category: 'interior', height: 1.6 },
  { id: 'lib2-cabinet', pack: P.furniture, file: 'cabinet_medium.gltf', subjects: ['cabinet'], category: 'interior', height: 1 },
  { id: 'lib2-shelf', pack: P.furniture, file: 'shelf_A_big.gltf', subjects: ['shelf'], category: 'interior', height: 1.9 },
  { id: 'lib2-cactus', pack: P.furniture, file: 'cactus_medium_A.gltf', subjects: ['cactus'], category: 'vegetation', height: 1.5 },
  // Buildings (medieval village)
  { id: 'lib2-castle', pack: P.medieval, file: 'buildings/blue/building_castle_blue.gltf', subjects: ['castle'], category: 'building', height: 14 },
  { id: 'lib2-market', pack: P.medieval, file: 'buildings/red/building_market_red.gltf', subjects: ['market'], category: 'building', height: 5 },
  { id: 'lib2-tavern', pack: P.medieval, file: 'buildings/yellow/building_tavern_yellow.gltf', subjects: ['tavern'], category: 'building', height: 7 },
  { id: 'lib2-church', pack: P.medieval, file: 'buildings/green/building_church_green.gltf', subjects: ['church'], category: 'building', height: 11 },
  { id: 'lib2-watermill', pack: P.medieval, file: 'buildings/blue/building_watermill_blue.gltf', subjects: ['watermill'], category: 'building', height: 7 },
  { id: 'lib2-tower', pack: P.medieval, file: 'buildings/red/building_tower_A_red.gltf', subjects: ['tower'], category: 'building', height: 10 },
  { id: 'lib2-barracks', pack: P.medieval, file: 'buildings/green/building_barracks_green.gltf', subjects: ['barracks'], category: 'building', height: 6 },
  { id: 'lib2-bridge', pack: P.medieval, file: 'buildings/neutral/building_bridge_A.gltf', subjects: ['bridge'], category: 'building', height: 3 },
  // Nature and fences
  { id: 'lib2-mountain-b', pack: P.medieval, file: 'decoration/nature/mountain_B_grass_trees.gltf', subjects: ['mountain'], category: 'terrain', height: 30 },
  { id: 'lib2-hill-single', pack: P.medieval, file: 'decoration/nature/hill_single_A.gltf', subjects: ['hill'], category: 'terrain', height: 6 },
  { id: 'lib2-forest-grove', pack: P.medieval, file: 'decoration/nature/trees_A_large.gltf', subjects: ['forest grove'], category: 'vegetation', height: 8 },
  { id: 'lib2-fence', pack: P.medieval, file: 'buildings/neutral/fence_wood_straight.gltf', subjects: ['fence'], category: 'street-prop', height: 1.2 },
  { id: 'lib2-bench', pack: P.city, file: 'bench.gltf', subjects: ['bench'], category: 'street-prop', height: 0.9 },
  { id: 'lib2-dustbin', pack: P.city, file: 'trash_A.gltf', subjects: ['dustbin'], category: 'street-prop', height: 1 },
];

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const clones = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Supply the directory holding the pinned clones');
const reviewedAt = '2026-11-19';
const raw = (p: Pack, path: string) => `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.revision}/${path}`;
const blob = (p: Pack, path: string) => `https://github.com/${p.owner}/${p.repo}/blob/${p.revision}/${path}`;
const normal = (path: string) => path.split('/').reduce<string[]>((a, s) => s === '..' ? a.slice(0, -1) : s === '.' ? a : [...a, s], []).join('/');

const entries: ReviewedAsset[] = []; const evidence: unknown[] = []; const verifiedRepos = new Set<string>();
for (const row of ROWS) {
  const p = row.pack; const repoDir = join(clones, p.repo);
  if (!verifiedRepos.has(p.repo)) {
    assert.equal(execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), p.revision, `${p.repo} is not at the pinned revision`);
    assert.equal(execFileSync('git', ['-C', repoDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', `${p.repo} has local changes`);
    verifiedRepos.add(p.repo);
  }
  const path = normal(`${p.root}/${row.file}`); const source = await readFile(join(repoDir, path));
  const license = await readFile(join(repoDir, p.licenseFile));
  if (p.spdx === 'CC0-1.0') assert.match(license.toString(), /Creative Commons Zero, CC0/); else assert.match(license.toString(), /^MIT License/);
  const isGltf = path.endsWith('.gltf');
  const doc = isGltf ? JSON.parse(source.toString('utf8')) : JSON.parse(source.subarray(20, 20 + source.readUInt32LE(12)).toString('utf8'));
  const uris = [...(doc.buffers ?? []), ...(doc.images ?? [])].map((x: { uri?: string }) => x.uri).filter((u): u is string => !!u && !u.startsWith('data:'));
  const resources = await Promise.all([...new Set(uris)].map(async uri => {
    const rpath = normal(`${dirname(path)}/${decodeURIComponent(uri)}`); const bytes = await readFile(join(repoDir, rpath));
    return { path: uri, url: raw(p, rpath), sha256: sha(bytes), bytes };
  }));
  const map = new Map(resources.map(r => [r.path, r.bytes]));
  let format: ReviewedAsset['format']; let optimization: ReviewedAsset['optimization']; let derived: Uint8Array; let retained: string[] | undefined;
  if (row.clips) {
    assert.equal(resources.length, 0, `${row.id}: animated source must be self-contained`);
    format = undefined; optimization = 'animation-selection-v1'; retained = [row.clips.idle, row.clips.walk, row.clips.run];
    derived = selectGlbAnimations(source, sha(source), retained);
  } else if (isGltf) { format = 'gltf'; optimization = 'compact-v1'; derived = compactGlb(bundleGltf(source, map)).bytes; }
  else if (resources.length) { format = 'glb-resources'; optimization = 'compact-v1'; derived = compactGlb(bundleGlbResources(source, map)).bytes; }
  else { format = undefined; optimization = 'compact-v1'; derived = compactGlb(source).bytes; }
  const stats = validateGlb(derived);
  assert.ok(derived.byteLength <= ASSET_LIMITS.bytes);
  const animations = row.clips ? retained! : [];
  for (const clip of animations) assert.ok(stats.animations.includes(clip), `${row.id}: missing clip ${clip}`);
  const entry: ReviewedAsset = {
    provider: p.provider, id: row.id, revision: p.revision, sourceUrl: blob(p, path), downloadUrl: raw(p, path), sha256: sha(derived),
    subjects: row.subjects, animations, height: row.height, yaw: 0, downloadOrigins: ['https://raw.githubusercontent.com'],
    review: { reviewer: 'NavBharatAI asset admission', evidenceRevision: p.revision, freeDownload: true },
    license: { spdx: p.spdx, evidenceUrl: blob(p, p.licenseFile), reviewedAt, author: p.author, attribution: p.attribution, commercial: true, redistributeInGame: true, redistributeSource: true },
    ...(row.clips ? { animationRoles: { walk: row.clips.walk, run: row.clips.run, idle: row.clips.idle }, retainedAnimations: retained } : {}),
    optimization, sourceSha256: sha(source), bytes: derived.byteLength,
    ...(format ? { format } : {}),
    ...(resources.length ? { resources: resources.map(({ path, url, sha256 }) => ({ path, url, sha256 })) } : {}),
    libraryCategory: row.category,
  };
  entries.push(entry);
  evidence.push({ id: row.id, file: basename(path), sourceBytes: source.byteLength, bytes: derived.byteLength, triangles: stats.triangles, animations: stats.animations.length, licenseFileSha256: sha(license), license: p.spdx });
  console.log(row.id, derived.byteLength, stats.triangles);
}
const header = `import type { ReviewedAsset } from './providers';\n/** Library batch 2 (admin request 2026-11-19). Generated by scripts/library/buildLibraryBatch.mts from pinned public sources; do not hand-edit. Evidence: docs/game-engine/library-batch-2026-11-19.md */\nexport const REVIEWED_LIBRARY_BATCH_2: readonly ReviewedAsset[] = `;
await writeFile('src/server/AgentV3/gameAssets/reviewedLibraryBatch2.ts', header + JSON.stringify(entries, null, 2) + ';\n');
await writeFile('docs/game-engine/asset-candidates/2026-11-19-batch.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(`${entries.length} entries, ${entries.reduce((s, e) => s + e.bytes!, 0)} bytes`);

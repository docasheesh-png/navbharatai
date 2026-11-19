/**
 * Maintainer-only library batch builder (admin request 2026-11-19). Offline: reads LOCAL clones of the pinned
 * public repositories, refuses any clone whose HEAD is not the pinned revision, derives each served GLB with the
 * SAME functions the live downloader uses (assetTransport.ts), validates it, and writes:
 *   - src/server/AgentV3/gameAssets/reviewedLibraryBatch<N>.ts (reviewed catalogue entries, with exact `bytes`)
 *   - docs/game-engine/asset-candidates/library-batch-<N>.json (evidence; batch 2 kept its 2026-11-19-batch.json name)
 * It never activates anything by itself; `scripts/library/admitLibraryBatch.mts` proves each entry live.
 * Usage: node --import tsx scripts/library/buildLibraryBatch.mts <directory holding the clones> <batch number>
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
import type { Pack, Row } from './packs.mts';


const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const clones = resolve(process.argv[2] ?? '');
const batch = Number(process.argv[3] ?? 2);
assert.ok(process.argv[2] && Number.isInteger(batch) && batch >= 2, 'Supply the clones directory and a batch number');
const { ROWS, REVIEWED_AT: reviewedAt } = await import(`./batch${batch}.mts`) as { ROWS: Row[]; REVIEWED_AT: string };
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
const header = `import type { ReviewedAsset } from './providers';\n/** Library batch ${batch} (admin request 2026-11-19). Generated by scripts/library/buildLibraryBatch.mts from pinned public sources; do not hand-edit. Evidence: docs/game-engine/library-batch-2026-11-19.md */\nexport const REVIEWED_LIBRARY_BATCH_${batch}: readonly ReviewedAsset[] = `;
await writeFile(`src/server/AgentV3/gameAssets/reviewedLibraryBatch${batch}.ts`, header + JSON.stringify(entries, null, 2) + ';\n');
await writeFile(batch === 2 ? 'docs/game-engine/asset-candidates/2026-11-19-batch.json' : `docs/game-engine/asset-candidates/library-batch-${batch}.json`, JSON.stringify(evidence, null, 2) + '\n');
console.log(`${entries.length} entries, ${entries.reduce((s, e) => s + e.bytes!, 0)} bytes`);

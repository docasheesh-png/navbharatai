/**
 * Maintainer-only: records the exact served size of reviewed entries that predate per-entry `bytes` (2026-11-19).
 * Each entry is fetched through the production transport (downloadReviewedAsset), its sha256 must match the pinned
 * hash, and only then is `"bytes": N` written next to that exact hash. An undeclared entry costs the 5 MiB worst case
 * in the storage budget, so measuring them returns budget to the library without changing any served byte.
 * Usage: node --import tsx scripts/library/measureCatalogueBytes.mts
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reviewedCatalogue } from '../../src/server/AgentV3/gameAssets/reviewedCatalogue';
import { REVIEWED_LIBRARY_EXPANSION } from '../../src/server/AgentV3/gameAssets/reviewedExpansion';
import { downloadReviewedAsset } from '../../src/server/AgentV3/gameAssets/assetTransport';

const files = ['src/server/AgentV3/gameAssets/reviewedCatalogue.ts', 'src/server/AgentV3/gameAssets/reviewedExpansion.ts'];
const sizes = new Map<string, number>();
for (const c of [...reviewedCatalogue, ...REVIEWED_LIBRARY_EXPANSION]) {
  if (c.bytes !== undefined) continue;
  const bytes = await downloadReviewedAsset(c, AbortSignal.timeout(60_000));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256, `${c.id}: hash mismatch`);
  sizes.set(c.sha256, bytes.byteLength); console.log(c.id, bytes.byteLength);
}
for (const file of files) {
  let text = await readFile(file, 'utf8');
  for (const [sha, n] of sizes) {
    const line = `"sha256": "${sha}",`;
    const at = text.indexOf(line);
    if (at < 0) continue;
    assert.equal(text.indexOf(line, at + 1), -1, `${sha} appears twice in ${file}`);
    const indent = text.slice(text.lastIndexOf('\n', at) + 1, at);
    text = text.replace(line, `${line}\n${indent}"bytes": ${n},`);
  }
  await writeFile(file, text);
}
console.log(`${sizes.size} entries measured, ${[...sizes.values()].reduce((a, b) => a + b, 0)} bytes`);

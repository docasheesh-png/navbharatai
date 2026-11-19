/**
 * Maintainer-only LIVE admission of the recorded sound library (2026-11-19): each sound is downloaded from its
 * pinned URL through the production downloader, its size and sha256 must match the catalogue, and the DOWNLOADED
 * bytes must decode in Chromium to non-silent audio. Writes docs/game-engine/asset-candidates/sound-library-admission.json.
 * Usage: node --import tsx scripts/library/admitSoundLibrary.mts <playwright index.mjs>
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOUND_LIBRARY } from '../../src/server/AgentV3/gameAssets/soundLibraryCatalogue';
import { downloadGameAsset } from '../../src/server/AgentV3/gameAssets/assetDownload';

const { chromium } = await import(pathToFileURL(resolve(process.argv[2] ?? '')).href) as typeof import('playwright');
const browser = await chromium.launch(); const page = await browser.newPage(); await page.setContent('<html></html>');
const results: unknown[] = []; let failed = 0;
for (const s of SOUND_LIBRARY) {
  try {
    const bytes = await downloadGameAsset({ downloadUrl: s.url }, new Set(['https://raw.githubusercontent.com']), AbortSignal.timeout(60_000));
    assert.equal(bytes.byteLength, s.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), s.sha256);
    const m = await page.evaluate(async (b64: string) => {
      const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
      let peak = 0; for (const v of buf.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
      return { duration: buf.duration, peak };
    }, Buffer.from(bytes).toString('base64'));
    assert.ok(m.duration > 0.05 && m.peak > 0.05, 'silent');
    results.push({ name: s.name, sha256: s.sha256, bytes: s.bytes, decodedSeconds: Math.round(m.duration * 100) / 100, verdict: 'admitted' });
    console.log('PASS', s.name);
  } catch (e) { failed++; results.push({ name: s.name, verdict: 'rejected', reason: String((e as Error).message).slice(0, 200) }); console.log('FAIL', s.name, (e as Error).message); }
}
await browser.close();
await writeFile('docs/game-engine/asset-candidates/sound-library-admission.json', JSON.stringify({ checkedAt: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n');
console.log(`${results.length - failed} admitted, ${failed} rejected`); process.exit(failed ? 1 : 0);

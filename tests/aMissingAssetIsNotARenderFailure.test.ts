// Build 19e5f6fb (2026-10-18): a rendered app went RED/₹0 on one 404 echo after production-defaults
// wrote manifest/icon/sw.js. A static-asset 404 must not judge a render; real failures still must.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { isStaticAssetMiss, splitAssetMisses } from '../src/server/AgentV3/renderCheckConsole';

const URLLESS = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

describe('a static-asset 404 does not judge a render', () => {
  afterEach(() => { delete process.env['AGENTV3_ASSET_404_IGNORE']; });

  it('the reported URL-less echo and asset-named echoes are ignored', () => {
    expect(isStaticAssetMiss(URLLESS)).toBe(true);
    for (const u of ['/sw.js', '/manifest.webmanifest', '/icon.svg', '/favicon.ico', '/fonts/inter.woff2', '/logo.png?v=2']) {
      expect(isStaticAssetMiss(`https://5173-x.e2b.app${u} - ${URLLESS}`)).toBe(true);
    }
  });

  it('real failures still count', () => {
    for (const t of [
      `https://5173-x.e2b.app/src/lib/api.ts - ${URLLESS}`,
      `https://5173-x.e2b.app/src/App.tsx?t=1 - ${URLLESS}`,
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      "Uncaught TypeError: Cannot read properties of undefined (reading 'map')",
      'Error: Request failed with status code 404',
    ]) expect(isStaticAssetMiss(t)).toBe(false);
  });

  it('splits in order and has a no-deploy off switch', () => {
    const r = splitAssetMisses([URLLESS, 'Uncaught ReferenceError: x is not defined']);
    expect(r.kept).toEqual(['Uncaught ReferenceError: x is not defined']);
    expect(r.assetMisses).toEqual([URLLESS]);
    process.env['AGENTV3_ASSET_404_IGNORE'] = 'off';
    expect(splitAssetMisses([URLLESS]).kept).toEqual([URLLESS]);
    expect(splitAssetMisses(undefined as unknown as string[])).toEqual({ kept: [], assetMisses: [] });
  });

  it('is wired into the one console filter every render check uses', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/splitAssetMisses\(notAuth\)/);
    expect(src).toMatch(/PREVIEW_ASSET_404_IGNORED/);
  });
});

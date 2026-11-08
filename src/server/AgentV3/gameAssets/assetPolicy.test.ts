import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { isBinaryAsset, isEditableSourceFile } from '../fileClassification';
import { contentTypeFor } from '../bucketPublish';
import { assetDownloadUrl, downloadGameAsset } from './assetDownload';
import { vi } from 'vitest';
import type { AssetCandidate } from './assetPolicy';

describe('L3 asset policy', () => {
  it('runs the dependency-free malicious GLB and persistence/cache scenarios', () => {
    expect(execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/checks/gameAssetPolicy.check.mjs'], { encoding: 'utf8' })).toContain('PASS: GLB policy');
  });
  it('keeps GLBs binary and uses model MIME types when publishing', () => {
    expect(isBinaryAsset('public/game-assets/model.glb')).toBe(true);
    expect(isEditableSourceFile('public/game-assets/model.glb')).toBe(false);
    expect(isEditableSourceFile('public/game-assets/model.gltf')).toBe(true);
    expect(contentTypeFor('model.glb')).toBe('model/gltf-binary');
    expect(contentTypeFor('model.gltf')).toBe('model/gltf+json');
  });
  it.each(['http://assets.example/m.glb', 'https://assets.example.evil/m.glb', 'https://u:p@assets.example/m.glb', 'https://assets.example:444/m.glb', 'https://127.0.0.1/m.glb', 'https://assets.example/m.glb#secret'])('refuses unapproved URL %s', url => {
    expect(() => assetDownloadUrl(url, new Set(['https://assets.example']))).toThrow();
  });
  it('accepts only the exact HTTPS origin', () => {
    expect(assetDownloadUrl('https://assets.example/a.glb', new Set(['https://assets.example'])).pathname).toBe('/a.glb');
  });
  it('uses socket-level SSRF guard, no redirects, deadline and bounded body', async () => {
    const fake = vi.fn().mockResolvedValue(new Response(new Uint8Array(5 * 1024 * 1024 + 1)));
    vi.stubGlobal('fetch', fake);
    try {
      await expect(downloadGameAsset({ downloadUrl: 'https://assets.example/a.glb' } as AssetCandidate, new Set(['https://assets.example']), new AbortController().signal)).rejects.toThrow('byte budget');
      expect(fake.mock.calls[0][1]).toMatchObject({ redirect: 'error', dispatcher: expect.anything(), signal: expect.anything() });
    } finally { vi.unstubAllGlobals(); }
  });
});

// failedbr #1343 (2026-11-20): a pasted static HTML site, served by http-server, got its manifest, icon, sw.js and
// nbai-native.css written to public/ — the post-build pass asked the framework the REQUEST named (default vite-react),
// not the project on disk. The links point at "/", nothing serves public/ there: four 404s, one failed the render check.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultAssetPath, viteAppOnDisk } from '../src/server/AgentV3/appDefaults';

const disk = (files: Record<string, string>) => async (p: string) => {
  if (p in files) return files[p];
  throw new Error(`ENOENT ${p}`);
};

describe('the project on disk decides where the defaults go', () => {
  it('a static site (http-server, no vite) keeps them at the root', async () => {
    const vite = await viteAppOnDisk(disk({ 'index.html': '<html></html>', 'package.json': '{"scripts":{"start":"http-server ."},"devDependencies":{"http-server":"^14"}}' }));
    expect(vite).toBe(false);
    expect(defaultAssetPath('sw.js', vite ? 'vite' : null)).toBe('sw.js');
    expect(await viteAppOnDisk(disk({ 'index.html': '<html></html>' }))).toBe(false);
  });
  it('a Vite app — by config or by dependency — puts them in public/', async () => {
    expect(await viteAppOnDisk(disk({ 'vite.config.ts': 'export default {}' }))).toBe(true);
    expect(await viteAppOnDisk(disk({ 'package.json': '{"devDependencies":{"vite":"^5"}}' }))).toBe(true);
    expect(defaultAssetPath('sw.js', 'vite')).toBe('public/sw.js');
  });
  it('🔒 no writer passes the REQUESTED framework to defaultAssetPath — both ask the disk', () => {
    for (const f of ['src/server/routes/agentv3.ts', 'src/server/AgentV3/ToolDispatcher.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/viteAppOnDisk\(/);
      expect(src, f).not.toMatch(/defaultAssetPath\([^)]*\bframework\)/);
    }
  });
});

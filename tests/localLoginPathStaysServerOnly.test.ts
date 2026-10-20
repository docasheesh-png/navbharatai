import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

describe('local login AST proof dependency boundary', () => {
  it('uses an existing production parser dependency, not a frontend or dev-only dependency', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.dependencies.typescript).toBeTruthy();
    const helper = readFileSync('src/server/AgentV3/localLoginPath.ts', 'utf8');
    expect(helper).not.toMatch(/from ['"](?:node:|fs|http|https|child_process)/);
  });

  it('does not pull the scanner or compiler helper into the actual browser entry graph', async () => {
    // Parse/bundle only. No app code executes, no package install or network, no output files.
    const result = await build({ entryPoints: ['src/main.tsx'], bundle: true, platform: 'browser',
      packages: 'external', external: ['*.css', '*.svg', '*.png', '*.jpg', '*.woff2'],
      write: false, metafile: true, logLevel: 'silent', outfile: '/tmp/local-login-browser-boundary.js' });
    expect(Object.keys(result.metafile!.inputs).some((file) => /(?:fakeFeatureScan|localLoginPath|localLoginNotice)\.ts$/.test(file))).toBe(false);
  });
});

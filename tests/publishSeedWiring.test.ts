import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The unit tests beside `sandboxSeed.ts` prove the RULE. This proves it is WIRED into the path that
 * failed — the half that rots silently, because the helper can stay perfect while the route stops
 * calling it and nothing fails until a real user presses Publish.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('Publish seeds the sandbox before it builds', () => {
  it('the seed runs BEFORE npm run build, not after', () => {
    const at = route.indexOf("'/api/agentv3/publish'");
    expect(at).toBeGreaterThan(-1);
    const seg = route.slice(at, at + 6000);
    const seed = seg.indexOf('ensureWorkspaceFilesInSandbox');
    const build = seg.indexOf("runCommand(workspaceId, 'npm run build')");
    expect(seed).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    // Order is the entire fix: seeding after the build would restore files for nobody.
    expect(seed).toBeLessThan(build);
  });

  it('a not-ready workspace is refused with OUR sentence, before npm can produce ENOENT', () => {
    const at = route.indexOf("'/api/agentv3/publish'");
    const seg = route.slice(at, at + 6000);
    expect(seg).toContain('if (!seed.ready)');
    expect(seg).toContain('res.status(422).json({ error: seed.reason })');
  });
});

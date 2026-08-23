import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The unit tests beside `sandboxSeed.ts` prove the RULE. This proves it is WIRED into the path that
 * failed — the half that rots silently, because the helper can stay perfect while the route stops
 * calling it and nothing fails until a real user presses Publish.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

/**
 * The BODY of the publish handler, bounded by the next route registration.
 *
 * ⚠️ These tests used four fixed byte windows (6000, 6000, 9000, 9000) into the route, and every one
 * of them broke the moment the handler grew — while the code they assert about stayed perfectly
 * correct. This is the THIRD suite today with the same defect (managedDns at 2600, nbaiDomainHonesty
 * at 2200), so it is a pattern rather than an accident: a byte count is not the property under test,
 * "inside this handler" is, and handlers grow. Bounding by the next registration cannot drift.
 */
function publishRoute(): string {
  const at = route.indexOf("'/api/agentv3/publish'");
  expect(at).toBeGreaterThan(-1);
  const after = Math.min(
    ...['app.post(', 'app.get(', 'app.delete(']
      .map((m) => route.indexOf(m, at + 30))
      .filter((i) => i > -1)
      .concat([route.length]),
  );
  return route.slice(at, after);
}

describe('Publish seeds the sandbox before it builds', () => {
  it('the seed runs BEFORE npm run build, not after', () => {
    const at = route.indexOf("'/api/agentv3/publish'");
    expect(at).toBeGreaterThan(-1);
    const seg = publishRoute();
    const seed = seg.indexOf('prepareSandboxForBuild');
    const build = seg.indexOf("runCommand(workspaceId, 'npm run build')");
    expect(seed).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    // Order is the entire fix: seeding after the build would restore files for nobody.
    expect(seed).toBeLessThan(build);
  });

  it('a not-ready workspace is refused with OUR sentence, before npm can produce ENOENT', () => {
    const seg = publishRoute();
    expect(seg).toContain('if (!prep.ready)');
    expect(seg).toContain('res.status(422).json({ error: prep.reason })');
  });

  it('a failed dependency install is named as the FIRST CAUSE on a build failure', () => {
    // Without this the user is shown `sh: 1: tsc: not found` and goes hunting through their own code
    // for a fault that is not there. The install's failure is what they actually need to see.
    const seg = publishRoute();
    expect(seg).toContain('prep.installFailed');
    expect(seg).toContain("dependencies could not be installed");
  });

  it('a build that exits 0 but produces NO output directory is caught, with the build\'s own words', () => {
    // Admin 2026-08-19, third failure in one flow: the build succeeded and the deploy then died on
    // "Could not read the built site: exit status 1". Between those two facts the route knew nothing,
    // because a SUCCESSFUL build's output was discarded — so the one piece of evidence that explains
    // this class did not exist by the time anyone needed it.
    const seg = publishRoute();
    expect(seg).toContain("ls -d dist out build");
    expect(seg).toContain('produced no website files');
    // The build's own output must reach the user — discarding it is what made this undiagnosable.
    expect(seg).toContain('What the build printed');
  });

  it('the output check runs BETWEEN the build and the deploy', () => {
    const seg = publishRoute();
    const build = seg.indexOf("runCommand(workspaceId, 'npm run build')");
    const check = seg.indexOf("ls -d dist out build");
    const deploy = seg.indexOf('new ToolDispatcher');
    expect(build).toBeLessThan(check);
    expect(check).toBeLessThan(deploy);
  });
});

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
    //
    // ⚠️ RE-ANCHORED 2026-08-25. This used to pin the literal `ls -d dist out build …`, which is the
    // check that was REPLACED: `ls -d` proves a folder exists, not that it holds a site, so a leftover
    // `dist/` from an earlier app in the same workspace sailed through it. The invariant being pinned
    // here was never the shell command — it is that a build claiming success is checked for real output
    // before anything is deployed, and that the build's own words travel with the refusal. Both still
    // hold; the wording now lives in builtSiteCheck.ts (see tests/builtSiteCheck.test.ts).
    const seg = publishRoute();
    expect(seg).toContain('buildOutputCensusCommand(outCandidates)');
    expect(seg).toContain('builtSiteRefusal(');
    // The build's own output must reach the user — discarding it is what made this undiagnosable.
    expect(seg).toContain('buildSaid');
  });

  it('the output check runs BETWEEN the build and the deploy', () => {
    const seg = publishRoute();
    const build = seg.indexOf("runCommand(workspaceId, 'npm run build')");
    const check = seg.indexOf('buildOutputCensusCommand(outCandidates)');
    const deploy = seg.indexOf('new ToolDispatcher');
    expect(build).toBeLessThan(check);
    expect(check).toBeLessThan(deploy);
  });
});

/**
 * A REFUSAL IS MADE ON THE REAL FILES (admin 2026-08-25).
 *
 * `planDeployment` learned to ask whether the app's own source really IMPORTS a server framework —
 * the half that stops a dev-only `express` from being mistaken for a server. That half could never
 * fire from this route, which handed the planner four manifests and nothing else. The pure rule can
 * therefore be perfect while the route keeps refusing the same working app, which is exactly the
 * silent rot this file exists to catch.
 */
describe('Publish classifies the app from its real files, not its manifests alone', () => {
  it('a would-be REFUSAL re-plans with the workspace files before it refuses', () => {
    const seg = publishRoute();
    const firstPlan = seg.indexOf('planDeployment(planFiles)');
    const load = seg.indexOf('loadWorkspaceFiles(workspaceId)');
    const rePlan = seg.indexOf('planDeployment({ ...src, ...planFiles })');
    const refusal = seg.indexOf('deployDecision(plan');
    expect(firstPlan).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(rePlan).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(-1);
    // The order IS the fix: load and re-plan must both happen before anything is refused.
    expect(firstPlan).toBeLessThan(load);
    expect(load).toBeLessThan(rePlan);
    expect(rePlan).toBeLessThan(refusal);
  });

  it('the sandbox manifests still win over the durable copies', () => {
    // `{ ...src, ...planFiles }` and not the reverse — planFiles is read from the live sandbox and is
    // the freshest truth about what this app declares.
    expect(publishRoute()).toContain('planDeployment({ ...src, ...planFiles })');
  });

  it('the workspace files are loaded ONCE and reused by the wiring analysis', () => {
    const seg = publishRoute();
    // Two loads would double the cost of every refusal for no new information.
    expect(seg.split('loadWorkspaceFiles(workspaceId)').length - 1).toBe(1);
    expect(seg).toContain('analyzeApiWiring(src)');
  });

  it('the ordinary static publish pays NOTHING for this — the load is inside the refusal branch', () => {
    const seg = publishRoute();
    const guard = seg.indexOf('if (!plan.staticHostingSufficient)');
    const load = seg.indexOf('loadWorkspaceFiles(workspaceId)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(load);
  });
});

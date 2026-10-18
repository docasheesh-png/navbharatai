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
  /**
   * 🔁 REPOINTED, NOT DELETED (2026-10-17). These pinned the route's own INLINE staged read —
   * `planDeployment(planFiles)` … `planDeployment({ ...src, ...planFiles })`. That read was the
   * second of two copies, and both carried the same hole, so it now lives in ONE place
   * (`readServerHalf`) and the behaviour each of these protected is pinned there, on real inputs
   * rather than on source text: `appServerHalf.test.ts` proves the staged order, that the manifests
   * win over the full read, and the gate that the old code got wrong.
   *
   * What remains here is what only THIS file can check: that the publish route uses that read, that
   * its manifests still come from the SANDBOX, and that the refusal happens after it.
   */
  it('a would-be REFUSAL classifies through the shared staged read before it refuses', () => {
    const seg = publishRoute();
    const read = seg.indexOf('readServerHalf({');
    const sandbox = seg.indexOf('actuator.readFile(workspaceId, p)');
    const refusal = seg.indexOf('deployDecision(plan');
    expect(read, 'the route must not grow its own second copy of this read').toBeGreaterThan(-1);
    expect(sandbox, 'the manifests come from the live sandbox — the freshest truth mid-build').toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(-1);
    expect(read).toBeLessThan(refusal);
    // The full-source loader is handed to the read, so the re-plan cannot be skipped by this route.
    expect(seg.slice(read, refusal)).toContain('loadWorkspaceFiles(workspaceId)');
  });

  it('the route no longer plans inline — one staged read for the whole product', () => {
    const seg = publishRoute();
    expect(seg).not.toContain('planDeployment(planFiles)');
    expect(seg).not.toContain('planDeployment({ ...src, ...planFiles })');
  });

  it('the workspace files are loaded ONCE and reused by the wiring analysis', () => {
    const seg = publishRoute();
    // Two loads would double the cost of every refusal for no new information.
    expect(seg.split('loadWorkspaceFiles(workspaceId)').length - 1).toBe(1);
    expect(seg).toContain('analyzeApiWiring(src)');
  });

  /**
   * 🔴 THIS TEST USED TO ENCODE THE BUG AS A REQUIREMENT, which is why the bug survived a fix, a
   * regression test and two months.
   *
   * It asserted `if (!plan.staticHostingSufficient)` came BEFORE the full read — i.e. that the real
   * files are read ONLY for an app the four manifests already suspect of having a server. Measured on
   * `main`: a plain `node:http` app's manifest classifies as `unknown` with
   * `staticHostingSufficient: true`, so that guard was exactly what stopped the source from ever being
   * read, and the app was published as a static site with its API dead — Q-707, reopened by its own
   * cost optimisation. A test that pins the guard pins the hole.
   *
   * The cost guarantee it was protecting is REAL and is kept — it just has to be stated as the
   * guarantee rather than as one line of code: an app stage 1 CONCLUDES about (an `spa`, a plain
   * `static` site — the ordinary case) pays one small manifest read and nothing more. That is pinned
   * on real inputs in `appServerHalf.test.ts` ("an ordinary static app never pays for the full read"),
   * where it cannot be satisfied by a guard that happens to sit in the right place.
   */
  it('the cost guarantee is kept, and pinned where it can be MEASURED rather than read', () => {
    const seg = publishRoute();
    // The route hands the loader to the staged read instead of calling it unconditionally, so the
    // read's own gate decides — and that gate is tested on inputs, not on text.
    expect(seg).toContain('full: () => loadWorkspaceFiles(workspaceId)');
    expect(seg, 'an unconditional load here would charge every static publish').not.toMatch(
      /const src = await loadWorkspaceFiles/,
    );
  });
});

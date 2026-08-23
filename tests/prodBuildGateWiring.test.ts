import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { judgeProdBuild } from '../src/server/AgentV3/prodBuildGate';

/**
 * THE ONE COMMAND NO GATE EVER RAN.
 *
 * `tsc --noEmit` type-checks, the preview proves the DEV server renders, the vaccine runs the app's
 * tests. None of them executes `npm run build` — the command Publish, the APK workflow and every
 * deploy provider depend on. That blind spot let the scaffold ship a build script pointing at a
 * tsconfig it never wrote, failing on every app that provider made, until a user hit it mid-build.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the detector runs, and only where it is safe to', () => {
  it('is wired into the post-success advisory window', () => {
    expect(route).toContain('prodBuildGateEnabled() && expectsArtifacts && result.ok');
  });

  it('respects the same wall-clock headroom the vaccine does', () => {
    const i = route.indexOf('prodBuildGateEnabled() && expectsArtifacts');
    expect(route.slice(i, i + 260)).toContain('effectiveBuildSeconds * 1000 - 90_000');
  });

  it('is bounded — a hung bundler cannot eat the window', () => {
    const i = route.indexOf('prodBuildCommand()');
    expect(i).toBeGreaterThan(-1);
    expect(route.slice(i - 200, i + 200)).toContain('PROD_BUILD_TIMEOUT_MS');
  });

  it('skips a project with no real build script rather than "passing" it', () => {
    expect(route).toContain('if (buildScriptFrom(pkgRaw))');
  });
});

describe('it observes — it never changes the verdict', () => {
  it('does NOT feed classifyBuildOutcome', () => {
    // A green, rendering app whose production build is broken is a working app with a shipping
    // problem, not a failed build. Calling it BUILD_FAILED would lie to the user AND change what they
    // are charged, since a failed build is never billed.
    const i = route.indexOf('prodBuildGateEnabled() && expectsArtifacts');
    const block = route.slice(i, route.indexOf('APP HEALTH CULTURE — VACCINE', i));
    expect(block).not.toContain('classifyBuildOutcome');
    expect(block).not.toContain('result.ok = false');
  });

  it('a real failure is recorded UNRESOLVED — filing it as handled would be the lie', () => {
    expect(route).toContain("autoResolved: verdict.code !== 'PROD_BUILD_FAILED'");
  });

  it('every failure path inside it is swallowed', () => {
    // Bounded by the block's real END (the vaccine gate that follows it) rather than by a guessed
    // character count — a fixed window silently stops covering the block the moment anything is added
    // inside it, which is exactly what happened when the snapshot fallback landed here.
    const i = route.indexOf('prodBuildGateEnabled() && expectsArtifacts');
    const end = route.indexOf('APP HEALTH CULTURE — VACCINE', i);
    expect(i).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(i);
    expect(route.slice(i, end)).toContain('the detector must never affect a build it is only observing');
  });
});

describe('the guarantee, executed rather than grepped', () => {
  it('the VPN report’s exact failure is caught and named', () => {
    const j = judgeProdBuild({
      ran: true, exitCode: 2,
      output: "error TS5058: The specified path does not exist: 'tsconfig.build.json'.",
    });
    expect(j.code).toBe('PROD_BUILD_FAILED');
    expect(j.message).toContain('TS5058');
  });

  it('and a sandbox that went away is not blamed on the user', () => {
    expect(judgeProdBuild({ ran: false, exitCode: null, output: '' }).code).toBe('PROD_BUILD_UNVERIFIED');
  });
});

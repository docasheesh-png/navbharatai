import { describe, it, expect } from 'vitest';
import {
  prodBuildGateEnabled, buildScriptFrom, prodBuildCommand, summarizeProdBuildFailure,
  judgeProdBuild, prodBuildUserNote, PROD_BUILD_TIMEOUT_MS,
} from './prodBuildGate';
import { packageJson } from './sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

describe('the blind spot this closes', () => {
  it('our own scaffold ships a real build script — the one nothing was running', () => {
    // The VPN report's root cause lived here: this script ran `tsc -p tsconfig.build.json`, the provider
    // never wrote that file, and no gate ever executed the script to find out.
    const script = buildScriptFrom(packageJson);
    expect(script).toContain('vite build');
  });

  it('reproduces the exact failure it would have caught', () => {
    const j = judgeProdBuild({
      ran: true, exitCode: 2,
      output: "error TS5058: The specified path does not exist: 'tsconfig.build.json'.",
    });
    expect(j.code).toBe('PROD_BUILD_FAILED');
    expect(j.message).toContain('TS5058');
    expect(j.message).toContain('Publish and the APK');
  });
});

describe('buildScriptFrom — a placeholder proves nothing', () => {
  it('finds a real script', () => {
    expect(buildScriptFrom('{"scripts":{"build":"vite build"}}')).toBe('vite build');
  });

  it('refuses the scripts that "pass" without building', () => {
    // Running one of these and reporting success would be exactly the fake-success this file prevents.
    for (const s of ['echo no build', 'true', 'exit 0', ':', 'echo "nothing to build"']) {
      expect(buildScriptFrom(`{"scripts":{"build":${JSON.stringify(s)}}}`), s).toBeNull();
    }
  });

  it('is null when there is no script, no scripts block, or no package.json', () => {
    expect(buildScriptFrom('{"scripts":{}}')).toBeNull();
    expect(buildScriptFrom('{}')).toBeNull();
    expect(buildScriptFrom('')).toBeNull();
    expect(buildScriptFrom(null)).toBeNull();
  });

  it('is null rather than throwing on an unparseable package.json', () => {
    expect(buildScriptFrom('{ not json')).toBeNull();
  });
});

describe('judgeProdBuild — three outcomes, not two', () => {
  it('a clean build is OK', () => {
    const j = judgeProdBuild({ ran: true, exitCode: 0, output: 'built in 3.2s' });
    expect(j.code).toBe('PROD_BUILD_OK');
    expect(j.ok).toBe(true);
  });

  it('"could not run" is UNVERIFIED, never a fault in the user’s app', () => {
    // A sandbox that has gone away or a bundler that outran its timeout tells us nothing about the app.
    for (const input of [
      { ran: false, exitCode: null, output: '' },
      { ran: true, exitCode: null, output: 'timed out' },
    ]) {
      const j = judgeProdBuild(input);
      expect(j.code).toBe('PROD_BUILD_UNVERIFIED');
      expect(j.message).toContain('not a fault in your app');
    }
  });

  it('a non-zero exit is a real failure and carries the cause', () => {
    const j = judgeProdBuild({ ran: true, exitCode: 1, output: 'src/App.tsx(1,1): error TS2307: Cannot find module' });
    expect(j.ok).toBe(false);
    expect(j.ran).toBe(true);
    expect(j.message).toContain('TS2307');
  });
});

describe('summarizeProdBuildFailure — the cause, not the last 120 lines', () => {
  it('keeps the lines that name a failure and drops the progress noise', () => {
    const out = [
      'vite v5.4.1 building for production...', 'transforming...', '✓ 34 modules transformed',
      "src/App.tsx(9,3): error TS2551: Property 'titel' does not exist.",
      'rendering chunks...', 'npm ERR! code ELIFECYCLE',
    ].join('\n');
    const s = summarizeProdBuildFailure(out);
    expect(s).toContain('TS2551');
    expect(s).toContain('npm ERR!');
    expect(s).not.toContain('transforming...');
  });

  it('falls back to the raw tail when nothing looks like an error', () => {
    expect(summarizeProdBuildFailure('something odd\nhappened here')).toContain('something odd');
  });

  it('is capped, because a report nobody can read is a report nobody reads', () => {
    const huge = Array.from({ length: 400 }, (_, i) => `error number ${i} ${'x'.repeat(80)}`).join('\n');
    expect(summarizeProdBuildFailure(huge).length).toBeLessThanOrEqual(1201);
  });

  it('handles empty and absent output', () => {
    expect(summarizeProdBuildFailure('')).toBe('');
    expect(summarizeProdBuildFailure(null)).toBe('');
  });
});

describe('prodBuildUserNote — say something only when it matters', () => {
  it('says nothing on success', () => {
    expect(prodBuildUserNote(judgeProdBuild({ ran: true, exitCode: 0, output: '' }))).toBeNull();
  });

  it('says nothing when the check could not run — that is our infrastructure, not their app', () => {
    expect(prodBuildUserNote(judgeProdBuild({ ran: false, exitCode: null, output: '' }))).toBeNull();
  });

  it('on a real failure, tells them what it BLOCKS and what to say', () => {
    const note = prodBuildUserNote(judgeProdBuild({ ran: true, exitCode: 1, output: 'boom' }))!;
    expect(note).toContain('running fine');
    expect(note).toContain('Publish');
    expect(note).toContain('fix the production build');
  });

  it('names no vendor or internal tool', () => {
    const note = prodBuildUserNote(judgeProdBuild({ ran: true, exitCode: 1, output: 'boom' }))!;
    expect(note).not.toMatch(/e2b|sandbox|vite|tsc|npm|glm|kimi|claude|gemini|grok/i);
  });
});

describe('configuration', () => {
  it('is on by default, off only for the explicit kill switch', () => {
    expect(prodBuildGateEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(prodBuildGateEnabled({ AGENTV3_PROD_BUILD_GATE: 'off' } as never)).toBe(false);
  });

  it('is bounded, so a hung bundler cannot eat the advisory window', () => {
    expect(PROD_BUILD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PROD_BUILD_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
  });

  it('captures stderr, where bundlers put the useful part', () => {
    expect(prodBuildCommand()).toContain('2>&1');
  });
});

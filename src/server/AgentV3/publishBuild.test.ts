import { describe, it, expect } from 'vitest';
import { composeBuildFailureDetail, bundlerFallbackCommand, TYPECHECK_SKIPPED_WARNING } from './publishBuild';
import { thrownCommandOutput } from './sandbox/EngineerAI/actuators/sandboxHealth';

/**
 * REGRESSION (admin 2026-08-20): "Publish" failed for five days showing only "exit status 2".
 * tsc prints type errors to STDOUT and exits 2 with an EMPTY stderr; two `||` fallbacks in a row
 * (actuator: `err.stderr || err.message`; route: `stderr || stdout`) displaced the real diagnostics
 * with the synthesized exit-status string. These tests encode that exact failure shape.
 */
describe('thrownCommandOutput — the real channels survive the throw', () => {
  it('THE EXACT BUG: stdout-only diagnostics (tsc) are kept — err.message must NOT displace them', () => {
    const err = Object.assign(new Error('exit status 2'), {
      stdout: "src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      stderr: '',
    });
    const out = thrownCommandOutput(err);
    expect(out.stdout).toContain('TS2322');
    expect(out.stderr).toBe(''); // NOT "exit status 2"
  });

  it('stderr-only output (vite/npm) is kept as-is', () => {
    const err = Object.assign(new Error('exit status 1'), { stdout: '', stderr: 'vite build failed: rollup error' });
    expect(thrownCommandOutput(err)).toEqual({ stdout: '', stderr: 'vite build failed: rollup error' });
  });

  it('only a command with NO output at all falls back to the error message (SDK/network throw)', () => {
    const err = Object.assign(new Error('fetch failed'), { stdout: '', stderr: '' });
    expect(thrownCommandOutput(err).stderr).toBe('fetch failed');
    expect(thrownCommandOutput(null).stderr).toBeTruthy(); // never returns two empty channels silently
  });
});

describe('composeBuildFailureDetail — both channels, actionable part first', () => {
  it('keeps stdout diagnostics even when stderr also has content (the old `stderr || stdout` lost one)', () => {
    const d = composeBuildFailureDetail(
      'src/App.tsx(1,1): error TS2304: Cannot find name.',
      'npm error Lifecycle script `build` failed with error: npm error code 2',
    );
    expect(d).toContain('TS2304');
    expect(d).toContain('npm error code 2');
    expect(d.indexOf('TS2304')).toBeLessThan(d.indexOf('npm error')); // diagnostics lead
  });

  it('takes only the tail of each channel (long compiler output stays bounded)', () => {
    const longOut = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const d = composeBuildFailureDetail(longOut, '');
    expect(d).toContain('line 99');
    expect(d).not.toContain('line 0\n');
    expect(d.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('dedupes the degenerate case where both channels carry one identical message', () => {
    expect(composeBuildFailureDetail('exit status 2', 'exit status 2')).toBe('exit status 2');
  });
});

describe('bundlerFallbackCommand — publish must not be stricter than preview', () => {
  const pkg = (buildScript: string) => JSON.stringify({ scripts: { build: buildScript } });

  it("the v5 scaffold's script: `tsc -p tsconfig.build.json && vite build` → run the bundler alone", () => {
    const fb = bundlerFallbackCommand(pkg('tsc -p tsconfig.build.json && vite build'));
    expect(fb).not.toBeNull();
    expect(fb!.command).toContain('vite build');
    expect(fb!.command).toContain('node_modules/.bin'); // local binaries resolvable outside `npm run`
    expect(fb!.command).not.toMatch(/\btsc\b/);
    expect(fb!.gate).toBe('tsc -p tsconfig.build.json');
  });

  it('vue projects: `vue-tsc -b && vite build` also gets the fallback', () => {
    expect(bundlerFallbackCommand(pkg('vue-tsc -b && vite build'))?.command).toContain('vite build');
  });

  it('no fallback when the build IS the bundler (nothing to skip)', () => {
    expect(bundlerFallbackCommand(pkg('vite build'))).toBeNull();
  });

  it('no fallback when the remainder still contains a typecheck (skipping it would change semantics)', () => {
    expect(bundlerFallbackCommand(pkg('tsc && tsc -p other && echo hi'))).toBeNull();
  });

  it('no fallback for a non-typecheck gate (`npm run lint && vite build`)', () => {
    expect(bundlerFallbackCommand(pkg('npm run lint && vite build'))).toBeNull();
  });

  it('tolerates unreadable/absent package.json shapes without throwing', () => {
    expect(bundlerFallbackCommand('not json')).toBeNull();
    expect(bundlerFallbackCommand('{}')).toBeNull();
    expect(bundlerFallbackCommand(JSON.stringify({ scripts: {} }))).toBeNull();
  });

  it('the user-facing warning is provider-anonymous (White-Label Law)', () => {
    for (const banned of ['GLM', 'Kimi', 'Claude', 'Anthropic', 'Gemini', 'Grok', 'OpenAI']) {
      expect(TYPECHECK_SKIPPED_WARNING).not.toContain(banned);
    }
  });
});

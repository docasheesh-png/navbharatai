// THE LOCK ON "the generated workflow is not valid shell".
//
// Root cause, 2026-08-03: the .apk workflow's final Summary step was a run of
//   echo "…run \"Build Android App Bundle (.aab, signed)\" once you have added your signing secrets."
// Once emitted into YAML the escapes were gone, so bash saw an unquoted `(` and died with
// `syntax error near unexpected token '('`.
//
// The damage was much worse than a broken message. Summary runs LAST — after the .apk is built and
// uploaded — so the app was sitting in the artifact, finished and correct, and the run went RED anyway.
// Every successful APK build was reported to the user as a failure. Nothing in the test suite noticed,
// because every test asserted on the workflow as TEXT and none of them ever asked whether it would RUN.
//
// So this file executes the real check: parse each generated workflow as YAML, pull out every `run:`
// block, and hand it to `bash -n`. That is the same parse GitHub's runner does, and it catches the whole
// class — this bug, and every future quoting or escaping mistake in any generated script.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { load } from 'js-yaml';
import { generateShipKit } from './mobileShipKit';

interface Step { name?: string; run?: string; if?: string }
interface Workflow { on?: unknown; jobs: Record<string, { steps: Step[] }> }

/** Every generated workflow, parsed. A parse failure here is itself the bug. */
function workflows(): Array<{ path: string; wf: Workflow }> {
  const kit = generateShipKit({ appName: 'Test App', ios: true });
  return Object.entries(kit.files)
    .filter(([p]) => p.endsWith('.yml'))
    .map(([path, text]) => ({ path, wf: load(text) as Workflow }));
}

function steps(wf: Workflow): Step[] {
  return Object.values(wf.jobs).flatMap((j) => j.steps || []);
}

describe('every generated workflow is real, runnable YAML', () => {
  it('parses as YAML and declares at least one job with steps', () => {
    const all = workflows();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const { path, wf } of all) {
      expect(wf.jobs, `${path} has no jobs`).toBeTruthy();
      expect(steps(wf).length, `${path} has no steps`).toBeGreaterThan(0);
    }
  });

  it('THE REGRESSION: every run: block is syntactically valid bash', () => {
    for (const { path, wf } of workflows()) {
      for (const step of steps(wf)) {
        if (!step.run) continue;
        expect(() => {
          // -n parses without executing: exactly the check that was missing.
          execFileSync('bash', ['-n'], { input: step.run, stdio: ['pipe', 'pipe', 'pipe'] });
        }, `${path} → step "${step.name ?? '(unnamed)'}" is not valid shell`).not.toThrow();
      }
    }
  });

  it('the .apk summary specifically — the step that silently failed every good build', () => {
    const apk = workflows().find((w) => w.path.endsWith('android-apk.yml'))!;
    const summary = steps(apk.wf).find((s) => s.name === 'Summary');
    expect(summary?.run).toBeTruthy();
    // A quoted heredoc is what makes the prose literal. Plain echo is what broke.
    expect(summary!.run).toContain("<<'NBAI_EOF'");
    expect(() => execFileSync('bash', ['-n'], { input: summary!.run, stdio: 'pipe' })).not.toThrow();
  });
});

describe('the web-build step packages what the preview verified (piano APK #3, 2026-08-18)', () => {
  it('every workflow falls back to the bundler when ONLY the strict type check failed', () => {
    for (const { path, wf } of workflows()) {
      const build = steps(wf).find((s) => s.name === 'Build the web app');
      expect(build, `${path} has no web-build step`).toBeTruthy();
      // The strict script still runs first — the fallback fires only on a type-check-only failure,
      // and only for a Vite app (a real syntax error fails the bundler too, so nothing broken passes).
      expect(build!.run).toContain('npm run build');
      expect(build!.run).toContain("grep -qE 'error TS[0-9]+'");
      expect(build!.run).toContain('node_modules/.bin/vite');
      expect(build!.run).toContain('npx vite build');
      // The findings are surfaced, never hidden — an honest warning, not a silent bypass.
      expect(build!.run).toContain('::warning::');
    }
  });

  it('the step carries the heap the Gradle half already forces, so a large app cannot OOM', () => {
    for (const { path, wf } of workflows()) {
      const build = steps(wf).find((s) => s.name === 'Build the web app') as (Step & { env?: Record<string, string> });
      expect(build?.env?.NODE_OPTIONS, `${path} web-build step has no heap headroom`).toBe('--max-old-space-size=4096');
    }
  });
});

describe('the install step matches what is actually in the repository', () => {
  it('never runs npm ci unless a lock file is genuinely present', () => {
    for (const { path, wf } of workflows()) {
      const install = steps(wf).find((s) => /Install the app/.test(s.name || ''));
      expect(install, `${path} has no install step`).toBeTruthy();
      // The kit ships no lock file, so an unconditional `npm ci` would fail on every single run and
      // bury the real error under a lock-file complaint.
      expect(install!.run).toContain('if [ -f package-lock.json ]');
    }
  });

  it('recovers from a peer-dependency conflict, which npm has an exact fix for', () => {
    for (const { wf } of workflows()) {
      const install = steps(wf).find((s) => /Install the app/.test(s.name || ''))!;
      expect(install.run).toContain('--legacy-peer-deps');
    }
  });

  it('the kit still ships no lock file — the reason the branch above exists', () => {
    const kit = generateShipKit({ appName: 'Test App' });
    expect(Object.keys(kit.files)).not.toContain('package-lock.json');
  });
});

describe('a failed build explains itself', () => {
  it('both Android workflows report which stage stopped, only on failure', () => {
    for (const { path, wf } of workflows()) {
      if (!path.includes('android')) continue;
      const diag = steps(wf).find((s) => s.name === 'Explain what stopped the build');
      expect(diag, `${path} cannot explain a failure`).toBeTruthy();
      expect(diag!.if).toBe('failure()');
      // The machine-readable line the self-healing loop reads instead of guessing from a huge log.
      expect(diag!.run).toContain('NBAI_FAILED_STAGE=');
      // All four stages must be distinguishable, or the diagnosis is not actionable.
      for (const stage of ['install', 'webbuild', 'capacitor', 'android']) {
        expect(diag!.run).toContain(`STAGE=${stage}`);
      }
    }
  });

  it('the explanation is written for the user, not for an engineer', () => {
    const apk = workflows().find((w) => w.path.endsWith('android-apk.yml'))!;
    const diag = steps(apk.wf).find((s) => s.name === 'Explain what stopped the build')!;
    expect(diag.run).toMatch(/your app/i);
    expect(diag.run).toMatch(/press the build button again/i);
    expect(diag.run).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok/i);
  });
});

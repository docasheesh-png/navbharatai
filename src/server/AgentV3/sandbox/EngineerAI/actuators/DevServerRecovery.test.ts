import { describe, it, expect } from 'vitest';
import { classifyDevServerFailure, planDevServerRecovery, devServerHealthLine, validateProjectForPreview, devScriptPort } from './DevServerRecovery';

describe('validateProjectForPreview — catch a non-runnable project before the mystery dead port', () => {
  it('accepts a project with a dev script and reports which script to run', () => {
    const r = validateProjectForPreview(JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }));
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.runScript).toBe('dev');
  });

  it('falls back to start, then serve, when there is no dev script', () => {
    expect(validateProjectForPreview(JSON.stringify({ scripts: { start: 'node server.js' } })).runScript).toBe('start');
    expect(validateProjectForPreview(JSON.stringify({ scripts: { serve: 'vite preview' } })).runScript).toBe('serve');
  });

  it('flags a missing package.json', () => {
    const r = validateProjectForPreview(null);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('No package.json');
  });

  it('flags invalid JSON', () => {
    const r = validateProjectForPreview('{ "scripts": { "dev": }');
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('not valid JSON');
  });

  it('flags a package.json with no runnable script', () => {
    const r = validateProjectForPreview(JSON.stringify({ scripts: { build: 'vite build', test: 'vitest' } }));
    expect(r.ok).toBe(false);
    expect(r.runScript).toBeNull();
    expect(r.issues[0]).toContain('no "dev", "start", or "serve" script');
  });
});

describe('classifyDevServerFailure — deterministic root cause + recovery from real log signatures', () => {
  it('missing dependency ("Cannot find module") → reinstall', () => {
    const d = classifyDevServerFailure("Error: Cannot find module 'tailwindcss'\n    at ...");
    expect(d.cause).toBe('missing_module');
    expect(d.recovery).toBe('reinstall');
    expect(d.detail).toContain('tailwindcss');
  });

  it('vite "Failed to resolve import" → missing_module → reinstall', () => {
    const d = classifyDevServerFailure('[vite] Failed to resolve import "react-router-dom" from "src/App.tsx".');
    expect(d.cause).toBe('missing_module');
    expect(d.recovery).toBe('reinstall');
  });

  it('"vite: not found" (CLI missing) → missing_module → reinstall', () => {
    const d = classifyDevServerFailure('sh: 1: vite: not found');
    expect(d.cause).toBe('missing_module');
    expect(d.recovery).toBe('reinstall');
  });

  it('EADDRINUSE / port in use → kill_port_retry', () => {
    expect(classifyDevServerFailure('Error: listen EADDRINUSE: address already in use :::5173').recovery).toBe('kill_port_retry');
    const d = classifyDevServerFailure('Port 5173 is already in use');
    expect(d.cause).toBe('port_in_use');
    expect(d.detail).toContain('5173');
  });

  it('syntax/transform error → code_fix (a restart can never fix it)', () => {
    const d = classifyDevServerFailure('X [ERROR] Transform failed with 1 error:\nsrc/App.tsx:12:3: ERROR: Expected ")" but found "}"');
    expect(d.cause).toBe('code_error');
    expect(d.recovery).toBe('code_fix');
  });

  it('SyntaxError → code_fix', () => {
    expect(classifyDevServerFailure('SyntaxError: Unexpected token (5:10)').recovery).toBe('code_fix');
  });

  it('OOM / Killed → out_of_memory → plain_retry (the "Killed after ready" case)', () => {
    expect(classifyDevServerFailure('\n<--- Last few GCs --->\nFATAL ERROR: Reached heap limit — JavaScript heap out of memory').cause).toBe('out_of_memory');
    const killed = classifyDevServerFailure('vite ready in 300 ms\nKilled');
    expect(killed.cause).toBe('out_of_memory');
    expect(killed.recovery).toBe('plain_retry');
  });

  it('generic crash (npm ELIFECYCLE) → crash → plain_retry', () => {
    const d = classifyDevServerFailure('npm ERR! code ELIFECYCLE\nnpm ERR! Failed at the app@0.0.0 dev script.');
    expect(d.cause).toBe('crash');
    expect(d.recovery).toBe('plain_retry');
  });

  it('a busy port takes precedence over a generic Error: line (most-specific-first ordering)', () => {
    // Both an "Error:" and EADDRINUSE present — must classify as the specific port cause, not generic crash.
    expect(classifyDevServerFailure('Error: listen EADDRINUSE :::3000').cause).toBe('port_in_use');
  });

  it('unrecognised / empty log → unknown → plain_retry', () => {
    expect(classifyDevServerFailure('').cause).toBe('unknown');
    expect(classifyDevServerFailure('some unrelated noise with no error').recovery).toBe('plain_retry');
  });
});

describe('planDevServerRecovery — bounded, escalating, code-error short-circuit', () => {
  it('a code error is surfaced immediately, never retried (identical failure every restart)', () => {
    const p = planDevServerRecovery('SyntaxError: Unexpected token', 1, 3);
    expect(p.recovery).toBe('code_fix');
  });

  it('a recoverable cause retries while attempts remain', () => {
    expect(planDevServerRecovery("Cannot find module 'x'", 1, 3).recovery).toBe('reinstall');
  });

  it('escalates to give_up once attempts are exhausted', () => {
    const p = planDevServerRecovery("Cannot find module 'x'", 3, 3);
    expect(p.recovery).toBe('give_up');
    // The root cause detail is preserved so the report is still honest about WHY.
    expect(p.detail).toContain('x');
  });
});

describe('devServerHealthLine — honest UP / DOWN summary with real root cause', () => {
  it('UP line names the verified port for update_preview', () => {
    expect(devServerHealthLine(true, 5173)).toContain('UP on port 5173');
  });
  it('DOWN line carries the real root cause, not a generic message', () => {
    const d = classifyDevServerFailure("Cannot find module 'tailwindcss'");
    const line = devServerHealthLine(false, 5173, d);
    // Lowercase "did not come up on port 5173" so agentv3.ts parseDevServerHealthCheck still parses it.
    expect(line).toContain('did not come up on port 5173');
    expect(line).toContain('Root cause');
    expect(line).toContain('tailwindcss');
  });
});

describe('devScriptPort (port truth from the app\'s own dev script)', () => {
  const pkg = (dev: string) => JSON.stringify({ scripts: { dev } });
  it('parses --port N, --port=N, -p N and a PORT= env prefix', () => {
    expect(devScriptPort(pkg('tsx server.ts --host 0.0.0.0 --port 5173 --strictPort'))).toBe(5173);
    expect(devScriptPort(pkg('next dev --port=4000'))).toBe(4000);
    expect(devScriptPort(pkg('vite -p 8080'))).toBe(8080);
    expect(devScriptPort(pkg('PORT=3005 node server.js'))).toBe(3005);
  });
  it('falls back to start/serve when dev is absent', () => {
    expect(devScriptPort(JSON.stringify({ scripts: { start: 'node app.js --port 9000' } }))).toBe(9000);
  });
  it('returns null when no explicit port, bad JSON, or missing input', () => {
    expect(devScriptPort(pkg('vite'))).toBeNull();
    expect(devScriptPort('{broken')).toBeNull();
    expect(devScriptPort(null)).toBeNull();
    expect(devScriptPort(pkg('serve --port 999999'))).toBeNull(); // out of range
  });
});

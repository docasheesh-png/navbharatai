import { describe, it, expect } from 'vitest';
import { classifyDevServerFailure, planDevServerRecovery, devServerHealthLine, validateProjectForPreview, devScriptPort, parseDevServerHealthLine, missingPreviewReason, resolveDevRunCommand , devServerRunnerMissing } from './DevServerRecovery';

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

describe('parseDevServerHealthLine — trust the managed launcher\'s authoritative verdict', () => {
  it('reads the exact UP line devServerHealthLine emits (build report: port 5173)', () => {
    // The real 2026-07-06 case: npm run dev printed this, yet update_preview\'s re-poll missed the port.
    const line = devServerHealthLine(true, 5173);
    expect(parseDevServerHealthLine(line)).toEqual({ up: true, port: 5173 });
  });

  it('reads the "already healthy … reused it" line as UP', () => {
    const out = '[health-check] dev server already healthy on port 3000 — reused it (no relaunch; edits apply via HMR).';
    expect(parseDevServerHealthLine(out)).toEqual({ up: true, port: 3000 });
  });

  it('reads the DOWN line as not-up (with the port preserved)', () => {
    const line = devServerHealthLine(false, 5173, { cause: 'crash', recovery: 'plain_retry', detail: 'crashed' });
    expect(parseDevServerHealthLine(line)).toEqual({ up: false, port: 5173 });
  });

  it('returns null when the output carries no health verdict (caller falls back to its own probe)', () => {
    expect(parseDevServerHealthLine('VITE v5.4.21  ready in 280 ms')).toBeNull();
    expect(parseDevServerHealthLine('')).toBeNull();
  });

  it('finds the UP verdict even when buried in a longer dev-server log', () => {
    const out = 'npm run dev\n> app@1.0.0 dev\n> vite\n\n  VITE ready\n[health-check] dev server is UP on port 5173. Call update_preview with port=5173.';
    expect(parseDevServerHealthLine(out)).toEqual({ up: true, port: 5173 });
  });
});

describe('missingPreviewReason — honest cause when the sandbox has no readable package.json', () => {
  it('durable index empty → the files were not saved/restorable (not "no package.json")', () => {
    const r = missingPreviewReason([]);
    expect(r).toContain("couldn't find your saved project files");
    expect(r).not.toContain('No package.json found');
  });

  it('durable index HAS package.json → a failed restore, NOT a broken project', () => {
    const r = missingPreviewReason(['package.json', 'src/App.tsx', 'index.html']);
    expect(r).toContain('package.json is saved safely');
    expect(r).not.toContain('No package.json found');
  });

  it('matches a nested package.json (monorepo) as present', () => {
    expect(missingPreviewReason(['client/package.json', 'server/index.ts'])).toContain('saved safely');
  });

  it('durable index has files but genuinely NO package.json → the real structural message', () => {
    const r = missingPreviewReason(['index.html', 'styles.css', 'data.json']);
    expect(r).toContain('No package.json found');
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

  it('Prisma P1001 (DB reaped) → db_unreachable → reprovision_db (EstateNest autopsy)', () => {
    // The EXACT EstateNest health-check log: the from-scratch Prisma+Postgres app previewed ~13 min after
    // the build began; the provisioned Postgres was reaped, so `npm run dev` crashed on boot with P1001.
    const d = classifyDevServerFailure(
      "attempt 1 — The dev server crashed on startup — restarting. Error: P1001: Can't reach database server at `localhost:5432`",
    );
    expect(d.cause).toBe('db_unreachable');
    expect(d.recovery).toBe('reprovision_db');
  });

  it('P1001 wins over the generic "Error:" crash branch (most-specific-first — the real bug)', () => {
    // P1001's own line contains "Error:", which the generic crash branch also matches. Before the fix that
    // mis-classified it as `crash`/`plain_retry`, so both attempts were wasted on futile restarts that can
    // never revive a dead DB, ending in DB_UNREACHABLE. It MUST be db_unreachable, not crash.
    const d = classifyDevServerFailure("Error: P1001: Can't reach database server at `localhost:5432`");
    expect(d.cause).toBe('db_unreachable');
    expect(d.cause).not.toBe('crash');
  });

  it('raw connection-refused on the Postgres port → db_unreachable', () => {
    expect(classifyDevServerFailure('Error: connect ECONNREFUSED 127.0.0.1:5432').cause).toBe('db_unreachable');
    expect(classifyDevServerFailure('could not connect to server: Connection refused\n\tIs the server running on host "localhost" and accepting TCP/IP connections on port 5432?').cause).toBe('db_unreachable');
  });

  it('DB never provisioned — "DATABASE_URL must be set" → db_unreachable → reprovision_db (the Mitrify Drizzle crash)', () => {
    // The exact from-scratch Drizzle/Express boot crash: no DATABASE_URL anywhere (the Prisma-only
    // provisioner never fired). Must provision a DB, not blind-retry.
    const d = classifyDevServerFailure('Error: DATABASE_URL must be set. Did you forget to provision a database?\n    at <anonymous> (/home/user/workspace/server/db.ts:8:9)');
    expect(d.cause).toBe('db_unreachable');
    expect(d.recovery).toBe('reprovision_db');
  });
  it('other DATABASE_URL-missing phrasings also route to reprovision_db', () => {
    expect(classifyDevServerFailure('Error: DATABASE_URL is not set').cause).toBe('db_unreachable');
    expect(classifyDevServerFailure('Missing environment variable DATABASE_URL').cause).toBe('db_unreachable');
    expect(classifyDevServerFailure('Error: DATABASE_URL is required').cause).toBe('db_unreachable');
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

  it('a db_unreachable cause attempts reprovision_db (not short-circuited like code_error)', () => {
    const p = planDevServerRecovery("Error: P1001: Can't reach database server at `localhost:5432`", 1, 3);
    expect(p.recovery).toBe('reprovision_db');
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

describe('resolveDevRunCommand (Fix 32) — launch with the PROJECT\'S own run script, never a blind `npm run dev`', () => {
  it('uses `npm start` for a start-script app (the CoreUI report: Missing script "dev")', () => {
    expect(resolveDevRunCommand(JSON.stringify({ scripts: { start: 'vite', build: 'vite build' } }))).toBe('npm start');
  });
  it('prefers `dev` when both dev and start exist (the scaffold convention)', () => {
    expect(resolveDevRunCommand(JSON.stringify({ scripts: { dev: 'vite', start: 'node server.js' } }))).toBe('npm run dev');
  });
  it('falls through to `serve` when it is the only run script', () => {
    expect(resolveDevRunCommand(JSON.stringify({ scripts: { serve: 'vue-cli-service serve' } }))).toBe('npm run serve');
  });
  it('defaults to `npm run dev` when package.json is missing/unreadable/script-less', () => {
    expect(resolveDevRunCommand(null)).toBe('npm run dev');
    expect(resolveDevRunCommand('not json')).toBe('npm run dev');
    expect(resolveDevRunCommand(JSON.stringify({ scripts: { build: 'vite build' } }))).toBe('npm run dev');
  });
});

describe('classifyDevServerFailure — "Missing script" is a launch-command mismatch, never "no recognisable error"', () => {
  it('classifies the exact CoreUI log with an honest, actionable detail and no futile restart', () => {
    const log = 'npm error Missing script: "dev"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run';
    const d = classifyDevServerFailure(log);
    expect(d.cause).toBe('missing_script');
    expect(d.recovery).toBe('code_fix'); // restarting re-runs the same wrong command — never retry
    expect(d.detail).toContain('"dev"');
    expect(d.detail).toContain('npm start');
  });
});

describe('classifyDevServerFailure — CRA port phrasing (Fix 34a, Conduit report 2026-07-07)', () => {
  it('recognises "Something is already running on port 4100." as port_in_use → kill_port_retry', () => {
    const d = classifyDevServerFailure('> cross-env PORT=4100 react-scripts start\nSomething is already running on port 4100.');
    expect(d.cause).toBe('port_in_use');
    expect(d.recovery).toBe('kill_port_retry');
    expect(d.detail).toContain('4100');
  });
});

describe('devServerRunnerMissing (Fix 42) — a TCP-open port must NOT be trusted when the runner binary was not found', () => {
  it('detects the exact report log: "sh: 1: vite: not found"', () => {
    const log = '> counter-app@0.0.0 dev\n> vite --host 0.0.0.0 --port 5173 --strictPort\n\nsh: 1: vite: not found\n\n[health-check] dev server is UP on port 5173.';
    expect(devServerRunnerMissing(log)).toBe(true);
  });
  it('detects other framework CLIs not found', () => {
    expect(devServerRunnerMissing('next: command not found')).toBe(true);
    expect(devServerRunnerMissing('sh: 1: react-scripts: not found')).toBe(true);
  });
  it('is FALSE for a healthy log (never downgrades a genuinely-serving build)', () => {
    expect(devServerRunnerMissing('VITE v5.0 ready in 320 ms\n➜ Local: http://localhost:5173/')).toBe(false);
    expect(devServerRunnerMissing('')).toBe(false);
    // a missing npm MODULE (not the runner) is handled by reinstall, not this guard:
    expect(devServerRunnerMissing("Cannot find module 'react'")).toBe(false);
  });
});

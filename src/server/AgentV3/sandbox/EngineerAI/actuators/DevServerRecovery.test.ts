import { describe, it, expect } from 'vitest';
import { classifyDevServerFailure, planDevServerRecovery, devServerHealthLine, validateProjectForPreview, devScriptPort, parseDevServerHealthLine, missingPreviewReason, resolveDevRunCommand , devServerRunnerMissing, missingCredentialFromLog, terminalDetail, userFacingPreviewFailure, cleanPreviewLogForUser } from './DevServerRecovery';

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

describe('missing_credential — an old app that kills itself over an unset user key (2026-08-03)', () => {
  it('extracts the env var name from every real phrasing', () => {
    expect(missingCredentialFromLog(`Error: Missing RAZORPAY_KEY_SECRET`)).toBe('RAZORPAY_KEY_SECRET');
    expect(missingCredentialFromLog(`Error: Missing required environment variable: SMTP_HOST`)).toBe('SMTP_HOST');
    expect(missingCredentialFromLog(`Error: STRIPE_SECRET_KEY is required`)).toBe('STRIPE_SECRET_KEY');
    expect(missingCredentialFromLog(`Error: SENDGRID_API_KEY must be set`)).toBe('SENDGRID_API_KEY');
    expect(missingCredentialFromLog(`Error: TWILIO_AUTH_TOKEN is not defined`)).toBe('TWILIO_AUTH_TOKEN');
    expect(missingCredentialFromLog(`environment variable GOOGLE_MAPS_API_KEY is missing`)).toBe('GOOGLE_MAPS_API_KEY');
  });

  it('returns null when there is no missing-credential failure (never cries wolf)', () => {
    expect(missingCredentialFromLog('')).toBeNull();
    expect(missingCredentialFromLog('SyntaxError: Unexpected token }')).toBeNull();
    expect(missingCredentialFromLog('Error: connect ECONNREFUSED 127.0.0.1:6379')).toBeNull();
    // a single all-caps word without an underscore is NOT treated as an env var (precision over recall)
    expect(missingCredentialFromLog('Error: Missing APIKEY')).toBeNull();
  });

  it('classifies it as missing_credential → code_fix, NOT crash → plain_retry', () => {
    const d = classifyDevServerFailure(`> app@1.0.0 dev\nError: Missing RAZORPAY_KEY_SECRET\n    at Object.<anonymous> (/app/server/pay.ts:3:9)\nnpm ERR! ELIFECYCLE`);
    expect(d.cause).toBe('missing_credential');
    expect(d.recovery).toBe('code_fix'); // a restart can never help — the key is still unset next boot
  });

  it('the detail tells the agent exactly what to build instead (the "Coming soon" contract)', () => {
    const d = classifyDevServerFailure(`Error: STRIPE_SECRET_KEY is required`);
    expect(d.detail).toContain('STRIPE_SECRET_KEY');
    expect(d.detail).toContain('Coming soon');
    expect(d.detail).toContain('Settings → App Settings → Secrets & API Keys');
    expect(d.detail).toMatch(/never crash at boot/i);
    expect(d.detail).toMatch(/never fake a result/i);
  });

  it('DATABASE_URL still routes to db_unreachable — provisioning Postgres beats editing source', () => {
    for (const log of ['Error: DATABASE_URL must be set', 'Error: Missing DATABASE_URL', 'Error: DATABASE_URL is not defined']) {
      const d = classifyDevServerFailure(log);
      expect(d.cause).toBe('db_unreachable');
      expect(d.recovery).toBe('reprovision_db');
    }
    expect(missingCredentialFromLog('Error: Missing DATABASE_URL')).toBeNull();
  });

  it('the earlier, better-recovery causes still win over it', () => {
    // a busy port must still free the port, even though the same log mentions a missing key
    expect(classifyDevServerFailure('Error: listen EADDRINUSE :::5000\nError: Missing SMTP_HOST').cause).toBe('port_in_use');
    // a wrong launch command is still a launch-command mismatch
    expect(classifyDevServerFailure('npm error Missing script: "dev"').cause).toBe('missing_script');
    // a genuinely missing dependency still reinstalls
    expect(classifyDevServerFailure("Cannot find module 'razorpay'\nError: Missing RAZORPAY_KEY_ID").cause).toBe('missing_module');
  });

  it('planDevServerRecovery short-circuits it like any other code_fix (no wasted restarts)', () => {
    const log = 'Error: Missing RAZORPAY_KEY_SECRET';
    expect(planDevServerRecovery(log, 1, 2).recovery).toBe('code_fix');
    expect(planDevServerRecovery(log, 2, 2).recovery).toBe('code_fix');
  });
});

describe('planDevServerRecovery — every code_fix cause keeps its detail on the FINAL attempt', () => {
  // Regression: the short-circuit was keyed on cause === 'code_error', so on the last attempt a
  // missing_script / missing_credential was rewritten to 'give_up' and lost the actionable instruction.
  it.each([
    ['npm error Missing script: "dev"', 'missing_script'],
    ['Error: Missing RAZORPAY_KEY_SECRET', 'missing_credential'],
    ['SyntaxError: Unexpected token }', 'code_error'],
  ])('%s stays code_fix at the attempt limit', (log, cause) => {
    const d = planDevServerRecovery(log, 2, 2);
    expect(d.cause).toBe(cause);
    expect(d.recovery).toBe('code_fix');
    expect(d.detail.length).toBeGreaterThan(20); // the instruction survives, it is not replaced by give_up
  });

  it('a genuinely restartable cause still escalates to give_up when attempts run out', () => {
    const oom = 'FATAL ERROR: JavaScript heap out of memory';
    expect(planDevServerRecovery(oom, 1, 2).recovery).toBe('plain_retry');
    expect(planDevServerRecovery(oom, 2, 2).recovery).toBe('give_up');
  });
});

describe('terminalDetail — give_up must never promise an action we are not taking (mitrify 2026-08-04)', () => {
  // The reported build printed "provisioning PostgreSQL, writing DATABASE_URL, and retrying" at the exact
  // moment it stopped trying, and provisioned nothing. The cause survives; the promise must not.
  it('a db_unreachable give-up stops claiming a database is being provisioned', () => {
    const d = planDevServerRecovery('Error: connect ECONNREFUSED 127.0.0.1:5432', 2, 2);
    expect(d.recovery).toBe('give_up');
    expect(d.detail).not.toMatch(/provisioning PostgreSQL/i);
    expect(d.detail).not.toMatch(/and retrying/i);
    expect(d.detail).toMatch(/could not be started/i);
    expect(d.detail).toContain('Settings → App Settings → Database'); // what the user can actually do
    expect(d.cause).toBe('db_unreachable'); // the real cause is still reported
  });

  it('every other restartable cause also drops its "about to" promise', () => {
    const reinstall = planDevServerRecovery("Cannot find module 'left-pad'", 2, 2);
    expect(reinstall.detail).not.toMatch(/reinstalling dependencies and restarting/i);
    expect(reinstall.detail).toMatch(/still missing/i);

    const port = planDevServerRecovery('Error: listen EADDRINUSE :::5000', 2, 2);
    expect(port.detail).not.toMatch(/freeing it and restarting/i);
    expect(port.detail).toMatch(/stayed occupied/i);

    const oom = planDevServerRecovery('FATAL ERROR: JavaScript heap out of memory', 2, 2);
    expect(oom.detail).toMatch(/ran out of memory/i);
  });

  it('every terminal detail says recovery is exhausted, so the state is unambiguous', () => {
    for (const log of [
      'Error: connect ECONNREFUSED 127.0.0.1:5432',
      "Cannot find module 'x'",
      'Error: listen EADDRINUSE :::5000',
      'FATAL ERROR: JavaScript heap out of memory',
      'npm ERR! ELIFECYCLE',
      '',
    ]) {
      expect(planDevServerRecovery(log, 2, 2).detail).toMatch(/exhausted/i);
    }
  });

  it('BEFORE the attempts run out, the detail still describes the action being taken', () => {
    const d = planDevServerRecovery('Error: connect ECONNREFUSED 127.0.0.1:5432', 1, 2);
    expect(d.recovery).toBe('reprovision_db');
    expect(d.detail).toMatch(/provisioning PostgreSQL/i); // the loop is genuinely about to do this
  });
});

describe('userFacingPreviewFailure — plain language, real cause, one action (admin 2026-08-04)', () => {
  const of = (log: string, port = 5000) => userFacingPreviewFailure(classifyDevServerFailure(log), port, log);

  it('a missing key of the USER\'S OWN names the key and the exact screen', () => {
    const msg = of('Error: Missing RAZORPAY_KEY_SECRET');
    expect(msg).toContain('RAZORPAY_KEY_SECRET');
    expect(msg).toContain('Settings → App Settings → Secrets & API Keys');
    expect(msg).toMatch(/Everything else in the app is ready/);
  });

  it('a database failure points at the Database screen and reassures about ownership', () => {
    const msg = of('Error: connect ECONNREFUSED 127.0.0.1:5432');
    expect(msg).toContain('Settings → App Settings → Database');
    expect(msg).toMatch(/your own account/i);
  });

  it('never leaks developer instructions or file paths to the user', () => {
    for (const log of [
      'Error: Missing STRIPE_SECRET_KEY',
      'Error: connect ECONNREFUSED 127.0.0.1:5432',
      "Cannot find module 'left-pad'",
      'SyntaxError: Unexpected token } at /app/src/App.tsx:12',
      'Error: listen EADDRINUSE :::5000',
      'FATAL ERROR: JavaScript heap out of memory',
      'npm ERR! ELIFECYCLE',
      '',
    ]) {
      const msg = of(log);
      expect(msg).not.toMatch(/process\.env|Boolean\(|throw|\.tsx|\.ts:|node_modules|stack/i);
      expect(msg.length).toBeLessThan(320); // short enough to actually read
    }
  });

  it('the agent instruction and the user message are DIFFERENT strings', () => {
    const log = 'Error: Missing RAZORPAY_KEY_SECRET';
    const agent = classifyDevServerFailure(log).detail;
    const user = of(log);
    expect(agent).toMatch(/Coming soon/);   // written for the model
    expect(user).not.toMatch(/Coming soon/); // written for the human
    expect(user).not.toBe(agent);
  });

  it('a port conflict names the real port', () => {
    expect(of('Error: listen EADDRINUSE :::5000', 5000)).toContain('5000');
  });
});

describe('cleanPreviewLogForUser — no git noise in the panel a user reads', () => {
  it('drops the `?? path` untracked-file lines that leaked into the detail box', () => {
    const raw = [
      '[health-check] The app needs a database…',
      '?? .gitignore',
      '?? DEPLOY_NOW.md',
      '?? attached_assets/',
      '5:06:31 AM [express] serving on port 5000',
    ].join('\n');
    const clean = cleanPreviewLogForUser(raw);
    expect(clean).not.toContain('?? .gitignore');
    expect(clean).not.toContain('DEPLOY_NOW.md');
    expect(clean).toContain('[health-check] The app needs a database…');
    expect(clean).toContain('serving on port 5000'); // the real signal survives
  });

  it('leaves an ordinary log completely untouched', () => {
    const raw = 'Error: connect ECONNREFUSED 127.0.0.1:5432\n    at foo (bar.js:1:1)';
    expect(cleanPreviewLogForUser(raw)).toBe(raw);
    expect(cleanPreviewLogForUser('')).toBe('');
  });
});

/**
 * THE DEAD PREVIEW (admin 2026-09-08, verbatim): "v5 dwara app bana, e2b live preview chalana. aur 2-3
 * din bad preview band ho jana. kitna bhi wake up karo, wapas preview nahi chalna. … user chahe 1 sal
 * baad preview chalaye, preview chalna hi chalna chahiye."
 *
 * The investigation found one CHAIN of four links, and this file pins every one of them:
 *
 *  1. E2B killed, rather than paused, any sandbox the sweeps missed — so the durable id named a
 *     machine that no longer existed and every wake started from an empty one.
 *  2. The wake gave that cold revive 90 seconds, which the install alone exceeds; and on timeout the
 *     route released its sandbox hold while the install kept running, so the idle sweep paused the
 *     machine MID-INSTALL and left a torn node_modules no later wake could boot.
 *  3. Two wakes at once (a person pressing Wake up while the watchdog's auto-heal was already running)
 *     ran two installs into one node_modules.
 *  4. A wake that re-provisioned the database never ran the app's migrations, so the server came up
 *     over an empty schema.
 *
 * Each assertion here is one of the ways the chain could quietly re-form.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  sandboxLifecycle,
  previewWakeBudgetMs,
  PREVIEW_WAKE_MIN_MS,
  PREVIEW_WAKE_MAX_MS,
  PREVIEW_WAKE_DEFAULT_MS,
  isSandboxLocalDatabaseUrl,
  envFileValue,
  shouldMigrateOnWake,
} from '../src/server/AgentV3/previewWake';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const actuator = codeOnly(read('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'));
const routes = codeOnly(read('../src/server/routes/agentv3.ts'));

describe('link 1 — E2B pauses, never kills, when the hour runs out', () => {
  it('the lifecycle policy is pause, and does NOT hand E2B an auto-resume', () => {
    // autoResume would let any stale direct sandbox URL in a forgotten tab wake a paid machine with
    // nothing of ours (the capped door, the build-aware wake) in the loop.
    expect(sandboxLifecycle()).toEqual({ onTimeout: 'pause' });
    expect('autoResume' in sandboxLifecycle()).toBe(false);
  });

  it('🔒 every sandbox is created with it — it rides _opts, the one place create options are built', () => {
    const at = actuator.indexOf('private _opts(');
    expect(at).toBeGreaterThan(-1);
    const body = actuator.slice(at, actuator.indexOf('\n  }', at));
    expect(body).toContain('lifecycle: sandboxLifecycle()');
    // Placed BEFORE `...extra` so a caller's explicit override still wins — and nothing passes one.
    expect(body.indexOf('lifecycle: sandboxLifecycle()')).toBeLessThan(body.indexOf('...extra'));
    expect(actuator).not.toMatch(/lifecycle:\s*\{\s*onTimeout:\s*'kill'/);
  });
});

describe('link 2 — the wake budget is derived from the work, not a 90-second wall', () => {
  it('defaults to ten minutes: install bound + port wait + two recovery rounds, with margin', () => {
    expect(previewWakeBudgetMs({} as NodeJS.ProcessEnv)).toBe(PREVIEW_WAKE_DEFAULT_MS);
    expect(PREVIEW_WAKE_DEFAULT_MS).toBe(10 * 60_000);
    // A budget below the install's own 5-minute command bound would recreate the original defect.
    expect(PREVIEW_WAKE_DEFAULT_MS).toBeGreaterThan(5 * 60_000 + 25_000 + 120_000 + 20_000);
  });

  it('is env-tunable, and junk falls back to the default rather than to zero', () => {
    expect(previewWakeBudgetMs({ AGENTV3_PREVIEW_WAKE_SECONDS: '300' } as never)).toBe(300_000);
    for (const bad of ['0', '-5', 'abc', '', ' ']) {
      expect(previewWakeBudgetMs({ AGENTV3_PREVIEW_WAKE_SECONDS: bad } as never), JSON.stringify(bad)).toBe(PREVIEW_WAKE_DEFAULT_MS);
    }
  });

  it('🔒 clamps: a typo cannot reinstate the 90-second wall or hang a request', () => {
    expect(previewWakeBudgetMs({ AGENTV3_PREVIEW_WAKE_SECONDS: '5' } as never)).toBe(PREVIEW_WAKE_MIN_MS);
    expect(previewWakeBudgetMs({ AGENTV3_PREVIEW_WAKE_SECONDS: '999999' } as never)).toBe(PREVIEW_WAKE_MAX_MS);
    expect(PREVIEW_WAKE_MIN_MS).toBe(90_000);
    // Cloud Run's request timeout on this service is 3600 s (cloudbuild.yaml) — the max must fit inside it.
    expect(PREVIEW_WAKE_MAX_MS).toBeLessThan(3600 * 1000);
  });

  it('🔒 both revive sites use the budget — the literal 90_000 is gone from each', () => {
    expect(routes).toContain("previewWakeBudgetMs(), 'preview-diagnose')");
    expect(routes).toContain("previewWakeBudgetMs(), 'preview-server-revive')");
    expect(routes).not.toContain("90_000, 'preview-diagnose'");
    expect(routes).not.toContain("90_000, 'preview-server-revive'");
  });
});

describe('link 2, the other half — the sandbox is held for the OPERATION, not the caller\'s wait', () => {
  it('runCommand and ensureDependencies each hold the sandbox and release in finally', () => {
    for (const method of ['async runCommand(', 'async ensureDependencies(']) {
      const at = actuator.indexOf(method);
      expect(at, method).toBeGreaterThan(-1);
      const body = actuator.slice(at, actuator.indexOf('\n  }\n', at));
      expect(body, method).toContain('const release = this._holdSandboxOp(workspaceId);');
      const fin = body.slice(body.lastIndexOf('} finally {'));
      expect(fin, method).toContain('release();');
    }
  });

  it('🔒 the idle sweep skips a workspace with an operation in flight, BEFORE the idle comparison', () => {
    const at = actuator.indexOf('private async _sweepIdleSandboxes(');
    const sweep = actuator.slice(at, at + 900);
    const holdAt = sweep.indexOf('this._opInFlight(workspaceId)');
    const idleAt = sweep.indexOf('now - last > limit');
    expect(holdAt).toBeGreaterThan(-1);
    expect(idleAt).toBeGreaterThan(holdAt);
    // On the same guard as the build flag — one `continue`, two reasons a machine is not idle.
    expect(sweep).toMatch(/this\._buildInFlight\(workspaceId, now\) \|\| this\._opInFlight\(workspaceId\)/);
  });

  it('the idle clock is re-stamped at RELEASE, so five minutes start when the work ends', () => {
    const at = actuator.indexOf('private _holdSandboxOp(');
    const body = actuator.slice(at, actuator.indexOf('\n  }\n', at));
    expect(body).toContain('this._lastActivity.set(workspaceId, Date.now());');
    // Idempotent: a double release cannot drive the count negative and free a machine still working.
    expect(body).toContain('if (released) return;');
  });

  it('the work itself moved to _runCommandInner — no path runs a command without the hold', () => {
    expect(actuator).toContain('private async _runCommandInner(');
    // The only caller of the inner method is the holding wrapper.
    const calls = actuator.match(/this\._runCommandInner\(/g) ?? [];
    expect(calls.length).toBe(2); // the coalesced dev launch + the regular command
    const wrapperAt = actuator.indexOf('async runCommand(');
    const innerAt = actuator.indexOf('private async _runCommandInner(');
    for (const m of actuator.matchAll(/this\._runCommandInner\(/g)) {
      expect(m.index!).toBeGreaterThan(wrapperAt);
      expect(m.index!).toBeLessThan(innerAt);
    }
  });
});

describe('link 3 — two wakes cannot install into one node_modules at once', () => {
  it('a dev-server launch in flight is JOINED, not duplicated', () => {
    const at = actuator.indexOf('async runCommand(');
    const body = actuator.slice(at, actuator.indexOf('\n  }\n', at));
    expect(body).toContain('const inFlight = this._devLaunches.get(workspaceId);');
    expect(body).toContain('if (inFlight) return await inFlight;');
    expect(body).toContain('this._devLaunches.set(workspaceId, tracked);');
    // Cleared when it settles — and only if it is still the tracked one, so a later launch is never
    // deleted by an earlier one's finally.
    expect(body).toContain('if (this._devLaunches.get(workspaceId) === tracked) this._devLaunches.delete(workspaceId);');
  });

  it('only LONG-RUNNING commands are coalesced — a regular command still runs on its own', () => {
    const at = actuator.indexOf('async runCommand(');
    const body = actuator.slice(at, actuator.indexOf('\n  }\n', at));
    expect(body.indexOf('if (isLongRunningCommand(command))')).toBeLessThan(body.indexOf('this._devLaunches.get(workspaceId)'));
    expect(body).toContain('return await this._runCommandInner(workspaceId, command);');
  });
});

describe('link 4 — the wake replays the app\'s migrations, and ONLY against the sandbox\'s own database', () => {
  it('a loopback Postgres is the sandbox\'s own', () => {
    expect(isSandboxLocalDatabaseUrl('postgresql://postgres@localhost:5432/myapp')).toBe(true);
    expect(isSandboxLocalDatabaseUrl('postgres://user:pw@127.0.0.1:5432/db')).toBe(true);
    expect(isSandboxLocalDatabaseUrl('postgresql://postgres@[::1]:5432/postgres')).toBe(true);
  });

  it('🔒 a user\'s real database is never a migration target on a wake', () => {
    expect(isSandboxLocalDatabaseUrl('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')).toBe(false);
    expect(isSandboxLocalDatabaseUrl('postgresql://u:p@ep-cool-name.us-east-2.aws.neon.tech/neondb?sslmode=require')).toBe(false);
    expect(isSandboxLocalDatabaseUrl('mysql://root@localhost.evil.example.com/db')).toBe(false);
    // Malformed or empty is "no" — the safe side.
    for (const bad of ['', '   ', 'not a url', 'localhost', null, undefined, 42]) {
      expect(isSandboxLocalDatabaseUrl(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('reads DATABASE_URL out of a .env as the app would see it', () => {
    expect(envFileValue('PORT=3000\nDATABASE_URL=postgresql://postgres@localhost:5432/myapp\n', 'DATABASE_URL')).toBe('postgresql://postgres@localhost:5432/myapp');
    expect(envFileValue('DATABASE_URL="postgresql://postgres@localhost:5432/myapp"', 'DATABASE_URL')).toBe('postgresql://postgres@localhost:5432/myapp');
    expect(envFileValue("export DATABASE_URL='postgres://x@127.0.0.1/db'", 'DATABASE_URL')).toBe('postgres://x@127.0.0.1/db');
    // A prefix is not the key: DATABASE_URL_POOL must not answer for DATABASE_URL.
    expect(envFileValue('DATABASE_URL_POOL=postgres://x@localhost/pool\n', 'DATABASE_URL')).toBeNull();
    expect(envFileValue('DATABASE_URL=\n', 'DATABASE_URL')).toBeNull();
    expect(envFileValue('', 'DATABASE_URL')).toBeNull();
    expect(envFileValue(null, 'DATABASE_URL')).toBeNull();
  });

  it('all three conditions must hold', () => {
    const local = 'postgresql://postgres@localhost:5432/myapp';
    expect(shouldMigrateOnWake({ needsDb: true, hasMigration: true, databaseUrl: local })).toBe(true);
    expect(shouldMigrateOnWake({ needsDb: false, hasMigration: true, databaseUrl: local })).toBe(false);
    expect(shouldMigrateOnWake({ needsDb: true, hasMigration: false, databaseUrl: local })).toBe(false);
    expect(shouldMigrateOnWake({ needsDb: true, hasMigration: true, databaseUrl: 'postgresql://x@db.supabase.co/postgres' })).toBe(false);
    expect(shouldMigrateOnWake({ needsDb: true, hasMigration: true, databaseUrl: null })).toBe(false);
  });

  it('🔒 the wake route is wired: same detector as the import path, gated by the pure decision, recorded in the result', () => {
    const at = routes.indexOf("'preview-diagnose')");
    expect(at).toBeGreaterThan(-1);
    const after = routes.slice(at, at + 3000);
    expect(after).toContain('detectMigrationCommand(durableFiles)');
    expect(after).toContain('shouldMigrateOnWake({ needsDb: true, hasMigration: true, databaseUrl })');
    expect(after).toContain("envFileValue(envText, 'DATABASE_URL')");
    expect(after).toContain("shellEnvAssignment('DATABASE_URL', databaseUrl!)");
    // The migration runs AFTER the boot (the boot's own recovery is what provisions the database)
    // and BEFORE the health verdict is read — so its output is part of the log the verdict sees.
    expect(after.indexOf('detectMigrationCommand(durableFiles)')).toBeLessThan(after.indexOf("sendStage('Running the health check', 85)"));
    // Honest in the payload, whichever way it went.
    expect(routes).toContain('dbMigration,');
    expect(after).toContain("dbMigration = mres.exitCode === 0 ? 'applied' : 'failed'");
  });
});

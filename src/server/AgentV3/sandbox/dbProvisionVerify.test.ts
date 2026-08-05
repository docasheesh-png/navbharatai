import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  dbProvisionScript, parseDbProvision, provisionOutcomeNote, provisionDiagnostics, CANONICAL_DB_URL,
} from './dbProvisionVerify';

/**
 * The false success this module kills (Mitrify build d5f0a2bc): "Sandbox database provisioned in
 * 21s" was reported while the app's very next connect to the same URL got ECONNREFUSED. The script
 * emitted a fallback URL either way, and three call sites each printed success off the URL's mere
 * existence. These tests lock both halves: SELECT 1 is the only thing allowed to declare success,
 * and every caller says only what was proven.
 */
describe('dbProvisionScript — SELECT 1 decides, pg_isready only waits', () => {
  const script = dbProvisionScript();

  it('gates the success marker on a real SELECT 1 over the exact URL the app gets', () => {
    // pg_isready cannot see a missing database or broken auth; it is not what the app experiences.
    expect(script).toContain(`psql "${CANONICAL_DB_URL}" -Atc 'SELECT 1'`);
    // The marker is emitted only inside the SELECT-1-passed branch.
    const select1At = script.indexOf("SELECT 1");
    const markerAt = script.indexOf('echo "DB_URL:');
    expect(select1At).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(select1At);
  });

  it('distinguishes "server never accepted" from "accepted but the app URL cannot query"', () => {
    // Two different fixes: not-ready means start/keepalive; select1-failed means database/auth.
    // Collapsing them would hide which one the next attempt has to address.
    expect(script).toContain('DB_NOT_READY');
    expect(script).toContain('DB_SELECT1_FAILED');
  });

  it('still waits with the pg_isready poll — the right tool for "accepting yet?"', () => {
    expect(script).toContain('pg_isready -h localhost -p 5432 -q');
    expect(script).toContain('for i in $(seq 1 20)');
  });
});

describe('parseDbProvision — the outcome is data, never a guess', () => {
  it('a marker means verified, with the exact URL that passed', () => {
    expect(parseDbProvision(`noise\nDB_URL:${CANONICAL_DB_URL}\n`)).toEqual({
      url: CANONICAL_DB_URL, verified: true, failure: null,
    });
  });

  it('each failure marker keeps its own name', () => {
    expect(parseDbProvision('DB_NOT_READY')).toMatchObject({ url: null, verified: false, failure: 'not-ready' });
    expect(parseDbProvision('DB_SELECT1_FAILED')).toMatchObject({ verified: false, failure: 'select1-failed' });
  });

  it('a timeout / empty / garbage result is a FAILURE, never a maybe', () => {
    // The old code fell back to the canonical URL here — which is exactly how the false success
    // reached three different user-facing surfaces.
    for (const raw of [null, undefined, '', 'apt-get output only', 'error: something']) {
      const out = parseDbProvision(raw);
      expect(out.verified, String(raw)).toBe(false);
      expect(out.url, String(raw)).toBeNull();
      expect(out.failure, String(raw)).toBe('no-output');
    }
  });
});

describe('provisionOutcomeNote — one source, so three surfaces cannot drift again', () => {
  it('says "verified" only for the verified outcome', () => {
    expect(provisionOutcomeNote({ verified: true, failure: null })).toContain('verified with a real SELECT 1');
    for (const failure of ['not-ready', 'select1-failed', 'no-output'] as const) {
      const note = provisionOutcomeNote({ verified: false, failure });
      expect(note).not.toContain('verified');
      expect(note).not.toMatch(/^\(PostgreSQL provisioned —/);
    }
  });

  it('names the failure specifically enough to act on', () => {
    expect(provisionOutcomeNote({ verified: false, failure: 'not-ready' })).toContain('never accepted connections');
    expect(provisionOutcomeNote({ verified: false, failure: 'select1-failed' })).toContain('SELECT 1');
  });

  it('is honest that the fallback URL is still written, and why', () => {
    // Writing the URL on failure is deliberate (a late-starting Postgres heals without a rewrite);
    // hiding that would just move the surprise.
    expect(provisionOutcomeNote({ verified: false, failure: 'not-ready' })).toContain('DATABASE_URL written');
  });
});

describe('every surface that claimed success now consumes the verification', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

  it('E2BActuator provisions through the shared script and returns dbVerified', () => {
    const src = read('server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(src).toContain('dbProvisionScript()');
    expect(src).toContain('parseDbProvision(pgResult?.stdout)');
    expect(src).toContain('dbVerified: dbOutcome?.verified');
    // The old hard-coded success suffix is gone from the recovery path.
    expect(src).not.toContain("' (PostgreSQL provisioned + DATABASE_URL written to .env).'");
    expect(src).toContain('provisionOutcomeNote(');
  });

  it('the import-preview record claims "provisioned" only when verified', () => {
    const src = read('server/routes/agentv3.ts');
    expect(src).toContain('if (prov.dbVerified === false) {');
    expect(src).toContain('connection verified with a real SELECT 1');
  });

  it('the ToolDispatcher "✅ ready" line is earned, with an honest alternative', () => {
    const src = read('server/AgentV3/ToolDispatcher.ts');
    expect(src).toContain("if (prov?.dbVerified === false) {");
    expect(src).toContain('did not pass its connection test');
  });

  it('the watchdog arms only for a database that actually answered', () => {
    // Keeping alive a server that never worked would guard the wrong thing.
    const src = read('server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(src).toContain('if (dbOutcome.verified) {');
  });
});

/**
 * WHY it failed, not just THAT it failed (report 15985d3b). That build reported the truth — "the
 * server never accepted connections" — and still left us unable to say what to fix, because every
 * reason had been thrown away inside the sandbox script: pg_ctlcluster's error went to `| tail -3
 * || true`, the retry loop sent its own to /dev/null, and nothing recorded whether psql was even
 * installed. Measuring first is the same move that already exonerated the integrity pass.
 */
describe('the script explains a failure instead of only announcing it', () => {
  const script = dbProvisionScript();

  it('captures pg_ctlcluster\'s own error rather than discarding it', () => {
    expect(script).toContain('START_ERR=$(pg_ctlcluster');
    expect(script).toContain('DB_DIAG_START:');
    // The old form threw the error away entirely.
    expect(script).not.toContain('pg_ctlcluster "$PG_VER" main start 2>&1 | tail -3 || true');
  });

  it('records the facts that decide the fix — psql present, version resolved, which user', () => {
    // "Insufficient privileges" and "postgresql not installed" need completely different responses.
    expect(script).toContain('DB_DIAG_PSQL:');
    expect(script).toContain('DB_DIAG_PGVER:');
    expect(script).toContain('DB_DIAG_WHOAMI:');
  });

  it('keeps psql\'s error when SELECT 1 fails — a missing DB and a refused password differ', () => {
    expect(script).toContain('DB_DIAG_SELECT1:');
    expect(script).toContain("SELECT1=$(psql");
  });

  it('records pg_isready\'s reason when the server never came up', () => {
    expect(script).toContain('DB_DIAG_ISREADY:');
  });

  it('still emits exactly one outcome marker — the diagnostics do not change the verdict', () => {
    expect(parseDbProvision('DB_DIAG_PSQL:none\nDB_DIAG_START:boom\nDB_NOT_READY'))
      .toMatchObject({ verified: false, failure: 'not-ready' });
    expect(parseDbProvision(`DB_DIAG_WHOAMI:user\nDB_URL:${CANONICAL_DB_URL}`))
      .toMatchObject({ verified: true });
  });
});

describe('provisionDiagnostics — for the admin report, never for the user', () => {
  const raw = 'noise\nDB_DIAG_PSQL:/usr/bin/psql\nDB_DIAG_PGVER:16\nDB_DIAG_START:Insufficient privileges\nDB_NOT_READY';

  it('collects the diagnostic lines and drops the marker prefix', () => {
    expect(provisionDiagnostics(raw)).toBe('PSQL:/usr/bin/psql\nPGVER:16\nSTART:Insufficient privileges');
  });

  it('never picks up the outcome markers themselves', () => {
    expect(provisionDiagnostics(raw)).not.toContain('DB_NOT_READY');
  });

  it('returns empty for junk, so a caller can skip an empty detail', () => {
    expect(provisionDiagnostics('')).toBe('');
    expect(provisionDiagnostics(null)).toBe('');
    expect(provisionDiagnostics('DB_NOT_READY')).toBe('');
  });

  it('the report puts it in DETAIL, not in the message the user reads', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'routes', 'agentv3.ts'), 'utf8');
    const at = route.indexOf("code: 'IMPORT_DB_PROVISION_FAILED'");
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 1400);
    expect(block).toContain('detail: prov.dbDiagnostics');
    // The user's sentence stays plain English about what happened, not a shell error.
    expect(block).toContain('the app will likely fail to connect on boot');
  });
});

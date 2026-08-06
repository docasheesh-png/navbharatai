import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  dbProvisionScript, parseDbProvision, provisionOutcomeNote, provisionDiagnostics, CANONICAL_DB_URL,
  pgBinariesVersion, pgBinariesUrl, PG_BINARIES_VERSION_DEFAULT,
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
    // The gate MOVED into nbai_select1 (2026-08-06) so it can also run where psql does not exist —
    // a fetched Postgres build ships the server only. The invariant is unchanged: SELECT 1 over the
    // URL the app is handed, and nothing else, declares success.
    expect(script).toContain(`psql "$1" -Atc 'SELECT 1'`);
    expect(script).toContain('nbai_select1 "$APP_URL"');
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
    // Two shorter polls now instead of one 20s poll: the privileged cluster gets 8s (it either works
    // instantly or fails instantly with a privileges error), and our own instance gets 15s after
    // pg_ctl's own -w wait. The 20-count belonged to a path that could never succeed here.
    expect(script).toContain('pg_isready -h localhost -p 5432 -q');
    expect(script).toContain('for i in $(seq 1 8)');
    expect(script).toContain('for i in $(seq 1 15)');
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
    expect(script).toContain('OUT=$(psql "$1"');
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

/**
 * ROOT WAS NEVER AVAILABLE — the actual reason the preview could not work (2026-08-05).
 *
 * Verified by RUNNING the emitted script as a non-root user, which is the sandbox's real condition
 * (the build's own `ls -la` shows /home/user/workspace owned by "user user"):
 *
 *   DB_DIAG_START: Error: You must run this program as the cluster owner (postgres) or root
 *   DB_DIAG_PGCTL: waiting for server to start.... done / server started
 *   DB_URL:postgresql://postgres@localhost:5432/myapp        ← SELECT 1 passed
 *
 * That first line is the error the old script discarded, and it is why every provisioning attempt
 * failed in ~21s on every build: pg_ctlcluster, apt-get install and `su postgres` are all root-only.
 * The re-run took 0.2s, which is what makes the keepalive path free.
 */
describe('the database starts WITHOUT root — the fix that makes the preview work', () => {
  const script = dbProvisionScript();

  it('runs its own instance with initdb + pg_ctl, needing no privileges', () => {
    expect(script).toContain('initdb');
    expect(script).toContain('pg_ctl');
    expect(script).toContain('--auth=trust');
    // A directory we own, never /var/lib/postgresql.
    expect(script).toContain('.nbai-pgdata');
  });

  it('drops every root-only command from the path that has to succeed', () => {
    // `su postgres -c "createdb …"` was itself root-only, so even a running cluster could not get
    // the app's database created. Checked against the COMMANDS only — the comment above explains why
    // that command was removed and therefore names it, which is worth keeping.
    const commands = script.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    expect(commands).not.toContain('su postgres');
    expect(commands).toContain('createdb -h 127.0.0.1');
  });

  it('still tries the privileged cluster FIRST — it is instant when the template allows it', () => {
    const clusterAt = script.indexOf('pg_ctlcluster');
    const ourAt = script.indexOf('initdb');
    expect(clusterAt).toBeGreaterThan(-1);
    expect(ourAt).toBeGreaterThan(clusterAt);
  });

  it('is idempotent — an initialised directory and a running server are both no-ops', () => {
    // The keepalive/reprovision path re-runs this; measured at 0.2s on the second run.
    expect(script).toContain('if [ ! -f "$PGDATA/PG_VERSION" ]');
    expect(script).toContain('if ! pg_isready');
  });

  it('captures the server\'s OWN log when it still refuses to start', () => {
    // A refused start explains itself in exactly one place.
    expect(script).toContain('DB_DIAG_PGLOG:');
    expect(script).toContain('server.log');
  });

  it('binds to loopback only — a preview database is not a public one', () => {
    expect(script).toContain('-h 127.0.0.1');
  });

  it('keeps SELECT 1 as the only thing that declares success', () => {
    const markerAt = script.indexOf('echo "DB_URL:$APP_URL"');
    const selectAt = script.indexOf('if nbai_select1 "$APP_URL"; then');
    expect(selectAt).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(selectAt);
  });
});

/**
 * NO POSTGRES IN THE IMAGE AT ALL (report 26a8e81c measured it: `PSQL:none PGBIN:none`).
 *
 * Both existing paths had nothing to run, so every database app's boot died on ECONNREFUSED and the
 * honest conclusion was "the E2B template must be rebuilt" — an action only the admin can take, with a
 * whole class of app blocked behind it. A relocatable Postgres fetched over plain HTTPS into $HOME
 * removes that dependency: no root, no apt, no template change.
 *
 * Verified for real before shipping: the artifact downloads, unpacks, `initdb`s and starts as an
 * unprivileged user, and answers SELECT 1 through Node's pg driver.
 */
describe('pgBinariesVersion / pgBinariesUrl — pinned, never "latest"', () => {
  it('defaults to the pinned version', () => {
    expect(pgBinariesVersion({})).toBe(PG_BINARIES_VERSION_DEFAULT);
    expect(PG_BINARIES_VERSION_DEFAULT).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('an env override must be a plain x.y.z — anything else falls back rather than building a bad URL', () => {
    expect(pgBinariesVersion({ AGENTV3_PG_BINARIES_VERSION: '15.7.0' })).toBe('15.7.0');
    for (const bad of ['latest', '16', '16.4', '', '  ', '16.4.0; rm -rf /', '../../etc']) {
      expect(pgBinariesVersion({ AGENTV3_PG_BINARIES_VERSION: bad }), bad).toBe(PG_BINARIES_VERSION_DEFAULT);
    }
  });

  it('builds the exact artifact URL', () => {
    expect(pgBinariesUrl('16.4.0')).toBe(
      'https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/16.4.0/embedded-postgres-binaries-linux-amd64-16.4.0.jar',
    );
  });
});

describe('The script survives an image with NO postgres and NO client tools', () => {
  const script = dbProvisionScript();

  it('is valid shell — a generated script\'s syntax error is invisible until a real build', () => {
    // The whole thing is a string we compose; nothing else would catch an unbalanced quote.
    expect(() => execFileSync('bash', ['-n'], { input: script })).not.toThrow();
  });

  it('fetches a relocatable build ONLY when the image genuinely has none', () => {
    expect(script).toContain(pgBinariesUrl(PG_BINARIES_VERSION_DEFAULT));
    // Guarded on an empty PGBIN, so a template that already ships Postgres never pays for the download.
    expect(script).toContain('if [ -z "$PGBIN" ] && [ ! -x "$NBAI_PG/bin/initdb" ]; then');
    // And re-uses what it already unpacked, so a re-provision costs nothing.
    expect(script).toContain('if [ -z "$PGBIN" ] && [ -x "$NBAI_PG/bin/initdb" ]; then PGBIN="$NBAI_PG/bin"; fi');
  });

  it('has a fallback for every tool the unpack needs', () => {
    expect(script).toContain('curl -fsSL');
    expect(script).toContain('|| wget -q');       // curl is absent in some images
    expect(script).toContain('unzip -o -q pg.jar');
    expect(script).toContain('python3 -c');        // …and unzip is absent in others
    expect(script).toContain('|| jar xf pg.jar');
  });

  it('readiness never depends on pg_isready, which that build does not ship', () => {
    expect(script).toContain('nbai_pg_up() {');
    expect(script).toContain('pg_ctl" -D "$PGDATA" status');
    // The final gate asks the helper, not the binary directly — the bug this prevents is a running
    // server reported as "never accepted connections" purely because a client tool was missing.
    expect(script).toContain('if nbai_pg_up; then');
    expect(script).not.toContain('if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null || pg_isready -h localhost');
  });

  it('creates the app database with the SERVER itself, since createdb is a client tool', () => {
    // Without this the database NAME changed between paths: our canonical URL said `myapp` while the
    // database was really `postgres`, so any caller holding CANONICAL_DB_URL pointed at a database that
    // did not exist. `postgres --single` needs no client, no running server and no root — verified for
    // real against these exact binaries.
    expect(script).toContain('echo "CREATE DATABASE myapp;" | "$PGBIN/postgres" --single -D "$PGDATA" postgres');
    expect(script).toContain('DB_DIAG_CREATEDB:');
    // It runs on a FRESH data directory only, and BEFORE the server starts — single-user mode requires
    // the server to be stopped.
    const createAt = script.indexOf('CREATE DATABASE myapp;');
    const startAt = script.indexOf('pg_ctl" -D "$PGDATA" -o "-p 5432');
    expect(createAt).toBeGreaterThan(script.indexOf('initdb" -D "$PGDATA"'));
    expect(createAt).toBeLessThan(startAt);
  });

  it('the canonical URL is what every path reports — the fallback is a LAST resort, and proven', () => {
    expect(script).toContain(`echo "DB_URL:$APP_URL"`);
    // The postgres-database fallback is only reached after the app database itself failed to answer,
    // and it must ALSO pass SELECT 1 before its URL is reported.
    const firstTry = script.indexOf('if nbai_select1 "$APP_URL"; then');
    const fallback = script.indexOf('if nbai_select1 "$FALLBACK_URL"; then');
    expect(firstTry).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(firstTry);
    expect(script).toContain('echo "DB_URL:$FALLBACK_URL"');
  });

  it('verifies through Node\'s pg driver when psql is absent — never skips verification', () => {
    expect(script).toContain('command -v node');
    expect(script).toContain('require("pg")');
    // No client at all is an honest failure, not a pass.
    expect(script).toContain('no psql and no node in the sandbox');
  });

  it('a CRASHED node can never be read as a passing query', () => {
    // Found by running it for real: with the driver missing, node dies with a stack trace whose LAST
    // LINE is "Node.js v22.22.2" — and the first version of this used `tail -1`, so a crash was read
    // as the query result. Success is now an exact match on a marker only our own code prints.
    expect(script).toContain('console.log("NBAI_SELECT1="+String(r.rows[0].ok))');
    expect(script).toContain("grep -qx 'NBAI_SELECT1=1'");
    // Narrowly: the NODE verify must not end in `tail -1`. (A `tail -1` on a pure DIAGNOSTIC line is
    // fine — it decides nothing.)
    const at = script.indexOf('nbai_select1() {');
    const fn = script.slice(at, script.indexOf('\nif ! which psql', at));
    expect(fn).not.toContain("| tail -1)");
  });

  it('the fetched build lands in $HOME — no root, no apt, no template change', () => {
    expect(script).toContain('${HOME:-/tmp}/.nbai-pg');
    expect(script).not.toContain('sudo ');
  });
});

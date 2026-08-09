import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { envVarNames, conjurableSecrets, externalSecretVars, buildDevEnvContent } from '../src/server/AgentV3/ImportPreview';
import { analyzePreviewHtml, jsonErrorBody } from '../src/server/AgentV3/PreviewVerify';

/**
 * FORENSIC AUTOPSY — build report d6deaaf0 (Mitrify import, 2026-08-09).
 *
 * The run looked clean: "✅ Live preview is up on port 3000". The admin's screen showed
 * `{"message":"secret option required for sessions"}` — the app served an error to EVERY request.
 * Three reported symptoms turned out to have TWO root causes, both fixed here:
 *
 *  ROOT CAUSE 1 — env discovery read a file the project does not have.
 *    `envVarNames` only parsed `.env.example` / `.env.sample` / `.env.template`. Mitrify commits
 *    none of them, so the list was EMPTY. Consequences, all from that one gap: no SESSION_SECRET was
 *    conjured (express-session then rejected every request), and the honest "these external services
 *    still need real values" note never appeared. A committed example file is a courtesy; a
 *    `process.env.X` in the source is the truth every project has.
 *
 *  ROOT CAUSE 2 — the install guarantee was attached to the dev-server COMMAND, not the WORKSPACE.
 *    `npm run db:push` ran before `npm install` and died `sh: 1: drizzle-kit: not found` (exit 127),
 *    so the database stayed empty and every data page failed.
 *
 *  ROOT CAUSE 3 (the honesty failure) — the preview verifier had no rule for a JSON error body, so a
 *    dead app was reported as a working preview.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('ROOT CAUSE 1 — env vars are discovered from the CODE, not just a file that may not exist', () => {
  it('finds process.env reads when the project commits NO .env.example (the exact Mitrify shape)', () => {
    const files = {
      'package.json': '{"name":"rest-express"}',
      'server/replit_integrations/auth/replitAuth.ts':
        'const s = process.env.SESSION_SECRET;\nif (!process.env.GOOGLE_CLIENT_ID) console.log("Google OAuth not configured");',
      'server/db.ts': 'const url = process.env["DATABASE_URL"];',
      'client/src/lib/firebase.ts': 'const k = import.meta.env.VITE_FIREBASE_API_KEY;',
    };
    const names = envVarNames(files);
    expect(names).toContain('SESSION_SECRET');
    expect(names).toContain('GOOGLE_CLIENT_ID');
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('VITE_FIREBASE_API_KEY');
  });

  it('THE FIX THAT MATTERS: SESSION_SECRET is now conjured, so express-session gets a real secret', () => {
    const files = { 'server/auth.ts': 'session({ secret: process.env.SESSION_SECRET })' };
    const secrets = conjurableSecrets(envVarNames(files));
    expect(secrets.SESSION_SECRET).toBeTruthy();
    expect(secrets.SESSION_SECRET.length).toBeGreaterThanOrEqual(16);
    // And it reaches the .env the dev server actually loads.
    expect(buildDevEnvContent(envVarNames(files), secrets)).toMatch(/^SESSION_SECRET=.+$/m);
  });

  it('the honest "still needs real values" list now sees third-party keys the code reads', () => {
    const files = { 'server/pay.ts': 'process.env.CASHFREE_APP_ID; process.env.SESSION_SECRET;' };
    const ext = externalSecretVars(envVarNames(files));
    expect(ext).toContain('CASHFREE_APP_ID');
    expect(ext).not.toContain('SESSION_SECRET'); // we CAN provision this one — it is not the user's problem
  });

  it('the documented template still leads the order, and is never lost', () => {
    const files = {
      '.env.example': 'DATABASE_URL=\nSTRIPE_KEY=',
      'src/a.ts': 'process.env.OTHER_THING',
    };
    expect(envVarNames(files).slice(0, 2)).toEqual(['DATABASE_URL', 'STRIPE_KEY']);
    expect(envVarNames(files)).toContain('OTHER_THING');
  });

  it('scans only source files, de-duplicates, and survives junk input', () => {
    const files = {
      'README.md': 'process.env.DOCS_ONLY',            // prose, not code
      'logo.png': 'process.env.BINARY_NOISE',
      'src/a.ts': 'process.env.DUP; process.env.DUP;',
    };
    const names = envVarNames(files);
    expect(names).toEqual(['DUP']);
    expect(envVarNames({})).toEqual([]);
    expect(envVarNames({ 'src/a.ts': null as any })).toEqual([]);
  });

  it('a repeated scan returns the SAME answer (a /g regex must not carry state between calls)', () => {
    const files = { 'src/a.ts': 'process.env.A; process.env.B;', 'src/b.ts': 'process.env.C;' };
    expect(envVarNames(files)).toEqual(envVarNames(files));
    expect(envVarNames(files)).toEqual(['A', 'B', 'C']);
  });
});

describe('ROOT CAUSE 2 — dependencies are installed before a command that needs their binaries', () => {
  const route = read('src/server/routes/agentv3.ts');
  const iface = read('src/server/AgentV3/sandbox/EngineerAI/actuators/IEngineerActuator.ts');
  const e2b = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');

  it('the guarantee exists at the WORKSPACE level, not inside the dev-server launch path', () => {
    expect(iface).toContain('ensureDependencies?(workspaceId: string)');
    expect(e2b).toContain('async ensureDependencies(workspaceId: string)');
  });

  it('it reuses the SAME staleness check and installer as the boot — one implementation, no drift', () => {
    const at = e2b.indexOf('async ensureDependencies');
    const seg = e2b.slice(at, at + 1400);
    expect(seg).toContain('buildDepsStaleCheckCommand()');
    expect(seg).toContain('this._npmInstall(sandbox)');
  });

  it('the migration call site installs FIRST and skips the migration when the install fails', () => {
    const at = route.indexOf('const migration = needsDb');
    const seg = route.slice(at, at + 3500);
    expect(seg).toContain('ensureDependencies?.(workspaceId)');
    expect(seg.indexOf('ensureDependencies?.(workspaceId)')).toBeLessThan(seg.indexOf('import-db-migrate'));
    expect(seg).toContain('IMPORT_DB_MIGRATIONS_SKIPPED');
    // Running a command whose binary certainly does not exist only buys a confusing exit 127.
    expect(seg).toContain('if (depsReady)');
  });

  it('a missing implementation is tolerated — an actuator without it must not break the boot', () => {
    const at = route.indexOf('const migration = needsDb');
    expect(route.slice(at, at + 3500)).toContain('?? { ok: true, ran: false, log: \'\' }');
  });
});

describe('ROOT CAUSE 3 — a JSON error body is NOT a working preview', () => {
  it('catches the exact body the admin saw, which used to pass as "rendered"', () => {
    const body = '{"message":"secret option required for sessions"}';
    expect(jsonErrorBody(body)).toBe('secret option required for sessions');
    const verdict = analyzePreviewHtml(body);
    expect(verdict.rendered).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/error instead of the app/);
    expect(verdict.problems.join(' ')).toMatch(/secret option required/);
  });

  it('catches explicit error envelopes whatever their wording', () => {
    expect(jsonErrorBody('{"error":"Internal Server Error"}')).toBeTruthy();
    expect(jsonErrorBody('{"statusCode":500,"message":"boom"}')).toBeTruthy();
    expect(jsonErrorBody('{"message":"Cannot connect to database"}')).toBeTruthy();
    expect(jsonErrorBody('{"message":"Unauthorized"}')).toBeTruthy();
  });

  it('does NOT flag a healthy API greeting — an API-first project is not a broken one', () => {
    expect(jsonErrorBody('{"message":"API is running"}')).toBe('');
    expect(jsonErrorBody('{"status":"ok","version":"1.0.0"}')).toBe('');
    expect(jsonErrorBody('{"name":"rest-express"}')).toBe('');
  });

  it('ignores anything that is not a small JSON object (real HTML pages are untouched)', () => {
    expect(jsonErrorBody('<html><body><h1>My app</h1></body></html>')).toBe('');
    expect(jsonErrorBody('[{"error":"in an array"}]')).toBe('');
    expect(jsonErrorBody('{not json')).toBe('');
    expect(jsonErrorBody(`{"error":"${'x'.repeat(3000)}"}`)).toBe(''); // a data payload, not a status envelope
    expect(jsonErrorBody('')).toBe('');
  });

  it('a genuine app page still passes (no regression in the happy path)', () => {
    const html = '<html><body><div id="root"><h1>Mitrify</h1><p>Find nearby service providers</p></div></body></html>';
    expect(analyzePreviewHtml(html).rendered).toBe(true);
  });

  it('a long error message is truncated rather than pasted whole into the verdict', () => {
    const msg = `database error: ${'y'.repeat(500)}`;
    expect(jsonErrorBody(`{"message":"${msg}"}`)).toMatch(/…$/);
  });
});

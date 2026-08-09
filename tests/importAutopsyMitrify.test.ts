import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { envVarNames, conjurableSecrets, externalSecretVars, buildDevEnvContent } from '../src/server/AgentV3/ImportPreview';
import { analyzePreviewHtml, jsonErrorBody } from '../src/server/AgentV3/PreviewVerify';
import { BuildDiagnostics, commandKey, recoveredCommands, failureHasSurvivingConsequence } from '../src/server/AgentV3/BuildDiagnostics';

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

// ─────────────────────────────────────────────────────────────────────────────
// SECOND PASS over the same report (admin: "autopsy me kuch bacha hai?"). Two more findings, both
// of which the FIRST pass missed — and the first one is the more serious, because it made the
// report lie about the engine's own quality.
// ─────────────────────────────────────────────────────────────────────────────

describe('ROOT CAUSE 4 — a permanent failure was counted as the build\'s ONE self-heal', () => {
  const fresh = () => new BuildDiagnostics({ buildId: 'b1', workspaceId: 'ws', framework: 'vite-react' });

  it('THE REPORTED LIE: db:push exit 127 with the tables still missing is NOT auto-resolved', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run db:push', exitCode: 127, stdout: '', stderr: 'sh: 1: drizzle-kit: not found', durationMs: 325 });
    // The consequence the run itself recorded, exactly as the real report did.
    d.record({
      phase: 'preview', severity: 'warning', code: 'IMPORT_DB_MIGRATIONS_FAILED',
      message: "The app's database migration step (npm run db:push) exited 127 after 0s — its tables may be missing.",
      autoResolved: false,
    });
    d.finish(true, 'Survey delivered.');
    const r = d.report();
    const failed = r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED');
    expect(failed?.autoResolved).toBe(false);
    // The heal tally must not count it. In the real report this was `healCount: 1` — a green number
    // measuring a failure, feeding the admin's first-pass-quality headline.
    expect(r.counts.autoResolved).toBe(0);
    expect(r.counts.unresolved).toBeGreaterThan(0);
  });

  it('PaisaTrack still holds: an intermediate failure with NO surviving consequence is forgiven', () => {
    const d = fresh();
    d.recordCommand({ command: 'npx tsc --noEmit', exitCode: 2, stdout: '', stderr: 'error TS2532', durationMs: 1000 });
    d.recordCommand({ command: 'npx tsc --noEmit', exitCode: 2, stdout: '', stderr: 'error TS2532', durationMs: 1000 });
    d.finish(true, 'Build complete.');
    const r = d.report();
    expect(r.counts.unresolved).toBe(0);
    expect(r.issues.filter((i) => i.code === 'SANDBOX_CMD_FAILED').every((i) => i.autoResolved)).toBe(true);
  });

  it('a command that later ran CLEAN is forgiven even with a lingering mention', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stdout: '', stderr: 'boom', durationMs: 10 });
    d.record({ phase: 'build', severity: 'warning', code: 'SOME_NOTE', message: 'npm run build was flaky earlier', autoResolved: false });
    d.recordCommand({ command: 'npm run build', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10 });
    d.finish(true, 'Build complete.');
    const failed = d.report().issues.find((i) => i.code === 'SANDBOX_CMD_FAILED');
    expect(failed?.autoResolved).toBe(true);
  });

  it('a FAILED build is untouched — it already keeps its failures', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run db:push', exitCode: 127, stdout: '', stderr: 'not found', durationMs: 1 });
    d.finish(false, 'Build failed.');
    expect(d.report().issues.find((i) => i.code === 'SANDBOX_CMD_FAILED')?.autoResolved).toBe(false);
  });

  it('the helpers are precise: an issue message and a recorded command compare equal', () => {
    expect(commandKey('$ npm run db:push → exit 127 (0s)')).toBe('npm run db:push');
    expect(commandKey('npm run db:push')).toBe('npm run db:push');
    expect(recoveredCommands([{ command: 'a', exitCode: 0 }, { command: 'b', exitCode: 1 }])).toEqual(new Set(['a']));
    // An observation about the user's own code is never a consequence of OUR command.
    expect(failureHasSurvivingConsequence('$ npm run db:push → exit 127', [
      { code: 'INTEGRITY_UNUSED_DEP', message: 'npm run db:push mentioned', autoResolved: false, observation: true },
    ])).toBe(false);
  });
});

describe('ROOT CAUSE 5 — one build carried TWO answers for its own framework', () => {
  it('the report keeps the request default until the import tells it otherwise', () => {
    const d = new BuildDiagnostics({ buildId: 'b1', framework: 'vite-react' });
    expect(d.report().framework).toBe('vite-react');
    d.setFramework('node-express');      // what the import actually detected, 12s into the build
    expect(d.report().framework).toBe('node-express');
  });

  it('a blank update can never erase a known framework', () => {
    const d = new BuildDiagnostics({ buildId: 'b1', framework: 'node-express' });
    d.setFramework('');
    d.setFramework(undefined);
    expect(d.report().framework).toBe('node-express');
  });

  it('every place that reassigns the framework tells the report (the sibling sweep)', () => {
    const route = read('src/server/routes/agentv3.ts');
    // The import landing — the path that produced the reported mismatch.
    const at = route.indexOf('framework = validation.framework;');
    expect(route.slice(at, at + 400)).toContain('setFramework');
    // The drift correction — the same class, found by hunting siblings rather than waiting for it.
    const drift = route.indexOf('const detected = detectFrameworkFromWorkspace(union);');
    expect(route.slice(drift, drift + 400)).toContain('setFramework');
  });
});

describe('ROOT CAUSE 6 — the app keeps its OWN port; the preview follows it', () => {
  const route = read('src/server/routes/agentv3.ts');

  /**
   * ADMIN 2026-08-09: "report me likha hai app port 3000 par, lekin mitrify to port 5000 par hai."
   * The report was not lying — the app really was on 3000, because a pin wrote `PORT=3000` into its
   * dev .env and moved every PORT-honoring app off its own port. That pin treated the SYMPTOM of the
   * 2026-08-07 bug (make the app match our URL) instead of the cause (make our URL follow the app),
   * and on an import turn told to change nothing it changed the app's port.
   */
  it('nothing assigns the app a port any more', () => {
    expect(route).not.toContain("provided.PORT = '3000'");
    expect(route).not.toMatch(/provided\.PORT\s*=\s*['"`]\d+/);
  });

  it('an EMPTY PORT is never written either — that binds a random port, not a default', () => {
    // `Number(process.env.PORT ?? 5000)` turns '' into 0. Absent is the only safe placeholder.
    expect(buildDevEnvContent(['PORT', 'API_KEY'], {})).not.toMatch(/^PORT=/m);
    expect(buildDevEnvContent(['PORT'], {})).toMatch(/NODE_ENV=development/);
    // A REAL provided port (the user's own value) is still honoured.
    expect(buildDevEnvContent(['PORT'], { PORT: '8080' })).toMatch(/^PORT=8080$/m);
    // Every other var keeps its empty placeholder — only PORT is parsed rather than tested.
    expect(buildDevEnvContent(['API_KEY'], {})).toMatch(/^API_KEY=$/m);
  });

  it('the import boot now uses the evidence-first flip, not a single guess', () => {
    const at = route.indexOf('const { up, port } = parseDevServerHealthCheck(combined);');
    const seg = route.slice(at, at + 3000);
    expect(seg).toContain('rankPortCandidates(');
    expect(seg).toContain('LISTENING_PORTS_COMMAND');
    // The flip must stay COST-FREE on the happy path: it only engages when the first port did not render.
    expect(seg).toContain('if (winner.url && !winner.served.rendered)');
  });

  it('the flip is fed real evidence — the app\'s own log first, the OS scan last', () => {
    const at = route.indexOf('const { up, port } = parseDevServerHealthCheck(combined);');
    const seg = route.slice(at, at + 3000);
    expect(seg).toMatch(/rankPortCandidates\(\{\s*parsed:\s*port,\s*scriptPort,/);
  });
});

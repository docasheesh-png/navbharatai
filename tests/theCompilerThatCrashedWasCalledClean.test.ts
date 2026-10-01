// AUTOPSY 120eb52f (2026-09-30, "Calendar wala app bnao").
//
// Two `npm install`s ran into one node_modules at once — the background boot's and the typecheck's own —
// and `typescript` came out with its bin/ but without its lib/. The next typecheck printed
// `Cannot find global type 'Array'` and `lib.dom.d.ts not found`, counted as "11 type errors" in the app;
// every run after it crashed with `Cannot find module '../lib/tsc.js'`, which has no `error TS` line, and
// was counted CLEAN — five times, while the app held 15 real errors. The `typecheck` tool told the model
// "type-checks clean (tsc --noEmit)" off the same crash. Locked here:
//   1. the ONE reader (`tscVerdict`) calls a torn install "did not run", never clean and never failed;
//   2. the `typecheck` tool and the endgame ask it, and say so;
//   3. the ensure step repairs a torn compiler, and waits for our own install instead of racing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tscVerdict, tscNeverRan, looksLikeBrokenTscInstall, commandOutcomeText, typecheckEvidenceFromCommands } from '../src/server/AgentV3/TscGate';
import { robustTscCommand, NPM_INSTALL_LOCK } from '../src/server/AgentV3/tscCommand';
import { runEndgameRepair } from '../src/server/AgentV3/EndgameRepair';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';

// The two outputs, verbatim from the report.
const LIB_MISSING = `error TS2318: Cannot find global type 'Array'.
error TS2318: Cannot find global type 'Boolean'.
error TS2318: Cannot find global type 'String'.
error TS6053: File '/home/user/workspace/node_modules/typescript/lib/lib.dom.d.ts' not found.
  The file is in the program because:
    Library 'lib.dom.d.ts' specified in compilerOptions
`;
const CRASH = `node:internal/modules/cjs/loader:1433
  throw err;
  ^

Error: Cannot find module '../lib/tsc.js'
Require stack:
- /home/user/workspace/node_modules/typescript/bin/tsc
    at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)
{
  code: 'MODULE_NOT_FOUND',
  requireStack: [ '/home/user/workspace/node_modules/typescript/bin/tsc' ]
}

Node.js v22.23.1
`;
const APP_ERROR = `src/components/AddEventModal.tsx(36,7): error TS2322: Type 'string | Date' is not assignable to type 'string'.`;
const APP_MISSING_MODULE = `src/pages/CalendarPage.tsx(3,30): error TS2307: Cannot find module '../hooks/useDateUtils' or its corresponding type declarations.`;

describe('1 · a torn compiler is "did not run", never clean and never failed', () => {
  it('🔴 the crash that was counted clean', () => {
    expect(looksLikeBrokenTscInstall(CRASH)).toBe(true);
    expect(tscVerdict(CRASH)).toBe('not-run');
    expect(tscNeverRan(CRASH)).toBe(true);
  });
  it('🔴 the missing library that was counted as eleven errors in the app', () => {
    expect(tscVerdict(LIB_MISSING)).toBe('not-run');
  });
  it('🔒 the app\'s OWN errors — including its own missing module — are still failures', () => {
    expect(looksLikeBrokenTscInstall(APP_ERROR)).toBe(false);
    expect(looksLikeBrokenTscInstall(APP_MISSING_MODULE)).toBe(false);
    expect(tscVerdict(APP_MISSING_MODULE)).toBe('failed');
    expect(tscVerdict('')).toBe('passed');
  });
  it('the report line says what happened, and the release gate does not count it', () => {
    const cmd = robustTscCommand('--noEmit', '2>&1 | head -80');
    expect(commandOutcomeText({ command: cmd, exitCode: null, stdout: CRASH })).toMatch(/did not run .*broken TypeScript install/);
    expect(typecheckEvidenceFromCommands([{ command: cmd, stdout: CRASH, exitCode: null }])).toBeUndefined();
  });
});

class TsProject implements ActuatorPort {
  files = new Map<string, string>([
    ['tsconfig.json', '{"compilerOptions":{"strict":true}}'],
    ['src/App.tsx', 'export default function App() { return <div>hi</div>; }'],
  ]);
  tsc = { exitCode: 0, stdout: CRASH, stderr: '' };
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_w: string, command: string) { return /\btsc\b/.test(command) ? this.tsc : { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('2 · its readers ask the one reader', () => {
  it('🔴 the typecheck tool no longer says "type-checks clean" off a crash', async () => {
    const d = new ToolDispatcher(new TsProject(), 'ws-1');
    const out = await d.dispatch({ id: 't', name: 'typecheck', input: {} });
    expect(out.content).not.toMatch(/type-checks clean/);
    expect(out.content).toMatch(/TYPECHECK DID NOT RUN/);
  });
  it('a project-level error that names no file is a failure, not clean', async () => {
    const act = new TsProject();
    act.tsc = { exitCode: 1, stdout: "error TS5023: Unknown compiler option 'foo'.", stderr: '' };
    const out = await new ToolDispatcher(act, 'ws-1').dispatch({ id: 't', name: 'typecheck', input: {} });
    expect(out.content).not.toMatch(/type-checks clean/);
    expect(out.content).toMatch(/TYPE ERROR/);
  });
  it('the endgame claims nothing about a compiler that never ran', async () => {
    const v = await runEndgameRepair({ runTsc: async () => CRASH, readFiles: async () => ({}), writeFile: async () => {} });
    expect(v.attempted).toBe(false);
  });
});

// The ensure step is a shell script; it is run here for real against a fake npm.
const BASH = existsSync('/bin/bash') ? '/bin/bash' : null;
describe.skipIf(!BASH)('3 · the ensure step repairs a torn compiler and never races our install', () => {
  let dir = '';
  let calls = '';
  // Resolves its own link like node's require does: `.bin/tsc` → `typescript/bin/tsc` → `../lib/tsc.js`.
  const fakeTsc = '#!/bin/sh\nd=$(dirname "$(readlink -f "$0")")/../lib/tsc.js; [ -f "$d" ] || { echo "Error: Cannot find module \'../lib/tsc.js\'"; exit 1; }; echo REAL_TSC_RAN\n';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nbai-tsc-'));
    calls = join(dir, 'npm-calls');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'npm'), `#!/bin/sh\necho "npm $*" >> ${calls}\nmkdir -p node_modules/typescript/bin node_modules/typescript/lib node_modules/.bin\nprintf '%s' '${fakeTsc.replace(/'/g, "'\\''")}' > node_modules/typescript/bin/tsc\nchmod +x node_modules/typescript/bin/tsc\ntouch node_modules/typescript/lib/tsc.js node_modules/typescript/lib/lib.es5.d.ts\nln -sf ../typescript/bin/tsc node_modules/.bin/tsc\n`);
    chmodSync(join(dir, 'bin', 'npm'), 0o755);
  });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); rmSync(NPM_INSTALL_LOCK, { force: true }); } catch { /* cleanup */ } });

  const workspace = (torn: boolean) => {
    const ws = mkdtempSync(join(dir, 'ws-'));
    writeFileSync(join(ws, 'package.json'), '{"devDependencies":{"typescript":"^5.4.0"}}');
    mkdirSync(join(ws, 'node_modules', 'typescript', 'bin'), { recursive: true });
    mkdirSync(join(ws, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(ws, 'node_modules', 'typescript', 'bin', 'tsc'), fakeTsc);
    chmodSync(join(ws, 'node_modules', 'typescript', 'bin', 'tsc'), 0o755);
    if (!torn) {
      mkdirSync(join(ws, 'node_modules', 'typescript', 'lib'));
      writeFileSync(join(ws, 'node_modules', 'typescript', 'lib', 'tsc.js'), '');
      writeFileSync(join(ws, 'node_modules', 'typescript', 'lib', 'lib.es5.d.ts'), '');
    }
    symlinkSync('../typescript/bin/tsc', join(ws, 'node_modules', '.bin', 'tsc'));
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(ws, 'node_modules'), later, later); // not stale — package.json is older
    return ws;
  };
  const run = (ws: string) => {
    try { rmSync(calls, { force: true }); } catch { /* none yet */ }
    const out = execFileSync(BASH!, ['-c', robustTscCommand('--noEmit', '2>&1 | head -20')], {
      cwd: ws, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` }, encoding: 'utf8',
    });
    return { out, npm: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
  };

  it('🔴 a compiler with its bin/ and without its lib/ is reinstalled, and then really runs', () => {
    try { rmSync(NPM_INSTALL_LOCK, { force: true }); } catch { /* none */ }
    const r = run(workspace(true));
    expect(r.npm).toMatch(/npm install/);
    expect(r.out).toContain('REAL_TSC_RAN');
  });
  it('an intact compiler is left alone — no install at all', () => {
    try { rmSync(NPM_INSTALL_LOCK, { force: true }); } catch { /* none */ }
    const r = run(workspace(false));
    expect(r.npm).toBe('');
    expect(r.out).toContain('REAL_TSC_RAN');
  });
  it('🔴 while our own install runs, the check waits for it instead of starting a second one', () => {
    writeFileSync(NPM_INSTALL_LOCK, '');
    const ws = workspace(false);
    const t0 = Date.now();
    // execFileSync blocks this thread, so the lock is released from a child shell.
    execFileSync(BASH!, ['-c', `(sleep 1.5; rm -f ${NPM_INSTALL_LOCK}) >/dev/null 2>&1 &`]);
    const r = run(ws);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_000);
    expect(r.out).toContain('REAL_TSC_RAN');
  }, 30_000);
  it('a lock left by an install that died long ago is ignored', () => {
    writeFileSync(NPM_INSTALL_LOCK, '');
    const old = new Date(Date.now() - 30 * 60_000);
    utimesSync(NPM_INSTALL_LOCK, old, old);
    const t0 = Date.now();
    const r = run(workspace(false));
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.out).toContain('REAL_TSC_RAN');
    rmSync(NPM_INSTALL_LOCK, { force: true });
  });
  it('🔒 a lock that never clears ends in an honest "nothing was checked", not a race', () => {
    const cmd = robustTscCommand();
    expect(cmd).toMatch(/NBAI_TSC_UNAVAILABLE: the app's dependencies are still being installed/);
    expect(cmd.indexOf('still being installed')).toBeLessThan(cmd.indexOf('npm install'));
    expect(tscVerdict("NBAI_TSC_UNAVAILABLE: the app's dependencies are still being installed, so nothing was checked yet.")).toBe('not-run');
  });
});

describe('🔒 our installs say they are running', () => {
  it('E2BActuator wraps every install in the lock', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    const body = src.slice(src.indexOf('private async _npmInstall('), src.indexOf('private async _npmInstallUnlocked('));
    expect(body).toContain('touch ${NPM_INSTALL_LOCK}');
    expect(body).toContain('rm -f ${NPM_INSTALL_LOCK}');
    expect(body).toMatch(/finally/);
  });
});

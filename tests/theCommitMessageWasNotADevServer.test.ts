/**
 * Autopsy 2b1f845e (2026-10-01) — "Fix all available issue and integration real api for payment, Design,
 * posting". A 19-minute edit of a working five-step app. Every case below is a line of that report.
 *
 *  1. Our own auto-commit, `git add -A && (git commit -q -m "edit vite.config.ts" || true)`, was read as a
 *     dev-server launch (the `(` hid the `git`, the word "vite" in the MESSAGE did the rest). It took the
 *     managed boot, cost 54 s of health-check restarts, and became the stored revival recipe.
 *  2. The sandbox's own agent (port 49983) was "a previous app still serving" — four private port lists,
 *     none of which knew the sandbox's machinery.
 *  3. Our badge's × checkbox was "the app takes input".
 *  4. Five `bash` calls with an empty command were reported as exit 0.
 *  5. "✅ The app looks complete — wrapping up." on an edit, at 2.8 minutes, with the work undone.
 *  6. Our Supabase templates threw while being imported, so an app without keys could not open.
 *  7. `Property 'campaign' does not exist on type 'void'` — nine rewrites of the wrong file.
 *  8. `cors@^4` — a version that does not exist, guessed twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  isLongRunningCommand, withoutGroupingPrefix, isOneShotSegment, detectDevPort,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import {
  recordDevServerLaunch, lastDevServerLaunch, serverLaunchCommand, startsAServer, __resetDevServerLaunchLog,
} from '../src/server/AgentV3/devServerLaunchLog';
import { isNeverAppPort, isSandboxSystemPort, SANDBOX_SYSTEM_PORTS } from '../src/server/AgentV3/neverAppPorts';
import { decideSupersede } from '../src/server/AgentV3/previewSupersede';
import { rankPortCandidates, isInfraPort } from '../src/server/AgentV3/PortDiscovery';
import { buildRecipe, isUsableRecipe } from '../src/server/AgentV3/previewRevival';
import { declaredAppPort } from '../src/server/lib/declaredAppPort';
import { conflictingPortFromLog } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';
import { appSignatureHtml, injectAppSignature, withoutAppSignature } from '../src/server/AgentV3/appSignature';
import { dataEntryEvidence, appHasNoDataEntry, noJourneyReason } from '../src/server/AgentV3/journeyDerivation';
import { emptyCommandMessage } from '../src/server/AgentV3/ToolDispatcher';
import { resolveStringArg } from '../src/server/AgentV3/toolArgRepair';
import { shouldCheckDone, readyOverrunNote, doneSignalConfig } from '../src/server/AgentV3/doneSignal';
import { generateDbConfig } from '../src/server/lib/DbConfigGenerator';
import { generateAuthCode } from '../src/server/AppMakerLab/generator/AuthCodeGenerator';
import { tscErrorCauses } from '../src/server/AgentV3/tscErrorCause';
import { missingRanges, latestVersionsCommand, versionHint, isSafePackageName } from '../src/server/AgentV3/npmVersionHint';
import { writeQualitySummary } from '../src/server/AgentV3/writeTimeTypecheck';

const AUTO_COMMIT = 'git add -A && (git commit -q -m "edit vite.config.ts" || true)';

describe('1 · a commit message is not a dev server', () => {
  beforeEach(() => __resetDevServerLaunchLog());

  it('our own auto-commit after editing vite.config.ts is a one-shot command (the report, verbatim)', () => {
    expect(isLongRunningCommand(AUTO_COMMIT)).toBe(false);
  });

  it('holds for every file name a dev-server word could hide in', () => {
    for (const file of ['vite.config.ts', 'dev.ts', 'server/dev-tools.ts', 'watch.ts', 'serve.json', 'scripts/npm run dev.md']) {
      expect(isLongRunningCommand(`git add -A && (git commit -q -m "edit ${file}" || true)`)).toBe(false);
    }
    expect(isLongRunningCommand('{ git commit -m "run vite"; }')).toBe(false);
    expect(isLongRunningCommand('! git diff --quiet vite.config.ts')).toBe(false);
  });

  it('a real launch inside a subshell is still a launch', () => {
    expect(isLongRunningCommand('(cd server && npm run dev)')).toBe(true);
    expect(isLongRunningCommand('npm run server')).toBe(true);
    expect(isLongRunningCommand('npx vite --port 5173')).toBe(true);
  });

  it('the grouping is removed only from the front', () => {
    expect(withoutGroupingPrefix('  ( { git commit')).toBe('git commit');
    expect(isOneShotSegment('(git commit -q -m "edit vite.config.ts" ')).toBe(true);
  });

  it('a commit is never recorded as the command that started the app', () => {
    recordDevServerLaunch('w1', AUTO_COMMIT, 3000, 1_000);
    expect(lastDevServerLaunch('w1', 1_001)).toBeNull();
    expect(startsAServer(AUTO_COMMIT)).toBe(false);
  });

  it('a real launch is still recorded — including `npm run server`, which SERVER_SEGMENT never matched', () => {
    recordDevServerLaunch('w1', 'npm run server > /tmp/server.log 2>&1', 3000, 1_000);
    expect(lastDevServerLaunch('w1', 1_001)?.command).toBe('npm run server > /tmp/server.log 2>&1');
  });

  it('the server segment is picked past a commit that names Vite', () => {
    expect(serverLaunchCommand(`${AUTO_COMMIT} && npm run dev`)).toBe('npm run dev');
  });
});

describe('2 · ports that are never the app — one list', () => {
  const LISTENING_IN_THE_REPORT = [22, 111, 3000, 9222, 49983];

  it('the sandbox agent, rpcbind, SSH and our browser daemon are the sandbox, not the app', () => {
    for (const p of [22, 111, 9222, 49983]) expect(isSandboxSystemPort(p)).toBe(true);
    expect(isNeverAppPort(3000)).toBe(false);
    expect(isNeverAppPort(5173)).toBe(false);
  });

  it('the preview flip only ever visits the app (the report\'s own listening list)', () => {
    const ranked = rankPortCandidates({ parsed: null, scriptPort: null, expected: 5173, listening: LISTENING_IN_THE_REPORT, framework: 'vite-react' } as never);
    for (const p of [22, 111, 9222, 49983]) expect(ranked).not.toContain(p);
    expect(ranked).toContain(3000);
    expect(isInfraPort(49983)).toBe(true);
  });

  it('a recipe can never name the sandbox agent — formed or read back', () => {
    expect(buildRecipe({ devCommand: 'npm run dev', port: 49983, now: 1 }).ok).toBe(false);
    expect(isUsableRecipe({ devCommand: 'npm run dev', port: 49983, provenAt: 1 })).toBe(false);
    expect(isUsableRecipe({ devCommand: 'npm run dev', port: 3000, provenAt: 1 })).toBe(true);
  });

  it('supersede never calls the sandbox agent "a previous app" and never kills it', () => {
    const d = decideSupersede({ newPort: 3000, recipe: { devCommand: 'x', port: 49983, provenAt: 1 }, declaredPort: 49983 });
    expect(d.staleports).toEqual([]);
    expect(d.note).toBe('');
  });

  it('a genuine previous app is still superseded', () => {
    const d = decideSupersede({ newPort: 3000, recipe: { devCommand: 'npm run dev', port: 5173, provenAt: 1 } });
    expect(d.staleports).toEqual([5173]);
  });

  it('the other readers agree', () => {
    expect(declaredAppPort({ 'package.json': JSON.stringify({ scripts: { dev: 'vite --port 9222' } }) })).toBeNull();
    expect(conflictingPortFromLog('Error: listen EADDRINUSE: address already in use :::49983')).toBeNull();
    expect(detectDevPort('devtools 127.0.0.1:9222', 5173)).toBe(5173);
  });

  it('the CDP port our actuator opens is in the list (census — a renamed constant cannot drift away)', () => {
    const src = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    const m = /const CDP_PORT = (\d+);/.exec(src);
    expect(m).not.toBeNull();
    expect(SANDBOX_SYSTEM_PORTS.has(Number(m![1]))).toBe(true);
  });

  it('no server file keeps a private never-the-app port list (census)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name) || p.endsWith('neverAppPorts.ts')) continue;
        const src = readFileSync(p, 'utf8');
        if (/new Set\(\[\s*(?:22|5432)\s*,\s*\d+\s*,\s*\d+/.test(src)) offenders.push(p);
      }
    };
    walk('src/server');
    expect(offenders).toEqual([]);
  });
});

describe('3 · our badge is not the app taking input', () => {
  const html = injectAppSignature('<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');

  it('the badge carries a checkbox (that is why it fooled the check)', () => {
    expect(appSignatureHtml()).toMatch(/<input type="checkbox"/);
  });

  it('removed, the document is exactly the app again', () => {
    expect(withoutAppSignature(html)).not.toMatch(/data-nbai-signature|<input/);
    expect(withoutAppSignature(html)).toContain('<div id="root"></div>');
  });

  it('a signed index.html alone is not evidence of data entry', () => {
    expect(dataEntryEvidence({ 'index.html': html, 'src/App.tsx': 'export default function App(){ return <main>Hi</main>; }' })).toBeNull();
    expect(appHasNoDataEntry({ 'index.html': html })).toBe(true);
  });

  it('a real input elsewhere is still found, and the reason names it instead of denying it', () => {
    const files = {
      'index.html': html,
      'src/App.tsx': 'import Shell from "./Shell"; export default function App(){ return <Shell/>; }',
      'src/steps/DesignStep.tsx': 'export function DesignStep(){ return <><input value={x} onChange={e=>set(e.target.value)} /><button onClick={save}>Save</button></>; }',
    };
    expect(dataEntryEvidence(files)?.path).toBe('src/steps/DesignStep.tsx');
    const reason = noJourneyReason(files);
    expect(reason).toContain('src/steps/DesignStep.tsx');
    expect(reason).not.toContain('nothing here takes user input');
  });
});

describe('4 · an empty command is not a success', () => {
  it('names what was wrong and how to retry', () => {
    const msg = emptyCommandMessage({ command: '' });
    expect(msg).toMatch(/EMPTY command/);
    expect(msg).toMatch(/not a success/);
    expect(msg).toContain('"command"');
  });

  it('a blank canonical value does not hide a real one under an alias', () => {
    expect(resolveStringArg({ command: '', cmd: 'npm run build' }, 'command')).toEqual({ value: 'npm run build', via: 'cmd' });
    // An empty string that is the only value is still returned — edit_file's new_string may be "".
    expect(resolveStringArg({ new_string: '' }, 'new_string')).toEqual({ value: '', via: 'new_string' });
  });

  it('the bash case refuses it before anything runs (source guard)', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const at = src.indexOf("case 'bash': {");
    const body = src.slice(at, at + 1500);
    expect(body).toMatch(/if \(!rawCommand\.trim\(\)\) throw new Error\(emptyCommandMessage\(input\)\)/);
  });
});

describe('5 · an edit is not judged "complete" by the project score', () => {
  const cfg = { ...doneSignalConfig(), enabled: true, minStep: 1, everyN: 1 };

  it('the report\'s moment: an edit that has written its first file', () => {
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 30, alreadySignalled: false, wroteThisRun: true, editingExistingApp: true })).toBe(false);
  });

  it('a fresh build still gets the check', () => {
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 30, alreadySignalled: false, wroteThisRun: true, editingExistingApp: false })).toBe(true);
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 30, alreadySignalled: false, wroteThisRun: true })).toBe(true);
  });

  it('the report line says the edit was not measured, not "never judged finished"', () => {
    expect(readyOverrunNote(null, 118, 900_000, { editingExistingApp: true })).toMatch(/^Not measured/);
    expect(readyOverrunNote(null, 118, 900_000)).toMatch(/never judged finished/);
  });

  it('the runner passes the edit flag to both checks (source guard)', () => {
    const src = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    expect((src.match(/editingExistingApp: this\.opts\.editingExistingApp === true \}\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/** Transpile a generated module and run it with stubbed packages and env. */
function runModule(code: string, env: Record<string, string>, stubs: Record<string, unknown>): Record<string, unknown> {
  const js = ts.transpileModule(code.replace(/import\.meta\.env/g, '__env'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (name: string) => { if (!(name in stubs)) throw new Error(`unexpected import ${name}`); return stubs[name]; };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', '__env', 'process', js)(req, mod, mod.exports, env, { env });
  return mod.exports;
}

describe('6 · a missing key fails the feature, never the app at start', () => {
  const supabaseStub = { createClient: (url: string, key: string) => ({ real: true, url, key, from: () => 'query' }) };

  it('the BYO Supabase client imports cleanly with no keys, and every use says what to set', () => {
    const mod = runModule(generateDbConfig('supabase').files['src/lib/supabase.ts'], {}, { '@supabase/supabase-js': supabaseStub });
    expect(mod.supabaseConfigured).toBe(false);
    expect(() => (mod.supabase as { from: unknown }).from).toThrow(/Supabase is not configured/);
  });

  it('with keys it is the real client', () => {
    const mod = runModule(generateDbConfig('supabase').files['src/lib/supabase.ts'], { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' }, { '@supabase/supabase-js': supabaseStub });
    expect(mod.supabaseConfigured).toBe(true);
    expect((mod.supabase as { real: boolean }).real).toBe(true);
  });

  it('the generated auth module opens with no keys too (createClient("") throws at import)', () => {
    const throwingStub = { createClient: (url: string) => { if (!url) throw new Error('supabaseUrl is required.'); return { auth: {} }; } };
    const code = generateAuthCode({ type: 'supabase' }).files[0].content;
    const mod = runModule(code, {}, { '@supabase/supabase-js': throwingStub });
    expect(mod.supabaseConfigured).toBe(false);
    expect(() => (mod.supabase as { auth: unknown }).auth).toThrow(/not configured/);
  });

  it('Postgres, Neon and Firebase follow the same rule', () => {
    const pg = runModule(generateDbConfig('postgres').files['src/lib/db.ts'], {}, { pg: { Pool: class { constructor() { throw new Error('should not connect'); } } } });
    expect(pg.databaseConfigured).toBe(false);
    expect(() => (pg.pool as { query: unknown }).query).toThrow(/DATABASE_URL is not set/);
    const neon = runModule(generateDbConfig('neon').files['src/lib/db.ts'], {}, { '@neondatabase/serverless': { neon: () => { throw new Error('no'); } } });
    expect(() => (neon.sql as () => unknown)()).toThrow(/DATABASE_URL is not set/);
    const fb = runModule(generateDbConfig('firebase').files['src/lib/firebase.ts'], {}, {
      'firebase/app': { initializeApp: () => { throw new Error('no'); } },
      'firebase/firestore': { getFirestore: () => { throw new Error('no'); } },
    });
    expect(fb.firebaseConfigured).toBe(false);
    expect(() => (fb.db as { type: unknown }).type).toThrow(/Firebase is not configured/);
  });

  it('a promise check on an unconfigured client is answered, not thrown', () => {
    const mod = runModule(generateDbConfig('supabase').files['src/lib/supabase.ts'], {}, { '@supabase/supabase-js': supabaseStub });
    expect((mod.supabase as { then?: unknown }).then).toBeUndefined();
  });

  it('no template throws at its top level (census)', () => {
    for (const p of ['supabase', 'neon', 'postgres', 'firebase'] as const) {
      for (const code of Object.values(generateDbConfig(p).files)) {
        // A statement at column 0 — a bare `throw`, or an `if` whose body throws — runs at import.
        expect(code).not.toMatch(/^(?:if\s*\([^\n]*\)\s*(?:\{\s*\n\s*)?)?throw /m);
      }
    }
  });
});

describe('7 · the result of a void call points at the callee', () => {
  it('the report\'s error, verbatim', () => {
    const causes = tscErrorCauses([{ file: 'src/steps/PostStep.tsx', line: 46, col: 32, code: 'TS2339', message: "Property 'campaign' does not exist on type 'void'." } as never]);
    expect(causes.map((c) => c.id)).toContain('void-result');
    expect(causes[0].advice).toMatch(/declaration/);
  });

  it('a Promise<void> result too, and an ordinary missing property is left to the model', () => {
    expect(tscErrorCauses([{ file: 'a.ts', line: 1, col: 1, code: 'TS2339', message: "Property 'x' does not exist on type 'Promise<void>'." } as never])[0]?.id).toBe('void-result');
    expect(tscErrorCauses([{ file: 'a.ts', line: 1, col: 1, code: 'TS2339', message: "Property 'x' does not exist on type 'User'." } as never]).map((c) => c.id)).not.toContain('void-result');
  });
});

describe('8 · a version that does not exist gets the real one', () => {
  const NPM = 'npm error code ETARGET\nnpm error notarget No matching version found for cors@^4.\nnpm error notarget In most cases you or one of your dependencies are requesting';

  it('reads the package and the range npm refused (the report, verbatim)', () => {
    expect(missingRanges(NPM)).toEqual([{ name: 'cors', range: '^4' }]);
  });

  it('asks npm once and turns the answer into one line', () => {
    const missing = missingRanges(NPM);
    expect(latestVersionsCommand(missing)).toContain('npm view "$p" version');
    expect(versionHint(missing, 'NBAI_LATEST cors=2.8.5\n')).toBe('[version hint] cors@^4 does not exist — the latest cors is 2.8.5; use cors@^2. Re-run the install with these ranges.');
    expect(versionHint(missing, 'NBAI_LATEST cors=\n')).toBeNull();
  });

  it('scoped packages work and nothing unsafe reaches the shell', () => {
    expect(missingRanges('No matching version found for @types/cors@^9.')).toEqual([{ name: '@types/cors', range: '^9' }]);
    expect(isSafePackageName('cors; rm -rf /')).toBe(false);
    expect(latestVersionsCommand([{ name: 'a;b', range: '1' }])).toBeNull();
  });
});

describe('9 · a file this build never wrote did not miss a note', () => {
  it('the report\'s line, with the file the edit never touched', () => {
    expect(writeQualitySummary([], ['src/index.css'], ['src/steps/PostStep.tsx'])).toMatch(/0 never got a note, 1 not written by this build \(src\/index\.css\)/);
    expect(writeQualitySummary([], ['src/index.css'])).toMatch(/1 never got a note \(src\/index\.css\)/);
  });
});

/**
 * Queue Q-284 and Q-274 (autopsy 241215d1, 2026-10-04). A paper-trading app was built as a Vite front end
 * plus a FastAPI server in `backend/`.
 *
 *   Q-284 — every path the PLATFORM uses to bring an app back (the preview wake, our own preview start and
 *           the two in-build restarts) ran ONE command, `npm run dev`. Nothing created the venv, installed
 *           requirements.txt or started uvicorn, so after a sandbox restart the API was gone. The service
 *           graph read only package.json and called the app "Single service".
 *   Q-274 — the request asked for "a complete, self-contained Python script" with live `yfinance` data; a
 *           web app with a simulated feed was built and called complete, and nobody said so.
 *
 * Every block was reverted and seen to fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'child_process';
import {
  pythonBackendPlan, pythonBackendPort, pythonBackendBootScript, pythonBackendBootCommand, readBackendBoot,
  isPythonServerCommand, bootPythonBackendFirst, DEFAULT_PYTHON_PORT,
} from '../src/server/AgentV3/pythonBackendBoot';
import { buildServiceGraph } from '../src/server/AgentV3/serviceGraph';
import { appPortsFrom } from '../src/server/AgentV3/appPorts';
import { isLongRunningCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { scriptDeliverableRequested, liveDataRequested, scriptRequestBuilderNote, scriptRequestStartLine } from '../src/server/AgentV3/scriptRequest';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { PRIME_NODE_MODULES, WARM_NODE_MODULES, TSC_ENSURE } from '../src/server/AgentV3/tscCommand';
import { writeTypecheckWarmupCommand } from '../src/server/AgentV3/writeTimeTypecheck';
import { existsSync } from 'fs';

const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const PROMPT = readFileSync(join(__dirname, 'fixtures/autopsy241215d1.prompt.txt'), 'utf8');

/** The report's shape: a Vite front end at the root, FastAPI in backend/, the proxy pointing at 8000. */
const APP: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'paper-trader', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18.3.1' }, devDependencies: { vite: '^5.4.0' } }),
  'vite.config.ts': "export default { server: { host: true, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } } };",
  'src/App.tsx': 'export default function App() { return null; }',
  'backend/requirements.txt': 'fastapi==0.115.0\nuvicorn[standard]==0.30.6\nyfinance\n',
  'backend/main.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/api/health")\ndef health():\n    return {"ok": True}\n',
};

describe('Q-284 · the platform knows the Python backend and how to start it', () => {
  it('finds the backend folder, its declared start command and the port the front end calls', () => {
    const plan = pythonBackendPlan(APP);
    expect(plan).toEqual({
      dir: 'backend',
      installCommand: 'pip install -q -r requirements.txt',
      manifest: 'requirements.txt',
      startCommand: 'uvicorn main:app --host 0.0.0.0 --port $PORT',
      port: 8000,
    });
  });

  it('the proxy target wins; then a port in the server source; then the default', () => {
    expect(pythonBackendPort({ ...APP, 'vite.config.ts': "proxy: { '/api': 'http://127.0.0.1:8010' }" }, 'backend')).toBe(8010);
    const noProxy = { ...APP, 'vite.config.ts': 'export default {}', 'backend/main.py': `${APP['backend/main.py']}\nif __name__ == "__main__":\n    import uvicorn\n    uvicorn.run(app, host="0.0.0.0", port=8100)\n` };
    expect(pythonBackendPort(noProxy, 'backend')).toBe(8100);
    expect(pythonBackendPort({ ...APP, 'vite.config.ts': 'export default {}' }, 'backend')).toBe(DEFAULT_PYTHON_PORT);
  });

  it('never guesses: no declared server, no manifest, or a Node-only app gives no plan', () => {
    expect(pythonBackendPlan({ ...APP, 'backend/requirements.txt': 'fastapi\n' })).toBeNull();
    const { 'backend/requirements.txt': _r, ...noManifest } = APP;
    expect(pythonBackendPlan(noManifest)).toBeNull();
    expect(pythonBackendPlan({ 'package.json': APP['package.json'], 'server.js': "require('express')().listen(3001)" })).toBeNull();
    // A Procfile states the command outright, and a Flask app served by gunicorn is read from the source.
    expect(pythonBackendPlan({ 'api/requirements.txt': 'flask\ngunicorn\n', 'api/app.py': 'from flask import Flask\napp = Flask(__name__)\n' })?.startCommand)
      .toBe('gunicorn app:app --bind 0.0.0.0:$PORT');
  });

  it('the service graph lists it as a backend the front end waits for (it said "Single service")', () => {
    const graph = buildServiceGraph({ contents: APP });
    expect(graph.multiService).toBe(true);
    const py = graph.services.find((s) => s.id === 'python:backend');
    expect(py).toMatchObject({ kind: 'backend', port: 8000, dir: 'backend', script: 'uvicorn main:app --host 0.0.0.0 --port 8000' });
    expect(graph.services.find((s) => s.kind === 'frontend')?.dependsOn).toEqual(['python:backend']);
    expect(graph.startOrder[0]).toBe('python:backend');
    // The port veto now knows 8000 is the app's own, so a "previous app" sweep never kills the API.
    expect(appPortsFrom(APP).all).toContain(8000);
    expect(appPortsFrom(APP).preview).toBe(5173);
  });

  it('the boot travels encoded, so it is never read as a dev-server launch', () => {
    const plan = pythonBackendPlan(APP)!;
    const command = pythonBackendBootCommand(plan);
    expect(command).not.toMatch(/uvicorn/);
    expect(isLongRunningCommand(command)).toBe(false);
    const b64 = command.match(/^echo (\S+) \| base64 -d/)![1];
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(pythonBackendBootScript(plan));
    // Inside: a venv (never a global pip), an install only when the manifest changed, a detached start.
    const script = pythonBackendBootScript(plan);
    expect(script).toContain('python3 -m venv .venv');
    expect(script).toContain('.venv/.nbai-installed');
    expect(script).toMatch(/setsid nohup bash -c 'uvicorn main:app --host 0.0.0.0 --port \$PORT'/);
  });

  it('reads the verdict, and a Python server command is recognised', () => {
    expect(readBackendBoot('NBAI_BACKEND_UP started').state).toBe('up');
    expect(readBackendBoot('x\nNBAI_BACKEND_UP already').state).toBe('already');
    expect(readBackendBoot('NBAI_BACKEND_NOT_UP install\nERROR: No matching distribution')).toMatchObject({ state: 'not-up', reason: 'install' });
    expect(readBackendBoot('').state).toBe('unknown');
    for (const c of ['uvicorn main:app --port 8000', 'cd backend && . .venv/bin/activate && uvicorn main:app', 'python3 server.py', 'flask run', 'python manage.py runserver']) {
      expect(isPythonServerCommand(c)).toBe(true);
    }
    for (const c of ['npm run dev', 'vite', 'python3 -m venv .venv', 'pip install -r requirements.txt']) expect(isPythonServerCommand(c)).toBe(false);
  });

  it('a failing runner is an outcome, never a throw; the kill switch returns null', async () => {
    const boom = await bootPythonBackendFirst(async () => { throw new Error('sandbox gone'); }, APP);
    expect(boom?.outcome).toMatchObject({ state: 'not-up', reason: 'error' });
    expect(await bootPythonBackendFirst(async () => ({ stdout: '' }), APP, { AGENTV3_PYTHON_BACKEND_BOOT: 'off' })).toBeNull();
    expect(await bootPythonBackendFirst(async () => ({ stdout: '' }), { 'package.json': '{}' })).toBeNull();
  });

  // The real script, in real bash, with a real venv. The server is Python's own http.server (declared in a
  // Procfile, an empty requirements.txt), so nothing is downloaded. Skipped where python3 has no venv.
  const venvWorks = spawnSync('python3', ['-c', 'import venv, ensurepip']).status === 0;
  (venvWorks ? it : it.skip)('the boot really creates the venv, starts the server, and is a no-op the second time', () => {
    const root = mkdtempSync(join(tmpdir(), 'nbai-pyboot-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    try {
      mkdirSync(join(root, 'api'));
      writeFileSync(join(root, 'api/requirements.txt'), '');
      writeFileSync(join(root, 'api/Procfile'), 'web: python3 -m http.server $PORT --bind 127.0.0.1\n');
      const plan = { ...pythonBackendPlan({ 'api/requirements.txt': '', 'api/Procfile': 'web: python3 -m http.server $PORT --bind 127.0.0.1\n' })!, port };
      expect(plan.dir).toBe('api');
      const run = () => execFileSync('bash', ['-c', pythonBackendBootCommand(plan)], { cwd: root, encoding: 'utf8', timeout: 120_000 });
      expect(readBackendBoot(run()).state).toBe('up');
      expect(readBackendBoot(run()).state).toBe('already');
    } finally {
      spawnSync('bash', ['-c', `pkill -f "http.server ${port}" || true`]);
      rmSync(root, { recursive: true, force: true });
    }
  }, 150_000);
});

describe('Q-284 · every platform start brings the backend up first', () => {
  it('the wake (preview-diagnose) boots it before the front end', () => {
    const at = ROUTE.indexOf("const result = await withTimeout(actuator.runCommand(workspaceId, devRunCommand), previewWakeBudgetMs(), 'preview-diagnose');");
    expect(at).toBeGreaterThan(-1);
    expect(ROUTE.slice(at - 900, at)).toContain('bootPythonBackendFirst(');
  });

  it('our own preview start and both in-build restarts boot it before `npm run dev`', () => {
    for (const site of ["'platform-preview-start'", "'preview-server-revive'", "'runtime-server-revive'"]) {
      const at = ROUTE.indexOf(site);
      expect(at, site).toBeGreaterThan(-1);
      expect(ROUTE.slice(at - 250, at), site).toContain('await startPythonBackendFirst(');
    }
    // Census: every hard-coded platform `npm run dev` start is preceded by the backend boot.
    const starts = [...ROUTE.matchAll(/actuator\.runCommand\(workspaceId, 'npm run dev'\)/g)];
    expect(starts.length).toBe(3);
    for (const m of starts) expect(ROUTE.slice((m.index ?? 0) - 250, m.index)).toContain('startPythonBackendFirst(');
  });

  it('a recipe recorded from the backend launch is never replayed as the preview', () => {
    expect(ROUTE).toContain('proven?.devCommand && !isPythonServerCommand(proven.devCommand) ? proven.devCommand');
    expect(ROUTE).toContain('lastLaunch && isPythonServerCommand(lastLaunch.command)');
  });
});

describe('Q-274 · a script request is built as a web app, and the user hears it first', () => {
  it("the report's request is a Python script that asks for live data", () => {
    expect(scriptDeliverableRequested(PROMPT)).toBe('a Python script');
    expect(liveDataRequested(PROMPT)).toBe(true);
  });

  it('precision: only a deliverable that cannot run in the preview counts', () => {
    expect(scriptDeliverableRequested('Build a CLI tool to rename my photo files')).toBe('a command-line tool');
    expect(scriptDeliverableRequested('make a streamlit dashboard for sales')).toBe('a Streamlit dashboard');
    for (const p of [
      'write a script for my youtube video about cooking',
      'build a todo web app',
      'convert my Python script into a website',
      'a JavaScript calculator',
      'my build script fails, fix it',
      'a Python script dashboard web app with React',
    ]) expect(scriptDeliverableRequested(p), p).toBeNull();
    expect(liveDataRequested('a live chat app')).toBe(false);
    expect(liveDataRequested('show real-time stock prices')).toBe(true);
  });

  it('the builder is told to label sample data, and the user is told before the build', () => {
    const note = scriptRequestBuilderNote('a Python script', true);
    expect(note).toContain('build this as a web app');
    expect(note).toContain('"Sample data"');
    expect(note).toContain('Never call sample or simulated data "live"');
    expect(scriptRequestBuilderNote(null, true)).toBe('');
    expect(scriptRequestStartLine('a Python script', true)).toMatch(/^ℹ️ You asked for a Python script\. NavBharatAI builds apps you open in the preview/);
    expect(ROUTE).toContain('scriptRequestStartLine(scriptFormAsked, liveDataAsked)');
    expect(ROUTE).toContain("code: 'SCRIPT_REQUEST_AS_WEB_APP'");
    expect(ROUTE).toContain('liveDataRequested: liveDataAsked,');
  });

  it('a summary calling a simulated feed "live" is corrected', () => {
    const source = 'import random\n\ndef simulate_tick(price):\n    return price * (1 + random.gauss(0, 0.001))\n';
    const facts = { consoleCaptured: true, screenshotTaken: true, previewVerified: true, sourceText: source, liveDataRequested: true };
    const hit = auditSummaryClaims('Live NSE prices update every second on the dashboard.', facts);
    expect(hit.map((c) => c.kind)).toContain('live-data-claimed');
    // Honest wording, a real feed, or no live data asked: nothing to correct.
    expect(auditSummaryClaims('Live prices are simulated until you connect a feed.', facts).map((c) => c.kind)).not.toContain('live-data-claimed');
    expect(auditSummaryClaims('Live NSE prices update every second.', { ...facts, sourceText: `${source}\nimport yfinance` }).map((c) => c.kind)).not.toContain('live-data-claimed');
    expect(auditSummaryClaims('Live NSE prices update every second.', { ...facts, liveDataRequested: undefined }).map((c) => c.kind)).not.toContain('live-data-claimed');
  });
});

describe('Q-304 · a fresh starter is primed from the baked tree, not installed cold', () => {
  const prime = (root: string) => PRIME_NODE_MODULES
    .split(WARM_NODE_MODULES).join(join(root, 'warm/node_modules'))
    .split('/home/user/.nbai-nm-stage').join(join(root, 'stage'));
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'nbai-prime-'));
    mkdirSync(join(root, 'warm/node_modules/typescript'), { recursive: true });
    writeFileSync(join(root, 'warm/node_modules/typescript/package.json'), '{}');
    mkdirSync(join(root, 'app'));
    writeFileSync(join(root, 'app/package.json'), '{ "dependencies": { "react": "^18.3.1" } }');
    return root;
  };

  it('copies the baked tree in when there is no node_modules and the app is React', () => {
    const root = setup();
    try {
      execFileSync('bash', ['-c', prime(root)], { cwd: join(root, 'app') });
      expect(existsSync(join(root, 'app/node_modules/typescript/package.json'))).toBe(true);
      expect(existsSync(join(root, 'warm/node_modules/typescript/package.json'))).toBe(true); // the bake is untouched
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('never touches an existing node_modules, a non-React app, or nests when two primers race', () => {
    const root = setup();
    try {
      mkdirSync(join(root, 'app/node_modules/own'), { recursive: true });
      execFileSync('bash', ['-c', prime(root)], { cwd: join(root, 'app') });
      expect(existsSync(join(root, 'app/node_modules/typescript'))).toBe(false);
      rmSync(join(root, 'app/node_modules'), { recursive: true });
      writeFileSync(join(root, 'app/package.json'), '{ "dependencies": { "vue": "^3" } }');
      execFileSync('bash', ['-c', prime(root)], { cwd: join(root, 'app') });
      expect(existsSync(join(root, 'app/node_modules'))).toBe(false);
      writeFileSync(join(root, 'app/package.json'), '{ "dependencies": { "react": "^18" } }');
      execFileSync('bash', ['-c', `( ${prime(root)} ) & ( ${prime(root)} ) & wait`], { cwd: join(root, 'app') });
      expect(existsSync(join(root, 'app/node_modules/typescript/package.json'))).toBe(true);
      expect(existsSync(join(root, 'app/node_modules/node_modules'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('the typecheck, the warm-up and the dev-server install all use the one primer', () => {
    const ensureAt = TSC_ENSURE.indexOf(PRIME_NODE_MODULES);
    expect(ensureAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(TSC_ENSURE.indexOf('[ ! -d node_modules ]'));
    expect(writeTypecheckWarmupCommand().startsWith(PRIME_NODE_MODULES)).toBe(true);
    const actuator = readFileSync(join(__dirname, '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    expect(actuator).toContain('await sandbox.commands.run(PRIME_NODE_MODULES, {');
    expect(actuator).not.toContain('cp -a ${warmDir} ${WORKSPACE_ROOT}/node_modules');
  });
});

import { Sandbox } from 'e2b';
import { TemplateRegistry } from '../../AppMakerLab/generator/templates/TemplateRegistry';
import { IEngineerActuator, BackendProvisionResult } from './IEngineerActuator';
import { BackendProvisioner } from '../BackendProvisioner';
import { dbProvisionScript, parseDbProvision, CANONICAL_DB_URL } from '../../AgentV3/sandbox/dbProvisionVerify';
import { usageTracker } from '../UsageTracker';
import { ensureHostBinding } from './devServerHost';
import { scanPackageJson, formatPackageScanReport } from '../../AgentV3/PackageSafetyScanner';
import { toWorkspaceRelPath } from '../../lib/workspacePath';
import { idleLimitMs } from '../../AgentV3/sandboxReaper';

// Phase 12E — auto-pause a sandbox after this much inactivity to stop compute
// billing on abandoned sessions. Must be less than SANDBOX_TIMEOUT_MS so the
// idle sweep fires before E2B kills the sandbox on its own.
//
// The limit lives in AgentV3/sandboxReaper.ts (15 minutes, env-tunable) so Engineer AI and the v5
// builder cannot drift apart on it — it was 45 minutes in both, which billed roughly nine times more
// idle VM than working VM on a typical five-minute session.
const IDLE_SWEEP_INTERVAL_MS = 2 * 60 * 1000;

const WORKSPACE_ROOT = '/home/user/workspace';

/**
 * Sanitize an AI/agent-supplied path so it can never escape WORKSPACE_ROOT. Delegates to the shared
 * normalizer, which ALSO accepts an absolute in-workspace path ("/home/user/workspace/src/App.tsx" →
 * "src/App.tsx") — the old segment-only filter kept the root as literal segments, so the
 * `${WORKSPACE_ROOT}/${...}` join DOUBLED the root and the file op failed with "path does not exist".
 */
function safeRelPath(filePath: string): string {
  return toWorkspaceRelPath(filePath, WORKSPACE_ROOT);
}

/** Reject identifiers that are not safe to interpolate into a shell command. */
function assertSafeId(id: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(String(id ?? ''))) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  }
  return id;
}
// Dedicated tools dir outside the user's workspace — persists across workspace resets
const TOOLS_DIR = '/home/user/.e-tools';
// 1-hour sandbox lifetime. Refreshed on every activity via sandbox.setTimeout() so
// a long build (npm install + AI steps) never gets killed mid-run.
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

const CDP_PORT = 9222;
const CONSOLE_LOG = `${TOOLS_DIR}/console.log`;

const SCREENSHOT_SCRIPT = `
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  const vw=parseInt(process.argv[3],10)||1280;
  const vh=parseInt(process.argv[4],10)||720;
  await p.setViewportSize({width:vw,height:vh});
  const url=process.argv[2]||'about:blank';
  await p.goto(url,{waitUntil:'networkidle',timeout:15000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,800));
  const buf=await p.screenshot({type:'png',fullPage:false});
  process.stdout.write(buf.toString('base64'));
  await b.close();
})().catch(e=>{process.stderr.write(String(e));process.exit(1)});
`.trim();

// Screenshot via the SAME persistent CDP browser the agent drives (Phase 3),
// so a screenshot taken after a browser_action flow (login, navigation) reflects
// the real session/cookies/current-page — not a clean fresh browser. If a target
// URL is given and differs from the current page, navigate there first; otherwise
// just capture the live page. Exits WITHOUT closing the browser (state persists).
const SCREENSHOT_CDP_SCRIPT = `
const {chromium}=require('playwright');
(async()=>{
  const target=process.argv[2]||'';
  const vw=parseInt(process.argv[3],10)||1280;
  const vh=parseInt(process.argv[4],10)||720;
  const browser=await chromium.connectOverCDP('http://localhost:${CDP_PORT}');
  const ctx=browser.contexts()[0]||await browser.newContext({viewport:{width:vw,height:vh}});
  let page=ctx.pages()[0]||await ctx.newPage();
  await page.setViewportSize({width:vw,height:vh}).catch(()=>{});
  if(target && page.url()!==target){
    await page.goto(target,{waitUntil:'networkidle',timeout:15000}).catch(()=>{});
  }
  await new Promise(r=>setTimeout(r,600));
  const buf=await page.screenshot({type:'png',fullPage:false});
  process.stdout.write(buf.toString('base64'));
  process.exit(0);
})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1);});
`.trim();

// Long-lived browser the agent drives across multiple interaction steps.
// Launched once in the background; exposes a CDP port that action scripts
// connect to. The DOM/cookies/current-URL persist between actions.
// It also attaches console/pageerror/requestfailed listeners to every page
// (existing and future) and appends runtime errors to CONSOLE_LOG as NDJSON —
// this is how the agent SEES runtime errors, not just compile/build errors.
const BROWSER_DAEMON_SCRIPT = `
const {chromium}=require('playwright');
const fs=require('fs');
const LOG=${JSON.stringify(CONSOLE_LOG)};
function rec(kind,text){ try{ fs.appendFileSync(LOG, JSON.stringify({t:Date.now(),kind,text:String(text).slice(0,500)})+'\\n'); }catch(e){} }
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--remote-debugging-port=${CDP_PORT}']});
  const seen=new WeakSet();
  function attach(page){
    if(seen.has(page))return; seen.add(page);
    page.on('console',m=>{ if(m.type()==='error') rec('console',m.text()); });
    page.on('pageerror',e=>rec('pageerror',e&&e.message||e));
    page.on('requestfailed',r=>{ const f=r.failure(); rec('requestfailed',r.url()+' — '+(f&&f.errorText||'failed')); });
  }
  setInterval(()=>{ try{ for(const ctx of browser.contexts()){ for(const p of ctx.pages()){ attach(p); } } }catch(e){} }, 1000);
  setInterval(()=>{}, 1<<30);
})().catch(e=>{ process.stderr.write(String(e)); process.exit(1); });
`.trim();

// Connects to the persistent browser via CDP, performs ONE action, screenshots,
// then exits WITHOUT closing the browser (so state survives for the next action).
// Also emits cursorX/cursorY: the pixel coordinates of the element interacted with
// (bounding-box center for click/type; sensible defaults for other actions).
// The frontend uses these to render an animated cursor overlay on the screenshot.
const BROWSER_ACTION_SCRIPT = `
const {chromium}=require('playwright');
(async()=>{
  const a=JSON.parse(process.argv[2]||'{}');
  const browser=await chromium.connectOverCDP('http://localhost:${CDP_PORT}');
  const ctx=browser.contexts()[0]||await browser.newContext({viewport:{width:1280,height:720}});
  let page=ctx.pages()[0]||await ctx.newPage();
  await page.setViewportSize({width:1280,height:720}).catch(()=>{});
  let result='';
  let cursorX=640,cursorY=360;
  async function elCenter(sel){
    try{const el=await page.$(sel);if(el){const b=await el.boundingBox();if(b){return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};}}return null;}catch(e){return null;}
  }
  try{
    if(a.action==='navigate'){await page.goto(a.url,{waitUntil:'networkidle',timeout:20000});result='Navigated to '+a.url;}
    else if(a.action==='click_xy'){cursorX=a.x;cursorY=a.y;await page.mouse.click(a.x,a.y);await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});result='Clicked ('+a.x+','+a.y+')';}
    else if(a.action==='type_text'){await page.keyboard.type(a.text||'');result='Typed text';}
    else if(a.action==='click'){const c=await elCenter(a.selector);if(c){cursorX=c.x;cursorY=c.y;}await page.click(a.selector,{timeout:8000});result='Clicked '+a.selector;}
    else if(a.action==='type'){const c=await elCenter(a.selector);if(c){cursorX=c.x;cursorY=c.y;}await page.fill(a.selector,a.text||'',{timeout:8000});result='Typed into '+a.selector;}
    else if(a.action==='scroll'){cursorX=640;cursorY=a.direction==='up'?200:520;await page.evaluate(d=>window.scrollBy(0,d==='up'?-700:700),a.direction||'down');result='Scrolled '+(a.direction||'down');}
    else if(a.action==='press'){await page.keyboard.press(a.text||'Enter');result='Pressed '+(a.text||'Enter');}
    else if(a.action==='hover'){const c=await elCenter(a.selector);if(c){cursorX=c.x;cursorY=c.y;}await page.hover(a.selector,{timeout:8000});result='Hovered '+a.selector;}
    else if(a.action==='double_click'){const c=await elCenter(a.selector);if(c){cursorX=c.x;cursorY=c.y;}await page.dblclick(a.selector,{timeout:8000});result='Double-clicked '+a.selector;}
    else if(a.action==='select_option'){const c=await elCenter(a.selector);if(c){cursorX=c.x;cursorY=c.y;}await page.selectOption(a.selector,a.text||'',{timeout:8000});result='Selected "'+(a.text||'')+'" in '+a.selector;}
    else if(a.action==='wait'){await page.waitForTimeout(2500);result='Waited';}
    else{result='Unknown browser action: '+a.action;}
    await page.waitForTimeout(600);
  }catch(e){result='ERROR: '+String(e&&e.message||e);}
  const url=page.url();
  const buf=await page.screenshot({type:'png'});
  process.stdout.write(JSON.stringify({result,url,screenshot:buf.toString('base64'),cursorX,cursorY}));
  process.exit(0);
})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1);});
`.trim();

/** Wrap a string as a single shell argument (safe for arbitrary JSON payloads). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Guess the dev-server port from the launch command for health-check polling. */
function extractDevPort(command: string): number {
  const flag = command.match(/--port[=\s]+(\d+)/i);
  if (flag) return parseInt(flag[1], 10);
  const env = command.match(/\bPORT=(\d+)/);
  if (env) return parseInt(env[1], 10);
  if (/next|react-scripts/.test(command)) return 3000;
  return 5173; // Vite default (most AI-generated React apps)
}

/**
 * Phase 2 actuator: each workspaceId gets its own real e2b.dev cloud sandbox
 * (separate VM, real OS-level isolation). Requires E2B_API_KEY.
 */
export class E2BActuator implements IEngineerActuator {
  private sandboxes = new Map<string, Sandbox>();
  private templateRegistry = new TemplateRegistry();
  // Tracks per-sandbox playwright install progress
  private _playwrightReady = new Map<string, Promise<boolean>>();
  // Tracks per-sandbox persistent-browser daemon launch
  private _browserDaemon = new Map<string, Promise<boolean>>();
  // Phase 12E — last activity timestamp per workspace, drives idle auto-pause.
  private _lastActivity = new Map<string, number>();

  /**
   * Optional per-user E2B API key. When provided (e.g. a Pro user's own key for
   * the top execution tier), it overrides the global E2B_API_KEY so the sandbox
   * is billed to the user, not NavBharatAI. Falls back to the env key when empty.
   */
  constructor(private apiKey?: string) { /* the idle sweep starts with the first sandbox — see below */ }

  private _sweepTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the idle sweep, once, when this actuator actually has a sandbox to watch.
   *
   * It used to start in the constructor, and ProEngineRunner builds a NEW actuator for every Engineer
   * AI run — so every run left behind an interval that captured `this` forever. unref() stops a timer
   * keeping the process alive; it does not stop it retaining the object. On a long-lived Cloud Run
   * instance that is an unbounded pile of timers and dead actuators, each still sweeping every two
   * minutes. Starting on the first sandbox and stopping when the last one goes leaves at most one
   * timer per actuator that genuinely has work.
   */
  private _ensureSweepTimer(): void {
    if (this._sweepTimer) return;
    const timer = setInterval(() => { void this._sweepIdleSandboxes(); }, IDLE_SWEEP_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this._sweepTimer = timer;
  }

  private _stopSweepTimerIfIdle(): void {
    if (this._sweepTimer && this.sandboxes.size === 0) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  /** Build the e2b SDK options, injecting the per-user key when set. */
  private _opts(extra?: Record<string, unknown>): { timeoutMs: number; apiKey?: string } {
    return { timeoutMs: SANDBOX_TIMEOUT_MS, ...(this.apiKey ? { apiKey: this.apiKey } : {}), ...extra };
  }

  /**
   * Install npm dependencies with automatic peer-dep fallback:
   *   1. npm ci       — fastest, reproducible (requires package-lock.json)
   *   2. npm install  — creates/updates lock, resolves new deps
   *   3. npm install --legacy-peer-deps  — only when ERESOLVE is detected
   * Never throws; returns success flag + combined log for the agent to read.
   */
  private async _npmInstall(sandbox: Sandbox): Promise<{ success: boolean; log: string }> {
    // Step 0: Scan package.json for known-malicious or suspicious packages BEFORE
    // any install command runs. Block installs that contain critical threats.
    try {
      const pkgJson = await sandbox.files.read(`${WORKSPACE_ROOT}/package.json`).catch(() => null);
      if (pkgJson) {
        const scanResult = scanPackageJson(typeof pkgJson === 'string' ? pkgJson : new TextDecoder().decode(pkgJson as Uint8Array));
        if (!scanResult.safe) {
          const report = formatPackageScanReport(scanResult);
          console.error('[E2BActuator] npm install blocked by PackageSafetyScanner:\n', report);
          return { success: false, log: report };
        }
        if (scanResult.findings.length > 0) {
          console.warn('[E2BActuator] PackageSafetyScanner warnings:\n', formatPackageScanReport(scanResult));
        }
      }
    } catch (scanErr) {
      console.warn('[E2BActuator] PackageSafetyScanner skipped (non-fatal):', scanErr);
    }

    // Step 1: npm ci when a lock file exists (clean, reproducible install)
    const hasLock = await sandbox.files.exists(`${WORKSPACE_ROOT}/package-lock.json`).catch(() => false);
    if (hasLock) {
      const ci = await sandbox.commands.run('npm ci', {
        cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS,
      }).catch((err: any) => ({ exitCode: -1, stdout: '', stderr: err?.message || String(err) }));
      if (ci.exitCode === 0) return { success: true, log: ci.stdout + ci.stderr };
      // npm ci failed (stale lock, missing lock entry) — fall through to npm install
    }

    // Step 2: npm install (resolves all deps, creates/updates lock file)
    const install = await sandbox.commands.run('npm install', {
      cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS,
    }).catch((err: any) => ({ exitCode: -1, stdout: '', stderr: err?.message || String(err) }));
    const installLog = install.stdout + install.stderr;
    if (install.exitCode === 0) return { success: true, log: installLog };

    // Step 3: ERESOLVE peer-dep conflict — retry with --legacy-peer-deps
    if (/ERESOLVE|peer dep(endenc)?/i.test(installLog)) {
      const retry = await sandbox.commands.run('npm install --legacy-peer-deps', {
        cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS,
      }).catch((err: any) => ({ exitCode: -1, stdout: '', stderr: err?.message || String(err) }));
      const retryLog = retry.stdout + retry.stderr;
      return {
        success: retry.exitCode === 0,
        log: installLog + '\n[--legacy-peer-deps retry]\n' + retryLog,
      };
    }

    return { success: false, log: installLog };
  }

  /** Pause sandboxes with no activity for the idle limit (abandoned sessions). */
  private async _sweepIdleSandboxes(): Promise<void> {
    const now = Date.now();
    const limit = idleLimitMs();
    for (const [workspaceId, sandbox] of [...this.sandboxes]) {
      const last = this._lastActivity.get(workspaceId) ?? now;
      if (now - last > limit) {
        await this.pauseSandbox(sandbox.sandboxId).catch(() => {});
        this._lastActivity.delete(workspaceId);
      }
    }
    this._stopSweepTimerIfIdle();
  }

  private async getSandbox(workspaceId: string, resumeSandboxId?: string): Promise<Sandbox> {
    // Refresh activity FIRST so any in-flight operation protects its sandbox from
    // the idle sweep for the full IDLE_LIMIT_MS window.
    this._lastActivity.set(workspaceId, Date.now());

    const existing = this.sandboxes.get(workspaceId);
    if (existing) {
      // Reset the E2B cloud-side countdown on every activity so a long build never
      // gets killed mid-run. Fire-and-forget — failure is non-fatal.
      existing.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});
      return existing;
    }

    let sandbox: Sandbox;
    if (resumeSandboxId) {
      // Reconnect to the persisted sandbox — auto-resumes it if paused, restoring
      // all files, node_modules, and any running dev server. Fall back to a fresh
      // sandbox if the resume target was killed/expired.
      try {
        sandbox = await Sandbox.connect(resumeSandboxId, this._opts());
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});
      } catch {
        sandbox = await Sandbox.create(this._opts());
      }
    } else {
      sandbox = await Sandbox.create(this._opts());
    }
    this.sandboxes.set(workspaceId, sandbox);
    usageTracker.record(workspaceId, 'sandbox');
    this._ensureSweepTimer(); // there is now something to auto-pause
    return sandbox;
  }

  async ensureWorkspace(workspaceId: string, projectType?: string, resumeSandboxId?: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId, resumeSandboxId);
    const exists = await sandbox.files.exists(WORKSPACE_ROOT);
    if (exists) {
      // Resumed sandbox already has the workspace — just ensure browser tooling is warming up.
      this._kickoffPlaywright(sandbox, workspaceId);
      return;
    }

    await sandbox.files.makeDir(WORKSPACE_ROOT);

    // Resolve template: fall back to vite-react for unknown/auto types.
    const templateKey =
      projectType && projectType !== 'auto' && projectType !== 'node' && projectType !== 'python'
        ? projectType
        : (projectType === 'python' ? 'python-fastapi' : 'vite-react');
    try {
      const files = this.templateRegistry.getProvider(templateKey).getFiles([]);
      await sandbox.files.writeFiles(
        Object.entries(files).map(([p, content]) => ({ path: `${WORKSPACE_ROOT}/${safeRelPath(p)}`, data: content }))
      );
    } catch {
      // Unknown template — start with an empty workspace, agent will scaffold it.
    }

    // Kick off playwright install in background immediately — by the time the agent
    // builds an app and starts a dev server, it'll be ready.
    this._kickoffPlaywright(sandbox, workspaceId);
  }

  /** Fire-and-forget: installs playwright + chromium in a dedicated tools dir. */
  private _kickoffPlaywright(sandbox: Sandbox, workspaceId: string): void {
    if (this._playwrightReady.has(workspaceId)) return;
    const promise: Promise<boolean> = (async () => {
      try {
        await sandbox.files.makeDir(TOOLS_DIR).catch(() => {});
        const hasPkg = await sandbox.files.exists(`${TOOLS_DIR}/node_modules/playwright`).catch(() => false);
        if (!hasPkg) {
          // --prefix installs into TOOLS_DIR without touching the workspace
          const install = await sandbox.commands.run(
            `npm install playwright --prefix ${TOOLS_DIR} --no-save 2>&1`,
            { timeoutMs: 120_000 }
          );
          if (install.exitCode !== 0) return false;
        }
        // Install chromium browser binaries
        const hasBin = await sandbox.files.exists(`${TOOLS_DIR}/.browsers/chromium-*/chrome-linux/chrome`).catch(() => false);
        if (!hasBin) {
          const pw = await sandbox.commands.run(
            `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/node_modules/.bin/playwright install chromium 2>&1`,
            { timeoutMs: 180_000 }
          );
          if (pw.exitCode !== 0) return false;
        }
        // Write the reusable browser scripts once
        await sandbox.files.write(`${TOOLS_DIR}/screenshot.js`, SCREENSHOT_SCRIPT);
        await sandbox.files.write(`${TOOLS_DIR}/screenshot-cdp.js`, SCREENSHOT_CDP_SCRIPT);
        await sandbox.files.write(`${TOOLS_DIR}/daemon.js`, BROWSER_DAEMON_SCRIPT);
        await sandbox.files.write(`${TOOLS_DIR}/browser-action.js`, BROWSER_ACTION_SCRIPT);
        return true;
      } catch {
        return false;
      }
    })();
    this._playwrightReady.set(workspaceId, promise);
  }

  async writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    await sandbox.files.write(`${WORKSPACE_ROOT}/${safeRelPath(filePath)}`, content);
  }

  async writeBinaryFile(workspaceId: string, filePath: string, base64: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    await sandbox.files.write(`${WORKSPACE_ROOT}/${safeRelPath(filePath)}`, bytes);
  }

  async readFile(workspaceId: string, filePath: string): Promise<string> {
    const sandbox = await this.getSandbox(workspaceId);
    return sandbox.files.read(`${WORKSPACE_ROOT}/${safeRelPath(filePath)}`);
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    const sandbox = await this.getSandbox(workspaceId);
    const entries = await sandbox.files.list(WORKSPACE_ROOT, { depth: 10 });
    return entries
      .filter(e => e.type === 'file')
      .map(e => e.path.slice(WORKSPACE_ROOT.length + 1));
  }

  async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    usageTracker.record(workspaceId, 'build');
    try {
      // Python project: install deps via pip, then do a syntax check (no compile step).
      const hasPyMain = await sandbox.files.exists(`${WORKSPACE_ROOT}/main.py`).catch(() => false);
      if (hasPyMain) {
        const hasReqs = await sandbox.files.exists(`${WORKSPACE_ROOT}/requirements.txt`).catch(() => false);
        let installLog = '';
        if (hasReqs) {
          const install = await sandbox.commands.run(
            'pip install -r requirements.txt -q',
            { cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS },
          );
          installLog = install.stdout + install.stderr;
        }
        const check = await sandbox.commands.run('python3 -m py_compile main.py', {
          cwd: WORKSPACE_ROOT, timeoutMs: 30_000,
        });
        return { success: check.exitCode === 0, logs: installLog + check.stdout + check.stderr };
      }

      // Static project (no package.json): nothing to build.
      const hasPkg = await sandbox.files.exists(`${WORKSPACE_ROOT}/package.json`).catch(() => false);
      if (!hasPkg) {
        return { success: true, logs: '(no build step — static project)' };
      }

      // Node/npm project: install if needed (with peer-dep fallback), then build.
      let installLog = '';
      const hasModules = await sandbox.files.exists(`${WORKSPACE_ROOT}/node_modules`).catch(() => false);
      if (!hasModules) {
        const installResult = await this._npmInstall(sandbox);
        installLog = installResult.log;
        if (!installResult.success) {
          return { success: false, logs: installLog };
        }
      }
      const build = await sandbox.commands.run('npm run build', {
        cwd: WORKSPACE_ROOT,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return {
        success: build.exitCode === 0,
        logs: installLog + build.stdout + build.stderr,
      };
    } catch (err: any) {
      return { success: false, logs: `${err.stdout || ''}${err.stderr || ''}${err.message || String(err)}` };
    }
  }

  async runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    usageTracker.record(workspaceId, 'command');

    // Long-running commands (dev servers, watchers) never exit — run in background,
    // collect startup output for 20 s (enough for Vite/Next to print the port),
    // then disconnect and leave the process alive.
    // Guard: a one-shot fetch (curl/wget) is never long-running even if its URL
    // happens to contain words like "serve" or "dev".
    const isFetch = /^\s*(?:curl|wget)\b/.test(command);
    const isLongRunning = !isFetch && (
      /\b(?:dev|serve|watch|livereload)\b/i.test(command) ||
      /npm\s+run\s+(?:dev|start|serve)\b/i.test(command) ||
      /python.*http\.server|http-server|live-server/i.test(command) ||
      /\buvicorn\b|\bgunicorn\b|\bflask\s+run\b/i.test(command)
    );

    if (isLongRunning) {
      let stdout = '';
      let stderr = '';
      // Force a 0.0.0.0 bind so the dev server is reachable via the external
      // preview URL (a localhost-only bind silently 502s the preview).
      const launchCommand = ensureHostBinding(command);
      const handle = await sandbox.commands.run(launchCommand, {
        cwd: WORKSPACE_ROOT,
        background: true,
        onStdout: s => { stdout += s; },
        onStderr: s => { stderr += s; },
      });
      await new Promise(resolve => setTimeout(resolve, 20_000));
      await handle.disconnect().catch(() => {});

      // Health check: confirm the dev server port is actually listening.
      // If not, attempt one automatic restart so transient startup crashes self-heal.
      const port = extractDevPort(launchCommand);
      const portCheck = await sandbox.commands.run(
        `nc -z localhost ${port} 2>/dev/null && echo PORT_UP || echo PORT_DOWN`,
        { timeoutMs: 5000 },
      ).catch(() => ({ stdout: 'PORT_DOWN' } as any));
      if (portCheck.stdout.includes('PORT_DOWN')) {
        stdout += `\n[health-check] port ${port} not responding — restarting…`;
        await sandbox.commands.run(
          `fuser -k ${port}/tcp 2>/dev/null; pkill -f "node.*${port}" 2>/dev/null || true`,
          { timeoutMs: 5000 },
        ).catch(() => {});
        const retry = await sandbox.commands.run(launchCommand, {
          cwd: WORKSPACE_ROOT,
          background: true,
          onStdout: s => { stdout += s; },
          onStderr: s => { stderr += s; },
        });
        await new Promise(r => setTimeout(r, 15_000));
        await retry.disconnect().catch(() => {});
      } else {
        stdout += `\n[health-check] port ${port} is UP`;
      }

      return { exitCode: 0, stdout, stderr };
    }

    try {
      const result = await sandbox.commands.run(command, {
        cwd: WORKSPACE_ROOT,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (err: any) {
      return { exitCode: -1, stdout: err.stdout || '', stderr: err.stderr || err.message || String(err) };
    }
  }

  async browseUrl(workspaceId: string, url: string): Promise<{ html: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    // Try Playwright if installed, fall back to curl.
    const playwrightScript = `node -e "
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  await p.goto(${JSON.stringify(url)},{waitUntil:'networkidle',timeout:15000}).catch(()=>{});
  console.log((await p.content()).slice(0,30000));
  await b.close();
})().catch(e=>{process.stderr.write(e.message);process.exit(1)});
" 2>/dev/null`;
    const pw = await sandbox.commands.run(playwrightScript, {
      cwd: WORKSPACE_ROOT, timeoutMs: 25_000,
    });
    if (pw.exitCode === 0 && pw.stdout.trim()) return { html: pw.stdout };

    const result = await sandbox.commands.run(
      `curl -s -L --max-time 20 -A "Mozilla/5.0" "${url}" 2>/dev/null | head -c 30000`,
      { cwd: WORKSPACE_ROOT, timeoutMs: 30_000 }
    );
    return { html: result.stdout || result.stderr };
  }

  async getPortUrl(workspaceId: string, port: number): Promise<string> {
    const sandbox = await this.getSandbox(workspaceId);
    return `https://${sandbox.getHost(port)}`;
  }

  async screenshot(workspaceId: string, url: string, viewport?: { width: number; height: number }): Promise<{ base64: string; mimeType: 'image/png' }> {
    const sandbox = await this.getSandbox(workspaceId);
    usageTracker.record(workspaceId, 'screenshot');
    const vw = viewport?.width ?? 1280;
    const vh = viewport?.height ?? 720;

    // Ensure playwright background install has been kicked off
    if (!this._playwrightReady.has(workspaceId)) {
      this._kickoffPlaywright(sandbox, workspaceId);
    }

    // Wait up to 90 s for the install to complete (it runs in parallel with coding steps)
    const ready = await Promise.race([
      this._playwrightReady.get(workspaceId)!,
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 90_000)),
    ]);

    if (!ready) {
      throw new Error(
        'Playwright not ready yet (still installing or failed). ' +
        'Ask the agent to run: npm install playwright && npx playwright install chromium'
      );
    }

    // Prefer the SHARED persistent browser (CDP) so the screenshot reflects the
    // same session the agent's browser_action hands have been driving. Falls back
    // to a fresh standalone browser if the daemon/CDP isn't reachable.
    await this._ensureBrowserDaemon(sandbox, workspaceId).catch(() => {});
    const cdp = await sandbox.commands.run(
      `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/screenshot-cdp.js ${JSON.stringify(url)} ${vw} ${vh}`,
      { cwd: TOOLS_DIR, timeoutMs: 30_000 }
    ).catch(() => null);
    if (cdp && cdp.exitCode === 0 && cdp.stdout) {
      return { base64: cdp.stdout.trim(), mimeType: 'image/png' };
    }

    // Fallback: fresh standalone browser (clean session, but always works).
    const result = await sandbox.commands.run(
      `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/screenshot.js ${JSON.stringify(url)} ${vw} ${vh}`,
      { cwd: TOOLS_DIR, timeoutMs: 30_000 }
    );

    if (!result.stdout || result.exitCode !== 0) {
      throw new Error(`Screenshot failed: ${result.stderr.slice(0, 300)}`);
    }

    return { base64: result.stdout.trim(), mimeType: 'image/png' };
  }

  /** Launch the persistent browser daemon once and wait for its CDP port to open. */
  private async _ensureBrowserDaemon(sandbox: Sandbox, workspaceId: string): Promise<boolean> {
    const existing = this._browserDaemon.get(workspaceId);
    if (existing) return existing;

    const promise: Promise<boolean> = (async () => {
      // daemon.js is written during playwright install; rewrite defensively in case.
      await sandbox.files.write(`${TOOLS_DIR}/daemon.js`, BROWSER_DAEMON_SCRIPT).catch(() => {});
      await sandbox.commands
        .run(`PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/daemon.js`, {
          cwd: TOOLS_DIR,
          background: true,
        })
        .catch(() => {});

      // Poll the CDP version endpoint until the browser is reachable (up to ~20 s)
      for (let i = 0; i < 20; i++) {
        const c = await sandbox.commands
          .run(`curl -s http://localhost:${CDP_PORT}/json/version || true`, { timeoutMs: 5000 })
          .catch(() => ({ stdout: '' } as any));
        if (c.stdout && c.stdout.includes('webSocketDebuggerUrl')) return true;
        await new Promise(r => setTimeout(r, 1000));
      }
      // Proceed anyway — the action script also waits/retries the connection.
      return true;
    })();

    this._browserDaemon.set(workspaceId, promise);
    return promise;
  }

  async browserAction(
    workspaceId: string,
    action: 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait' | 'hover' | 'double_click' | 'select_option' | 'click_xy' | 'type_text',
    args: { selector?: string; text?: string; url?: string; direction?: 'up' | 'down'; x?: number; y?: number },
  ): Promise<{ screenshot: string; result: string; cursorX?: number; cursorY?: number }> {
    const sandbox = await this.getSandbox(workspaceId);

    if (!this._playwrightReady.has(workspaceId)) this._kickoffPlaywright(sandbox, workspaceId);
    const ready = await Promise.race([
      this._playwrightReady.get(workspaceId)!,
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 120_000)),
    ]);
    if (!ready) {
      throw new Error('Playwright not ready yet (still installing or failed).');
    }

    await this._ensureBrowserDaemon(sandbox, workspaceId);

    const payload = JSON.stringify({ action, ...args });
    const result = await sandbox.commands.run(
      `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/browser-action.js ${shellQuote(payload)}`,
      { cwd: TOOLS_DIR, timeoutMs: 30_000 },
    );

    if (!result.stdout || result.exitCode !== 0) {
      throw new Error(`Browser action failed: ${result.stderr.slice(0, 300)}`);
    }

    const parsed = JSON.parse(result.stdout.trim());
    const detail = parsed.url ? `${parsed.result} (now at ${parsed.url})` : parsed.result;
    return {
      screenshot: parsed.screenshot,
      result: detail,
      cursorX: typeof parsed.cursorX === 'number' ? parsed.cursorX : undefined,
      cursorY: typeof parsed.cursorY === 'number' ? parsed.cursorY : undefined,
    };
  }

  async getConsoleErrors(
    workspaceId: string,
    sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[] }> {
    const sandbox = await this.getSandbox(workspaceId);
    let raw = '';
    try {
      raw = await sandbox.files.read(CONSOLE_LOG);
    } catch {
      return { errors: [] }; // no browser session yet / no errors logged
    }
    const errors: { t: number; kind: string; text: string }[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const e = JSON.parse(trimmed);
        if (typeof e.t === 'number' && e.t > sinceMs) {
          errors.push({ t: e.t, kind: String(e.kind || 'console'), text: String(e.text || '') });
        }
      } catch { /* skip malformed line */ }
    }
    // Cap to the most recent 20 to keep the AI prompt bounded
    return { errors: errors.slice(-20) };
  }

  async getSandboxId(workspaceId: string): Promise<string | null> {
    const sandbox = this.sandboxes.get(workspaceId);
    return sandbox ? sandbox.sandboxId : null;
  }

  async searchFiles(workspaceId: string, terms: string[]): Promise<string[]> {
    if (terms.length === 0) return [];
    const sandbox = await this.getSandbox(workspaceId);
    const termArgs = terms.slice(0, 8).map(t => `-e ${shellQuote(t)}`).join(' ');
    const result = await sandbox.commands.run(
      `grep -rl ${termArgs} \
        --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
        --include="*.py" --include="*.css" --include="*.json" --include="*.html" \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
        --exclude-dir=.next --exclude-dir=build --exclude-dir=__pycache__ \
        ${WORKSPACE_ROOT} 2>/dev/null | head -40`,
      { cwd: WORKSPACE_ROOT, timeoutMs: 10_000 }
    ).catch(() => ({ stdout: '', stderr: '', exitCode: -1 }));
    return result.stdout
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => p.startsWith(`${WORKSPACE_ROOT}/`) ? p.slice(`${WORKSPACE_ROOT}/`.length) : p);
  }

  async pauseSandbox(sandboxId: string): Promise<boolean> {
    try {
      // Static pause works across server instances — operates on the cloud
      // resource directly, even if this instance never held the live object.
      const ok = await Sandbox.pause(sandboxId);
      // Drop any live reference so the next run reconnects (and auto-resumes).
      for (const [wid, sb] of this.sandboxes) {
        if (sb.sandboxId === sandboxId) this.sandboxes.delete(wid);
      }
      return ok;
    } catch {
      return false;
    }
  }

  // Checkpoints directory lives outside WORKSPACE_ROOT so it survives a restore.
  private static readonly CKPT_DIR = '/home/user/.e-checkpoints';

  async checkpoint(workspaceId: string, triggeredBy = 'manual'): Promise<string> {
    const sandbox = await this.getSandbox(workspaceId);
    assertSafeId(workspaceId, 'workspaceId');
    const id = `ckpt_${Date.now()}`;
    const dir = `${E2BActuator.CKPT_DIR}/${workspaceId}`;
    const meta = JSON.stringify({ id, createdAt: Date.now(), triggeredBy: triggeredBy.slice(0, 80) });
    await sandbox.commands.run(
      `mkdir -p ${dir} && tar --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./.next --exclude=./.e-checkpoints -czf ${dir}/${id}.tar.gz -C ${WORKSPACE_ROOT} . && printf %s ${shellQuote(meta)} > ${dir}/${id}.json`,
      { timeoutMs: 30_000 },
    ).catch(() => ({ stdout: '', stderr: '', exitCode: -1 }));
    return id;
  }

  async downloadDistFiles(workspaceId: string): Promise<Map<string, Buffer>> {
    const sandbox = await this.getSandbox(workspaceId);
    // Phase 16 — try dist/ first (Vite, esbuild), then out/ (Next.js static export).
    const distPath = `${WORKSPACE_ROOT}/dist`;
    const outPath = `${WORKSPACE_ROOT}/out`;

    // Use a Node.js one-liner inside the sandbox to recursively read all files
    // in the output directory as base64, output as JSON {relativePath: base64string}.
    // Node.js is always available (it's the E2B base template runtime).
    const script = [
      `node -e "`,
      `const fs=require('fs'),path=require('path');`,
      `function walk(d,b,o){`,
      `  try{for(const f of fs.readdirSync(d)){`,
      `    const a=path.join(d,f),r=(b?b+'/':'')+f;`,
      `    if(fs.statSync(a).isDirectory()) walk(a,r,o);`,
      `    else o[r]=fs.readFileSync(a).toString('base64');`,
      `  }}catch(e){}`,
      `  return o;`,
      `}`,
      `let out={};`,
      `const dirs=[${JSON.stringify(distPath)},${JSON.stringify(outPath)}];`,
      `for(const d of dirs){const r=walk(d,'',{});if(Object.keys(r).length){out=r;break;}}`,
      `if(!Object.keys(out).length) throw new Error('dist/ and out/ are empty or do not exist');`,
      `console.log(JSON.stringify(out));`,
      `"`,
    ].join('');

    const result = await sandbox.commands.run(script, { timeoutMs: 30_000 });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      throw new Error(
        `No build output found in dist/ or out/. Run "npm run build" first (for Next.js static export add output:'export' to next.config.js).\n` +
        (result.stderr || result.stdout).slice(0, 300),
      );
    }

    const data: Record<string, string> = JSON.parse(result.stdout.trim());
    const files = new Map<string, Buffer>();
    for (const [relPath, base64] of Object.entries(data)) {
      files.set(relPath, Buffer.from(base64, 'base64'));
    }
    return files;
  }

  async provisionBackend(workspaceId: string, features: ('db' | 'auth' | 'storage')[]): Promise<BackendProvisionResult> {
    const sandbox = await this.getSandbox(workspaceId);

    let dbUrl = '';
    let dbVerified = false;
    let dbVerifyFailure: string | null = null;
    if (features.includes('db')) {
      // SIBLING FIX (rule 3, 2026-08-06). This was an independent COPY of the AgentV3 provisioner as it
      // stood before the Mitrify autopsies, and it carried every defect they killed — plus the worst
      // one of its own:
      //   • `apt-get install`, `pg_ctlcluster` and `su postgres` are ALL root-only, and the sandbox runs
      //     unprivileged, so this could never start a database on any build, ever;
      //   • the image ships no PostgreSQL at all (measured: PSQL:none PGBIN:none), so there was nothing
      //     to start either way;
      //   • and on failure it printed DB_NOT_READY and then handed the caller a DATABASE_URL anyway
      //     (`?? 'postgresql://…/myapp'`), which the loop wrote straight into `.env`. The app then met
      //     ECONNREFUSED on boot while every status line said the backend was provisioned. That is the
      //     exact false success the shared provisioner exists to kill.
      // It now runs the SAME script, parses the SAME markers and reports the SAME honest outcome as
      // AgentV3. Two copies of this is how one of them silently rots; there is one.
      const pgResult = await sandbox.commands
        .run(dbProvisionScript(), { timeoutMs: 180_000 })
        .catch(() => null);
      const outcome = parseDbProvision(pgResult?.stdout);
      dbVerified = outcome.verified;
      dbVerifyFailure = outcome.failure;
      // The URL is still written when unverified — .env must point at the local server so a late start
      // heals without a rewrite — but it can no longer masquerade as success: `dbVerified` travels with
      // it, and the honest note is the shared one.
      dbUrl = outcome.url ?? CANONICAL_DB_URL;
    }

    const jwtSecret = `jwt_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const envVars: Record<string, string> = {};
    if (features.includes('db'))      envVars.DATABASE_URL = dbUrl;
    if (features.includes('auth'))    envVars.JWT_SECRET   = jwtSecret;
    if (features.includes('storage')) envVars.STORAGE_DIR  = './uploads';

    const scaffoldFiles = BackendProvisioner.getScaffoldFiles(features);
    return { dbUrl, envVars, scaffoldFiles, dbVerified, dbVerifyFailure };
  }

  async restore(workspaceId: string, checkpointId: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    // checkpointId is agent-controlled — validate before it reaches the shell to block injection.
    assertSafeId(workspaceId, 'workspaceId');
    assertSafeId(checkpointId, 'checkpointId');
    const tarPath = `${E2BActuator.CKPT_DIR}/${workspaceId}/${checkpointId}.tar.gz`;
    const result = await sandbox.commands.run(
      `test -f ${tarPath} && tar -xzf ${tarPath} -C ${WORKSPACE_ROOT} --overwrite`,
      { timeoutMs: 30_000 },
    );
    if (result.exitCode !== 0) {
      throw new Error(`Restore failed: ${result.stderr.slice(0, 300)}`);
    }
  }
}

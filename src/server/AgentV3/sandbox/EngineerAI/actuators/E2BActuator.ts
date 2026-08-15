import { Sandbox } from 'e2b';
import { parseNpmAuditSummary } from '../../../npmAuditSummary';
import { shouldRunAuditFix, AUDIT_FIX_COMMAND, AUDIT_FIX_TIMEOUT_MS } from '../../../npmAuditFix';
import { commandFailureResult } from '../../../../lib/sandboxCommandError';
import type { CommandHandle } from 'e2b';
import { TemplateRegistry } from '../../AppMakerLab/generator/templates/TemplateRegistry';
import { IEngineerActuator, BackendProvisionResult } from './IEngineerActuator';
import { BackendProvisioner } from '../BackendProvisioner';
import { usageTracker } from '../UsageTracker';
import { ensureHostBinding, buildPreKillPortCommand, buildPortWaitCommand, pinDevServerPort, detectDevPort, shouldReprobeBoundPort, shouldSkipDevServerLaunch, stripDevServerBackgrounding, buildDepsStaleCheckCommand, isLongRunningCommand, disableDevServerAutoOpen, redirectDevServerOutput, resolvePmScript, detectDevFramework, isNodeServerCommand, buildHttpLivenessCommand, backgroundedServerSmokeCheckMs, DEV_SERVER_LOG_PATH, devServerWatchdogCommand } from './devServerHost';
import { buildPortSweepCommand, parsePortSweep, portCandidates, shouldSweep, sweepFoundSummary } from './portSweep';
import type { DevFramework } from './devServerHost';
import { planDevServerRecovery, classifyDevServerFailure, devServerHealthLine, devServerRunnerMissing, type DevServerDiagnosis } from './DevServerRecovery';
import { dbProvisionScript, parseDbProvision, provisionOutcomeNote, provisionDiagnostics, CANONICAL_DB_URL, type DbProvisionOutcome } from '../../dbProvisionVerify';
import { ensureViteAllowedHosts } from '../../../ViteConfigGuard';
import { toWorkspaceRelPath } from '../../../../lib/workspacePath';
import { isDeadSandboxSignal, isDeadSandboxError, resolveThrownCommandExit, recordCommandLatency, newSandboxLatencyState } from './sandboxHealth';
import { postgresWatchdogCommand, mergeEnvVar } from '../../../postgresProvision';
import { resolveTemplateId } from './fullstackRouting';
import { sandboxStore, sandboxResumeEnabled } from '../../../SandboxStore';
import { idleLimitMs, reapAfterMs, sandboxesToReap, shouldTouchDurable } from '../../../sandboxReaper';

// Phase 12E — auto-pause a sandbox after this much inactivity to stop compute
// billing on abandoned sessions. Must be less than SANDBOX_TIMEOUT_MS so the
// idle sweep fires before E2B kills the sandbox on its own.
//
// The limit itself now lives in sandboxReaper.ts (15 minutes, env-tunable) — it was 45, which meant a
// five-minute build was followed by three quarters of an hour of billed idle VM, usually for someone
// who had already closed the tab.
const IDLE_SWEEP_INTERVAL_MS = 2 * 60 * 1000;

import {
  BROWSE_PAINT_DEADLINE_MS, BROWSE_PAINT_POLL_MS, splitPaintMarker,
} from '../../../PreviewVerify';
import { assertWriteAllowed } from '../../../greenFreeze';

const WORKSPACE_ROOT = '/home/user/workspace';

/**
 * Sanitize an AI/agent-supplied path so it can never escape WORKSPACE_ROOT. Delegates to the shared
 * normalizer, which ALSO accepts an absolute in-workspace path ("/home/user/workspace/src/App.tsx" →
 * "src/App.tsx"). The old segment-only filter kept the root as literal segments, so the file ops'
 * `${WORKSPACE_ROOT}/${...}` join DOUBLED the root and every such read/write/edit failed with
 * "path does not exist" (build-diagnostics root cause, 2026-07-03).
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
// Hard cap on how long Sandbox.create()/connect() may block. The e2b SDK's timeoutMs
// option is the sandbox LIFETIME, not a connect-request timeout — so without this a
// slow/throttled/misconfigured E2B makes workspace setup HANG with no event emitted
// (the "infinite loading then stop" symptom). On timeout we throw, so the route's
// ensureWorkspace try/catch surfaces an honest "sandbox unavailable" instead of hanging.
const SANDBOX_CREATE_TIMEOUT_MS = Math.max(
  10_000,
  parseInt(process.env.AGENTV3_SANDBOX_CREATE_TIMEOUT_MS || '', 10) || 45_000,
);

/** Reject if `p` does not settle within `ms` — bounds a call that could otherwise hang forever.
 *  Exported for unit testing. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Directories excluded from listFiles — dependency/build/VCS output the agent never edits.
// Mirrors LocalActuator's IGNORED_DIRS so both actuators present the same (small) file tree.
const IGNORED_LIST_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build',
  '__pycache__', '.venv', '.cache', 'coverage', 'out', '.e-checkpoints',
]);

/** True if a workspace-relative path lives under an ignored dir (any path segment matches).
 *  Exported for unit testing. */
export function isIgnoredListPath(relPath: string): boolean {
  return relPath.split('/').some(seg => IGNORED_LIST_DIRS.has(seg));
}

/**
 * A3 (v5.0 redesign — E2B reliability) — resolve the custom E2B image the sandbox should launch from.
 *
 * Root cause the audit found: every sandbox was created from E2B's DEFAULT base image because the
 * committed custom template (`navbharat-builder`, pinned modern Node — see infra/e2b/) was NEVER
 * wired into Sandbox.create(). This is the #1 reason v5.0 builds felt unreliable (wrong runtime).
 *
 * When `E2B_TEMPLATE_ID` is set, that id is passed as SandboxOpts.template so Sandbox.create() launches
 * the pinned image; when unset it returns undefined → no `template` field → E2B's default base, i.e. the
 * EXACT current behavior. So this is a safe, env-gated no-op until the admin publishes the template and
 * sets the env var (see infra/e2b/README.md). Pure + exported → unit-testable.
 */
export function resolveE2bTemplate(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const t = env.E2B_TEMPLATE_ID?.trim();
  return t ? t : undefined;
}

const CDP_PORT = 9222;
const CONSOLE_LOG = `${TOOLS_DIR}/console.log`;

/**
 * WAIT FOR THE APP TO PAINT, NOT FOR A CLOCK — the in-sandbox snippet, shared by every capture path.
 *
 * ROOT CAUSE (admin field report 2026-08-12): all three capture paths waited a FIXED number of
 * milliseconds and then looked. A fixed sleep has exactly one failure mode — an app slower than the
 * guess is captured mid-load. The screenshot then shows a spinner or a blank page, the DOM scan finds
 * no elements, the preview verdict reads an empty `<div id="root">` and declares the app crashed, and
 * a repair pass edits code that was never broken. The repair restarts the dev server, the preview
 * really does go down, and the next capture can be early again. That loop turned a 7-minute app into a
 * 34-minute build.
 *
 * Polling ends the moment content appears, so a fast app is captured SOONER than the old fixed sleep
 * while a slow one stops being libelled. Written ONCE and shared, because three copies of a timing
 * rule is three chances for one of them to keep the old bug (the safeRelPath lesson).
 *
 * `networkidle` is not an option and never was: a Vite/CRA dev server's HMR socket never goes idle.
 */
const paintWaitJs = (page: string): string => `
  var painted=0;
  for(var i=0;i<${Math.ceil(BROWSE_PAINT_DEADLINE_MS / BROWSE_PAINT_POLL_MS)};i++){
    var n=await ${page}.evaluate(function(){
      var r=document.getElementById('root')||document.getElementById('app')||document.body;
      if(!r) return 0;
      return (r.children?r.children.length:0)+((r.innerText||'').trim().length);
    }).catch(function(){return 0;});
    if(n>0){painted=1;break;}
    await ${page}.waitForTimeout(${BROWSE_PAINT_POLL_MS});
  }
  if(painted){await ${page}.waitForTimeout(250);}
`;

const SCREENSHOT_SCRIPT = `
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  const vw=parseInt(process.argv[3],10)||1280;
  const vh=parseInt(process.argv[4],10)||720;
  await p.setViewportSize({width:vw,height:vh});
  const url=process.argv[2]||'about:blank';
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
${paintWaitJs('p')}
  const buf=await p.screenshot({type:'png',fullPage:false});
  require('fs').writeFileSync('${TOOLS_DIR}/last-shot.png', buf);
  process.stdout.write('OK');
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
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
  }
${paintWaitJs('page')}
  const buf=await page.screenshot({type:'png',fullPage:false});
  require('fs').writeFileSync('${TOOLS_DIR}/last-shot.png', buf);
  process.stdout.write('OK');
  process.exit(0);
})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1);});
`.trim();

// Long-lived browser the agent drives across multiple interaction steps.
// Launched once in the background; exposes a CDP port that action scripts
// connect to. The DOM/cookies/current-URL persist between actions.
// It also attaches console/pageerror/requestfailed/response listeners to every
// page (existing and future) and appends runtime errors to CONSOLE_LOG as NDJSON —
// this is how the agent SEES runtime errors, not just compile/build errors.
// The 'response' listener captures HTTP 5xx SERVER errors: a fetch/XHR that
// COMPLETES with a 500 does NOT fire 'requestfailed' (that is transport-only), so
// a broken API call is otherwise invisible to the auto-fix loop unless the app
// happens to console.error it. Only 5xx is captured — 4xx (401/403/404) is left
// out on purpose (auth/probing is routinely intentional and would be noise).
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
    page.on('response',res=>{ try{ const s=res.status(); if(s>=500) rec('httperror','HTTP '+s+' from '+res.url()); }catch(e){} });
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
  // Write the PNG to a FILE instead of embedding its base64 in stdout. The sandbox caps commands.run
  // stdout at 64KB (65536 bytes); a base64 screenshot blows past that, which truncated the JSON
  // mid-string and broke JSON.parse with "Unterminated string in JSON at position 65536" on EVERY
  // interaction (BENCHMARK #2/#3 + the restart-button fix, 2026-08-12) — so the model could never
  // verify a click and fell back to claiming PASS it had not confirmed. The TS side reads the bytes.
  require('fs').writeFileSync('${TOOLS_DIR}/last-action.png', buf);
  process.stdout.write(JSON.stringify({result,url,cursorX,cursorY}));
  process.exit(0);
})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1);});
`.trim();

/** Wrap a string as a single shell argument (safe for arbitrary JSON payloads). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a browser action, retrying exactly ONCE after relaunching the CDP daemon if the first attempt
 * fails (BENCHMARK #2, 2026-08-12 — browser_action failed twice with a bare "exit status 1" because the
 * daemon was not reachable and the failure was never retried, so the model reported interactive features
 * PASS it had never driven). Pure control-flow: both effects are injected, so the retry behaviour is
 * unit-testable without a live sandbox. `relaunch` drops the cached (dead) daemon so the second `attempt`
 * re-ensures a fresh one; a second failure is thrown honestly rather than swallowed.
 */
export async function withDaemonRetry<T>(attempt: () => Promise<T>, relaunch: () => void): Promise<T> {
  try {
    return await attempt();
  } catch {
    relaunch();
    return await attempt();
  }
}

/** Guess the dev-server port from the launch command for health-check polling. */
function extractDevPort(command: string): number {
  // Explicit --port / PORT= always wins
  const flag = command.match(/--port[=\s]+(\d+)/i);
  if (flag) return parseInt(flag[1], 10);
  const env = command.match(/\bPORT=(\d+)/);
  if (env) return parseInt(env[1], 10);
  // Python-style port argument (uvicorn main:app --port 8000 / runserver 0.0.0.0:8000)
  const pyPort = command.match(/\bport\s+(\d+)|\d+\.?\d*\.\d+\.?\d*:(\d+)/i);
  if (pyPort) return parseInt(pyPort[1] ?? pyPort[2], 10);
  // Framework-specific defaults
  if (/\bng\s+serve\b/.test(command)) return 4200;           // Angular
  if (/\bastro\b/.test(command)) return 4321;               // Astro
  if (/\bnext\b/.test(command) || /react-scripts/.test(command)) return 3000; // Next.js / CRA
  if (/\bnuxt\b/.test(command)) return 3000;               // Nuxt
  if (/\buvicorn\b|\bgunicorn\b|\bflask\b|\bdjango\b|\bmanage\.py\b/.test(command)) return 8000; // Python
  if (/\bflask\s+run\b/.test(command)) return 5000;         // Flask default
  if (/\bnestjs\b|\bnest\b/.test(command)) return 3000;     // NestJS
  if (/\bexpress\b/.test(command)) return 3000;             // Express
  if (/\bfastify\b/.test(command)) return 3000;             // Fastify
  if (/\bserve\b/.test(command) && !/npm/.test(command)) return 3000; // http-server/serve
  // A direct Node server launcher (`tsx server/index.ts`, `node dist/server.js`, `nodemon app.js`) carries
  // no framework keyword, so it used to fall through to Vite's 5173 while the Express/Fastify server bound
  // a Node port — the exact Mitrify "did not come up on port 5173" import failure. Treat it as a Node port.
  if (isNodeServerCommand(command)) return 3000;
  return 5173; // Vite default
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
  // Warm-sandbox durability (2026-07-05): a bounded write-through cache of the SOURCE files written to
  // each sandbox, so when a dead sandbox is evicted and recreated mid-build the fresh one is restored
  // instead of coming back empty. Source only — node_modules / big / binary writes are skipped (they
  // re-install), so the cache stays small (<~1 MB for a normal app).
  private _fileCache = new Map<string, Map<string, string>>();

  /**
   * Trivial-command latency, for the DEGRADED-sandbox check in runCommand.
   *
   * Per-actuator rather than per-workspace on purpose: the evidence is about the MACHINE, and one
   * actuator serves one build's sandbox. Reset whenever a sandbox is dropped, so a fresh machine is
   * never judged on the last one's record.
   */
  private _latency = newSandboxLatencyState();
  private static readonly FILE_CACHE_MAX_FILES = 500;
  private static readonly FILE_CACHE_MAX_BYTES = 256 * 1024; // per file
  // Scaffold files the last ensureWorkspace() seeded into a fresh sandbox, per workspace. These bypass
  // the write-tracking hook, so the route drains them (takeSeededScaffold) and persists them durably —
  // otherwise package.json only reaches durable via a flaky end scan ("No package.json found" preview bug).
  private _seededScaffold = new Map<string, Record<string, string>>();
  // Last time each workspace's DURABLE record was refreshed, so a live build's timestamp says "in use"
  // to the cross-instance orphan reaper. Throttled — see shouldTouchDurable.
  private _lastDurableTouch = new Map<string, number>();
  // When this workspace's sandbox was created/resumed here. A v5 build runs a real VM billed by
  // WALL-CLOCK, which is a completely different cost shape from token spend — a build that used almost
  // no tokens but held a VM for forty minutes still cost real money, and nothing in the build report
  // showed it. See sandboxCost.ts.
  private _sandboxStartedAt = new Map<string, number>();

  /**
   * Optional per-user E2B API key. When provided (e.g. a Pro user's own key for
   * the top execution tier), it overrides the global E2B_API_KEY so the sandbox
   * is billed to the user, not NavBharatAI. Falls back to the env key when empty.
   */
  constructor(private apiKey?: string) {
    // Phase 12E — periodic idle sweep. unref() so it never keeps the process alive.
    const timer = setInterval(() => { void this._sweepIdleSandboxes(); }, IDLE_SWEEP_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Build the e2b SDK options, injecting the per-user key when set, and — A3 — the custom template
   *  when E2B_TEMPLATE_ID is configured (else omitted → E2B default base image, unchanged behavior).
   *  AB-1: when `framework` is a polyglot backend (spring-boot/go) AND FULLSTACK_E2B_TEMPLATE_ID is
   *  published, route that build onto the fullstack image (JDK 17 + Maven, Go, Mongo, Redis) instead;
   *  otherwise resolveTemplateId falls back to the exact default behaviour (doubly env-gated no-op).
   *  SandboxOpts.template is ignored by Sandbox.connect (which reattaches by id), so sharing this
   *  across create+connect is harmless. */
  private _opts(extra?: Record<string, unknown>, framework?: string): { timeoutMs: number; apiKey?: string; template?: string } {
    const template = resolveTemplateId(framework);
    return {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(template ? { template } : {}),
      ...extra,
    };
  }

  /**
   * Install npm dependencies with automatic peer-dep fallback:
   *   1. npm ci       — fastest, reproducible (requires package-lock.json)
   *   2. npm install  — creates/updates lock, resolves new deps
   *   3. npm install --legacy-peer-deps  — only when ERESOLVE is detected
   * Never throws; returns success flag + combined log for the agent to read.
   */
  private async _npmInstall(sandbox: Sandbox): Promise<{ success: boolean; log: string }> {
    // Step 0 (SPEED — warm node_modules primer): the custom E2B template bakes a fully-installed
    // vite-react baseline at /home/user/.warm/vite-react (see infra/e2b/e2b.Dockerfile). When the
    // workspace has NO node_modules yet AND declares react (a vite-react-family app), copy that baked
    // tree in as a LOCAL fs copy (~1-3s) instead of a 30-90s cold network install. The npm ci/install
    // steps below then run as a fast DELTA (only generator-added deps like tailwind are fetched), and
    // reconcile any version drift. Fully guarded: if the warm dir isn't present (i.e. the template
    // hasn't been rebuilt yet) this is a no-op and behaviour is byte-identical to today.
    try {
      const warmDir = '/home/user/.warm/vite-react/node_modules';
      const [warmExists, hasModules] = await Promise.all([
        sandbox.files.exists(warmDir).catch(() => false),
        sandbox.files.exists(`${WORKSPACE_ROOT}/node_modules`).catch(() => false),
      ]);
      if (warmExists && !hasModules) {
        const pkgRaw = await sandbox.files.read(`${WORKSPACE_ROOT}/package.json`).catch(() => null);
        const pkg = typeof pkgRaw === 'string' ? pkgRaw : (pkgRaw ? new TextDecoder().decode(pkgRaw as Uint8Array) : '');
        // Only prime for React-family apps — a Vue/Next/Python workspace must NOT get a React tree.
        if (/["']react["']\s*:/.test(pkg)) {
          await sandbox.commands.run(`cp -a ${warmDir} ${WORKSPACE_ROOT}/node_modules`, {
            cwd: WORKSPACE_ROOT, timeoutMs: 60_000,
          }).catch(() => { /* copy is best-effort — a failure just falls through to a full install */ });
        }
      }
    } catch { /* warm-primer is best-effort — never blocks the real install below */ }

    /**
     * SECURITY REMEDIATION (admin 2026-08-12). npm has just told us, in this very log, how many known
     * vulnerabilities the tree carries. When high/critical ones are present and the admin has switched
     * this on, apply npm's OWN SemVer-compatible fixes — never `--force`, which applies breaking major
     * upgrades and is a way to break a working app while claiming to secure it (see npmAuditFix.ts).
     *
     * It runs HERE, inside the one install implementation every path funnels through, so no build path
     * can quietly skip it — and it lands BEFORE the typecheck and build gates, so the rare regression a
     * patch release causes is caught by checks that already exist rather than shipped.
     *
     * Best-effort in every direction: a failure, a timeout, or an unreadable result all fall through to
     * the install's own result. Securing dependencies must never be able to fail a working build.
     */
    const withAuditFix = async (log: string): Promise<string> => {
      try {
        if (!shouldRunAuditFix(parseNpmAuditSummary(log))) return log;
        const fix = await sandbox.commands
          .run(AUDIT_FIX_COMMAND, { cwd: WORKSPACE_ROOT, timeoutMs: AUDIT_FIX_TIMEOUT_MS })
          .catch((err: any) => commandFailureResult(err));
        // The fix's own output carries the POST-fix audit summary, so appending it is what lets the
        // report state the tree the app actually ships with rather than the one it started from.
        return `${log}\n[${AUDIT_FIX_COMMAND}]\n${fix.stdout}${fix.stderr}`;
      } catch {
        return log; // a security step that breaks the install would be worse than the vulnerability
      }
    };

    // Step 1: npm ci when a lock file exists (clean, reproducible install)
    const hasLock = await sandbox.files.exists(`${WORKSPACE_ROOT}/package-lock.json`).catch(() => false);
    if (hasLock) {
      const ci = await sandbox.commands.run('npm ci', {
        cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS,
      }).catch((err: any) => commandFailureResult(err));
      if (ci.exitCode === 0) return { success: true, log: await withAuditFix(ci.stdout + ci.stderr) };
      // npm ci failed (stale lock, missing lock entry) — fall through to npm install
    }

    // Step 2: npm install (resolves all deps, creates/updates lock file)
    const install = await sandbox.commands.run('npm install', {
      cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS,
    }).catch((err: any) => commandFailureResult(err));
    const installLog = install.stdout + install.stderr;
    if (install.exitCode === 0) return { success: true, log: await withAuditFix(installLog) };

    // Step 3: ERESOLVE peer-dep conflict — retry with --legacy-peer-deps
    if (/ERESOLVE|peer dep(endenc)?/i.test(installLog)) {
      const retry = await sandbox.commands.run('npm install --legacy-peer-deps', {
        cwd: WORKSPACE_ROOT, timeoutMs: COMMAND_TIMEOUT_MS,
      }).catch((err: any) => commandFailureResult(err));
      const retryLog = retry.stdout + retry.stderr;
      const combined = installLog + '\n[--legacy-peer-deps retry]\n' + retryLog;
      return {
        success: retry.exitCode === 0,
        // Only a SUCCESSFUL install gets the remediation pass — running it over a broken tree would
        // spend two minutes on a dependency graph that does not resolve in the first place.
        log: retry.exitCode === 0 ? await withAuditFix(combined) : combined,
      };
    }

    return { success: false, log: installLog };
  }

  /** Pause sandboxes with no activity for the idle limit (abandoned sessions). */
  /**
   * Workspaces with a build IN FLIGHT → the epoch it started. The idle sweep skips these.
   *
   * Idle is measured from the last SANDBOX operation, and a long model call is not one: while the AI
   * is thinking, nothing touches the sandbox. That silence is indistinguishable from an abandoned
   * session, so a short idle window would pause a sandbox in the middle of a live build — a broken app
   * for a real user, which no amount of saved compute is worth.
   */
  private _activeBuilds = new Map<string, number>();

  /** @see IEngineerActuator.setBuildActive */
  setBuildActive(workspaceId: string, active: boolean): void {
    if (active) this._activeBuilds.set(workspaceId, Date.now());
    else this._activeBuilds.delete(workspaceId);
  }

  /**
   * True while a build is genuinely in flight.
   *
   * ⚠️ THE FLAG EXPIRES ON ITS OWN. A build that crashes between `true` and `false` would otherwise
   * keep its VM alive forever — the exact opposite of what this whole change is for, and a far more
   * expensive bug than the one it prevents. Past one full max-length build plus a margin, the flag is
   * ignored and the sandbox is swept like any other.
   */
  private _buildInFlight(workspaceId: string, now: number): boolean {
    const startedAt = this._activeBuilds.get(workspaceId);
    if (startedAt === undefined) return false;
    if (now - startedAt > reapAfterMs()) {
      this._activeBuilds.delete(workspaceId);
      return false;
    }
    return true;
  }

  private async _sweepIdleSandboxes(): Promise<void> {
    const now = Date.now();
    const limit = idleLimitMs();
    for (const [workspaceId, sandbox] of [...this.sandboxes]) {
      if (this._buildInFlight(workspaceId, now)) continue;
      const last = this._lastActivity.get(workspaceId) ?? now;
      if (now - last > limit) {
        await this.pauseSandbox(sandbox.sandboxId).catch(() => {});
        this._lastActivity.delete(workspaceId);
        this._lastDurableTouch.delete(workspaceId);
        this._sandboxStartedAt.delete(workspaceId);
        this._fileCache.delete(workspaceId); // free the recreate-restore cache for an idle workspace (a resume reconnects + restores from E2B; a fresh build re-populates)
        await sandboxStore.markPaused(workspaceId).catch(() => {});
      }
    }
    await this._sweepOrphanSandboxes().catch(() => {});
  }

  /**
   * Pause sandboxes NO instance can see any more — the leak the sweep above cannot reach.
   *
   * The in-memory sweep only knows about sandboxes in THIS process's map. Cloud Run runs several
   * instances and recycles them, and NavBharatAI redeploys on every merge to main, so the instance
   * that created a sandbox routinely disappears while the sandbox keeps running and keeps billing —
   * until E2B's own hour-long lifetime finally expires. Nothing was pausing those.
   *
   * This pass reads the DURABLE record instead, so an orphan is visible whichever instance made it.
   * Sandbox.pause is a static cloud-side call, so this instance can stop a VM it never held.
   *
   * Safety: the cut-off is held a whole max-length build plus a margin past the last recorded
   * activity (reapAfterMs), a live build refreshes that record every few minutes, and anything this
   * instance is actively holding is skipped outright. Every step is best-effort and swallowed — a
   * cost sweep must never be able to fail a build.
   */
  private async _sweepOrphanSandboxes(): Promise<void> {
    // The durable record only exists when warm resume is on — with it off there is nothing to read.
    if (!sandboxResumeEnabled()) return;
    const now = Date.now();
    const records = await sandboxStore.listStale(now - reapAfterMs()).catch(() => []);
    if (!records.length) return;
    for (const rec of sandboxesToReap(records, now)) {
      if (this.sandboxes.has(rec.workspaceId)) continue; // in use here — the sweep above owns it
      const paused = await this.pauseSandbox(rec.sandboxId).catch(() => false);
      // Stamp it either way. If the pause succeeded the compute is stopped; if it failed the sandbox
      // is already gone or already paused. Re-trying it every two minutes forever helps in neither
      // case, and the record stays so a returning user can still resume by id.
      await sandboxStore.markPaused(rec.workspaceId).catch(() => {});
      if (paused) {
        this._lastActivity.delete(rec.workspaceId);
        this._lastDurableTouch.delete(rec.workspaceId);
        this._sandboxStartedAt.delete(rec.workspaceId);
        this._fileCache.delete(rec.workspaceId);
      }
    }
  }

  /**
   * Tell the DURABLE record this sandbox is in use right now, so the cross-instance orphan reaper can
   * tell a running build apart from an abandoned VM.
   *
   * The record used to be written only when a build FINISHED, which meant a build in progress looked
   * exactly like one that ended long ago. Throttled to one write per few minutes and deliberately not
   * awaited — the caller is on the hot path of every file write and command, and a slow Firestore must
   * never add latency to a build. (It writes no userId: a record created here is filled in by the
   * end-of-build record(), and nothing about resume or reaping depends on that field.)
   */
  private _touchDurable(workspaceId: string, sandboxId: string): void {
    if (!sandboxResumeEnabled() || !workspaceId || !sandboxId) return;
    const now = Date.now();
    if (!shouldTouchDurable(this._lastDurableTouch.get(workspaceId), now)) return;
    this._lastDurableTouch.set(workspaceId, now);
    void sandboxStore.touch(workspaceId, sandboxId).catch(() => {});
  }

  private async getSandbox(workspaceId: string, resumeSandboxId?: string, framework?: string): Promise<Sandbox> {
    // Refresh activity FIRST so any in-flight operation protects its sandbox from
    // the idle sweep for its full window.
    this._lastActivity.set(workspaceId, Date.now());

    const existing = this.sandboxes.get(workspaceId);
    if (existing) {
      // Reset the E2B cloud-side countdown on every activity so a long build never
      // gets killed mid-run. Fire-and-forget — failure is non-fatal.
      existing.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});
      this._touchDurable(workspaceId, existing.sandboxId);
      return existing;
    }

    // Every create/connect is bounded by SANDBOX_CREATE_TIMEOUT_MS so a slow E2B can
    // never hang the build silently — on timeout we throw and the caller surfaces it.
    let sandbox: Sandbox;
    let freshCreate = false;
    if (resumeSandboxId) {
      // Reconnect to the persisted sandbox — auto-resumes it if paused, restoring
      // all files, node_modules, and any running dev server. Fall back to a fresh
      // sandbox if the resume target was killed/expired.
      try {
        sandbox = await withTimeout(Sandbox.connect(resumeSandboxId, this._opts()), SANDBOX_CREATE_TIMEOUT_MS, 'Sandbox.connect');
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});
      } catch {
        sandbox = await withTimeout(Sandbox.create(this._opts(undefined, framework)), SANDBOX_CREATE_TIMEOUT_MS, 'Sandbox.create');
        freshCreate = true;
      }
    } else {
      sandbox = await withTimeout(Sandbox.create(this._opts(undefined, framework)), SANDBOX_CREATE_TIMEOUT_MS, 'Sandbox.create');
      freshCreate = true;
    }
    this.sandboxes.set(workspaceId, sandbox);
    usageTracker.record(workspaceId, 'sandbox');
    if (!this._sandboxStartedAt.has(workspaceId)) this._sandboxStartedAt.set(workspaceId, Date.now());
    // Durable from the FIRST moment the sandbox exists, not from the end of the build — that gap was
    // what made a running build indistinguishable from an abandoned one.
    this._lastDurableTouch.delete(workspaceId);
    this._touchDurable(workspaceId, sandbox.sandboxId);
    // RECREATE-AFTER-DEATH restore: a fresh sandbox comes back EMPTY. When we hold a cached copy of the
    // source files this workspace already wrote (the dead sandbox that was just evicted), replay them so
    // the build continues instead of losing everything. No-op on the very first create (cache empty).
    if (freshCreate) {
      const cached = this._fileCache.get(workspaceId);
      if (cached && cached.size > 0) await this._replayFilesToSandbox(sandbox, cached);
    }
    return sandbox;
  }

  /** Record a source-file write in the bounded per-workspace cache (for recreate-after-death restore). */
  private _cacheFileWrite(workspaceId: string, relPath: string, content: string): void {
    if (content.length > E2BActuator.FILE_CACHE_MAX_BYTES) return;      // skip huge files (they re-install/re-generate)
    if (/(^|\/)(node_modules|\.git|dist|build)\//.test(relPath)) return; // never cache dependency/build output
    let m = this._fileCache.get(workspaceId);
    if (!m) { m = new Map(); this._fileCache.set(workspaceId, m); }
    if (!m.has(relPath) && m.size >= E2BActuator.FILE_CACHE_MAX_FILES) return; // bounded — never grows unbounded
    m.set(relPath, content);
  }

  /** Best-effort replay of the cached source files onto a freshly-created sandbox. Never throws. */
  private async _replayFilesToSandbox(sandbox: Sandbox, files: Map<string, string>): Promise<void> {
    for (const [relPath, content] of files) { // keys are already safeRelPath'd by writeFile
      try { await withTimeout(sandbox.files.write(`${WORKSPACE_ROOT}/${relPath}`, content), 15_000, 'files.write(replay)'); }
      catch { /* one file failing to replay never blocks the recreate */ }
    }
  }

  async ensureWorkspace(workspaceId: string, projectType?: string, resumeSandboxId?: string): Promise<void> {
    // AB-1: pass the framework so the FIRST sandbox create for this workspace can route a polyglot
    // backend (spring-boot/go) onto the fullstack E2B image. Follow-up getSandbox() calls reuse the
    // cached sandbox, so the framework only needs to be known here at creation time.
    const sandbox = await this.getSandbox(workspaceId, resumeSandboxId, projectType);
    // Bound each setup file op (15-30s) so a stalled E2B can't hang workspace setup — this runs at
    // the very START of a build and a hang here means "stuck at 'setting up workspace…'" forever.
    const exists = await withTimeout(sandbox.files.exists(WORKSPACE_ROOT), 15_000, 'files.exists');
    if (exists) {
      // Resumed sandbox already has the workspace — just ensure browser tooling is warming up.
      this._kickoffPlaywright(sandbox, workspaceId);
      return;
    }

    await withTimeout(sandbox.files.makeDir(WORKSPACE_ROOT), 15_000, 'files.makeDir');

    // Resolve template: fall back to vite-react for unknown/auto types.
    // Note: this.templateRegistry keys are e.g. 'vite-react', 'nextjs', 'vue' — NOT 'react'.
    const templateKey =
      projectType && projectType !== 'auto' && projectType !== 'node' && projectType !== 'python'
        ? projectType
        : (projectType === 'python' ? 'python-fastapi' : 'vite-react');
    const resolveKey = (key: string): string =>
      this.templateRegistry.listFrameworks().includes(key) ? key : 'vite-react';
    try {
      const files = this.templateRegistry.getProvider(resolveKey(templateKey)).getFiles([]);
      await withTimeout(sandbox.files.writeFiles(
        Object.entries(files).map(([p, content]) => ({ path: `${WORKSPACE_ROOT}/${safeRelPath(p)}`, data: content }))
      ), 30_000, 'files.writeFiles(template)');
      // Record the seeded scaffold (workspace-relative) so the route can persist it durably — these
      // writes bypass the onFileWrite hook, so without this package.json never reliably reaches durable.
      this._rememberSeededScaffold(workspaceId, files);
    } catch {
      // Last-resort fallback: seed a minimal vite-react project so the workspace is never empty.
      try {
        const fallbackFiles = this.templateRegistry.getProvider('vite-react').getFiles([]);
        await withTimeout(sandbox.files.writeFiles(
          Object.entries(fallbackFiles).map(([p, content]) => ({ path: `${WORKSPACE_ROOT}/${safeRelPath(p)}`, data: content }))
        ), 30_000, 'files.writeFiles(fallback)');
        this._rememberSeededScaffold(workspaceId, fallbackFiles);
      } catch { /* if this also fails, agent will scaffold manually */ }
    }

    // Kick off playwright install in background immediately — by the time the agent
    // builds an app and starts a dev server, it'll be ready.
    this._kickoffPlaywright(sandbox, workspaceId);
  }

  /** Store the scaffold files seeded for a workspace (kept small — a template is a handful of files). */
  private _rememberSeededScaffold(workspaceId: string, files: Record<string, string>): void {
    try {
      const rel: Record<string, string> = {};
      for (const [p, content] of Object.entries(files || {})) {
        if (typeof content === 'string') rel[safeRelPath(p)] = content;
      }
      if (Object.keys(rel).length > 0) this._seededScaffold.set(workspaceId, rel);
    } catch { /* best-effort — scaffold durability must never break workspace setup */ }
  }

  /** IEngineerActuator — drain the scaffold seeded by the last ensureWorkspace (see interface doc). */
  takeSeededScaffold(workspaceId: string): Record<string, string> | undefined {
    const seeded = this._seededScaffold.get(workspaceId);
    if (seeded) this._seededScaffold.delete(workspaceId);
    return seeded;
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

  /**
   * Run a single E2B file operation, BOUNDED by a timeout. The e2b SDK's `files.*` methods (unlike
   * `commands.run`) take no timeoutMs, so without this a stalled SDK call or a sandbox E2B reaped
   * server-side hangs the build forever (no per-op deadline; the 12-min wall-clock can't cancel an
   * in-flight promise). On timeout we ALSO evict the cached sandbox so the next call gets a fresh one
   * instead of repeatedly hanging against a dead reference. (audit P0-B / P1)
   */
  private async fileOp<T>(workspaceId: string, label: string, op: (sandbox: Sandbox) => Promise<T>, timeoutMs = 30_000): Promise<T> {
    const sandbox = await this.getSandbox(workspaceId);
    try {
      return await withTimeout(op(sandbox), timeoutMs, label);
    } catch (e) {
      // Evict the cached sandbox on a DEAD-sandbox signal — not just a timeout. A reaped sandbox
      // rejects FAST (the "exit -1 in 0s" from the report), so the old timeout-only check never fired
      // and the corpse was reused forever. isDeadSandboxError catches the reaped/not-running/network
      // shapes too, so the next getSandbox recreates (and replays the cached source files).
      if (e instanceof Error && (isDeadSandboxError(e.message) || / timed out after /.test(e.message)) && this.sandboxes.get(workspaceId) === sandbox) {
        this.sandboxes.delete(workspaceId);
      }
      throw e;
    }
  }

  async writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    const rel = safeRelPath(filePath);
    // GREEN FREEZE — refuse to overwrite a file on a verified-working app unless an allowlisted pass is
    // doing it (admin 2026-08-12). Checked at the ONE place every sandbox write passes through, before
    // disk is touched, so a corrupting post-green pass is a no-op rather than damage. Throws, which the
    // caller's write-then-record idiom skips cleanly (sandbox + writtenFiles + durable save together).
    assertWriteAllowed(workspaceId, rel);
    await this.fileOp(workspaceId, 'files.write', (sb) => sb.files.write(`${WORKSPACE_ROOT}/${rel}`, content));
    this._cacheFileWrite(workspaceId, rel, content); // warm-durability: remember for recreate-after-death restore
  }

  async writeBinaryFile(workspaceId: string, filePath: string, base64: string): Promise<void> {
    const rel = safeRelPath(filePath);
    // GREEN FREEZE — a binary asset (a logo/icon/font the working app depends on) is source too, so a
    // post-green overwrite of one is refused by the same rule as a code file (adversarial review 2026-08-12).
    assertWriteAllowed(workspaceId, rel);
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    await this.fileOp(workspaceId, 'files.write', (sb) => sb.files.write(`${WORKSPACE_ROOT}/${rel}`, bytes));
  }

  async readFile(workspaceId: string, filePath: string): Promise<string> {
    return this.fileOp(workspaceId, 'files.read', (sb) => sb.files.read(`${WORKSPACE_ROOT}/${safeRelPath(filePath)}`));
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    const entries = await this.fileOp(workspaceId, 'files.list', (sb) => sb.files.list(WORKSPACE_ROOT, { depth: 10 }));
    return entries
      .filter(e => e.type === 'file')
      .map(e => e.path.slice(WORKSPACE_ROOT.length + 1))
      // Exclude dependency / build / VCS dirs (matches LocalActuator). After `npm install`
      // node_modules holds THOUSANDS of files — without this the edit-mode prompt was fed 5000+
      // paths ("Editing your existing app (5115 files)"), bloating the context and slowing every
      // turn. The agent only ever edits the real source files, never these.
      .filter(p => !isIgnoredListPath(p));
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
      // Re-install when node_modules is MISSING, or STALE (package.json edited after the last
      // install — e.g. the scaffold/agent added `tailwindcss`). The old "skip if node_modules
      // exists" gate left newly-declared deps uninstalled, so `npm run dev` crashed with
      // "Cannot find module 'tailwindcss'" and the preview never came up.
      const depsStale = hasModules && await sandbox.commands
        .run(buildDepsStaleCheckCommand(), { cwd: WORKSPACE_ROOT, timeoutMs: 10_000 })
        .then((r) => r.stdout.includes('STALE'))
        .catch(() => false);
      if (!hasModules || depsStale) {
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

  /**
   * Install the project's dependencies if they are missing or stale — see IEngineerActuator for the
   * failure this closes (a migration that ran before `npm install` and died with "drizzle-kit: not
   * found"). Uses the SAME staleness check and installer as the dev-server boot, so there is one
   * install implementation and the two can never drift; a warm tree returns instantly with
   * `ran: false`. Never throws — the caller decides what to do with an honest failure.
   */
  async ensureDependencies(workspaceId: string): Promise<{ ok: boolean; ran: boolean; log: string }> {
    try {
      const sandbox = await this.getSandbox(workspaceId);
      const hasPkg = await sandbox.files.exists(`${WORKSPACE_ROOT}/package.json`).catch(() => false);
      if (!hasPkg) return { ok: true, ran: false, log: '(no package.json — nothing to install)' };
      const hasModules = await sandbox.files.exists(`${WORKSPACE_ROOT}/node_modules`).catch(() => false);
      const stale = hasModules && await sandbox.commands
        .run(buildDepsStaleCheckCommand(), { cwd: WORKSPACE_ROOT, timeoutMs: 10_000 })
        .then((r) => r.stdout.includes('STALE'))
        .catch(() => false);
      if (hasModules && !stale) return { ok: true, ran: false, log: '(dependencies already installed)' };
      const res = await this._npmInstall(sandbox);
      return { ok: res.success, ran: true, log: res.log };
    } catch (err: any) {
      return { ok: false, ran: false, log: err?.message ? String(err.message) : String(err) };
    }
  }

  async runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    usageTracker.record(workspaceId, 'command');

    // Long-running commands (dev servers, watchers) never exit — run in background,
    // poll the port, then disconnect and leave the process alive. A non-background run
    // would block until the 5-minute command timeout (deadline_exceeded). Detection lives
    // in the pure isLongRunningCommand() so a missed pattern (e.g. bare `npx vite`) is a
    // one-line, unit-tested fix instead of an inline regex drift.
    if (isLongRunningCommand(command)) {
      let stdout = '';
      let stderr = '';
      // Force the dev server to bind 0.0.0.0 so the PUBLIC E2B preview URL is
      // reachable. A localhost-only bind (Vite/Next default unless host:true is
      // set) passes the `nc -z localhost` check below yet 502s on the public
      // preview — the #1 "built but the preview is blank" cause. No-op if the
      // command already binds a host (e.g. our vite-react template's host:true).
      // Resolve `npm run dev` → its CONCRETE underlying tool (best-effort, from package.json) so the
      // host/port flags match the ACTUAL framework. A Vite scaffold is byte-for-byte unchanged; a
      // Next/Astro/Nuxt/Angular scaffold no longer gets Vite-only flags (`--strictPort`, Vite-style
      // `--host`) that its dev server rejects on boot → blank preview ("preview never comes up").
      // Any failure falls back to the raw command (today's Vite-assumption behaviour).
      const strippedForResolve = stripDevServerBackgrounding(command);
      let resolvedCommand = strippedForResolve;
      try {
        const pkgRaw = await sandbox.files.read(`${WORKSPACE_ROOT}/package.json`);
        resolvedCommand = resolvePmScript(strippedForResolve, JSON.parse(pkgRaw)?.scripts);
      } catch { /* no package.json / parse error — keep the raw command (unchanged behaviour) */ }
      const framework: DevFramework = detectDevFramework(resolvedCommand);
      const port = extractDevPort(resolvedCommand);
      // E6 — FAST PATH: if a healthy dev server is ALREADY bound on this port and package.json hasn't
      // changed, skip the whole config-patch → pre-kill → launch → 25s port-wait → recovery sequence.
      // A managed preview re-runs `npm run dev` on every update_preview; a running Vite/Next server
      // already reflects file edits via HMR, so relaunching just re-pays ~25s+ for nothing. Both checks
      // are real sandbox probes (a false "up"/"fresh" is impossible), and on ANY doubt we fall through
      // to the full, proven sequence below — never worse than today. AGENTV3_DEVSERVER_FASTPATH=off bypasses.
      // ARM THE KEEPALIVE — from ONE place, so a path cannot quietly skip it.
      //
      // ROOT CAUSE (admin build transcript 2026-08-12). The watchdog was armed only after a FRESH
      // launch. The fast path below — "already healthy on port N, reused it" — returned a healthy
      // verdict and armed nothing, so a server we adopted rather than started had no keepalive at all.
      // It then died mid-build with nothing watching, the preview went to the host's closed-port page,
      // and the platform spent an LLM repair pass concluding "the app itself is fine; it just needed
      // the dev server restarted". Three times, in one build.
      //
      // Restarting well was the second half of that fix. This is the first half: not needing to.
      const armKeepalive = async (livePort: number): Promise<void> => {
        await sandbox.commands
          .run(devServerWatchdogCommand({ port: livePort, runCommand: devCommand, cwd: WORKSPACE_ROOT }), { timeoutMs: 15_000 })
          .catch(() => null); // best-effort: every reactive net still stands if detaching is refused
      };

      if (process.env.AGENTV3_DEVSERVER_FASTPATH !== 'off') {
        const alreadyUp = await sandbox.commands.run(buildPortWaitCommand(port, 2), { timeoutMs: 6000 })
          .then((r) => r.stdout.includes('PORT_UP')).catch(() => false);
        if (alreadyUp) {
          const stale = await sandbox.commands.run(buildDepsStaleCheckCommand(), { cwd: WORKSPACE_ROOT, timeoutMs: 8000 })
            .then((r) => r.stdout.includes('STALE')).catch(() => false);
          if (shouldSkipDevServerLaunch(alreadyUp, stale)) {
            const boundPort = port;
            // A server we ADOPTED needs the keepalive exactly as much as one we started — arguably
            // more, since nobody in this process has been watching it so far.
            await armKeepalive(boundPort);
            return { exitCode: 0, stdout: `[health-check] dev server already healthy on port ${boundPort} — reused it (no relaunch; edits apply via HMR).\n${devServerHealthLine(true, boundPort)}`, stderr: '' };
          }
        }
      }
      // Pin the port so the server binds EXACTLY `port` (or fails loudly) instead of
      // silently drifting to 5174 when 5173 is busy — the drift is what made the
      // preview connect to a dead port and the build loop until the time-limit cap.
      // Strip the agent's own `… &` / `nohup … &` FIRST: E2B already backgrounds this
      // command, and a self-backgrounded vite is orphaned + reaped (prints "Killed" right
      // after "ready") — the root cause of the preview-restart loop and BUILD_TIMEOUT.
      // disableDevServerAutoOpen: stop Vite/CRA from spawning `xdg-open` (absent in the headless
      // sandbox) — that ENOENT can crash the server right after "ready" and leave the preview dead.
      // redirectDevServerOutput: send the server's output to a FILE (not the live SDK stream) so that
      // when we disconnect below, vite writing its next log line can't SIGPIPE-kill itself — the real
      // "vite dies on 5173 while a silent node server survives on 3333" reaping seen in the build report.
      // DETERMINISTIC PREVIEW-HOST GATE: before a Vite dev server starts, guarantee its config allows
      // the E2B preview host. Even with the write-time backstop (ToolDispatcher/ViteConfigGuard), a
      // config written BEFORE this safeguard existed would still 502 the preview with "Blocked
      // request … is not allowed". This last-line net reads the on-disk config and, only if it lacks
      // allowedHosts AND can be safely patched, writes it back — so the very next preview loads.
      // Best-effort: a read/write hiccup must never block the dev server from starting.
      // DETECTION-INDEPENDENT (admin 2026-07-06): patch whenever a vite config EXISTS on disk — NOT only
      // when the framework label is 'vite' or the command literally contains "vite". An IMPORTED app (or
      // any app whose dev script is just `npm run dev`) runs Vite with NEITHER signal, so its config was
      // being skipped here and the preview 502'd with "Blocked request … is not allowed" (the admin hit
      // this on port 3000). The per-file exists() check below is the real gate — this whole block is a
      // cheap no-op (a handful of exists() probes) for a non-Vite app that has no vite config.
      {
        for (const cfg of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.mts', 'vite.config.cts']) {
          try {
            const full = `${WORKSPACE_ROOT}/${cfg}`;
            if (!(await sandbox.files.exists(full).catch(() => false))) continue;
            const current = await sandbox.files.read(full);
            const patched = ensureViteAllowedHosts(cfg, current);
            if (patched !== current) {
              await sandbox.files.write(full, patched);
              stdout += `\n[preview-host] patched ${cfg} to allow the E2B preview host (allowedHosts).`;
            }
            break; // only one vite config is loaded by Vite — stop at the first that exists
          } catch { /* best-effort — never block the dev server on a config patch */ }
        }
      }
      let devCommand = redirectDevServerOutput(
        // `resolvedCommand` is passed so the pin decision can see THROUGH `npm run dev` to the script it
        // actually runs (report 26a8e81c): a Node server behind a pm script used to get Vite's
        // `--port … --strictPort`, which it ignores, and the health check then watched the wrong port.
        disableDevServerAutoOpen(pinDevServerPort(ensureHostBinding(strippedForResolve, framework, resolvedCommand), port, framework, resolvedCommand)),
      );
      // LOAD .env INTO THE DEV-SERVER ENV (Mitrify autopsy 2026-08-02): a Drizzle/Express app that reads
      // process.env.DATABASE_URL directly (no dotenv) crashes on boot even though .env holds the value —
      // the launch never loaded it. Auto-export every KEY=value from .env into the process env before
      // starting, so ANY app (dotenv or not) sees its env. `set -a` auto-exports; sourcing is guarded with
      // `2>/dev/null || true` so a malformed user line can never abort the launch (worst case = today's
      // behaviour). Kill switch: AGENTV3_DEVSERVER_LOAD_DOTENV=off.
      if ((process.env.AGENTV3_DEVSERVER_LOAD_DOTENV ?? '').trim().toLowerCase() !== 'off') {
        devCommand = `set -a; if [ -f .env ]; then . ./.env 2>/dev/null || true; fi; set +a; ${devCommand}`;
      }

      // Ensure dependencies are installed BEFORE starting the dev server. If the
      // scaffold/agent declared a new dep (e.g. tailwindcss) but node_modules is stale,
      // `npm run dev` crashes on boot ("Cannot find module 'tailwindcss'") and the preview
      // never comes up. Best-effort + only when actually stale, so a warm tree starts instantly.
      const depsStale = await sandbox.commands
        .run(buildDepsStaleCheckCommand(), { cwd: WORKSPACE_ROOT, timeoutMs: 10_000 })
        .then((r) => r.stdout.includes('STALE'))
        .catch(() => false);
      if (depsStale) {
        stdout += '\n[health-check] installing dependencies (package.json changed)…';
        const dep = await this._npmInstall(sandbox).catch(() => ({ success: false, log: '' }));
        if (dep.success) {
          stdout += ' done.';
        } else {
          // Fix 40 (CoreUI retest 2026-07-07: "sh: 1: vite: not found"): "starting anyway" after a
          // FAILED install on a tree with NO node_modules is a guaranteed dead boot — the binaries
          // don't exist, and npm install's OWN error (the real root cause) was never surfaced. On a
          // first boot: stop honestly with the install log. On a warm tree (a re-install for a
          // changed package.json), the old binaries still exist, so starting is genuinely viable.
          const hasModules = await sandbox.commands
            .run(`test -d ${WORKSPACE_ROOT}/node_modules/.bin && echo HAS_BIN`, { timeoutMs: 5000 })
            .then((r) => r.stdout.includes('HAS_BIN')).catch(() => false);
          if (!hasModules) {
            const installTail = (dep.log || '').split('\n').slice(-25).join('\n');
            stdout += ` FAILED — and node_modules is empty, so the dev server cannot start.\n[health-check] npm install's own error is the root cause:\n${installTail || '(npm produced no log — it may have been killed: out of memory or a network failure)'}`;
            return { exitCode: 1, stdout, stderr };
          }
          stdout += ' (install reported errors — existing node_modules still present, starting anyway).';
        }
      }

      // Pre-kill any stale dev server still holding this port from a previous
      // attempt (now reliable — tries fuser/lsof/ss, not a Vite-blind pkill).
      await sandbox.commands.run(buildPreKillPortCommand(port), { timeoutMs: 5000 })
        .catch(() => {});

      // Launch the dev server + a BOUNDED, CAUSE-SPECIFIC recovery loop (production-grade). Each round:
      // launch → poll the port (return the moment it's up) → if still down, read the dev server's own
      // log, classify the REAL failure, and apply the ONE correct recovery — reinstall a missing dep,
      // free a busy port, STOP on a code error the agent must fix (a restart can never help it), or
      // plain-retry a transient crash. This replaces the old single blind restart and yields an HONEST
      // root cause when it still can't come up (instead of a generic "check the logs").
      const launchAndWait = async (seconds: number): Promise<boolean> => {
        const h = await sandbox.commands.run(devCommand, {
          cwd: WORKSPACE_ROOT, background: true,
          onStdout: s => { stdout += s; }, onStderr: s => { stderr += s; },
        });
        const w = await sandbox.commands.run(buildPortWaitCommand(port, seconds), { timeoutMs: (seconds + 5) * 1000 })
          .catch(() => ({ stdout: 'PORT_DOWN' } as { stdout: string }));
        await h.disconnect().catch(() => {});
        const up = w.stdout.includes('PORT_UP');
        // ARM THE KEEPALIVE the moment the port is genuinely up — the sibling of the Postgres watchdog
        // above, for the same root cause. The Shiv Medical Store report (2026-08-10) showed a dev server
        // that started fine and was simply GONE ~4 minutes later, with no error in its log to classify,
        // twice; the sandbox had reaped it. Bounded (see devServerWatchdogCommand) so a server dying of
        // a real code error is never restarted forever. Best-effort: if nohup/setsid cannot detach in
        // this sandbox, every existing reactive net still stands.
        if (up) await armKeepalive(port);
        return up;
      };
      const readDevLog = async (): Promise<string> =>
        sandbox.commands.run(`cat ${DEV_SERVER_LOG_PATH} 2>/dev/null | tail -80`, { cwd: WORKSPACE_ROOT, timeoutMs: 5000 })
          .then((r) => r.stdout).catch(() => '');

      let portUp = await launchAndWait(25);
      let devLog = '';
      let lastDiagnosis: DevServerDiagnosis | undefined;
      const MAX_RECOVERY = 2;
      for (let attempt = 1; !portUp && attempt <= MAX_RECOVERY; attempt++) {
        devLog = await readDevLog();
        // ROOT CAUSE (mitrify autopsy 2026-08-04, buildId ca5a4ca8): this used to call
        // planDevServerRecovery(devLog, attempt, MAX_RECOVERY), which escalates to `give_up` as soon as
        // `attempt >= maxAttempts`. With MAX_RECOVERY = 2 that made the LAST attempt do NOTHING: it was
        // diagnosed, then broke out before the recovery ran. So "2 recovery attempts" only ever performed
        // ONE action — and worse, the give_up branch printed the diagnosis detail verbatim, which for a
        // db_unreachable reads "provisioning PostgreSQL, writing DATABASE_URL, and retrying". The user was
        // told we were provisioning a database while we provisioned nothing. Announcing an action we do
        // not take is exactly the fake-success the second absolute rule forbids.
        // The escalation is now decided AFTER the loop (below), so every attempt inside it performs a real
        // recovery. `code_fix` still short-circuits — a source error fails identically on every restart.
        const diag = classifyDevServerFailure(devLog);
        lastDiagnosis = diag;
        if (diag.recovery === 'code_fix') {
          stdout += `\n[health-check] ${diag.detail}`;
          break;
        }
        stdout += `\n[health-check] attempt ${attempt} — ${diag.detail}`;
        if (diag.recovery === 'reinstall') {
          // PARTIAL-INSTALL REPAIR (mitrify autopsy 2026-08-04): when the log proves ONE package
          // installed only partially (its own file could not resolve a sibling — e.g. lucide-react's
          // barrel importing ./icons/*.js that never landed), a plain `npm install` is a NO-OP: the
          // dependency is already in package.json and the directory already exists, so npm has nothing
          // to do and the next restart fails identically. The broken tree must be REMOVED first, or the
          // "heal" runs, reports success, and changes nothing — the fake-heal this rule forbids.
          if (diag.corruptPackage && /^(?:@[\w.-]+\/)?[\w.-]+$/.test(diag.corruptPackage)) {
            await sandbox.commands
              .run(`rm -rf ${WORKSPACE_ROOT}/node_modules/${diag.corruptPackage}`, { cwd: WORKSPACE_ROOT, timeoutMs: 30_000 })
              .catch(() => { /* best-effort — the reinstall below still runs */ });
            stdout += ` (removed the incomplete "${diag.corruptPackage}" so it reinstalls cleanly)`;
          }
          const dep = await this._npmInstall(sandbox).catch(() => ({ success: false, log: '' }));
          stdout += dep.success ? ' (dependencies reinstalled).' : ' (reinstall reported errors — retrying anyway).';
        }
        // DB reaped/never-started (EstateNest autopsy 2026-07-20): a from-scratch Prisma+Postgres app can
        // preview many minutes after the build began, by which point the sandbox Postgres has been reaped —
        // `npm run dev` then crashes on boot with P1001 and a blind restart can never revive it. Restart the
        // DB itself (provisionBackend is idempotent: it re-runs `pg_ctlcluster … start` in the same sandbox,
        // fast when Postgres is already installed) BEFORE relaunching, so the dev server can connect. The
        // .env DATABASE_URL written when the DB was first provisioned still points at the same local Postgres.
        if (diag.recovery === 'reprovision_db') {
          try {
            const prov = await this.provisionBackend(workspaceId, ['db']);
            // FIRST-TIME provision (Mitrify autopsy 2026-08-02): a from-scratch Drizzle/Express app was never
            // provisioned, so there is no DATABASE_URL anywhere. provisionBackend restarted Postgres AND
            // returned the URL — write it into .env (merge, preserving the user's other vars) so the app can
            // read it. For a previously-provisioned app whose DB was merely reaped, .env already has the same
            // URL and this merge is a harmless no-op. The relaunch below loads .env into the dev-server env.
            const url = prov?.envVars?.DATABASE_URL;
            if (url) {
              const envPath = `${WORKSPACE_ROOT}/.env`;
              const current = await sandbox.files.read(envPath).catch(() => '');
              await sandbox.files.write(envPath, mergeEnvVar(current, 'DATABASE_URL', url)).catch(() => {});
            }
            // The Mitrify build printed "provisioned + written" here while the app's very next connect
            // got ECONNREFUSED — because a URL existed either way. The shared note says only what the
            // SELECT 1 actually proved (admin task 1, 2026-08-05).
            stdout += ` ${provisionOutcomeNote({ verified: prov?.dbVerified === true, failure: prov?.dbVerifyFailure ?? 'no-output' })}`;
          } catch {
            stdout += ' (PostgreSQL provision reported errors — retrying anyway).';
          }
        }
        // Free the port before every restart (reinstall / kill_port_retry / plain_retry all need it clean)
        // — AND, when the log named a DIFFERENT port as the occupied one, free that one too. Without it
        // the recovery frees the port we watch while the orphan sits on the port the app actually binds,
        // so every attempt reproduces the same EADDRINUSE and "recovery exhausted" is guaranteed before
        // the first restart runs (mitrify autopsy 2026-08-05). conflictPort is read from the error text
        // only, and never names an infrastructure port we must not kill (PROTECTED_PORTS).
        const killPorts = diag.conflictPort && diag.conflictPort !== port ? [port, diag.conflictPort] : port;
        await sandbox.commands.run(buildPreKillPortCommand(killPorts), { timeoutMs: 5000 }).catch(() => {});
        portUp = await launchAndWait(20);
      }
      // Attempts are spent and the server is still down: NOW escalate to give_up, with a detail that
      // states the terminal truth instead of the "here is what I am about to do" text the loop used.
      if (!portUp && lastDiagnosis && lastDiagnosis.recovery !== 'code_fix') {
        lastDiagnosis = planDevServerRecovery(devLog, MAX_RECOVERY + 1, MAX_RECOVERY);
      }

      // The dev server's output goes to a FILE (redirectDevServerOutput), so read it for drift detection
      // instead of the live stream (intentionally empty now). Best-effort — fall back to the pinned port.
      if (!devLog) devLog = await readDevLog();
      if (devLog) stdout += devLog;

      // SOURCE OF TRUTH for the preview: the port the server ACTUALLY bound (parsed from its own output),
      // not the assumed default. If it drifted despite pinning, preview the REAL port so update_preview
      // can never aim at the wrong one.
      const boundPort = detectDevPort(devLog || stdout, port);
      // Re-probe the REAL bound port whenever it drifted from the assumed one — NOT only when the
      // assumed port already read UP. The old `portUp &&` guard meant a drifted-but-healthy server
      // whose assumed port was down was reported DOWN forever (the agent then never published the
      // working port). The re-probe can only ever UPGRADE portUp to true — it can never mark a
      // healthy server down — so this is safe. (root-cause helper: shouldReprobeBoundPort.)
      if (shouldReprobeBoundPort(port, boundPort)) {
        const reUp = await sandbox.commands.run(buildPortWaitCommand(boundPort, 10), { timeoutMs: 15_000 })
          .catch(() => ({ stdout: 'PORT_DOWN' } as { stdout: string }));
        if (reUp.stdout.includes('PORT_UP')) portUp = true;
      }
      // FALSE-POSITIVE GUARD (Fix 42, report 2026-07-11): the port-wait's first probe is `nc -z` (a
      // pure TCP-open check), so a stale/zombie process or the sandbox proxy holding the port reads as
      // "PORT_UP" even when the dev log screams `sh: 1: vite: not found` (the runner never started).
      // That shipped a false "dev server is UP" + "preview verified renders correctly". When the log
      // shows the RUNNER BINARY was not found, demand a REAL HTTP response before trusting the port —
      // a genuinely-serving prior attempt answers HTTP (stays UP); a stale TCP port does not (honest
      // DOWN with the real reason). Only triggers on the runner-missing signal, so a normal healthy
      // build is never affected.
      if (portUp && devServerRunnerMissing(devLog || stdout)) {
        const httpOk = await sandbox.commands.run(buildHttpLivenessCommand(boundPort), { timeoutMs: 6000 })
          .then((r) => r.stdout.includes('HTTP_OK')).catch(() => false);
        if (!httpOk) {
          portUp = false;
          lastDiagnosis = { cause: 'missing_module', recovery: 'code_fix', detail: `The dev-server runner (e.g. vite) was "not found" and nothing is serving real HTTP on port ${boundPort} — the port was only held by a stale/unrelated process. The app's dependencies did not install correctly (ensure the framework CLI is in devDependencies and the install completed).` };
        }
      }
      // SMART PORT SWITCH — before declaring the server dead, look where else it might be.
      //
      // Everything above needs the server to cooperate: pinning needs the launch to go through the
      // managed path, and detectDevPort needs a recognisable announcement in the log. When neither
      // holds, `boundPort` is just the port we ASSUMED, and one failed probe of it condemns a server
      // that may be perfectly healthy one port away.
      //
      // That is the 2026-08-15 report exactly: the model launched the server itself with a piped
      // command (so pinning correctly skipped it), the app came up on 3000, the framework had been
      // read as `vite-react` so the platform watched 5173, and a working app was reported dead — after
      // which the model spent ten minutes trying to move the working server to the port we wanted.
      //
      // It runs ONLY when the expected port is already down, so a healthy build pays nothing, and it
      // is ONE command for all candidates because a bare `ls` on that build's degraded sandbox took
      // 116 seconds — a probe per port could outlast the build itself.
      let livePort = boundPort;
      if (shouldSweep(portUp)) {
        const found = await sandbox.commands
          .run(buildPortSweepCommand(portCandidates(boundPort)), { timeoutMs: 30_000 })
          .then((r) => parsePortSweep(r.stdout))
          .catch(() => null);
        if (found !== null) {
          // A REAL HTTP responder — the same standard the Fix-42 guard demands, so a stale TCP holder
          // cannot promote itself here either.
          portUp = true;
          livePort = found;
          stdout += `\n${sweepFoundSummary(boundPort, found)}`;
        }
      }
      // Honest health line: the verified port when UP, the REAL root cause when DOWN.
      stdout += `\n${devServerHealthLine(portUp, livePort, portUp ? undefined : (lastDiagnosis ?? classifyDevServerFailure(devLog)))}`;

      return { exitCode: 0, stdout, stderr };
    }

    // REGULAR command with DEAD-SANDBOX recreate-retry (root-cause fix for the "81 commands died on a
    // reaped sandbox for 21 min" build): on a dead-sandbox signal, evict + recreate ONCE (getSandbox
    // replays the cached source files onto the fresh sandbox) and retry — so a mid-build sandbox death
    // is invisible instead of a corpse grind. A normal nonzero program exit is returned as-is and NEVER
    // triggers a recreate (isDeadSandboxSignal distinguishes a dead sandbox from a failed command).
    // A backgrounded long-lived-server smoke check (`npm run server & sleep; curl …`) holds the E2B
    // pipe and would otherwise block the FULL 300s command timeout (deadline_exceeded) before returning
    // — two of these burned ~10 min in deep-test App #7/#8/#9. Cap ONLY that narrow pattern so the held
    // server is killed early and the agent moves on ~270s sooner; every other command keeps the normal
    // timeout (the detector is deliberately narrow and never shortens a legit build/install/dev command).
    const cmdTimeoutMs = backgroundedServerSmokeCheckMs(command) ?? COMMAND_TIMEOUT_MS;
    let sb = sandbox;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const result = await sb.commands.run(command, { cwd: WORKSPACE_ROOT, timeoutMs: cmdTimeoutMs });
        // DEGRADED-SANDBOX CHECK — the failure mode the dead-sandbox detector cannot see.
        //
        // Everything in the catch block below answers "did this FAIL like a dead sandbox?". The
        // 2026-08-15 report failed in the opposite way: every command SUCCEEDED, and `ls -la` took 97
        // and 116 seconds while a `timeout 10` command took 129. Nothing errored, so nothing was
        // evicted, and 36 minutes were spent on a machine where listing a directory cost two minutes.
        //
        // Only TRIVIAL commands are measured, and only on SUCCESS: their runtime is evidence about the
        // machine rather than the work, which is what makes this safe to act on. The sandbox is then
        // dropped exactly as a dead one is — the next getSandbox creates a fresh one and replays the
        // cached files, a path in production since 2026-07-05 rather than a new one invented here.
        if (recordCommandLatency(this._latency, command, Date.now() - t0) && this.sandboxes.get(workspaceId) === sb) {
          this.sandboxes.delete(workspaceId);
          this._latency = newSandboxLatencyState(); // the fresh sandbox starts with a clean record
        }
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      } catch (err: any) {
        // A non-zero exit REJECTS here (E2B CommandExitError) — recover the REAL exit code so a genuine
        // command failure (tsc exit 2) is reported honestly, not flattened to the -1 dead-sandbox sentinel.
        const realExit = resolveThrownCommandExit(err);
        const dead = isDeadSandboxSignal({ exitCode: realExit, durationMs: Date.now() - t0, stdout: err?.stdout, stderr: err?.stderr, errorMessage: err?.message });
        if (attempt === 0 && dead && this.sandboxes.get(workspaceId) === sb) {
          this.sandboxes.delete(workspaceId); // drop the reaped sandbox reference
          try { sb = await this.getSandbox(workspaceId); continue; } // recreate (replays source) + retry once
          catch { /* recreate itself failed (E2B down) → fall through to an honest error */ }
        }
        return { exitCode: realExit, stdout: err.stdout || '', stderr: err.stderr || err.message || String(err) };
      }
    }
    return { exitCode: -1, stdout: '', stderr: 'sandbox unavailable after recreate attempt' };
  }

  async browseUrl(workspaceId: string, url: string): Promise<{ html: string; painted?: boolean; source?: 'browser' | 'curl' }> {
    const sandbox = await this.getSandbox(workspaceId);

    // Ensure the shared Playwright install (same one the screenshot path uses) has been kicked
    // off, then wait briefly for it. This method used to run `node -e "require('playwright')"`
    // from WORKSPACE_ROOT with no PLAYWRIGHT_BROWSERS_PATH — but Playwright lives under TOOLS_DIR,
    // not the workspace, so the require ALWAYS failed and browseUrl silently degraded to a curl of
    // the static HTML shell. The preview self-check then only ever saw the un-hydrated shell (never
    // the client-rendered DOM), which made it both rubber-stamp broken apps and "heal" working ones.
    // Bounded so a slow/failed install degrades to curl instead of hanging the self-check.
    if (!this._playwrightReady.has(workspaceId)) {
      this._kickoffPlaywright(sandbox, workspaceId);
    }
    const ready = await Promise.race([
      this._playwrightReady.get(workspaceId)!,
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 60_000)),
    ]).catch(() => false);

    if (ready) {
      // Rendered DOM via the real headless browser. Runs from TOOLS_DIR (where playwright is
      // installed) with PLAYWRIGHT_BROWSERS_PATH set, exactly like the screenshot scripts — so
      // `require('playwright')` resolves and Chromium actually launches.
      // waitUntil MUST NOT be 'networkidle' for a Vite/CRA dev server: its HMR WebSocket stays open
      // forever, so the network is NEVER idle → goto times out at 15s and p.content() captures the
      // un-hydrated shell (root #root empty) — the exact false "Present: none" from deep-test build #2.
      //
      // WAIT FOR THE APP TO PAINT, NOT FOR A CLOCK (admin field report 2026-08-12). The previous fix
      // for that was `waitForTimeout(1800)` — a guess, and a guess has exactly one failure mode: an app
      // that takes longer than the guess is snapshotted BLANK. PreviewVerify then reads the empty
      // `<div id="root"></div>` and declares "a runtime error likely crashed it before render", the
      // build launches a repair pass for a bug that does not exist, the repair restarts the dev server,
      // the preview really does go down for a while, and the next check may snapshot early again. That
      // loop is what turned a 7-minute app into a 34-minute build.
      //
      // The condition replaces the clock: poll until the mount root actually has content, up to a
      // bounded deadline. A fast app is snapshotted SOONER than the old fixed sleep; a slow one is no
      // longer libelled. Whether it ever painted is reported, because "I looked and nothing had
      // painted" and "the app crashed" are different facts and only one of them is a defect.
      const playwrightScript = `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node -e "
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  await p.goto(${JSON.stringify(url)},{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
${paintWaitJs('p')}
  console.log('NBAI_PAINTED:'+painted);
  console.log((await p.content()).slice(0,30000));
  await b.close();
})().catch(e=>{process.stderr.write(e.message);process.exit(1)});
" 2>/dev/null`;
      const pw = await sandbox.commands.run(playwrightScript, {
        cwd: TOOLS_DIR, timeoutMs: BROWSE_PAINT_DEADLINE_MS + 20_000,
      }).catch(() => null);
      if (pw && pw.exitCode === 0 && pw.stdout.trim()) {
        const { painted, html } = splitPaintMarker(pw.stdout);
        return { html, painted, source: 'browser' };
      }
    }

    // Fallback: raw HTML via curl (static shell only — no client-rendered DOM).
    //
    // `source: 'curl'` is the important part of this return, not the html. For ANY single-page app the
    // static shell is `<div id="root"></div>` and nothing else — so judged by the same rules as a real
    // browser snapshot, a perfectly healthy React app looks exactly like one that crashed on mount.
    // Every caller must treat an un-painted curl snapshot as "we could not see the app", never as
    // evidence against it.
    const result = await sandbox.commands.run(
      `curl -s -L --max-time 20 -A "Mozilla/5.0" "${url}" 2>/dev/null | head -c 30000`,
      { cwd: WORKSPACE_ROOT, timeoutMs: 30_000 }
    );
    return { html: result.stdout || result.stderr, painted: false, source: 'curl' };
  }

  async getPortUrl(workspaceId: string, port: number): Promise<string> {
    const sandbox = await this.getSandbox(workspaceId);
    return `https://${sandbox.getHost(port)}`;
  }

  /**
   * Scan the RENDERED page and return every visible element with the facts needed to locate it in the
   * source: its class string (greppable verbatim), text, position, computed colours, and the
   * `data-nbai-src` stamp when the preview provides one.
   *
   * WHY (mitrify autopsy 2026-08-04): the agent could screenshot a page but had no pixel→file path, so
   * a request to remove a small green dot became ~30 blind greps over 20 minutes and then a destructive
   * guess. This is the missing half — see UiElementFinder.ts for the matching + the honest
   * proof-of-absence. Bounded and best-effort: an unavailable browser returns an empty list, and the
   * caller reports that honestly rather than pretending the element is absent.
   */
  async scanUiElements(workspaceId: string, url: string): Promise<{ elements: unknown[]; scanned: boolean }> {
    const sandbox = await this.getSandbox(workspaceId);
    if (!this._playwrightReady.has(workspaceId)) this._kickoffPlaywright(sandbox, workspaceId);
    const ready = await Promise.race([
      this._playwrightReady.get(workspaceId)!,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 60_000)),
    ]).catch(() => false);
    // NO BROWSER ⇒ scanned:false, NOT "no elements". The difference matters: an empty list from a real
    // scan is evidence the thing is absent; an empty list from a failed scan is evidence of nothing.
    if (!ready) return { elements: [], scanned: false };

    // domcontentloaded + settle, never networkidle: a Vite dev server's HMR socket never goes idle, so
    // networkidle times out and captures the un-hydrated shell (the exact false-negative that made the
    // preview self-check report "Present: none" for every React build).
    const script = `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node -e "
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  await p.setViewportSize({width:1280,height:800});
  await p.goto(${JSON.stringify(url)},{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
${paintWaitJs('p')}
  const out=await p.evaluate(()=>{
    var res=[];
    var all=document.querySelectorAll('body *');
    for(var i=0;i<all.length && res.length<600;i++){
      var e=all[i];
      var r=e.getBoundingClientRect();
      if(r.width<=0||r.height<=0) continue;              // invisible: no box
      var cs=getComputedStyle(e);
      if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)===0) continue;
      var host=e.closest?e.closest('[data-nbai-src]'):null;
      var own=e.children.length===0?(e.textContent||'').trim():'';
      res.push({
        tag:e.tagName.toLowerCase(),
        className:typeof e.className==='string'?e.className.slice(0,240):'',
        id:e.id||undefined,
        text:own?own.slice(0,120):undefined,
        selector:(e.id?('#'+e.id):(e.tagName.toLowerCase()+(typeof e.className==='string'&&e.className.trim()?('.'+e.className.trim().split(/\\\\s+/).slice(0,3).join('.')):''))).slice(0,160),
        source:host?(host.getAttribute('data-nbai-src')||undefined):undefined,
        rect:{x:r.x,y:r.y,w:r.width,h:r.height},
        bg:cs.backgroundColor,
        color:cs.color,
        borderRadius:cs.borderRadius,
        src:e.tagName==='IMG'?(e.getAttribute('src')||undefined):undefined
      });
    }
    return res;
  }).catch(function(){return [];});
  process.stdout.write(JSON.stringify(out));
  await b.close();
})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1)});
" 2>/dev/null`;
    const run = await sandbox.commands.run(script, { cwd: TOOLS_DIR, timeoutMs: 30_000 }).catch(() => null);
    if (!run || run.exitCode !== 0 || !run.stdout.trim()) return { elements: [], scanned: false };
    try {
      const parsed = JSON.parse(run.stdout.trim());
      return Array.isArray(parsed) ? { elements: parsed, scanned: true } : { elements: [], scanned: false };
    } catch {
      return { elements: [], scanned: false };
    }
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
    // The PNG is read from a FILE, never stdout. commands.run caps stdout at 64KB (65536 bytes), so a
    // base64 screenshot past that was silently TRUNCATED to a corrupt image (the same 64KB cap that broke
    // browser_action loudly; here it failed quietly because raw base64 needs no JSON.parse). files.read
    // has no such cap. Returns '' when the file is missing, so an empty result falls through / throws.
    const readShotBase64 = async (): Promise<string> => {
      const bytes = await sandbox.files.read(`${TOOLS_DIR}/last-shot.png`, { format: 'bytes' }).catch(() => null);
      return bytes ? Buffer.from(bytes as Uint8Array).toString('base64') : '';
    };

    await this._ensureBrowserDaemon(sandbox, workspaceId).catch(() => {});
    const cdp = await sandbox.commands.run(
      `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/screenshot-cdp.js ${JSON.stringify(url)} ${vw} ${vh}`,
      { cwd: TOOLS_DIR, timeoutMs: 30_000 }
    ).catch(() => null);
    if (cdp && cdp.exitCode === 0) {
      const b64 = await readShotBase64();
      if (b64) return { base64: b64, mimeType: 'image/png' };
    }

    // Fallback: fresh standalone browser (clean session, but always works).
    const result = await sandbox.commands.run(
      `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/screenshot.js ${JSON.stringify(url)} ${vw} ${vh}`,
      { cwd: TOOLS_DIR, timeoutMs: 30_000 }
    );

    if (!result.stdout || result.exitCode !== 0) {
      throw new Error(`Screenshot failed: ${result.stderr.slice(0, 300)}`);
    }

    const b64 = await readShotBase64();
    if (!b64) throw new Error('Screenshot produced no image file');
    return { base64: b64, mimeType: 'image/png' };
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
      // The CDP port never opened. Report it HONESTLY as false, not the old optimistic `true`.
      // Returning true here (BENCHMARK #2, 2026-08-12) is exactly what made browser_action fail with a
      // bare "exit status 1": the action script then ran connectOverCDP() against a daemon that was not
      // there, its outer catch fired, and the model — told only "exit status 1" — went on to report
      // interactive features PASS that it had never actually driven.
      return false;
    })();

    this._browserDaemon.set(workspaceId, promise);
    // NEVER cache a FAILED daemon. The old code cached the optimistic `true` forever, so once the daemon
    // was (wrongly) marked ready every later browser_action reused it and kept failing — the report's two
    // consecutive exit-1s. Dropping the cache on a false/rejected result means the next call relaunches it.
    promise.then((ok) => { if (!ok) this._browserDaemon.delete(workspaceId); })
      .catch(() => { this._browserDaemon.delete(workspaceId); });
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

    const payload = JSON.stringify({ action, ...args });
    // ONE attempt: ensure the CDP daemon is genuinely reachable, then drive the action against it.
    const attempt = async (): Promise<{ result: string; url?: string; screenshot: string; cursorX?: number; cursorY?: number }> => {
      await this._ensureBrowserDaemon(sandbox, workspaceId);
      const result = await sandbox.commands.run(
        `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/browser-action.js ${shellQuote(payload)}`,
        { cwd: TOOLS_DIR, timeoutMs: 30_000 },
      );
      if (!result.stdout || result.exitCode !== 0) {
        throw new Error(`Browser action failed: ${result.stderr.slice(0, 300) || 'the browser was not reachable'}`);
      }
      const meta = JSON.parse(result.stdout.trim()) as { result: string; url?: string; cursorX?: number; cursorY?: number };
      // The screenshot comes from a FILE, never stdout — stdout is capped at 64KB and a base64 PNG blows
      // past it, which is exactly what broke every interaction with "Unterminated string in JSON at
      // position 65536". files.read has no such cap. A missing file degrades to no image, never a throw.
      const shot = await sandbox.files.read(`${TOOLS_DIR}/last-action.png`, { format: 'bytes' }).catch(() => null);
      const screenshot = shot ? Buffer.from(shot as Uint8Array).toString('base64') : '';
      return { ...meta, screenshot };
    };

    // The one failure worth retrying: the CDP daemon was not reachable (the action script's OUTER catch,
    // exit 1). A genuine action error — a missing selector — never reaches here, because the script
    // returns it as `result:"ERROR: …"` with exit 0. `withDaemonRetry` drops the cached daemon so it is
    // RELAUNCHED, then retries exactly once. If it still fails it throws honestly, so the caller reports
    // the tool as unavailable rather than the model treating a bare exit-1 as licence to claim success.
    const parsed = await withDaemonRetry(attempt, () => { this._browserDaemon.delete(workspaceId); });

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
  ): Promise<{ errors: { t: number; kind: string; text: string }[]; captured: boolean }> {
    const sandbox = await this.getSandbox(workspaceId);
    let raw = '';
    try {
      raw = await withTimeout(sandbox.files.read(CONSOLE_LOG), 15_000, 'files.read(console)');
    } catch {
      // No CONSOLE_LOG (no live browser session was ever opened) / read stalled → we did NOT actually
      // capture the console. captured:false so the caller records "runtime unchecked", not a false clean.
      return { errors: [], captured: false };
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
    // The log file existed and was read → the console WAS captured (empty errors here = genuinely clean).
    // Cap to the most recent 20 to keep the AI prompt bounded.
    return { errors: errors.slice(-20), captured: true };
  }

  /**
   * Seconds this instance has held a sandbox for the workspace, or null when it never created one
   * (a build served entirely from another instance's sandbox, or no sandbox at all). Null means
   * "not measured" — the report says exactly that rather than showing a zero that looks like a fact.
   */
  sandboxHeldSeconds(workspaceId: string): number | null {
    const started = this._sandboxStartedAt.get(workspaceId);
    if (!started) return null;
    return Math.max(0, Math.round((Date.now() - started) / 1000));
  }

  async getSandboxId(workspaceId: string): Promise<string | null> {
    const sandbox = this.sandboxes.get(workspaceId);
    return sandbox ? sandbox.sandboxId : null;
  }

  // ---------------------------------------------------------------------------------------------
  // PtyHost — real, persistent shells for Code Studio (see ShellSessions.ts for the why).
  //
  // `runCommand` above runs one command to completion and returns; these four run a genuine TTY that
  // stays alive between commands, which is what makes `cd`, Ctrl+C, colours and interactive prompts
  // work at all. The PTY is a process inside the sandbox that is ALREADY running for this workspace,
  // so a shell costs a process, not a machine.
  // ---------------------------------------------------------------------------------------------

  /** Live PTY handles by pid, so the shell can be killed and so the process isn't garbage-collected. */
  private ptys = new Map<number, { handle: CommandHandle; workspaceId: string }>();

  async openPty(
    workspaceId: string,
    opts: { cols: number; rows: number; onData: (chunk: string) => void; onExit: (code?: number) => void },
  ): Promise<{ pid: number }> {
    const sandbox = await this.getSandbox(workspaceId);
    usageTracker.record(workspaceId, 'command');

    // A STREAMING decoder, not `new TextDecoder().decode(chunk)` per callback. PTY output arrives in
    // arbitrary byte-sized pieces, so a multi-byte character (₹, an emoji, a box-drawing glyph in a
    // progress bar) is routinely split across two chunks. Decoding each chunk independently would
    // turn every such split into a replacement character — the terminal would look subtly corrupted
    // for exactly the output that matters most to an Indian user.
    const decoder = new TextDecoder('utf-8');

    const handle = await sandbox.pty.create({
      cols: opts.cols,
      rows: opts.rows,
      cwd: WORKSPACE_ROOT,
      // Interactive programs read TERM to decide whether they may use colour and cursor movement.
      // Without it they fall back to dumb output and the shell looks nothing like a real terminal.
      envs: { TERM: 'xterm-256color' },
      // The SDK default is 60 SECONDS — a persistent shell needs an hour. ShellSessions reaps idle
      // shells long before this; this is the sandbox-side backstop against a forgotten process.
      timeoutMs: 60 * 60 * 1000,
      onData: (data: Uint8Array) => {
        try { opts.onData(decoder.decode(data, { stream: true })); } catch { /* never break the stream */ }
      },
    });

    this.ptys.set(handle.pid, { handle, workspaceId });
    // `wait()` rejects with CommandExitError on a non-zero exit — for a shell that is the ORDINARY
    // case (`exit 1`, or Ctrl+D after a failed command), not an error to log. Either way the shell is
    // over, and the reader is told honestly.
    void handle
      .wait()
      .then((r) => opts.onExit(typeof r.exitCode === 'number' ? r.exitCode : undefined))
      .catch((e: unknown) => opts.onExit(typeof (e as { exitCode?: number })?.exitCode === 'number' ? (e as { exitCode: number }).exitCode : undefined))
      .finally(() => { this.ptys.delete(handle.pid); });

    return { pid: handle.pid };
  }

  async writePty(workspaceId: string, pid: number, data: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    await sandbox.pty.sendInput(pid, new TextEncoder().encode(data));
  }

  async resizePty(workspaceId: string, pid: number, cols: number, rows: number): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    await sandbox.pty.resize(pid, { cols, rows });
  }

  async killPty(workspaceId: string, pid: number): Promise<boolean> {
    this.ptys.delete(pid);
    try {
      const sandbox = await this.getSandbox(workspaceId);
      return await sandbox.pty.kill(pid);
    } catch {
      return false; // sandbox already gone ⇒ the PTY is gone with it
    }
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
      // Bounded (10s, like create/connect) so a throttled E2B API can't leave the
      // periodic idle-sweep's fire-and-forget pause promise hanging forever.
      const ok = await withTimeout(Sandbox.pause(sandboxId), 10_000, 'Sandbox.pause');
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
    let dbOutcome: DbProvisionOutcome | undefined;
    let dbDiagnostics = '';
    if (features.includes('db')) {
      // Install PostgreSQL if missing, start it, create the app database — then prove it with a REAL
      // `SELECT 1` over the exact URL the app is handed (admin task 1, 2026-08-05; script + parser in
      // dbProvisionVerify.ts, where the Mitrify false-success story lives). pg_isready remains the
      // WAIT; SELECT 1 is the only thing allowed to declare success — pg_isready cannot see a missing
      // database or broken auth, and it is not what the app experiences.
      const pgResult = await sandbox.commands.run(
        dbProvisionScript(),
        { timeoutMs: 120_000 },
      ).catch(() => null);

      dbOutcome = parseDbProvision(pgResult?.stdout);
      // WHY it failed, carried to the caller (report 15985d3b): the previous version told the user
      // the truth — "the server never accepted connections" — and still left us with no idea what to
      // fix, because every reason had been swallowed. These lines are for the admin report's detail,
      // never for the user's message.
      dbDiagnostics = provisionDiagnostics(pgResult?.stdout);
      // The fallback URL is still written on failure — DELIBERATELY — so .env points at the local
      // Postgres and a late-starting server heals without a rewrite (the downstream P1001 detector
      // handles a genuinely-dead DB). What the fallback may no longer do is masquerade as success:
      // `dbVerified` carries the truth to every caller, and "provisioned" can only be SAID where it
      // was PROVEN.
      dbUrl = dbOutcome.url ?? CANONICAL_DB_URL;
      // KEEPALIVE WATCHDOG (last-5-reports class fix, 2026-07-20): the sandbox reaps the Postgres daemon
      // minutes after provision — the root class behind builds #14→#18. Arm ONE in-sandbox loop (pgrep-
      // guarded against duplicates) that restarts the cluster within ~20s of it dying, so a reap
      // self-heals BEFORE any migrate/seed/preview can hit P1001. Armed here — the single provisioning
      // choke point — so first provision, mid-build revival, and preview-boot revival all re-arm it.
      // Best-effort: if nohup/setsid can't detach in this sandbox, the reactive nets still stand.
      if (dbOutcome.verified) {
        await sandbox.commands.run(postgresWatchdogCommand(), { timeoutMs: 15_000 }).catch(() => null);
      }
    }

    const jwtSecret = `jwt_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const envVars: Record<string, string> = {};
    if (features.includes('db'))      envVars.DATABASE_URL = dbUrl;
    if (features.includes('auth'))    envVars.JWT_SECRET   = jwtSecret;
    if (features.includes('storage')) envVars.STORAGE_DIR  = './uploads';

    const scaffoldFiles = BackendProvisioner.getScaffoldFiles(features);
    return {
      dbUrl, envVars, scaffoldFiles,
      dbVerified: dbOutcome?.verified,
      dbVerifyFailure: dbOutcome ? dbOutcome.failure : undefined,
      dbDiagnostics: dbDiagnostics || undefined,
    };
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

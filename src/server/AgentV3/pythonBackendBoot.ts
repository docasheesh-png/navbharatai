/**
 * 🔴 A PYTHON BACKEND COMES BACK WITH ITS APP (queue Q-284, autopsy 241215d1, 2026-10-04).
 *
 * A paper-trading app was built as a Vite/React front end plus a FastAPI server in `backend/`. The model
 * started both by hand during the build, so the preview worked. But every path the PLATFORM uses to bring
 * an app back — the preview "Wake up" (preview-diagnose), our own preview start (`PLATFORM_PREVIEW_UP`)
 * and the two in-build restarts — sends ONE command, `npm run dev` or the stored recipe. Nothing created
 * the virtualenv (it is never saved: `.venv` is a generated directory), nothing installed
 * `requirements.txt`, nothing started uvicorn. After a sandbox restart the front end came back and every
 * API call failed. The service graph read only `package.json` scripts, so it reported "Single service"
 * for a two-process app and nothing knew the second process existed.
 *
 * 🔑 THE CLASS: a backend the platform cannot see is a backend the platform never starts. Every start
 * path now asks ONE question — `pythonBackendPlan(files)` — and runs the same bounded boot before the
 * front end, and the service graph lists the Python server as a backend.
 *
 * WHAT THE BOOT DOES, in the user's sandbox, and why it is shaped this way:
 *   • nothing at all when the port already answers (a paused sandbox resumes WITH its processes);
 *   • `python3 -m venv .venv` in the backend's own folder (PEP 668: the sandbox refuses a global pip);
 *   • `pip install` only when the manifest changed since the last install (a hash stamp in the venv),
 *     bounded by `timeout`;
 *   • starts the server detached (`setsid nohup`, its own log), with `.venv/bin` first on PATH so the
 *     project's own declared command runs unchanged, then waits up to 30 s for the port.
 * The script reaches the sandbox base64-encoded, so the dev-server classifier never mistakes this bounded
 * boot for a dev-server launch (that path would merge it with the front end's launch, truncate the shared
 * log and take the single watchdog).
 *
 * 🔒 WHAT IT WILL NOT DO: guess. The start command comes from `pythonStart.ts` (a Procfile line, Django's
 * own WSGI module, or the app object in the source served by the server the project DECLARES). A project
 * that does not say enough gets no plan, and the paths behave exactly as before. Kill switch:
 * `AGENTV3_PYTHON_BACKEND_BOOT=off`. PURE — files in, a plan and a command out.
 */
import { derivePythonCommands } from './pythonStart';

export function pythonBackendBootEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PYTHON_BACKEND_BOOT ?? '').trim().toLowerCase() !== 'off';
}

export interface PythonBackendPlan {
  /** The backend's folder, relative to the project root ('' = the root). */
  dir: string;
  /** The install command, run inside the venv (`pip install -r requirements.txt` / `pip install .`). */
  installCommand: string;
  /** The manifest whose hash decides whether to reinstall. */
  manifest: string;
  /** The project's own start command, with `$PORT` where the port goes. */
  startCommand: string;
  /** The port the server is started on — the one the front end expects. */
  port: number;
}

/** Folders that are never the app's own backend. */
const NOT_APP_DIR = /(^|\/)(node_modules|\.venv|venv|env|\.git|dist|build|site-packages|__pycache__|tests?)(\/|$)/i;

/** The default port when nothing in the project names one — uvicorn's and Django's own default. */
export const DEFAULT_PYTHON_PORT = 8000;

/** Files re-rooted at `dir`, so `backend/main.py` reads as `main.py`. */
function reroot(files: Record<string, string>, dir: string): Record<string, string> {
  if (!dir) return files;
  const prefix = `${dir}/`;
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) if (p.startsWith(prefix)) out[p.slice(prefix.length)] = c;
  return out;
}

/**
 * The port the front end expects the API on: a dev-server proxy target (`target: 'http://localhost:8000'`)
 * first — that is the address the front end really calls — then a port in the server's own source
 * (`uvicorn.run(app, port=8001)`), then the default. PURE.
 */
export function pythonBackendPort(files: Record<string, string>, dir: string): number {
  const ok = (n: number) => Number.isInteger(n) && n > 1023 && n < 65536 ? n : null;
  for (const [path, content] of Object.entries(files)) {
    if (!/(^|\/)(vite|webpack|next)\.config\.[cm]?[jt]s$|(^|\/)package\.json$|(^|\/)setupProxy\.[jt]s$/.test(path) || typeof content !== 'string') continue;
    if (NOT_APP_DIR.test(path)) continue;
    const m = content.match(/(?:target|proxy|["']\/[^"'\n]*["'])\s*["']?\s*:\s*["'`]https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/);
    const port = m ? ok(Number(m[1])) : null;
    if (port) return port;
  }
  const prefix = dir ? `${dir}/` : '';
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(prefix) || !path.endsWith('.py') || typeof content !== 'string' || NOT_APP_DIR.test(path)) continue;
    const m = content.match(/\b(?:uvicorn\.run|\.run)\s*\([^)]*\bport\s*=\s*(\d{2,5})/);
    const port = m ? ok(Number(m[1])) : null;
    if (port) return port;
  }
  return DEFAULT_PYTHON_PORT;
}

/**
 * Does this project have a Python backend we can start, and how? Null when it does not, or when it does
 * not say enough to start it (never a guess). The shallowest backend folder wins. PURE.
 */
export function pythonBackendPlan(files: Record<string, string> | null | undefined): PythonBackendPlan | null {
  const f = files ?? {};
  const dirs = Object.keys(f)
    .filter((p) => /(^|\/)(requirements\.txt|pyproject\.toml)$/.test(p) && !NOT_APP_DIR.test(p))
    .map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))
    .filter((d, i, all) => all.indexOf(d) === i)
    .sort((a, b) => (a ? a.split('/').length : 0) - (b ? b.split('/').length : 0) || a.localeCompare(b));
  for (const dir of dirs) {
    const local = reroot(f, dir);
    const commands = derivePythonCommands(local);
    if (!commands) continue;
    const manifest = typeof local['requirements.txt'] === 'string' ? 'requirements.txt' : 'pyproject.toml';
    const installCommand = manifest === 'requirements.txt' ? 'pip install -q -r requirements.txt' : 'pip install -q .';
    return { dir, installCommand, manifest, startCommand: commands.startCommand, port: pythonBackendPort(f, dir) };
  }
  return null;
}

/** The marker lines the boot script prints, so the caller reads a verdict instead of guessing. */
export const BACKEND_UP = 'NBAI_BACKEND_UP';
export const BACKEND_NOT_UP = 'NBAI_BACKEND_NOT_UP';
export const BACKEND_LOG_PATH = '/tmp/nbai-backend.log';

const shellQuote = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The bash script that brings the backend up. Exported for the test that runs it. PURE. */
export function pythonBackendBootScript(plan: PythonBackendPlan, opts: { installSeconds?: number; waitSeconds?: number } = {}): string {
  const installSeconds = Math.max(30, Math.min(600, Math.floor(opts.installSeconds ?? 240)));
  const waitSeconds = Math.max(5, Math.min(120, Math.floor(opts.waitSeconds ?? 30)));
  const port = plan.port;
  return [
    'set -u',
    `cd ${shellQuote(plan.dir || '.')} || { echo "${BACKEND_NOT_UP} folder"; exit 0; }`,
    `PORT=${port}; export PORT`,
    // A paused sandbox resumes with its processes: an answering port is the backend, already up.
    `if (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then echo "${BACKEND_UP} already"; exit 0; fi`,
    `[ -x .venv/bin/python ] || python3 -m venv .venv > ${BACKEND_LOG_PATH} 2>&1 || { echo "${BACKEND_NOT_UP} venv"; tail -n 5 ${BACKEND_LOG_PATH}; exit 0; }`,
    `NEW=$(sha1sum ${shellQuote(plan.manifest)} 2>/dev/null | cut -c1-40)`,
    `if [ "$(cat .venv/.nbai-installed 2>/dev/null)" != "$NEW" ]; then`,
    `  if timeout ${installSeconds} .venv/bin/${plan.installCommand} > ${BACKEND_LOG_PATH} 2>&1; then echo "$NEW" > .venv/.nbai-installed; else echo "${BACKEND_NOT_UP} install"; tail -n 8 ${BACKEND_LOG_PATH}; exit 0; fi`,
    'fi',
    `PATH="$PWD/.venv/bin:$PATH" setsid nohup bash -c ${shellQuote(plan.startCommand)} > ${BACKEND_LOG_PATH} 2>&1 < /dev/null &`,
    `for i in $(seq 1 ${waitSeconds}); do`,
    `  if (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then echo "${BACKEND_UP} started"; exit 0; fi`,
    '  sleep 1',
    'done',
    `echo "${BACKEND_NOT_UP} timeout"; tail -n 8 ${BACKEND_LOG_PATH}`,
  ].join('\n');
}

/**
 * The one-line command handed to the sandbox. The script travels base64-encoded so no classifier reads
 * its server command as a dev-server launch. PURE.
 */
export function pythonBackendBootCommand(plan: PythonBackendPlan): string {
  const b64 = Buffer.from(pythonBackendBootScript(plan), 'utf8').toString('base64');
  return `echo ${b64} | base64 -d > /tmp/nbai-backend-boot.sh && bash /tmp/nbai-backend-boot.sh`;
}

export interface BackendBootOutcome {
  state: 'up' | 'already' | 'not-up' | 'unknown';
  /** venv / install / timeout / folder — why it did not come up. */
  reason: string;
  /** The last lines of the backend's own log when it did not come up. */
  tail: string;
}

/** Read the boot script's verdict. Never throws. PURE. */
export function readBackendBoot(stdout: string | null | undefined): BackendBootOutcome {
  const text = String(stdout ?? '');
  const up = text.match(new RegExp(`${BACKEND_UP}\\s+(already|started)`));
  if (up) return { state: up[1] === 'already' ? 'already' : 'up', reason: '', tail: '' };
  const down = text.match(new RegExp(`${BACKEND_NOT_UP}\\s+(\\w+)`));
  if (down) {
    const after = text.slice(text.indexOf(down[0]) + down[0].length).trim().split('\n').slice(-8).join('\n');
    return { state: 'not-up', reason: down[1], tail: after.slice(0, 600) };
  }
  return { state: 'unknown', reason: '', tail: '' };
}

/** One admin-report line. PURE. */
export function backendBootReport(plan: PythonBackendPlan, outcome: BackendBootOutcome, where: string): string {
  const at = `${plan.dir || 'the project root'} on port ${plan.port}`;
  if (outcome.state === 'up') return `Started the Python backend (${at}) before the front end (${where}).`;
  if (outcome.state === 'already') return `The Python backend (${at}) was already running (${where}).`;
  if (outcome.state === 'not-up') return `The Python backend (${at}) did not come up (${where}, ${outcome.reason})${outcome.tail ? `: ${outcome.tail.split('\n').slice(-2).join(' / ')}` : ''}.`;
  return `The Python backend (${at}) boot gave no verdict (${where}).`;
}

/** Is this command a Python server start (so it cannot be the preview's own recipe)? PURE. */
export function isPythonServerCommand(command: string | null | undefined): boolean {
  return /\b(uvicorn|gunicorn|hypercorn|daphne)\b|\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bpython3?\s+(?:-m\s+)?[\w./-]*\.py\b/.test(String(command ?? ''));
}

/**
 * Start the Python backend before the front end, through an injected runner (the actuator's
 * `runCommand`). Null when the switch is off or the project has no Python backend to start — then the
 * caller does exactly what it did before. Never throws: a failed boot is an outcome, and the front end
 * still starts (it renders, and the honest report says the API did not come up).
 */
export async function bootPythonBackendFirst(
  run: (command: string) => Promise<{ stdout?: string; stderr?: string }>,
  files: Record<string, string> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ plan: PythonBackendPlan; outcome: BackendBootOutcome } | null> {
  if (!pythonBackendBootEnabled(env)) return null;
  const plan = pythonBackendPlan(files);
  if (!plan) return null;
  try {
    const res = await run(pythonBackendBootCommand(plan));
    return { plan, outcome: readBackendBoot(`${res?.stdout ?? ''}\n${res?.stderr ?? ''}`) };
  } catch (e) {
    return { plan, outcome: { state: 'not-up', reason: 'error', tail: (e instanceof Error ? e.message : String(e)).slice(0, 300) } };
  }
}

/** How long one boot may take before the caller stops waiting: venv + a bounded install + the port wait. */
export const PYTHON_BOOT_BUDGET_MS = 330_000;

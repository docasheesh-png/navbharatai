// HOW DOES A PYTHON APP START? — read from the project, never invented (admin 2026-09-05).
//
// 🔴 THE GAP THIS CLOSES. `deployPlan.ts` recognises Flask, FastAPI, Django, Uvicorn and Gunicorn and
// classifies them as `python-server` — and then `buildCreateServiceRequest` hardcoded `env: 'node'`,
// so nothing could ever deploy one. The platform could NAME the app's shape and not host it: an honest
// refusal, and still a wall. Render runs Python perfectly well, so the wall was ours.
//
// 🔒 AND THE HARD PART IS THE START COMMAND, WHICH IS WHY THIS IS A MODULE AND NOT A CONSTANT. Node
// declares its own entry point in `package.json` — one field, read it, done. Python has no equivalent:
// the command is `gunicorn <module>:<variable>`, and both halves live inside the source. So they are
// READ from the source:
//
//   • a Procfile `web:` line     — the author has stated it outright. Nothing beats a declaration.
//   • an ASGI/WSGI app object    — the module path and variable name come from the file that defines
//                                  them, so `src/api.py` holding `app = FastAPI()` yields `src.api:app`.
//   • Django                     — `manage.py` beside a `<project>/wsgi.py` names its own entry point.
//
// 🔒 AND THE SERVER MUST BE DECLARED. `uvicorn`/`gunicorn` have to be installed for the command to
// run, so a project that never lists one gets **null** — the same refusal a Node app with no `start`
// script gets, and for the same reason: a service created with a command that cannot run builds,
// crashes, and bills the user for a dead site our UI would call deployed.
//
// PURE — files in, commands out.

export interface PythonCommands {
  buildCommand: string;
  startCommand: string;
}

/** `$PORT` is what the host sets; binding anywhere else makes the app unreachable however well it runs. */
const BIND = '--bind 0.0.0.0:$PORT';
const UVICORN_BIND = '--host 0.0.0.0 --port $PORT';

/** Everything the project says it depends on, lowercased, as one blob. */
function declaredDeps(files: Record<string, string>): string {
  return [
    files['requirements.txt'], files['pyproject.toml'], files['Pipfile'], files['setup.py'],
  ].map((v) => (typeof v === 'string' ? v : '')).join('\n').toLowerCase();
}

/** Is this server declared as a dependency? Without it the command cannot run, so it is not a command. */
function declares(files: Record<string, string>, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`).test(declaredDeps(files));
}

/** The importable module path for a file: `src/api.py` → `src.api`. Returns '' for a path we cannot use. */
export function pythonModulePath(file: string): string {
  const p = String(file ?? '').trim().replace(/^\.\//, '');
  if (!p.endsWith('.py')) return '';
  const stem = p.slice(0, -3);
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\/[A-Za-z_][A-Za-z0-9_]*)*$/.test(stem)) return '';
  return stem.split('/').join('.');
}

export interface PythonAppObject {
  module: string;
  variable: string;
  kind: 'asgi' | 'wsgi';
}

/**
 * Find the application object the server is meant to serve — the `app` in `app = FastAPI()`.
 *
 * Both the module and the VARIABLE come from the file, because assuming the variable is called `app`
 * is exactly the kind of near-always-right guess that produces a service which builds and then cannot
 * start. Shallow paths are preferred so a top-level `main.py` beats a fixture buried six levels down.
 * PURE.
 */
export function findPythonApp(files: Record<string, string>): PythonAppObject | null {
  const found: PythonAppObject[] = [];
  for (const [path, content] of Object.entries(files ?? {})) {
    if (!path.endsWith('.py') || typeof content !== 'string') continue;
    if (/(^|\/)(tests?|test_[^/]*|conftest)\b/i.test(path)) continue;   // a fixture is not the app
    const module = pythonModulePath(path);
    if (!module) continue;
    // `app = FastAPI(...)` / `application = Flask(__name__)` — the constructor names the kind.
    const m = content.match(/(^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(FastAPI|Flask|Starlette|Quart)\s*\(/);
    if (!m) continue;
    found.push({ module, variable: m[2], kind: m[3] === 'Flask' ? 'wsgi' : 'asgi' });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.module.split('.').length - b.module.split('.').length || a.module.localeCompare(b.module));
  return found[0];
}

/** Django names its own entry point: `manage.py` beside `<project>/wsgi.py`. PURE. */
export function findDjangoWsgi(files: Record<string, string>): string {
  if (!Object.prototype.hasOwnProperty.call(files ?? {}, 'manage.py')) return '';
  for (const path of Object.keys(files ?? {})) {
    const m = path.match(/^([A-Za-z_][A-Za-z0-9_]*)\/wsgi\.py$/);
    if (m) return `${m[1]}.wsgi:application`;
  }
  return '';
}

/** The `web:` process from a Procfile, which is the author stating the command outright. PURE. */
export function procfileWebCommand(procfile: string | null | undefined): string {
  for (const raw of String(procfile ?? '').split('\n')) {
    const m = raw.match(/^\s*web\s*:\s*(.+?)\s*$/i);
    if (m && m[1]) return m[1];
  }
  return '';
}

/** How to install this project's dependencies, or '' when it declares none we can install. PURE. */
export function pythonBuildCommand(files: Record<string, string>): string {
  if (typeof files?.['requirements.txt'] === 'string') return 'pip install -r requirements.txt';
  if (typeof files?.['pyproject.toml'] === 'string') return 'pip install .';
  if (typeof files?.['Pipfile'] === 'string') return 'pipenv install --deploy --system';
  return '';
}

/**
 * The build and start commands for a Python service, or **null** when the project does not say enough
 * to run it.
 *
 * Null is the honest answer, not a shortfall: the caller falls back to the same hand-off a Node app
 * with no `start` script gets, and the user is told exactly what to add. PURE.
 */
export function derivePythonCommands(files: Record<string, string> | null | undefined): PythonCommands | null {
  const f = files ?? {};
  const buildCommand = pythonBuildCommand(f);
  if (!buildCommand) return null;   // nothing we can install ⇒ nothing that can run

  // 1. A declaration beats every derivation.
  const declared = procfileWebCommand(f['Procfile']);
  if (declared) return { buildCommand, startCommand: declared };

  // 2. Django names itself.
  const django = findDjangoWsgi(f);
  if (django && declares(f, 'gunicorn')) {
    return { buildCommand, startCommand: `gunicorn ${django} ${BIND}` };
  }

  // 3. The app object, with the server the project actually declares.
  const app = findPythonApp(f);
  if (app) {
    if (app.kind === 'asgi' && declares(f, 'uvicorn')) {
      return { buildCommand, startCommand: `uvicorn ${app.module}:${app.variable} ${UVICORN_BIND}` };
    }
    if (declares(f, 'gunicorn')) {
      // Gunicorn serves WSGI natively; an ASGI app needs uvicorn's worker class, which the project
      // must also have declared — asking gunicorn to serve ASGI without it fails at the first request.
      if (app.kind === 'wsgi') return { buildCommand, startCommand: `gunicorn ${app.module}:${app.variable} ${BIND}` };
      if (declares(f, 'uvicorn')) {
        return { buildCommand, startCommand: `gunicorn ${app.module}:${app.variable} -k uvicorn.workers.UvicornWorker ${BIND}` };
      }
    }
  }
  return null;
}

/**
 * What to TELL the user when we could not work out how their Python app starts — naming the one thing
 * to add rather than reporting a failure they cannot act on. PURE.
 */
export function pythonStartRefusal(files: Record<string, string> | null | undefined): string {
  const f = files ?? {};
  if (!pythonBuildCommand(f)) {
    return 'We could not tell how to install your app — add a requirements.txt (or pyproject.toml) listing what it needs, then deploy again.';
  }
  return 'We could not tell how your app starts. Add a Procfile with a line like `web: gunicorn main:app --bind 0.0.0.0:$PORT`, '
    + 'and make sure gunicorn (or uvicorn) is listed in requirements.txt — then deploy again.';
}

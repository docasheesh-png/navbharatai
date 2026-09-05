import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  pythonModulePath, findPythonApp, findDjangoWsgi, procfileWebCommand,
  pythonBuildCommand, derivePythonCommands, pythonStartRefusal,
} from '../src/server/AgentV3/pythonStart';
import { buildCreateServiceRequest, createRenderService } from '../src/server/AgentV3/renderCreateService';

/**
 * PYTHON APPS COULD BE NAMED BUT NEVER HOSTED (admin 2026-09-05).
 *
 * `deployPlan.ts` has always recognised Flask, FastAPI, Django, Uvicorn and Gunicorn and classified
 * them as `python-server` — and then `buildCreateServiceRequest` hardcoded `env: 'node'`, so nothing
 * could deploy one. The platform could tell you exactly what your app was and refuse to run it.
 *
 * The hard half is the START COMMAND: Node states its entry point in one manifest field; Python's
 * lives inside the source. So it is READ from the source, and when the project does not say enough,
 * the answer is null — the same refusal a Node app with no `start` script gets, and for the same
 * reason.
 */
const REQS = 'flask==3.0.0\ngunicorn==21.2.0\n';

describe('pythonModulePath', () => {
  it('a path becomes an importable module', () => {
    expect(pythonModulePath('main.py')).toBe('main');
    expect(pythonModulePath('src/api.py')).toBe('src.api');
    expect(pythonModulePath('./app.py')).toBe('app');
  });

  it('anything not importable is refused rather than mangled', () => {
    for (const p of ['main.txt', 'my-app.py', 'src/2bad.py', '', 'a b.py']) {
      expect(pythonModulePath(p), p).toBe('');
    }
  });
});

describe('findPythonApp — the module AND the variable come from the file', () => {
  it('🔒 the variable name is read, never assumed to be "app"', () => {
    // Assuming `app` is the near-always-right guess that produces a service which builds and then
    // cannot start.
    expect(findPythonApp({ 'main.py': 'application = Flask(__name__)' }))
      .toEqual({ module: 'main', variable: 'application', kind: 'wsgi' });
  });

  it('FastAPI and Starlette are ASGI; Flask is WSGI', () => {
    expect(findPythonApp({ 'main.py': 'app = FastAPI()' })?.kind).toBe('asgi');
    expect(findPythonApp({ 'main.py': 'app = Flask(__name__)' })?.kind).toBe('wsgi');
  });

  it('the shallowest module wins — a top-level entry point beats a nested one', () => {
    expect(findPythonApp({ 'a/b/c/deep.py': 'app = FastAPI()', 'main.py': 'app = FastAPI()' })?.module).toBe('main');
  });

  it('🔒 a test fixture is not the app', () => {
    expect(findPythonApp({ 'tests/conftest.py': 'app = FastAPI()' })).toBeNull();
    expect(findPythonApp({ 'test_api.py': 'app = Flask(__name__)' })).toBeNull();
  });

  it('no app object at all is null', () => {
    expect(findPythonApp({ 'main.py': 'print("hi")' })).toBeNull();
    expect(findPythonApp({})).toBeNull();
  });
});

describe('findDjangoWsgi + procfileWebCommand — declarations, read verbatim', () => {
  it('Django names its own entry point', () => {
    expect(findDjangoWsgi({ 'manage.py': '', 'mysite/wsgi.py': '' })).toBe('mysite.wsgi:application');
  });

  it('no manage.py is not Django, whatever else is there', () => {
    expect(findDjangoWsgi({ 'mysite/wsgi.py': '' })).toBe('');
  });

  it('a Procfile web line is the author stating the command', () => {
    expect(procfileWebCommand('release: migrate\nweb: gunicorn app:server --bind 0.0.0.0:$PORT\n'))
      .toBe('gunicorn app:server --bind 0.0.0.0:$PORT');
    expect(procfileWebCommand('worker: celery -A x')).toBe('');
    expect(procfileWebCommand(null)).toBe('');
  });
});

describe('pythonBuildCommand', () => {
  it('installs whatever the project declares, in the order it is most likely meant', () => {
    expect(pythonBuildCommand({ 'requirements.txt': 'flask' })).toBe('pip install -r requirements.txt');
    expect(pythonBuildCommand({ 'pyproject.toml': '[project]' })).toBe('pip install .');
    expect(pythonBuildCommand({ Pipfile: '[packages]' })).toContain('pipenv');
  });

  it('a project that declares nothing has nothing to install', () => {
    expect(pythonBuildCommand({ 'main.py': 'app = Flask(__name__)' })).toBe('');
  });
});

describe('derivePythonCommands — read it, or refuse', () => {
  it('a declaration beats every derivation', () => {
    const c = derivePythonCommands({
      'requirements.txt': REQS,
      Procfile: 'web: gunicorn custom:thing --bind 0.0.0.0:$PORT',
      'main.py': 'app = Flask(__name__)',
    });
    expect(c?.startCommand).toBe('gunicorn custom:thing --bind 0.0.0.0:$PORT');
  });

  it('Flask + gunicorn produces a real WSGI command bound to the host port', () => {
    const c = derivePythonCommands({ 'requirements.txt': REQS, 'main.py': 'app = Flask(__name__)' });
    expect(c).toEqual({ buildCommand: 'pip install -r requirements.txt', startCommand: 'gunicorn main:app --bind 0.0.0.0:$PORT' });
  });

  it('FastAPI + uvicorn binds to the host port too', () => {
    const c = derivePythonCommands({ 'requirements.txt': 'fastapi\nuvicorn\n', 'src/api.py': 'api = FastAPI()' });
    expect(c?.startCommand).toBe('uvicorn src.api:api --host 0.0.0.0 --port $PORT');
  });

  it('🔒 $PORT is always what it binds to — anywhere else is unreachable however well it runs', () => {
    for (const files of [
      { 'requirements.txt': REQS, 'main.py': 'app = Flask(__name__)' },
      { 'requirements.txt': 'fastapi\nuvicorn\n', 'main.py': 'app = FastAPI()' },
      { 'requirements.txt': 'django\ngunicorn\n', 'manage.py': '', 'site/wsgi.py': '' },
    ]) expect(derivePythonCommands(files)?.startCommand).toContain('$PORT');
  });

  it('Django is served through its own wsgi entry point', () => {
    expect(derivePythonCommands({ 'requirements.txt': 'django\ngunicorn\n', 'manage.py': '', 'site/wsgi.py': '' })?.startCommand)
      .toBe('gunicorn site.wsgi:application --bind 0.0.0.0:$PORT');
  });

  it('🔒 gunicorn serving an ASGI app needs the uvicorn worker, or it fails at the first request', () => {
    const c = derivePythonCommands({ 'requirements.txt': 'fastapi\ngunicorn\nuvicorn\n', 'main.py': 'app = FastAPI()' });
    // uvicorn alone is preferred; but when gunicorn is the declared server the worker class is required.
    expect(c?.startCommand).toContain('uvicorn');
    const noUvicorn = derivePythonCommands({ 'requirements.txt': 'fastapi\ngunicorn\n', 'main.py': 'app = FastAPI()' });
    expect(noUvicorn).toBeNull();
  });

  it('🔒 no declared server ⇒ null — a command that cannot run is not a command', () => {
    // A service created with it builds, crashes, and bills the user for a dead site we would call live.
    expect(derivePythonCommands({ 'requirements.txt': 'flask\n', 'main.py': 'app = Flask(__name__)' })).toBeNull();
  });

  it('🔒 nothing to install ⇒ null, before anything else is considered', () => {
    expect(derivePythonCommands({ 'main.py': 'app = Flask(__name__)', Procfile: 'web: gunicorn main:app' })).toBeNull();
    expect(derivePythonCommands(null)).toBeNull();
  });
});

describe('pythonStartRefusal — names the one thing to add', () => {
  it('distinguishes "cannot install" from "cannot start"', () => {
    expect(pythonStartRefusal({ 'main.py': '' })).toMatch(/requirements\.txt/);
    expect(pythonStartRefusal({ 'requirements.txt': 'flask' })).toMatch(/Procfile/);
    expect(pythonStartRefusal({ 'requirements.txt': 'flask' })).toMatch(/gunicorn/);
  });
});

describe('🔒 the service is actually created as a Python service', () => {
  it('the runtime reaches the request, and node stays the default', () => {
    const base = {
      ownerId: 'o', name: 'n', repoUrl: 'https://github.com/a/b', branch: 'main',
      commands: { buildCommand: 'pip install -r requirements.txt', startCommand: 'gunicorn main:app' },
    };
    expect(JSON.parse(buildCreateServiceRequest('k', { ...base, runtime: 'python' }).body!).serviceDetails.env).toBe('python');
    expect(JSON.parse(buildCreateServiceRequest('k', base).body!).serviceDetails.env).toBe('node');
  });

  it('a python app with a readable start command is created', async () => {
    const res = await createRenderService({
      apiKey: 'k', name: 'api', repoUrl: 'https://github.com/a/api', repoPath: 'a/api',
      runtime: 'python', files: { 'requirements.txt': REQS, 'main.py': 'app = Flask(__name__)' },
    }, (async (url: any) => (String(url).includes('/owners')
      ? { ok: true, status: 200, json: async () => [{ id: 'own-1' }], text: async () => '' }
      : { ok: true, status: 201, json: async () => ({ service: { id: 's1', name: 'api', serviceUrl: 'https://api.onrender.com' } }), text: async () => '' })) as any);
    expect(res.ok).toBe(true);
  });

  it('🔒 a python app we cannot start is refused BEFORE any call, with the fix named', async () => {
    let called = false;
    const res = await createRenderService({
      apiKey: 'k', name: 'api', repoUrl: 'https://github.com/a/api', repoPath: 'a/api',
      runtime: 'python', files: { 'main.py': 'app = Flask(__name__)' },
    }, (async () => { called = true; return { ok: true, status: 200, json: async () => [], text: async () => '' }; }) as any);
    expect(called).toBe(false);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/requirements\.txt/);
  });
});

describe('🔒 the wiring — the planner that classifies the app also decides how it is built', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('the runtime comes from planDeployment, so the two cannot disagree', () => {
    expect(handler).toContain("planDeployment(envSource).backend?.runtime === 'python'");
    expect(handler).toContain('runtime: backendRuntime');
  });

  it('the project files travel with it — python\'s entry point is not in a manifest', () => {
    expect(handler).toContain('files: envSource');
  });
});

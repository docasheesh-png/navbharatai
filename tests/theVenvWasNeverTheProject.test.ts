/**
 * AUTOPSY e1c21ad8 (2026-09-27) — "limitless writer", a free build that turned an imported FastAPI
 * backend into a React + FastAPI app.
 *
 *  1. It ran `python3 -m venv venv` in `backend/`. Ten drifted copies of "directories that are not
 *     source" knew `.venv` and none knew `venv`, so ~1,900 installed-package files were listed, saved
 *     durably (the snapshot check counted 1,930 files), committed to the user's own repository,
 *     detected as a pytest suite ("this project HAS a test suite") and scanned as fake code ("96
 *     fake/incomplete code issue(s) in 24 file(s) this build did not touch").
 *  2. The app's only form lives in `NewNovel.tsx`, served at `/new` by the app's own router. The
 *     journey check guessed the route from the filename, went to `/`, and reported the form's fields
 *     "not present on the running page".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NEVER_SOURCE_DIRS, LIST_PRUNE_DIRS, isNeverSourcePath, isListPrunedPath,
} from '../src/server/lib/generatedDirs';
import { isIgnoredListPath, buildListFilesCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { toDurableFileKey, normalizeFileMapKeys } from '../src/server/lib/workspacePath';
import { liveIndexPaths } from '../src/server/AgentV3/WorkspaceFileStore';
import { detectTestPlan, suitePresentButRunnerMissing } from '../src/server/AgentV3/testRunner';
import { NESTED_REPO_PRUNE_DIRS } from '../src/server/AgentV3/nestedRepoProbe';
import { ARCHIVE_EXCLUDES } from '../src/server/AgentV3/sourceArchive';
import { deriveJourneys, routeFromRouter, routeForFile } from '../src/server/AgentV3/journeyDerivation';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Paths shaped exactly like the report's workspace. */
const VENV = [
  'backend/venv/pyvenv.cfg',
  'backend/venv/bin/uvicorn',
  'backend/venv/lib/python3.11/site-packages/pydantic/main.py',
  'backend/venv/lib/python3.11/site-packages/anyio/tests/test_taskgroups.py',
  'backend/__pycache__/main.cpython-311.pyc',
];
const SOURCE = ['backend/main.py', 'backend/requirements.txt', 'src/App.tsx', 'src/pages/NewNovel.tsx', 'package.json'];

describe('1 · a Python virtualenv is never the project', () => {
  it('every venv path is pruned from the listing; every source path is kept', () => {
    for (const p of VENV) expect(isIgnoredListPath(p)).toBe(true);
    for (const p of SOURCE) expect(isIgnoredListPath(p)).toBe(false);
  });

  it('a virtualenv under ANY name is caught by its site-packages', () => {
    expect(isNeverSourcePath('api/myenv/lib/python3.12/site-packages/fastapi/app.py')).toBe(true);
  });

  it('the sandbox listing command prunes venv and site-packages inside the machine', () => {
    const cmd = buildListFilesCommand('/home/user/workspace');
    expect(cmd).toContain("-name 'venv'");
    expect(cmd).toContain("-name 'site-packages'");
  });

  it('the durable store refuses a venv file and heals an index that already holds 1,900 of them', () => {
    expect(toDurableFileKey('backend/venv/lib/python3.11/site-packages/pydantic/main.py')).toBeNull();
    expect(toDurableFileKey('/home/user/workspace/backend/main.py')).toBe('backend/main.py');
    const { files, dropped } = normalizeFileMapKeys({ 'backend/main.py': 'x', 'backend/venv/pyvenv.cfg': 'y' });
    expect(Object.keys(files)).toEqual(['backend/main.py']);
    expect(dropped).toBe(1);
    expect(liveIndexPaths([...SOURCE, ...VENV]).sort()).toEqual([...SOURCE].sort());
  });

  it('only the unambiguous tier is refused durably — a hand-written build/ folder stays stored', () => {
    expect(toDurableFileKey('build/release.js')).toBe('build/release.js');
    expect(isListPrunedPath('build/release.js')).toBe(true);   // still out of listings, as before
    expect(isNeverSourcePath('build/release.js')).toBe(false); // but never deleted from a stored project
    expect(isNeverSourcePath('src/venv.ts')).toBe(false);      // a FILE called venv is not the directory
  });

  it("a library's own test_*.py is not the project's pytest suite", () => {
    expect(detectTestPlan([...SOURCE, ...VENV])).toBeNull();
    expect(detectTestPlan([...SOURCE, 'backend/test_main.py'])?.framework).toBe('pytest');
    expect(suitePresentButRunnerMissing(['node_modules/x/vitest.config.ts'], '{}')).toBeNull();
  });

  it('every former copy reads the ONE list', () => {
    expect(NESTED_REPO_PRUNE_DIRS).toEqual(LIST_PRUNE_DIRS.filter((d) => d !== '.git'));
    for (const d of LIST_PRUNE_DIRS) expect(ARCHIVE_EXCLUDES).toContain(`${d}/`);
    for (const d of NEVER_SOURCE_DIRS) expect(LIST_PRUNE_DIRS).toContain(d);
    for (const file of [
      'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts',
      'src/server/AgentV3/sandbox/EngineerAI/actuators/LocalActuator.ts',
      'src/server/AgentV3/sandbox/EngineerAI/actuators/DockerActuator.ts',
      'src/server/AgentV3/GitManager.ts',
      'src/server/AgentV3/ToolDispatcher.ts',
      'src/server/AgentV3/ProjectContext.ts',
      'src/server/AgentV3/nestedRepoProbe.ts',
      'src/server/AgentV3/sourceArchive.ts',
    ]) {
      const src = read(file);
      expect(src, file).toMatch(/from '(?:\.\.\/)+lib\/generatedDirs'/);
      // The hand-written arrays that drifted: none may come back.
      expect(src, file).not.toMatch(/'__pycache__',\s*'\.venv'/);
    }
  });
});

const ROUTER_APP = `import Home from './pages/Home';
import NewNovel from './pages/NewNovel';
import Workspace from './pages/Workspace';
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<NewNovel />} />
      <Route path="/workspace/:novelId" element={<Workspace />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}`;
const NEW_NOVEL_FORM = `export default function NewNovel() {
  return (
    <form onSubmit={save}>
      <label htmlFor="name">Name</label>
      <input id="name" name="name" placeholder="Novel name" />
      <button type="submit">Create</button>
    </form>
  );
}`;

describe("2 · a journey starts where the app's own router puts the form", () => {
  const files = {
    'src/App.tsx': ROUTER_APP,
    'src/pages/Home.tsx': 'export default function Home() { return <h1>Home</h1>; }',
    'src/pages/NewNovel.tsx': NEW_NOVEL_FORM,
    'src/pages/Workspace.tsx': 'export default function Workspace() { return <div />; }',
  };

  it('🔴 the report: NewNovel is served at /new, not /', () => {
    expect(routeFromRouter('src/pages/NewNovel.tsx', files)).toBe('/new');
    // The old filename guess, with the report's routes, sent it home.
    expect(routeForFile('src/pages/NewNovel.tsx', ['/', '/new', '/workspace/:novelId'])).toBe('/');
    expect(routeForFile('src/pages/NewNovel.tsx', ['/', '/new', '/workspace/:novelId'], files)).toBe('/new');
    const journeys = deriveJourneys({ files, marker: 'nbai-m', routes: ['/', '/new'] });
    expect(journeys.find((j) => j.fields.length > 0)?.route).toBe('/new');
  });

  it('reads aliased, named, lazy and object-style routes', () => {
    const page = 'src/pages/NewNovel.tsx';
    const base = { [page]: NEW_NOVEL_FORM };
    const cases: Array<[string, string]> = [
      ["import Create from './pages/NewNovel';\n<Route element={<Create />} path='/create' />", '/create'],
      ["import { NewNovel as NN } from './pages/NewNovel';\n<Route path={'/write'} element={<NN />} />", '/write'],
      ["const Lazy = lazy(() => import('./pages/NewNovel'));\n<Route path=\"/lazy\" element={<Lazy />} />", '/lazy'],
      ["import NewNovel from './pages/NewNovel';\nconst router = createBrowserRouter([{ path: '/obj', element: <NewNovel /> }]);", '/obj'],
      ["import NewNovel from './pages/NewNovel';\n<Route path=\"/c\" Component={NewNovel} />", '/c'],
    ];
    for (const [app, want] of cases) {
      expect(routeFromRouter(page, { ...base, 'src/App.tsx': app }), app).toBe(want);
    }
  });

  it('a relative (nested) child path is not guessed, and neighbouring routes never bleed', () => {
    const page = 'src/pages/NewNovel.tsx';
    const nested = "import NewNovel from './pages/NewNovel';\n<Route path=\"/app\" element={<Layout />}><Route path=\"new\" element={<NewNovel />} /></Route>";
    expect(routeFromRouter(page, { [page]: NEW_NOVEL_FORM, 'src/App.tsx': nested })).toBeNull();
    // Home's path must not be attributed to the page declared after it.
    expect(routeFromRouter('src/pages/Home.tsx', files)).toBe('/');
    expect(routeFromRouter('src/pages/Workspace.tsx', files)).toBe('/workspace/:novelId');
  });
});

import {
  classifySmokeStatus, summarizeSmoke, parseCurlStatus, parseFrontendShell, planSmokeChecks, smokeCurlCommand,
} from '../src/server/AgentV3/RouteSmokeCheck';

describe("3 · a 200 from the frontend's page is not the API answering", () => {
  it('🔴 the report: /health "PASS" was the Vite dev server serving index.html', () => {
    expect(parseCurlStatus('200 NBAI_FRONTEND_SHELL')).toBe(200);
    expect(parseFrontendShell('200 NBAI_FRONTEND_SHELL')).toBe(true);
    expect(parseFrontendShell('200')).toBe(false);
    const r = classifySmokeStatus('/health', 200, { frontendShell: true });
    expect(r.verdict).toBe('unverified');
    const s = summarizeSmoke([r, classifySmokeStatus('/', 200, { frontendShell: true })], 8);
    expect(s.headline).not.toMatch(/checked and working/);
    expect(s.headline).toMatch(/No route could be checked/);
    expect(s.hasFailures).toBe(false);
  });

  it('a real API answer is unchanged, and a mix says which is which', () => {
    expect(classifySmokeStatus('/api/x', 200).verdict).toBe('pass');
    const s = summarizeSmoke([classifySmokeStatus('/api/x', 200), classifySmokeStatus('/health', 200, { frontendShell: true })]);
    expect(s.headline).toBe("1 route checked and working, 1 not checked (1 answered by the frontend's page instead of your API).");
  });

  it('the body is grepped for the marker and deleted — never printed', () => {
    const cmd = smokeCurlCommand('http://h', '/health');
    expect(cmd).toContain("grep -qsF '/@vite/client'");
    expect(cmd).toContain('rm -f "$f"');
    expect(cmd).not.toMatch(/cat\s/);
  });

  it('each skipped route is listed once, however many times the extractor saw it', () => {
    const main = 'app = FastAPI()\n@app.post("/v1/write")\ndef w(): pass\n@app.post("/v1/write")\ndef w2(): pass\n';
    const plan = planSmokeChecks([{ path: 'backend/main.py', content: main }]);
    expect(plan.skipped.filter((x) => x.path === '/v1/write')).toHaveLength(1);
  });
});

import { extractEndpoints } from '../src/server/AgentV3/apiGraph';

describe('4 · a FastAPI route is one route', () => {
  it('🔴 the report: @app.post("/v1/write") was extracted twice', () => {
    const main = 'app = FastAPI()\n@app.post("/v1/write")\ndef w(): pass\n@app.get("/health")\ndef h(): pass\n';
    expect(extractEndpoints([{ path: 'backend/main.py', content: main }])).toEqual([
      { method: 'POST', path: '/v1/write', file: 'backend/main.py' },
      { method: 'GET', path: '/health', file: 'backend/main.py' },
    ]);
  });

  it('an Express route is still found exactly once', () => {
    expect(extractEndpoints([{ path: 'server.js', content: "app.get('/api/x', h); router.post('/api/y', h);" }])).toHaveLength(2);
  });
});

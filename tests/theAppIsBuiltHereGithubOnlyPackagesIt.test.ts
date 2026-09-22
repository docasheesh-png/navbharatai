import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE APP IS BUILT HERE; GITHUB ONLY PACKAGES IT (admin 2026-09-22: *"toote hi na" wala banao*).
 *
 * The GitHub runner's `npm run build` was where most phone builds died — on an app that had already
 * built and rendered in its own sandbox. So the ship now runs the app's PRODUCTION build in that
 * sandbox, reads the output out, and pushes it as `www/` with the honest no-op build script: the
 * runner meets an app it cannot fail to compile, because it does not compile it.
 *
 * These cases lock the properties that keep this an optimisation with an honest fallback, never a
 * new way to be blocked — and the two places it deliberately IS strict.
 */

const state: { durable: Record<string, string>; gh: Array<{ method: string; url: string; body?: unknown }>; tree: Array<{ path: string; type: string }>; truncated: boolean } = {
  durable: {},
  gh: [],
  tree: [],
  truncated: false,
};

vi.mock('../src/server/AgentV3/WorkspaceFileStore', () => ({
  loadWorkspaceFiles: async () => ({ ...state.durable }),
  mergeWorkspaceFiles: async () => undefined,
}));

vi.mock('axios', () => ({
  default: {
    get: async (url: string) => {
      state.gh.push({ method: 'GET', url });
      if (/\/git\/ref\/heads\//.test(url)) return { data: { object: { sha: 'parent-sha' } } };
      if (/\/git\/trees\/[^?]+\?recursive=1$/.test(url)) return { data: { tree: state.tree, truncated: state.truncated } };
      throw Object.assign(new Error('404'), { response: { status: 404 } });
    },
    post: async (url: string, body: unknown) => {
      state.gh.push({ method: 'POST', url, body });
      if (/\/git\/blobs$/.test(url)) return { data: { sha: 'blob-sha' } };
      if (/\/git\/trees$/.test(url)) return { data: { sha: 'tree-sha' } };
      if (/\/git\/commits$/.test(url)) return { data: { sha: 'commit-sha' } };
      throw Object.assign(new Error('404'), { response: { status: 404 } });
    },
    patch: async (url: string, body: unknown) => { state.gh.push({ method: 'PATCH', url, body }); return { data: {} }; },
  },
}));

const {
  prebuildForShip, prebuiltShipEnabled, prebuiltBudgetMs, splitBuiltOutput, prebuiltStamp, declaresVite,
  capacitorPluginScanCommand, parseCapacitorPluginScan, clearOutputDirsCommand,
  PREBUILT_MAX_FILES, PREBUILT_INLINE_TEXT_MAX,
} = await import('../src/server/lib/mobileShipPrebuilt');
type PrebuiltActuator = import('../src/server/lib/mobileShipPrebuilt').PrebuiltActuator;
const {
  assembleMobileProject, prebuiltPackageJson, detectRepoLayout, workspacePathForRepoPath, detectProjectKind,
  STATIC_NO_OP_BUILD, PREBUILT_STAMP_PATH,
} = await import('../src/server/lib/mobileProjectAssembler');
const { makeRepairVerifier } = await import('../src/server/lib/mobileShipRealBuild');
const { isAppSourcePath } = await import('../src/server/lib/mobileBuildAiRepair');
const { commitFiles, listRepoPathsUnder } = await import('../src/server/lib/githubRepoWrite');
const { summariseBuildOutcomes, recordShip } = await import('../src/server/lib/mobileBuildOutcomeStore');
const { generateShipKit } = await import('../src/server/lib/mobileShipKit');
const { friendlyBuildStep } = await import('../src/server/lib/mobileBuildReport');

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VITE_PKG = JSON.stringify({
  name: 'chai', scripts: { build: 'tsc && vite build', prepare: 'husky' },
  dependencies: { react: '^18', '@capacitor/camera': '^7', 'capacitor-plugin-safe-area': '^3' },
  devDependencies: { vite: '^5', typescript: '^5', husky: '^9' },
});
const VITE_APP: Record<string, string> = {
  'package.json': VITE_PKG,
  'index.html': '<div id="root"></div>',
  'src/main.tsx': 'export {}',
  'vite.config.ts': "export default { build: { outDir: 'dist' } }",
};
const DIST = (): Map<string, Buffer> => new Map<string, Buffer>([
  ['index.html', Buffer.from('<html><body>built</body></html>')],
  ['assets/index-abc123.js', Buffer.from('console.log(1)')],
  ['assets/logo-def456.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
]);

interface Machine extends PrebuiltActuator {
  files: Record<string, string>;
  commands: string[];
  writes: string[];
  active: boolean[];
  builds: number;
}

function machine(over: {
  files?: Record<string, string>;
  dist?: Map<string, Buffer> | (() => Promise<Map<string, Buffer>>);
  build?: { success: boolean; logs: string } | (() => Promise<{ success: boolean; logs: string }>);
  vite?: { exitCode: number; stdout: string; stderr: string };
  plugins?: string | null;
  sandboxBacked?: boolean;
} = {}): Machine {
  const m: Machine = {
    files: { ...(over.files ?? VITE_APP) },
    commands: [],
    writes: [],
    active: [],
    builds: 0,
    readFile: async (_w, p) => { if (!(p in m.files)) throw new Error(`no ${p}`); return m.files[p]; },
    writeFile: async (_w, p, c) => { m.writes.push(p); m.files[p] = c; },
    listFiles: async () => Object.keys(m.files),
    build: async () => {
      m.builds += 1;
      if (typeof over.build === 'function') return over.build();
      return over.build ?? { success: true, logs: 'vite v5 building for production… ✓ built in 1.2s' };
    },
    runCommand: async (_w, cmd) => {
      m.commands.push(cmd);
      if (cmd === 'npx vite build') return over.vite ?? { exitCode: 0, stdout: '✓ built', stderr: '' };
      if (cmd.includes('NBAI_CAP_PLUGINS')) {
        return over.plugins === null
          ? { exitCode: 1, stdout: '', stderr: 'node: not found' }
          : { exitCode: 0, stdout: `${over.plugins ?? 'NBAI_CAP_PLUGINS ["@capacitor/camera","capacitor-plugin-safe-area"]'}\n`, stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    downloadDistFiles: async () => (typeof over.dist === 'function' ? over.dist() : (over.dist ?? DIST())),
    setBuildActive: (_w, active) => { m.active.push(active); },
  };
  if (over.sandboxBacked !== false) m.hasLiveSandbox = () => false; // present; the answer is not consulted
  return m;
}

const ENV_KEYS = ['MOBILE_SHIP_PREBUILT', 'MOBILE_SHIP_PREBUILT_MS'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  state.durable = {};
  state.gh = [];
  state.tree = [];
  state.truncated = false;
});

describe('the flag and the budget', () => {
  it('is ON unless switched off; `off` is the whole revert', () => {
    delete process.env.MOBILE_SHIP_PREBUILT;
    expect(prebuiltShipEnabled()).toBe(true);
    process.env.MOBILE_SHIP_PREBUILT = 'off';
    expect(prebuiltShipEnabled()).toBe(false);
  });

  it('a malformed budget takes the default, never "no limit"; the floor and cap hold', () => {
    delete process.env.MOBILE_SHIP_PREBUILT_MS;
    expect(prebuiltBudgetMs()).toBe(240_000);
    process.env.MOBILE_SHIP_PREBUILT_MS = 'lots';
    expect(prebuiltBudgetMs()).toBe(240_000);
    process.env.MOBILE_SHIP_PREBUILT_MS = '5000';
    expect(prebuiltBudgetMs()).toBe(240_000);
    process.env.MOBILE_SHIP_PREBUILT_MS = '9999999';
    expect(prebuiltBudgetMs()).toBe(600_000);
  });

  it('off ⇒ a skip that never touched the machine', async () => {
    process.env.MOBILE_SHIP_PREBUILT = 'off';
    const m = machine();
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out).toEqual({ kind: 'skip', reason: 'flag-off', buildRan: false });
    expect(m.builds).toBe(0);
  });
});

describe('the happy path — built here, read out, handed to the assembler', () => {
  it('builds, clears stale output FIRST, reads the output, scans the plugins, and returns the built app', async () => {
    const m = machine();
    const out = await prebuildForShip(m, 'ws', VITE_APP, { 'src/main.tsx': 'export const healed = 1' });
    expect(out.kind).toBe('built');
    if (out.kind !== 'built') return;
    expect(out.fileCount).toBe(3);
    expect(out.outputDir).toBe('dist');
    expect(Object.keys(out.prebuilt.files)).toEqual(['index.html', 'assets/index-abc123.js']);
    expect(Object.keys(out.prebuilt.binaryFiles)).toEqual(['assets/logo-def456.png']);
    expect(out.prebuilt.pluginDeps).toEqual(['@capacitor/camera', 'capacitor-plugin-safe-area']);
    expect(out.prebuilt.stamp).toContain('output-dir: dist');
    // The heal reached the machine before the build, and the output dirs were cleared before it too.
    expect(m.writes).toEqual(['src/main.tsx']);
    const rmAt = m.commands.findIndex((c) => c.startsWith('rm -rf '));
    expect(rmAt).toBe(0);
    expect(m.commands[0]).toContain("'dist'");
    expect(m.builds).toBe(1);
    // The idle sweep was told a build was in flight, and told again when it was not.
    expect(m.active).toEqual([true, false]);
  });

  it('a machine that did not answer the plugin scan ⇒ pluginDeps null (nothing will be trimmed)', async () => {
    const m = machine({ plugins: null });
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('built');
    if (out.kind === 'built') expect(out.prebuilt.pluginDeps).toBeNull();
  });

  it('an EMPTY machine is seeded from the durable store first, then built — the case the check never covered', async () => {
    state.durable = { ...VITE_APP };
    const m = machine({ files: {} });
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('built');
    expect(m.writes).toContain('package.json');
    expect(m.builds).toBe(1);
  });
});

describe('every stand-down is a skip to the source ship — and says whether a build was STARTED', () => {
  it('a static app has nothing to build', async () => {
    const m = machine({ files: { 'index.html': '<p>hi</p>' } });
    expect(await prebuildForShip(m, 'ws', { 'index.html': '<p>hi</p>' })).toEqual({ kind: 'skip', reason: 'static-app', buildRan: false });
    expect(m.builds).toBe(0);
  });

  it('🔒 an actuator with no `hasLiveSandbox` is not sandbox-backed: nothing is woken, seeded or built on disk', async () => {
    // The local actuator (tests, dev) lists an empty directory as an empty workspace and would seed
    // and build INSIDE THE TEST PROCESS. Presence of the method is the signal; its answer is not.
    const m = machine({ sandboxBacked: false });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toEqual({ kind: 'skip', reason: 'no-sandbox', buildRan: false });
    expect(m.builds).toBe(0);
    expect(m.writes).toEqual([]);
  });

  it('a machine that still holds no app after seeding ⇒ no-sandbox, no build', async () => {
    state.durable = {};
    const m = machine({ files: {} });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toEqual({ kind: 'skip', reason: 'no-sandbox', buildRan: false });
    expect(m.builds).toBe(0);
  });

  it('a build that runs past the budget ⇒ timed-out, buildRan TRUE (the caller must not start a second one)', async () => {
    // The clock never races a call at less than a second (a near-spent budget still gets one), so the
    // build here takes longer than that floor.
    const m = machine({ build: () => new Promise((r) => setTimeout(() => r({ success: true, logs: '' }), 1_300)) });
    const out = await prebuildForShip(m, 'ws', VITE_APP, {}, 30);
    expect(out).toMatchObject({ kind: 'skip', reason: 'timed-out', buildRan: true });
    expect(m.active[m.active.length - 1]).toBe(false);
  });

  it('a successful build whose output cannot be read ⇒ no-output, buildRan true', async () => {
    const m = machine({ dist: async () => { throw new Error('No build output found'); } });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'no-output', buildRan: true });
  });

  it('an output with no index.html at its ROOT is not shippable as it is ⇒ no-output (the source ship still is)', async () => {
    const nested = new Map<string, Buffer>([['app/index.html', Buffer.from('<p/>')], ['app/main.js', Buffer.from('1')]]);
    const m = machine({ dist: nested });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'no-output', buildRan: true });
  });

  it('too many files, or too many bytes ⇒ too-large', async () => {
    const many = new Map<string, Buffer>();
    for (let i = 0; i <= PREBUILT_MAX_FILES; i++) many.set(`f${i}.txt`, Buffer.from('x'));
    expect(await prebuildForShip(machine({ dist: many }), 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'too-large', buildRan: true });
  });
});

describe('the ONE strict outcome — the app did not compile here, and the runner would fail too', () => {
  it('a real compile error ⇒ refuse, with the class and the log', async () => {
    const m = machine({ build: { success: false, logs: 'src/App.tsx:3:1: error: Unexpected token\n[vite] build failed' } });
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('refuse');
    if (out.kind === 'refuse') {
      expect(out.code).toBeTruthy();
      expect(out.log).toContain('Unexpected token');
    }
  });

  it('a TYPE-ONLY failure on a Vite app is rescued exactly as the runner rescues it — `npx vite build` — and ships', async () => {
    const m = machine({ build: { success: false, logs: 'src/App.tsx(3,1): error TS2322: Type string is not assignable to number.' } });
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('built');
    expect(m.commands).toContain('npx vite build');
  });

  it('…and when even the bundler fails, that is a refusal too', async () => {
    const m = machine({
      build: { success: false, logs: 'src/App.tsx(3,1): error TS2322: Type string is not assignable to number.' },
      vite: { exitCode: 1, stdout: '', stderr: 'error during build: Could not resolve "./Missing"' },
    });
    expect((await prebuildForShip(m, 'ws', VITE_APP)).kind).toBe('refuse');
  });

  it('a type-only failure with NO Vite to rescue with is not a refusal: the source ship carries it (buildRan true)', async () => {
    const files = { ...VITE_APP, 'package.json': JSON.stringify({ scripts: { build: 'tsc' }, devDependencies: { typescript: '^5' } }) };
    const m = machine({ files, build: { success: false, logs: 'src/a.ts(1,1): error TS2322: nope' } });
    expect(await prebuildForShip(m, 'ws', files)).toMatchObject({ kind: 'skip', reason: 'unavailable', buildRan: true });
    expect(declaresVite(files)).toBe(false);
  });
});

describe('the pure helpers', () => {
  it('splitBuiltOutput: binaries go as base64, a LARGE text file goes as a blob too, sizes are summed', () => {
    const big = Buffer.alloc(PREBUILT_INLINE_TEXT_MAX + 1, 'a');
    const dist = new Map<string, Buffer>([
      ['./index.html', Buffer.from('<p/>')],
      ['assets/big-1234.js', big],
      ['assets/x.woff2', Buffer.from([1, 2, 3])],
      ['../escape.html', Buffer.from('no')],
    ]);
    const out = splitBuiltOutput(dist);
    expect(Object.keys(out.files)).toEqual(['index.html']);
    expect(Object.keys(out.binaryFiles).sort()).toEqual(['assets/big-1234.js', 'assets/x.woff2']);
    expect(out.binaryFiles['assets/x.woff2']).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(out.bytes).toBe(4 + big.length + 3);
  });

  it('the stamp names WHAT was built and never who built it', () => {
    const stamp = prebuiltStamp(VITE_APP, 'dist', 3, Date.UTC(2026, 8, 22));
    expect(stamp).toContain('built-from: ');
    expect(stamp).toContain('files: 3');
    expect(stamp).toContain('built-at: 2026-09-22T00:00:00.000Z');
    for (const vendor of ['E2B', 'GLM', 'Kimi', 'Claude', 'sandbox']) expect(stamp.toLowerCase()).not.toContain(vendor.toLowerCase());
  });

  it('the plugin scan reads the answer only from its own marker line, and drops anything that is not a package name', () => {
    expect(parseCapacitorPluginScan('npm WARN x\nNBAI_CAP_PLUGINS ["@capacitor/camera","evil;rm -rf /","ok-plugin"]\n'))
      .toEqual(['@capacitor/camera', 'ok-plugin']);
    expect(parseCapacitorPluginScan('nothing here')).toBeNull();
    expect(parseCapacitorPluginScan('NBAI_CAP_PLUGINS {"not":"a list"}')).toBeNull();
    // The command reads node_modules — the authoritative source — and asks for the `capacitor` field.
    const cmd = capacitorPluginScanCommand();
    expect(cmd.startsWith('node -e ')).toBe(true);
    expect(cmd).toContain('m.capacitor');
    expect(cmd).toContain('node_modules/');
  });

  it('🔒 the output dirs are cleared with QUOTED names — one of them comes from the user\'s own vite config', () => {
    const files = { ...VITE_APP, 'vite.config.ts': "export default { build: { outDir: '$(touch pwned)' } }" };
    const cmd = clearOutputDirsCommand(files);
    expect(cmd.startsWith('rm -rf ')).toBe(true);
    expect(cmd).toContain("'$(touch pwned)'");
    expect(cmd).not.toMatch(/(^|\s)\$\(touch pwned\)/);
    expect(cmd).toContain("'dist'");
  });
});

describe('the assembler ships the build as a STATIC repository — every static-path mechanism applies by construction', () => {
  const kit = () => generateShipKit({ appName: 'Chai', ios: false }).files;
  const prebuilt = () => ({
    files: { 'index.html': '<html>built</html>', 'assets/index-abc.js': 'x' },
    binaryFiles: { 'assets/logo.png': Buffer.from([1]).toString('base64') },
    stamp: 'stamp',
    pluginDeps: ['@capacitor/camera'],
  });

  it('source at its own paths, the build under www/, the stamp, kind static, webDir www, and the sentinel build script', () => {
    const p = assembleMobileProject(VITE_APP, kit(), { appName: 'Chai', appId: 'com.chai.app', prebuilt: prebuilt() });
    expect(p.prebuilt).toBe(true);
    expect(p.kind).toBe('static');
    expect(p.webDir).toBe('www');
    expect(p.files['src/main.tsx']).toBe('export {}');
    expect(p.files['www/index.html']).toBe('<html>built</html>');
    expect(p.files['www/assets/index-abc.js']).toBe('x');
    expect(p.files[PREBUILT_STAMP_PATH]).toBe('stamp');
    expect(p.binaryFiles['www/assets/logo.png']).toBeTruthy();
    expect(p.files['capacitor.config.ts']).toContain("webDir: 'www'");
    const pkg = JSON.parse(p.files['package.json']);
    expect(pkg.scripts).toEqual({ build: STATIC_NO_OP_BUILD });
    // Every existing static-path detector agrees — the pipeline sees a static app.
    expect(detectProjectKind({ 'package.json': p.files['package.json'] })).toBe('static');
    expect(p.notes.join(' ')).toContain('GitHub does not compile it again');
  });

  it('the runner installs ONLY Capacitor and the plugins the machine named; lifecycle scripts are gone', () => {
    const p = assembleMobileProject(VITE_APP, kit(), { appName: 'Chai', appId: 'com.chai.app', prebuilt: prebuilt() });
    const pkg = JSON.parse(p.files['package.json']);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@capacitor/android', '@capacitor/camera', '@capacitor/core']);
    expect(Object.keys(pkg.devDependencies)).toEqual(['@capacitor/cli']);
    expect(pkg.scripts.prepare).toBeUndefined(); // "prepare": "husky" would run on an install with no husky
  });

  it('🔒 pluginDeps null ⇒ NOTHING is trimmed (a plugin left out dies on the phone; a dependency left in only costs an install)', () => {
    const p = assembleMobileProject(VITE_APP, kit(), { appName: 'Chai', appId: 'com.chai.app', prebuilt: { ...prebuilt(), pluginDeps: null } });
    const pkg = JSON.parse(p.files['package.json']);
    expect(pkg.dependencies.react).toBe('^18');
    expect(pkg.dependencies['capacitor-plugin-safe-area']).toBe('^3');
    expect(pkg.devDependencies.vite).toBe('^5');
    expect(pkg.scripts.build).toBe(STATIC_NO_OP_BUILD);
  });

  it('prebuiltPackageJson keeps a plugin declared under devDependencies, and hands back unparseable input untouched', () => {
    const assembled = JSON.stringify({ dependencies: { '@capacitor/core': '^7' }, devDependencies: { '@capacitor/cli': '^7', 'capacitor-plugin-x': '^1' }, scripts: { build: STATIC_NO_OP_BUILD, test: 'vitest' } });
    const pkg = JSON.parse(prebuiltPackageJson(assembled, ['capacitor-plugin-x']));
    expect(pkg.dependencies['capacitor-plugin-x']).toBe('^1');
    expect(pkg.scripts).toEqual({ build: STATIC_NO_OP_BUILD });
    expect(prebuiltPackageJson('not json', ['x'])).toBe('not json');
  });

  it('a prebuilt for an app that is static anyway is ignored — nothing to build means nothing was built', () => {
    const p = assembleMobileProject({ 'index.html': '<p/>' }, kit(), { appName: 'Chai', appId: 'com.chai.app', prebuilt: prebuilt() });
    expect(p.prebuilt).toBe(false);
    expect(p.files[PREBUILT_STAMP_PATH]).toBeUndefined();
    expect(p.files['www/index.html']).toBe('<p/>');
  });
});

describe('a repository path is not a workspace path — the map the repair loop needed all along', () => {
  it('reads the layout from the stamp and the sentinel', () => {
    expect(detectRepoLayout({ [PREBUILT_STAMP_PATH]: 'stamp', 'package.json': '{}' })).toBe('prebuilt');
    expect(detectRepoLayout({ 'package.json': JSON.stringify({ scripts: { build: STATIC_NO_OP_BUILD } }) })).toBe('static');
    expect(detectRepoLayout({ 'package.json': JSON.stringify({ scripts: { build: 'vite build' } }) })).toBe('built');
    expect(detectRepoLayout({})).toBe('built');
  });

  it('built: identity · static: www/ is the root · prebuilt: www/ lives nowhere in the workspace', () => {
    expect(workspacePathForRepoPath('src/App.tsx', 'built')).toBe('src/App.tsx');
    expect(workspacePathForRepoPath('www/index.html', 'built')).toBe('www/index.html');
    expect(workspacePathForRepoPath('www/index.html', 'static')).toBe('index.html');
    expect(workspacePathForRepoPath('www/css/app.css', 'static')).toBe('css/app.css');
    expect(workspacePathForRepoPath('www/assets/index-abc.js', 'prebuilt')).toBeNull();
    expect(workspacePathForRepoPath('src/App.tsx', 'prebuilt')).toBe('src/App.tsx');
    expect(workspacePathForRepoPath(PREBUILT_STAMP_PATH, 'prebuilt')).toBeNull();
    expect(workspacePathForRepoPath('../x', 'built')).toBeNull();
  });

  it('the verifier writes the candidate at its WORKSPACE path — a static app\'s www/index.html is finally testable', async () => {
    const writes: string[] = [];
    const sandbox = {
      hasLiveSandbox: () => true,
      readFile: async (_w: string, p: string) => { if (p === 'package.json') return '{"scripts":{"build":"vite build"}}'; if (p === 'index.html') return '<old/>'; throw new Error('no'); },
      writeFile: async (_w: string, p: string) => { writes.push(p); },
      build: async () => ({ success: true, logs: 'ok' }),
    };
    const verify = makeRepairVerifier(sandbox, 'ws', { stage: 'webbuild', code: 'APP_CODE_BUILD_FAILED' }, isAppSourcePath, (p) => workspacePathForRepoPath(p, 'static'));
    expect(verify).toBeTruthy();
    const verdict = await verify!({ 'www/index.html': '<new/>', 'www/.nbai-prebuilt': 'x' });
    expect(verdict).toEqual({ ran: true, ok: true });
    expect(writes).toEqual(['index.html']); // written at the workspace path, kept on success (app source)
  });

  it('…and a prebuilt bundle edit has nothing to test, so it is never called verified', async () => {
    const sandbox = {
      hasLiveSandbox: () => true,
      readFile: async (_w: string, p: string) => { if (p === 'package.json') return '{"scripts":{"build":"vite build"}}'; throw new Error('no'); },
      writeFile: async () => undefined,
      build: async () => ({ success: true, logs: 'ok' }),
    };
    const verify = makeRepairVerifier(sandbox, 'ws', { stage: 'webbuild', code: 'APP_CODE_BUILD_FAILED' }, isAppSourcePath, (p) => workspacePathForRepoPath(p, 'prebuilt'));
    expect(await verify!({ 'www/assets/index-abc.js': 'patched' })).toEqual({ ran: false, reason: 'nothing-to-test' });
  });

  it('app source is everything that is not packaging — a root index.html or vite.config.ts is the app too', () => {
    expect(isAppSourcePath('index.html')).toBe(true);
    expect(isAppSourcePath('vite.config.ts')).toBe(true);
    expect(isAppSourcePath('src/App.tsx')).toBe(true);
    for (const repoOnly of ['package.json', 'capacitor.config.ts', '.github/workflows/android-apk.yml', 'android/app/build.gradle', PREBUILT_STAMP_PATH, 'dist/index.html', 'node_modules/x/index.js', '.gitignore']) {
      expect(isAppSourcePath(repoOnly), repoOnly).toBe(false);
    }
    expect(isAppSourcePath('src/../.env')).toBe(false);
    expect(isAppSourcePath('release.keystore')).toBe(false);
  });
});

describe('www/ is OWNED by the push — what an earlier push left there and this one does not carry is removed', () => {
  const headers = { Authorization: 'token t' } as never;

  it('commitFiles adds a `sha: null` entry per removed path, never for a path the push still carries', async () => {
    await commitFiles(headers, 'ravi', 'chai', 'main', { 'www/index.html': '<p/>' }, { 'www/a.png': 'AA==' }, 'msg', ['www/old-abc.js', 'www/index.html', 'www/a.png', '']);
    const treePost = state.gh.find((c) => c.method === 'POST' && /\/git\/trees$/.test(c.url))!.body as { tree: Array<Record<string, unknown>> };
    const removed = treePost.tree.filter((t) => t.sha === null).map((t) => t.path);
    expect(removed).toEqual(['www/old-abc.js']);
    expect(treePost.tree.find((t) => t.path === 'www/index.html')).toMatchObject({ content: '<p/>' });
  });

  it('listRepoPathsUnder lists the WHOLE subtree, and answers null (remove nothing) when the tree is unreadable or truncated', async () => {
    state.tree = [
      { path: 'www/index.html', type: 'blob' }, { path: 'www/assets/old.js', type: 'blob' },
      { path: 'www', type: 'tree' }, { path: 'src/App.tsx', type: 'blob' }, { path: 'wwwx/nope', type: 'blob' },
    ];
    expect(await listRepoPathsUnder(headers, 'ravi', 'chai', 'main', 'www')).toEqual(['www/index.html', 'www/assets/old.js']);
    state.truncated = true;
    expect(await listRepoPathsUnder(headers, 'ravi', 'chai', 'main', 'www')).toBeNull();
    expect(await listRepoPathsUnder(headers, 'ravi', 'chai', 'main', '')).toBeNull();
  });
});

describe('the number that says whether the runner still compiles apps at all', () => {
  it('summarises ships and the stand-down reasons, commonest first, and is pure', () => {
    const rows = [
      { day: '2026-09-22', outcomes: {}, codes: {}, ships: { prebuilt: 3, source: 2 }, prebuildSkips: { 'no-sandbox': 1, 'timed-out': 1 } },
      { day: '2026-09-21', outcomes: {}, codes: {}, ships: { prebuilt: 1 }, prebuildSkips: { 'timed-out': 2 } },
      { day: '2026-09-20', outcomes: {}, codes: {} },
    ];
    const s = summariseBuildOutcomes(rows);
    expect(s.ships).toEqual({ prebuilt: 4, source: 2 });
    expect(s.prebuildSkips).toEqual([{ reason: 'timed-out', count: 3 }, { reason: 'no-sandbox', count: 1 }]);
    expect(summariseBuildOutcomes(rows)).toEqual(s);
    expect(summariseBuildOutcomes([]).ships).toEqual({ prebuilt: 0, source: 0 });
  });

  it('🔒 telemetry never blocks the ship — with no store it answers false rather than throwing', async () => {
    expect(await recordShip('prebuilt', 'no-sandbox')).toBe(false);
  });
});

describe('the workflows cache what they download, so a retry after a repair does not pay for the first run again', () => {
  const kit = () => generateShipKit({ appName: 'Chai', ios: true }).files;

  it('every workflow restores the npm cache before installing and saves it after; the Android ones cache Gradle too', () => {
    const wfs = Object.entries(kit()).filter(([p]) => p.startsWith('.github/workflows/'));
    expect(wfs.length).toBe(3);
    for (const [path, wf] of wfs) {
      expect(wf, path).toContain('- name: Restore the library cache');
      expect(wf, path).toContain('- name: Save the library cache');
      expect(wf, path).toContain("if: always() && steps.nbai-npm-cache.outputs.cache-hit != 'true'");
      // A cache is a speed-up: a cache-service problem must never fail a build that would have passed.
      const cacheSteps = wf.split(/\n(?=      - name: )/).filter((step) => /uses: actions\/cache\//.test(step));
      expect(cacheSteps.length, path).toBe(/android/.test(path) ? 4 : 2);
      for (const step of cacheSteps) expect(step, path).toContain('continue-on-error: true');
      expect(wf.indexOf('Restore the library cache'), path).toBeLessThan(wf.indexOf("Install the app's libraries"));
      // Keyed on package.json — the one manifest that IS pushed. NEVER setup-node's `cache: npm`,
      // which hard-fails without a lock file (the 2026-08-02 autopsy that this test file already pins).
      expect(wf, path).toContain("hashFiles('package.json')");
      expect(wf, path).not.toContain("cache: 'npm'");
      if (/android/.test(path)) {
        expect(wf, path).toContain('- name: Restore the Gradle cache');
        expect(wf, path).toContain('- name: Save the Gradle cache');
        expect(wf, path).toContain("if: always() && steps.nbai-gradle-cache.outputs.cache-hit != 'true'");
        expect(wf, path).toMatch(/nbai-gradle-\$\{\{ runner\.os \}\}-java\d+-/);
        expect(wf.indexOf('Restore the Gradle cache'), path).toBeLessThan(wf.indexOf('Generate and sync the Android project'));
      } else {
        expect(wf, path).not.toContain('Gradle cache');
      }
    }
  });

  it('a cache step is the runner\'s housekeeping — it never appears in the user\'s step list', () => {
    expect(friendlyBuildStep('Restore the library cache')).toBeNull();
    expect(friendlyBuildStep('Save the Gradle cache')).toBeNull();
  });
});

describe('the wiring — read out of the source, so a refactor cannot quietly undo it', () => {
  const setup = codeOnly(read('src/server/routes/mobileSetup.ts'));
  const autofix = codeOnly(read('src/server/routes/mobileShip.ts'));
  const panel = codeOnly(read('src/components/ide/StoreBuildPanel.tsx'));
  const prebuiltSrc = codeOnly(read('src/server/lib/mobileShipPrebuilt.ts'));
  const assembler = codeOnly(read('src/server/lib/mobileProjectAssembler.ts'));

  it('the setup route hands the built app to the assembler, records the ship, and answers `prebuilt`', () => {
    expect(setup).toContain("prebuilt: prebuild.kind === 'built' ? prebuild.prebuilt : undefined,");
    expect(setup).toContain("void recordShip(project.prebuilt ? 'prebuilt' : 'source', prebuild.kind === 'skip' ? prebuild.reason : null);");
    expect(setup).toContain('prebuilt: project.prebuilt,');
    // The missing-asset gate is the SOURCE ship's; the bundle already resolved every import.
    expect(setup).toContain('const missingAssets = project.prebuilt ? [] : findMissingImportedAssets(appFiles, Object.keys(appAssets));');
  });

  it('the setup route removes what an earlier push left under www/ — only on a repo that already existed', () => {
    expect(setup).toContain("((await listRepoPathsUnder(headers, owner, repoName, defaultBranch, 'www')) ?? []).filter((p) => !shipped.has(p))");
    expect(setup).toMatch(/const stale = created\s*\?\s*\[\]/);
    expect(setup.indexOf('const stale = created')).toBeLessThan(setup.indexOf('const sha = await commitFiles('));
  });

  it('🔒 reversion guards: the local-actuator guard, the stale-output clear, and the sentinel through the constant', () => {
    expect(prebuiltSrc).toContain("if (typeof actuator.hasLiveSandbox !== 'function') return skip('no-sandbox', false);");
    expect(prebuiltSrc).toContain('await actuator.runCommand(workspaceId, clearOutputDirsCommand(files)).catch(() => undefined);');
    expect(prebuiltSrc.indexOf('clearOutputDirsCommand(files)')).toBeLessThan(prebuiltSrc.indexOf('actuator.build(workspaceId)'));
    expect(assembler).toContain('pkg.scripts = { build: STATIC_NO_OP_BUILD };');
    expect(assembler).toContain('prebuiltPackageJson(buildPackageJson(');
  });

  it('the autofix route maps repository paths through the layout before the verifier and the workspace heal', () => {
    expect(autofix).toContain('const toWorkspace = (repoPath: string): string | null => workspacePathForRepoPath(repoPath, layout);');
    expect(autofix).toContain('await readRepoFiles(headers, String(owner), String(repo), ref, [PREBUILT_STAMP_PATH])');
  });

  it('the panel says which of the three happened, and no vendor is ever named', () => {
    expect(panel).toContain("' (your app was built here first — GitHub only packages it)'");
    expect(panel).toContain('prebuilt?: boolean;');
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Sonnet', 'Opus', 'Gemini', 'Grok', 'E2B']) {
      expect(panel).not.toMatch(new RegExp(`['"\`][^'"\`]*\\b${vendor}\\b[^'"\`]*['"\`]`));
    }
  });
});

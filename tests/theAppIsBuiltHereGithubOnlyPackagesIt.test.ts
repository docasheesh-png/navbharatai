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
  capacitorPluginScanCommand, parseCapacitorPluginScan, markStaleOutputCommand, outputIsStale,
  PREBUILT_MAX_FILES, PREBUILT_MAX_BYTES, PREBUILT_INLINE_TEXT_MAX, PREBUILT_INLINE_TOTAL_MAX, PREBUILT_MIN_BUILD_MS, STALE_MARKER,
} = await import('../src/server/lib/mobileShipPrebuilt');
type PrebuiltActuator = import('../src/server/lib/mobileShipPrebuilt').PrebuiltActuator;
const {
  assembleMobileProject, prebuiltPackageJson, detectRepoLayout, workspacePathForRepoPath, detectProjectKind,
  buildPackageJson, parseWwwManifest, STATIC_NO_OP_BUILD, PREBUILT_STAMP_PATH, WWW_MANIFEST_PATH, TYPESCRIPT_FOR_CONFIG,
} = await import('../src/server/lib/mobileProjectAssembler');
const { makeRepairVerifier, readRealBuildFailure } = await import('../src/server/lib/mobileShipRealBuild');
const { isAppSourcePath } = await import('../src/server/lib/mobileBuildAiRepair');
const { classifyBuildFailure, repairFiles, repairTypescriptForConfig } = await import('../src/server/lib/mobileBuildRepair');
const { commitFiles } = await import('../src/server/lib/githubRepoWrite');
const { latchGreen, clearGreenLatch } = await import('../src/server/AgentV3/greenFreeze');
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
  activeNow: boolean;
}

function machine(over: {
  files?: Record<string, string>;
  dist?: Map<string, Buffer> | (() => Promise<Map<string, Buffer>>);
  build?: { success: boolean; logs: string } | (() => Promise<{ success: boolean; logs: string }>);
  vite?: { exitCode: number; stdout: string; stderr: string };
  plugins?: string | null;
  sandboxBacked?: boolean;
  activeNow?: boolean;
  seedDelayMs?: number;
} = {}): Machine {
  const m: Machine = {
    files: { ...(over.files ?? VITE_APP) },
    commands: [],
    writes: [],
    active: [],
    builds: 0,
    activeNow: over.activeNow ?? false,
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
    setBuildActive: (_w, active) => { m.active.push(active); m.activeNow = active; },
    isBuildActive: () => m.activeNow,
  };
  if (over.seedDelayMs) {
    // A slow seed: listFiles is the seed's first call, so delaying it delays the whole seed.
    const list = m.listFiles;
    m.listFiles = async (w) => { await new Promise((r) => setTimeout(r, over.seedDelayMs)); return list(w); };
  }
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
  it('builds, marks the existing output dirs FIRST, reads the output, scans the plugins, and returns the built app', async () => {
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
    // The heal reached the machine before the build, and the stale marker was placed before it too —
    // and nothing was ever removed from the machine.
    expect(m.writes).toEqual(['src/main.tsx']);
    expect(m.commands[0]).toContain(`touch 'dist/${STALE_MARKER}'`);
    expect(m.commands[0].startsWith("if [ -d 'dist' ]")).toBe(true);
    expect(m.commands.some((c) => /\brm\b/.test(c))).toBe(false);
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

  it('a Next.js app with no static export builds a server — skipped BEFORE any machine is woken', async () => {
    const next = { 'package.json': JSON.stringify({ scripts: { build: 'next build' }, dependencies: { next: '^14' } }), 'app/page.tsx': 'export default () => null' };
    const m = machine({ files: next });
    expect(await prebuildForShip(m, 'ws', next)).toEqual({ kind: 'skip', reason: 'server-app', buildRan: false });
    expect(m.builds).toBe(0);
    expect(m.writes).toEqual([]);
    // …while a Next app that DOES export a static site still builds here.
    const exported = { ...next, 'next.config.js': "module.exports = { output: 'export' }" };
    expect((await prebuildForShip(machine({ files: exported }), 'ws', exported)).kind).not.toBe('skip');
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

  it('🔒 a seed that ran past the clock is NOT followed by a build on a half-seeded machine', async () => {
    // The seed keeps writing in the background; a build started now fails on a file that is not there
    // yet, and that failure would read as the app\'s own — a refusal with nothing behind it.
    state.durable = { ...VITE_APP };
    const m = machine({ files: {}, seedDelayMs: 1_300 });
    const out = await prebuildForShip(m, 'ws', VITE_APP, {}, 30);
    expect(out).toEqual({ kind: 'skip', reason: 'timed-out', buildRan: false });
    expect(m.builds).toBe(0);
  });

  it('🔒 another build of the same app in flight ⇒ build-in-flight, and its flag is never touched', async () => {
    const m = machine({ activeNow: true });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toEqual({ kind: 'skip', reason: 'build-in-flight', buildRan: false });
    expect(m.active).toEqual([]);
    expect(m.builds).toBe(0);
    // …and a Green Freeze latch is the same signal from the other side.
    latchGreen('ws-latched', ['src/main.tsx']);
    try {
      const n = machine();
      expect(await prebuildForShip(n, 'ws-latched', VITE_APP)).toEqual({ kind: 'skip', reason: 'build-in-flight', buildRan: false });
    } finally {
      clearGreenLatch('ws-latched');
    }
  });

  it('a build is not STARTED when less than the minimum remains on the clock — it could only be abandoned', async () => {
    const m = machine();
    // A budget under the floor is honoured by the floor (1 s), which is under PREBUILT_MIN_BUILD_MS.
    expect(PREBUILT_MIN_BUILD_MS).toBeGreaterThan(1_000);
    const out = await prebuildForShip(m, 'ws', VITE_APP, {}, 30);
    expect(out).toEqual({ kind: 'skip', reason: 'timed-out', buildRan: false });
    expect(m.builds).toBe(0);
  });

  it('an output that still carries the stale marker was NOT rewritten by this build ⇒ no-output, never shipped', async () => {
    const stale = DIST();
    stale.set(STALE_MARKER, Buffer.alloc(0));
    const m = machine({ dist: stale });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'no-output', buildRan: true });
    expect(outputIsStale(stale)).toBe(true);
    expect(outputIsStale(DIST())).toBe(false);
  });

  it('a build that runs past the budget ⇒ timed-out, buildRan TRUE (the caller must not start a second one)', async () => {
    // The clock never races a call at less than a second (a near-spent budget still gets one); the
    // minimum-remaining rule is lowered for this case so the build is STARTED and then outlives the clock.
    const m = machine({ build: () => new Promise((r) => setTimeout(() => r({ success: true, logs: '' }), 1_300)) });
    const out = await prebuildForShip(m, 'ws', VITE_APP, {}, 30, 0);
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

  it('too many files, or too many bytes ⇒ too-large (each cap exercised on its own)', async () => {
    const many = new Map<string, Buffer>();
    for (let i = 0; i <= PREBUILT_MAX_FILES; i++) many.set(`f${i}.txt`, Buffer.from('x'));
    expect(await prebuildForShip(machine({ dist: many }), 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'too-large', buildRan: true });
    const heavy = new Map<string, Buffer>([['index.html', Buffer.from('<p/>')], ['assets/huge.bin', Buffer.allocUnsafe(PREBUILT_MAX_BYTES)]]);
    expect(await prebuildForShip(machine({ dist: heavy }), 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'too-large', buildRan: true });
  });
});

describe('the ONE strict outcome — the app did not compile here, and the runner would fail too', () => {
  it('a real compile error ⇒ refuse, with the class and the log', async () => {
    const m = machine({ build: { success: false, logs: 'error during build:\nCould not resolve "./Missing" from "src/App.tsx"' } });
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('refuse');
    if (out.kind === 'refuse') {
      expect(out.code).toBe('APP_CODE_BUILD_FAILED');
      expect(out.log).toContain('Could not resolve');
    }
    expect(m.commands).not.toContain('npx vite build'); // the bundler rescue is for the TYPE-ONLY class alone
  });

  it('a TYPE-ONLY failure on a Vite app is rescued exactly as the runner rescues it — `npx vite build` — and ships', async () => {
    const m = machine({ build: { success: false, logs: 'src/App.tsx(3,1): error TS2322: Type string is not assignable to number.' } });
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('built');
    expect(m.commands).toContain('npx vite build');
  });

  it('…and when even the bundler fails on the app\'s own fault, that is a refusal too', async () => {
    const m = machine({
      build: { success: false, logs: 'src/App.tsx(3,1): error TS2322: Type string is not assignable to number.' },
      vite: { exitCode: 1, stdout: '', stderr: 'error during build: Could not resolve "./Missing"' },
    });
    expect((await prebuildForShip(m, 'ws', VITE_APP)).kind).toBe('refuse');
  });

  it('🔴 a failure the classifier cannot NAME is never a refusal — the runner gets to judge it (the review\'s catch)', async () => {
    // UNKNOWN, a machine killed mid-build, a registry blip: none of these is the app\'s own fault, and
    // the first draft turned every one into "your app did not compile". The source ship carries it.
    const m = machine({ build: { success: false, logs: 'Killed\nnpm error signal SIGKILL' } });
    expect(await prebuildForShip(m, 'ws', VITE_APP)).toMatchObject({ kind: 'skip', reason: 'unavailable', buildRan: true });
    expect(m.commands).not.toContain('npx vite build'); // not the type-only class ⇒ no rescue, no guess
    expect(readRealBuildFailure('Killed').blocking).toBe(false);
    expect(readRealBuildFailure('nonsense nobody can classify').code).toBe('UNKNOWN');
    expect(readRealBuildFailure('nonsense nobody can classify').blocking).toBe(false);
    expect(readRealBuildFailure('error during build:\nCould not resolve "./Missing" from "src/App.tsx"').blocking).toBe(true);
  });

  it('a type-only failure with NO Vite to rescue with is not a refusal: the source ship carries it (buildRan true)', async () => {
    const files = { ...VITE_APP, 'package.json': JSON.stringify({ scripts: { build: 'tsc' }, devDependencies: { typescript: '^5' } }) };
    const m = machine({ files, build: { success: false, logs: 'src/a.ts(1,1): error TS2322: nope' } });
    expect(await prebuildForShip(m, 'ws', files)).toMatchObject({ kind: 'skip', reason: 'unavailable', buildRan: true });
    expect(declaresVite(files)).toBe(false);
  });
});

describe('the pure helpers', () => {
  it('splitBuiltOutput: binaries go as base64, a LARGE text file goes as a blob too, the marker is never shipped, sizes are summed', () => {
    const big = Buffer.alloc(PREBUILT_INLINE_TEXT_MAX + 1, 'a');
    const dist = new Map<string, Buffer>([
      ['./index.html', Buffer.from('<p/>')],
      ['assets/big-1234.js', big],
      ['assets/x.woff2', Buffer.from([1, 2, 3])],
      ['../escape.html', Buffer.from('no')],
      [STALE_MARKER, Buffer.alloc(0)],
    ]);
    const out = splitBuiltOutput(dist);
    expect(Object.keys(out.files)).toEqual(['index.html']);
    expect(Object.keys(out.binaryFiles).sort()).toEqual(['assets/big-1234.js', 'assets/x.woff2']);
    expect(out.binaryFiles['assets/x.woff2']).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(out.bytes).toBe(4 + big.length + 3);
  });

  it('…and the inline text of a WHOLE ship is bounded: past the total, chunks go as blobs (one trees body, not 37 MB)', () => {
    const chunk = Buffer.alloc(PREBUILT_INLINE_TEXT_MAX - 1, 'b');
    const dist = new Map<string, Buffer>();
    const n = Math.ceil(PREBUILT_INLINE_TOTAL_MAX / chunk.length) + 3;
    for (let i = 0; i < n; i++) dist.set(`assets/c${i}.js`, chunk);
    const out = splitBuiltOutput(dist);
    const inlineBytes = Object.values(out.files).reduce((a, t) => a + Buffer.byteLength(t), 0);
    expect(inlineBytes).toBeLessThanOrEqual(PREBUILT_INLINE_TOTAL_MAX);
    expect(Object.keys(out.binaryFiles).length).toBeGreaterThan(0);
    expect(Object.keys(out.files).length + Object.keys(out.binaryFiles).length).toBe(n);
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

  it('🔒 the stale marker is placed with QUOTED names, only where a directory EXISTS, and removes nothing — one name comes from the user\'s own vite config', () => {
    const files = { ...VITE_APP, 'vite.config.ts': "export default { build: { outDir: '$(touch pwned)' } }" };
    const cmd = markStaleOutputCommand(files);
    expect(cmd).toContain("if [ -d '$(touch pwned)' ]; then touch '$(touch pwned)/.nbai-prebuild-stale'; fi");
    expect(cmd).not.toMatch(/(^|[\s;])\$\(touch pwned\)/);
    expect(cmd).toContain("if [ -d 'dist' ]");
    expect(cmd).not.toMatch(/\brm\b/);
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

  it('the runner installs ONLY Capacitor, TypeScript (for the .ts config) and the plugins the machine named; lifecycle scripts are gone', () => {
    const p = assembleMobileProject(VITE_APP, kit(), { appName: 'Chai', appId: 'com.chai.app', prebuilt: prebuilt() });
    const pkg = JSON.parse(p.files['package.json']);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@capacitor/android', '@capacitor/camera', '@capacitor/core']);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@capacitor/cli', 'typescript']);
    expect(pkg.devDependencies.typescript).toBe('^5'); // the app\'s own range, never overridden
    expect(pkg.scripts.prepare).toBeUndefined(); // "prepare": "husky" would run on an install with no husky
  });

  it('🔴 TypeScript is declared in EVERY pushed package.json — Capacitor\'s CLI reads capacitor.config.ts with it (the review\'s critical catch)', () => {
    // A hand-written static app has no TypeScript. `npx cap add android` then dies on the runner with
    // "Could not find installation of TypeScript" — before a single Gradle line, on every such ship.
    const staticPkg = JSON.parse(buildPackageJson(undefined, 'Chai', 'static'));
    expect(staticPkg.devDependencies.typescript).toBe(TYPESCRIPT_FOR_CONFIG);
    const builtPkg = JSON.parse(buildPackageJson(JSON.stringify({ devDependencies: { typescript: '~5.3' } }), 'Chai', 'built'));
    expect(builtPkg.devDependencies.typescript).toBe('~5.3');
    // The trimmed prebuilt package.json keeps it, and adds it when the app never had it.
    const noTs = JSON.stringify({ dependencies: { '@capacitor/core': '^7' }, devDependencies: { '@capacitor/cli': '^7' }, scripts: { build: STATIC_NO_OP_BUILD } });
    expect(JSON.parse(prebuiltPackageJson(noTs, [])).devDependencies.typescript).toBe(TYPESCRIPT_FOR_CONFIG);
    // …and an old repository that dies this way is classified and repaired by the rules tier.
    const diag = classifyBuildFailure('[error] Could not find installation of TypeScript.\nTo use capacitor.config.ts files, you must install TypeScript in your project', 'wf.yml');
    expect(diag.code).toBe('TYPESCRIPT_MISSING');
    expect(diag.autoFixable).toBe(true);
    const fix = repairFiles(diag, { 'package.json': JSON.stringify({ devDependencies: { '@capacitor/cli': '^7' } }) }, 'wf.yml');
    expect(fix && JSON.parse(fix.files['package.json']).devDependencies.typescript).toBe(TYPESCRIPT_FOR_CONFIG);
    expect(repairTypescriptForConfig(JSON.stringify({ devDependencies: { typescript: '^5' } }))).toBeNull(); // nothing to change ⇒ no commit
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok']) expect(diag.summary).not.toContain(vendor);
  });

  it('a Capacitor platform added with `npm i -D @capacitor/ios` survives the trim — moved to dependencies', () => {
    const assembled = JSON.stringify({ dependencies: { '@capacitor/core': '^7' }, devDependencies: { '@capacitor/cli': '^7', '@capacitor/ios': '^7', vite: '^5' }, scripts: { build: STATIC_NO_OP_BUILD } });
    const pkg = JSON.parse(prebuiltPackageJson(assembled, []));
    expect(pkg.dependencies['@capacitor/ios']).toBe('^7');
    expect(pkg.devDependencies['@capacitor/ios']).toBeUndefined();
    expect(pkg.devDependencies.vite).toBeUndefined();
  });

  it('every ship that writes www/ records what it wrote, so the next push can remove exactly that and nothing else', () => {
    const p = assembleMobileProject(VITE_APP, kit(), { appName: 'Chai', appId: 'com.chai.app', prebuilt: prebuilt() });
    const listed = parseWwwManifest(p.files[WWW_MANIFEST_PATH]);
    expect(listed).toEqual([PREBUILT_STAMP_PATH, 'www/assets/index-abc.js', 'www/assets/logo.png', 'www/index.html']);
    expect(listed).not.toContain(WWW_MANIFEST_PATH);
    const s = assembleMobileProject({ 'index.html': '<p/>', 'app.js': '1' }, kit(), { appName: 'Chai', appId: 'com.chai.app' });
    expect(parseWwwManifest(s.files[WWW_MANIFEST_PATH])).toEqual(['www/app.js', 'www/index.html']);
    const built = assembleMobileProject(VITE_APP, kit(), { appName: 'Chai', appId: 'com.chai.app' });
    expect(built.files[WWW_MANIFEST_PATH]).toBeUndefined();
    expect(parseWwwManifest('www/ok.js\nnot-www/x\nwww/../etc\n\n')).toEqual(['www/ok.js']);
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
    expect(workspacePathForRepoPath(WWW_MANIFEST_PATH, 'static')).toBeNull();
    expect(workspacePathForRepoPath('../x', 'built')).toBeNull();
  });

  it('🔴 on a static or prebuilt repo package.json and capacitor.config.ts are OURS — never written over the workspace\'s real ones', async () => {
    // The repository\'s package.json carries the no-op sentinel; written into the sandbox, `npm run build`
    // becomes an echo and a packaging-only edit would be "verified" against nothing (the review\'s catch).
    for (const layout of ['static', 'prebuilt'] as const) {
      expect(workspacePathForRepoPath('package.json', layout)).toBeNull();
      expect(workspacePathForRepoPath('capacitor.config.ts', layout)).toBeNull();
      expect(workspacePathForRepoPath('capacitor.config.json', layout)).toBeNull();
    }
    expect(workspacePathForRepoPath('package.json', 'built')).toBe('package.json');
    const writes: string[] = [];
    const sandbox = {
      hasLiveSandbox: () => true,
      readFile: async (_w: string, p: string) => { if (p === 'package.json') return '{"scripts":{"build":"vite build"}}'; throw new Error('no'); },
      writeFile: async (_w: string, p: string) => { writes.push(p); },
      build: async () => ({ success: true, logs: 'ok' }),
    };
    const verify = makeRepairVerifier(sandbox, 'ws', { stage: 'install', code: 'UNKNOWN' }, isAppSourcePath, (p) => workspacePathForRepoPath(p, 'prebuilt'));
    expect(await verify!({ 'package.json': JSON.stringify({ scripts: { build: STATIC_NO_OP_BUILD } }) })).toEqual({ ran: false, reason: 'nothing-to-test' });
    expect(writes).toEqual([]);
  });

  it('the verifier writes the candidate at its WORKSPACE path — a static-LAYOUT repo\'s www/index.html reaches the workspace root (the layout map; a static app itself still has no `npm run build` to judge it by)', async () => {
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

  it('repoFileExists tells a 404 (absent) from a failure to check (unknown)', async () => {
    const { repoFileExists } = await import('../src/server/lib/githubRepoWrite');
    // The mock answers 404 for any contents URL — absent, with certainty.
    expect(await repoFileExists(headers, 'ravi', 'chai', 'main', 'www/.nbai-prebuilt')).toBe(false);
  });

  it('commitFiles adds a `sha: null` entry per removed path, never for a path the push still carries', async () => {
    await commitFiles(headers, 'ravi', 'chai', 'main', { 'www/index.html': '<p/>' }, { 'www/a.png': 'AA==' }, 'msg', ['www/old-abc.js', 'www/index.html', 'www/a.png', '']);
    const treePost = state.gh.find((c) => c.method === 'POST' && /\/git\/trees$/.test(c.url))!.body as { tree: Array<Record<string, unknown>> };
    const removed = treePost.tree.filter((t) => t.sha === null).map((t) => t.path);
    expect(removed).toEqual(['www/old-abc.js']);
    expect(treePost.tree.find((t) => t.path === 'www/index.html')).toMatchObject({ content: '<p/>' });
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
      // Saved after a FAILED build (the retry is the run that must not pay again), never after a cancel,
      // and never when the restore never ran (a job that died at its pre-flight has nothing to save).
      expect(wf, path).toContain("if: ${{ !cancelled() && steps.nbai-npm-cache.outcome != 'skipped' && steps.nbai-npm-cache.outputs.cache-hit != 'true' }}");
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
        expect(wf, path).toContain("if: ${{ !cancelled() && steps.nbai-gradle-cache.outcome != 'skipped' && steps.nbai-gradle-cache.outputs.cache-hit != 'true' }}");
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

  it('every autofix answer says whether the sandbox could judge the failure — the rules tier\'s too', () => {
    // A Gradle-stage failure repaired by the rules tier used to arrive without `judgeable`, and the
    // panel then said "could not check this one here first" — as if it could have.
    const rulesFixed = autofix.slice(autofix.indexOf("fixedBy: 'rules',"), autofix.indexOf("fixedBy: 'rules',") + 400);
    expect(rulesFixed).toContain('judgeable,');
    expect((autofix.match(/\bjudgeable,/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('the setup route hands the built app to the assembler, records the ship, and answers `prebuilt`', () => {
    expect(setup).toContain("prebuilt: prebuild.kind === 'built' ? prebuild.prebuilt : undefined,");
    expect(setup).toContain("void recordShip(project.prebuilt ? 'prebuilt' : 'source', prebuild.kind === 'skip' ? prebuild.reason : null);");
    expect(setup).toContain('prebuilt: project.prebuilt,');
    // The missing-asset gate is the SOURCE ship's; the bundle already resolved every import.
    expect(setup).toContain('const missingAssets = project.prebuilt ? [] : findMissingImportedAssets(appFiles, Object.keys(appAssets));');
  });

  it('the setup route removes ONLY what an earlier push of ours RECORDED under www/ — never a folder it merely found', () => {
    expect(setup).toContain('const stale = parseWwwManifest(previous[WWW_MANIFEST_PATH]).filter((p) => !shipped.has(p));');
    expect(setup).toContain('await readRepoFiles(headers, owner, repoName, defaultBranch, [WWW_MANIFEST_PATH])');
    expect(setup).not.toContain('listRepoPathsUnder');
    expect(setup.indexOf('const stale = parseWwwManifest')).toBeLessThan(setup.indexOf('const sha = await commitFiles('));
  });

  it('the screens gate runs BEFORE the production build, so a server-only project never wakes a machine to be refused with the wrong reason', () => {
    expect(setup.indexOf('const noUi = apkRefusalForProject(appFiles);')).toBeLessThan(setup.indexOf('const prebuild = await prebuildForShip('));
  });

  it('one prepare per app at a time — a second setup while one is building answers 409, never a second build in the same machine', () => {
    expect(setup).toContain("code: 'already-preparing'");
    expect(setup).toContain('PREPARING.add(workspaceId);');
    expect(setup.indexOf('PREPARING.has(workspaceId)')).toBeLessThan(setup.indexOf('const prebuild = await prebuildForShip('));
  });

  it('🔒 reversion guards: the local-actuator guard, the in-flight guard, the stale marker, and the sentinel through the constant', () => {
    expect(prebuiltSrc).toContain("if (typeof actuator.hasLiveSandbox !== 'function') return skip('no-sandbox', false);");
    expect(prebuiltSrc).toContain("if (actuator.isBuildActive?.(workspaceId) || isGreenLatched(workspaceId)) return skip('build-in-flight', false);");
    expect(prebuiltSrc).toContain('await actuator.runCommand(workspaceId, markStaleOutputCommand(files)).catch(() => undefined);');
    expect(prebuiltSrc.indexOf('markStaleOutputCommand(files)')).toBeLessThan(prebuiltSrc.indexOf('actuator.build(workspaceId)'));
    expect(prebuiltSrc).toContain("if (outputIsStale(dist)) return skip('no-output', true, log);");
    expect(prebuiltSrc).not.toMatch(/rm -rf/);
    expect(prebuiltSrc).toContain("if (left() < minBuildMs) return skip('timed-out', false);");
    expect(prebuiltSrc).toContain('minBuildMs: number = PREBUILT_MIN_BUILD_MS,');
    expect(prebuiltSrc).toContain("if (read.code === 'TYPE_GATE_BLOCKED_PACKAGING' && declaresVite(files)) {");
    expect(assembler).toContain('pkg.scripts = { build: STATIC_NO_OP_BUILD };');
    expect(assembler).toContain('prebuiltPackageJson(buildPackageJson(');
    expect(assembler).toContain('if (!devDeps.typescript && !deps.typescript) devDeps.typescript = TYPESCRIPT_FOR_CONFIG;');
  });

  it('the autofix route maps repository paths through the layout before the verifier and the workspace heal — and a stamp it could not READ counts as present', () => {
    expect(autofix).toContain('const toWorkspace = (repoPath: string): string | null => workspacePathForRepoPath(repoPath, layout);');
    expect(autofix).toContain('await repoFileExists(headers, String(owner), String(repo), ref, PREBUILT_STAMP_PATH)');
    // `stamp === false` (a real 404) is the ONLY answer that lets `www/` map into the workspace root.
    expect(autofix).toContain("...(stamp === false ? {} : { [PREBUILT_STAMP_PATH]: 'present-or-unknown' })");
    // The sandbox can judge the runner's build only where the runner BUILDS: a prebuilt or static
    // repository compiles nothing there, so no verifier is built for it and `judgeable` says so.
    expect(autofix).toContain("const judgeable = layout === 'built' && sandboxCanJudge({ stage: failedStage(normalizeLog(log)), code: diag.code });");
    expect(autofix).toContain('const verify = judgeable');
    expect(autofix.indexOf('const layout = detectRepoLayout(')).toBeLessThan(autofix.indexOf("cureFamily(diag.code) === 'user-credentials'"));
  });

  it('🔒 the active-build flag is HELD, and the release leaves a flag another build took over (a v5 build that started during the ship keeps its protection)', async () => {
    const m = machine();
    let owner: string | null = null;
    let active = false;
    m.holdBuildActive = () => {
      active = true; owner = 'prebuild';
      return () => { if (owner !== 'prebuild') return; owner = null; active = false; };
    };
    // Simulate the app's own engine taking the flag over while the prebuild's build runs.
    const build = m.build;
    m.build = async (w) => { owner = 'v5'; return build(w); };
    const out = await prebuildForShip(m, 'ws', VITE_APP);
    expect(out.kind).toBe('built');
    expect(active).toBe(true);          // the v5 build's flag survived the prebuild's release
    expect(m.active).toEqual([]);       // setBuildActive was never used when a hold is available
    expect(prebuiltSrc).toContain("typeof actuator.holdBuildActive === 'function'");
  });

  it('the panel says which of the three happened, and no vendor is ever named', () => {
    expect(panel).toContain("' (your app was built here first — GitHub only packages it)'");
    expect(panel).toContain('prebuilt?: boolean;');
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Sonnet', 'Opus', 'Gemini', 'Grok', 'E2B']) {
      expect(panel).not.toMatch(new RegExp(`['"\`][^'"\`]*\\b${vendor}\\b[^'"\`]*['"\`]`));
    }
  });
});

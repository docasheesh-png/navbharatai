// A PACKAGE THIS BUILD INSTALLED AND NEVER USED IS TAKEN OUT AGAIN (admin 2026-10-01, after autopsy a106df77,
// whose rebuild installed `recharts` and never imported it). Only a package THIS build added, named nowhere
// else, not tooling, not needed by another installed package — and only if the app's own production build
// passes without it. The user's own packages are never touched.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  depsAddedByBuild, pruneCandidates, isSafePackageName, parseNeeded, peerCheckScript, hasBuildScript,
  pruneBuildAddedDeps, prunedNarration, pruneUnusedDepsEnabled, MAX_PRUNE,
} from '../src/server/AgentV3/unusedDepPrune';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'app', scripts: { build: 'vite build' }, dependencies: deps, ...extra }, null, 2);

const BEFORE = pkg({ react: '^18.3.1', 'react-dom': '^18.3.1' }, { devDependencies: { vite: '^5.4.0' } });
const AFTER = pkg({ react: '^18.3.1', 'react-dom': '^18.3.1', recharts: '^2.12.0', 'react-router-dom': '^6.26.0' }, { devDependencies: { vite: '^5.4.0' } });
const FILES = {
  'package.json': AFTER,
  'src/App.tsx': "import { BrowserRouter } from 'react-router-dom';\nexport default function App() { return <BrowserRouter />; }",
  'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({});",
};

describe('which packages may be removed', () => {
  it('🔴 the a106df77 case: recharts, added by this build and used nowhere, is a candidate', () => {
    expect(depsAddedByBuild(BEFORE, AFTER)).toEqual(['recharts', 'react-router-dom']);
    expect(pruneCandidates({ before: BEFORE, after: AFTER, unused: ['recharts'], files: FILES })).toEqual(['recharts']);
  });

  it('a package the user had before the build is never a candidate, however unused', () => {
    const before = pkg({ react: '^18.3.1', lodash: '^4.17.21' });
    const after = pkg({ react: '^18.3.1', lodash: '^4.17.21' });
    expect(pruneCandidates({ before, after, unused: ['lodash'], files: {} })).toEqual([]);
    // …including one the user had only as a dev dependency
    expect(depsAddedByBuild(pkg({}, { devDependencies: { zod: '^3.0.0' } }), pkg({ zod: '^3.0.0' }))).toEqual([]);
  });

  it('with no readable baseline nothing is removed', () => {
    expect(pruneCandidates({ before: null, after: AFTER, unused: ['recharts'], files: FILES })).toEqual([]);
    expect(pruneCandidates({ before: '{not json', after: AFTER, unused: ['recharts'], files: FILES })).toEqual([]);
  });

  it('a package any other file names is kept — a config, a stylesheet, a page', () => {
    for (const [path, text] of [
      ['vite.config.ts', "import charts from 'recharts/plugin';"],
      ['src/index.css', "@import 'recharts/dist/styles.css';"],
      ['index.html', '<script src="https://cdn.example/recharts.js"></script>'],
      ['src/lazy.ts', "const m = await import(`${'recharts'}`);"],
    ]) {
      expect(pruneCandidates({ before: BEFORE, after: AFTER, unused: ['recharts'], files: { ...FILES, [path]: text } }), path).toEqual([]);
    }
  });

  it('tooling is used without an import, so it is never a candidate', () => {
    const after = pkg({ react: '^18.3.1', 'react-dom': '^18.3.1', 'vite-plugin-pwa': '^0.20.0', '@vitejs/plugin-react': '^4.3.0', tailwindcss: '^3.4.0', 'core-js': '^3.38.0' });
    expect(pruneCandidates({ before: BEFORE, after, unused: ['vite-plugin-pwa', '@vitejs/plugin-react', 'tailwindcss', 'core-js'], files: {} })).toEqual([]);
  });

  it('at most MAX_PRUNE in one build', () => {
    const extra = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`pkg-${i}`, '^1.0.0']));
    const after = pkg({ react: '^18.3.1', ...extra });
    expect(pruneCandidates({ before: pkg({ react: '^18.3.1' }), after, unused: Object.keys(extra), files: {} })).toHaveLength(MAX_PRUNE);
  });

  it('a name that is not a plain npm package name never reaches a shell line', () => {
    expect(isSafePackageName('recharts')).toBe(true);
    expect(isSafePackageName('@tanstack/react-query')).toBe(true);
    for (const bad of ['a;rm -rf /', '$(id)', 'x y', "it's", '../x', '']) expect(isSafePackageName(bad), bad).toBe(false);
  });

  it('the kill switch', () => {
    expect(pruneUnusedDepsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(pruneUnusedDepsEnabled({ AGENTV3_PRUNE_UNUSED_DEPS: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

/** A fake sandbox: records every command and answers from a script. */
function fakeIo(answers: { peers?: string[]; uninstall?: number; build?: number; pkgAfter?: string | null }) {
  const commands: string[] = [];
  return {
    commands,
    io: {
      run: async (cmd: string) => {
        commands.push(cmd);
        if (cmd.startsWith('node -e')) return { exitCode: 0, stdout: (answers.peers ?? []).map((p) => `NBAI_NEEDED ${p}`).join('\n'), stderr: '' };
        if (cmd.includes('npm uninstall')) return { exitCode: answers.uninstall ?? 0, stdout: '', stderr: '' };
        if (cmd.includes('npm run build')) return { exitCode: answers.build ?? 0, stdout: '', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      read: async (p: string) => (p === 'package.json' ? (answers.pkgAfter === undefined ? BEFORE : answers.pkgAfter) : null),
    },
  };
}

describe('removing, proving, and putting it back', () => {
  it('removed only when the production build passes without it', async () => {
    const f = fakeIo({});
    const out = await pruneBuildAddedDeps(['recharts'], AFTER, f.io);
    expect(out.status).toBe('removed');
    expect(f.commands.some((c) => c.includes('npm uninstall --no-audit --no-fund recharts'))).toBe(true);
    expect(f.commands.some((c) => c.includes('npm run build'))).toBe(true);
    expect(f.commands.some((c) => c.includes('npm install'))).toBe(false); // no restore on success
  });

  it('a build that fails without it puts package.json, the lock and node_modules back', async () => {
    const f = fakeIo({ build: 1 });
    const out = await pruneBuildAddedDeps(['recharts'], AFTER, f.io);
    expect(out).toMatchObject({ status: 'reverted', reason: 'the app did not build without them', tried: ['recharts'] });
    const restore = f.commands.find((c) => c.includes('npm install'))!;
    expect(restore).toMatch(/cp \/tmp\/nbai-prune-package\.json package\.json/);
    expect(restore).toMatch(/package-lock\.json/);
  });

  it('a failed uninstall is put back too', async () => {
    const f = fakeIo({ uninstall: 1 });
    expect((await pruneBuildAddedDeps(['recharts'], AFTER, f.io)).status).toBe('reverted');
    expect(f.commands.some((c) => c.includes('npm install'))).toBe(true);
  });

  it('a package another installed package needs is kept, before anything is uninstalled', async () => {
    const f = fakeIo({ peers: ['recharts'] });
    const out = await pruneBuildAddedDeps(['recharts'], AFTER, f.io);
    expect(out).toMatchObject({ status: 'skipped', keptForPeers: ['recharts'] });
    expect(f.commands.some((c) => c.includes('npm uninstall'))).toBe(false);
  });

  it('with no build script there is nothing to prove the removal with, so nothing is removed', async () => {
    const f = fakeIo({});
    const noBuild = JSON.stringify({ name: 'app', dependencies: { recharts: '^2.0.0' } });
    expect(hasBuildScript(noBuild)).toBe(false);
    expect((await pruneBuildAddedDeps(['recharts'], noBuild, f.io)).status).toBe('skipped');
    expect(f.commands).toEqual([]);
  });

  it('the peer check reads only declared packages and prints one name per line', () => {
    const script = peerCheckScript(['recharts', 'bad;name']);
    expect(script).toContain('"recharts"');
    expect(script).not.toContain('bad;name');
    expect([...parseNeeded('noise\nNBAI_NEEDED recharts\nNBAI_NEEDED  \n')]).toEqual(['recharts']);
  });

  it('the user is told in plain words', () => {
    expect(prunedNarration(['recharts'])).toBe('🧹 Removed 1 package this build installed but your app never uses (recharts). Your app still builds.');
  });
});

describe('the route wiring (source guards)', () => {
  it('the baseline is read after the platform seeds and before the first model call', () => {
    const at = route.indexOf("const packageJsonAtBuildStart: string | null = await actuator.readFile(workspaceId, 'package.json')");
    expect(at).toBeGreaterThan(route.indexOf('const pastedSeed = new Map'));
    expect(at).toBeLessThan(route.indexOf('const fastLaneWouldRun = '));
  });

  it('never on an import, a plan turn, a stopped build, or a working app already latched green', () => {
    expect(route).toContain('if (pruneUnusedDepsEnabled() && result.ok && expectsArtifacts && !isImportTurn && !projectModuleRef && !megaRoadmapActive && !abort.signal.aborted && !isGreenLatched(workspaceId)) {');
  });

  it('a removed package is saved, and is no longer reported as unused', () => {
    expect(route).toMatch(/if \(outcome\.status === 'removed'\) \{\s*prunedDeps\.push\(\.\.\.outcome\.removed\);/);
    expect(route).toMatch(/for \(const u of unusedDeps\) \{\s*if \(prunedDeps\.includes\(u\.name\)\) continue;/);
    expect(route).toContain('await saveWorkspaceFiles(workspaceId, changed)');
  });
});

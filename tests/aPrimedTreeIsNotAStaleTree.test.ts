/**
 * BUILD 46e2d74b (admin 2026-10-11) — WRITE_TIME_TYPECHECK skipped all fourteen TypeScript writes of the
 * racing game "because dependencies were still being installed".
 *
 * The cause, reproduced here in a real shell: the node_modules primer copies the image's baked tree with
 * `cp -a`, which keeps the image's months-old timestamp, so `[ package.json -nt node_modules ]` — the
 * freshness question every reader asked — said "stale" about a tree primed a second earlier. The write-time
 * check never installs, so it stood down on every write until the model ran its own `npm install`. The
 * report could not even say which of its three not-ready conditions had fired.
 *
 * Fixed at the question (`MANIFEST_CURRENT`): a tree the primer placed and nothing has touched since, whose
 * declared ranges are the baked manifest's own, IS current. Every other case keeps the timestamp's answer.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, utimesSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRIME_NODE_MODULES, WARM_NODE_MODULES, WARM_PACKAGE_JSON, PRIMED_STAMP, NPM_INSTALL_LOCK, TSC_ENSURE_LOG, MANIFEST_CURRENT,
} from '../src/server/AgentV3/tscCommand';
import {
  writeTypecheckCommand, writeTypecheckWarmupCommand, writeTypecheckNotReadyReason, writeTypecheckSummary,
  emptyWriteTypecheckStats, WRITE_TYPECHECK_NOT_READY_MARKER, WARMUP_COMPILED_MARKER,
} from '../src/server/AgentV3/writeTimeTypecheck';

const STARTER_DEPS = { dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { typescript: '^5.5.3', vite: '^8.3.0' } };

let roots: string[] = [];
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots = []; });

/** A sandbox in a temp dir: the baked tree (old timestamp), its manifest, and a fresh starter app. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nbai-primed-'));
  roots.push(root);
  const warm = join(root, 'warm');
  mkdirSync(join(warm, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(warm, 'node_modules/typescript/lib'), { recursive: true });
  for (const d of ['react', 'react-dom', 'vite']) { mkdirSync(join(warm, 'node_modules', d), { recursive: true }); writeFileSync(join(warm, 'node_modules', d, 'package.json'), '{}'); }
  writeFileSync(join(warm, 'node_modules/typescript/package.json'), '{}');
  writeFileSync(join(warm, 'node_modules/typescript/lib/tsc.js'), '');
  // A compiler stub that says it ran — the question here is whether the check RUNS it.
  writeFileSync(join(warm, 'node_modules/.bin/tsc'), '#!/bin/sh\necho TSC_RAN\n');
  chmodSync(join(warm, 'node_modules/.bin/tsc'), 0o755);
  writeFileSync(join(warm, 'package.json'), JSON.stringify({ name: 'warm', ...STARTER_DEPS }));
  // The image was baked weeks ago: cp -a carries this timestamp into the workspace.
  const old = new Date('2026-09-01T00:00:00Z');
  utimesSync(join(warm, 'node_modules'), old, old);
  const app = join(root, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'racer', ...STARTER_DEPS }, null, 2));
  writeFileSync(join(app, 'tsconfig.json'), '{}');
  const local = (cmd: string) => cmd
    .split(WARM_PACKAGE_JSON).join(join(warm, 'package.json'))
    .split(WARM_NODE_MODULES).join(join(warm, 'node_modules'))
    .split(PRIMED_STAMP).join(join(root, 'primed-stamp'))
    .split(NPM_INSTALL_LOCK).join(join(root, 'install.lock'))
    .split(TSC_ENSURE_LOG).join(join(root, 'ensure.log'))
    .split('/home/user/.nbai-nm-stage').join(join(root, 'stage'));
  const sh = (cmd: string) => execFileSync('bash', ['-c', local(cmd)], { cwd: app, encoding: 'utf8' });
  return { root, warm, app, sh };
}

describe('the write-time check runs on a freshly primed tree (the 46e2d74b skip, reproduced)', () => {
  it('primed from the baked tree, the starter\'s package.json is NEWER than node_modules — and the check still runs', () => {
    const { app, sh } = sandbox();
    sh(PRIME_NODE_MODULES);
    expect(existsSync(join(app, 'node_modules/.bin/tsc'))).toBe(true);
    // The timestamp lies exactly as it did in the build:
    expect(sh('[ package.json -nt node_modules ] && echo STALE || echo FRESH').trim()).toBe('STALE');
    const out = sh(writeTypecheckCommand('t1'));
    expect(out).toContain('TSC_RAN');
    expect(out).not.toContain(WRITE_TYPECHECK_NOT_READY_MARKER);
  });

  it('the build-start warm-up compiles on the primed tree too, instead of standing down', () => {
    const { sh } = sandbox();
    expect(sh(writeTypecheckWarmupCommand('t2'))).toContain(WARMUP_COMPILED_MARKER);
  });
});

describe('every other case keeps the timestamp\'s answer, and says which condition fired', () => {
  it('a dependency the baked tree was not installed for (the model adds three) is manifest-changed until an install', () => {
    const { app, sh } = sandbox();
    sh(PRIME_NODE_MODULES);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'racer', dependencies: { ...STARTER_DEPS.dependencies, three: '^0.180.0' }, devDependencies: STARTER_DEPS.devDependencies }));
    const out = sh(writeTypecheckCommand('t3'));
    expect(out.trim()).toBe(`${WRITE_TYPECHECK_NOT_READY_MARKER}:manifest-changed`);
    expect(writeTypecheckNotReadyReason(out)).toBe('manifest-changed');
    // An install stamps the tree (npm writes node_modules/.package-lock.json last — measured): ready again.
    sh('sleep 1; touch node_modules');
    expect(sh(writeTypecheckCommand('t3'))).toContain('TSC_RAN');
  });

  it('a different RANGE for the same package is not the baked install (react 19 over a react 18 tree)', () => {
    const { app, sh } = sandbox();
    sh(PRIME_NODE_MODULES);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ ...STARTER_DEPS, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }));
    expect(writeTypecheckNotReadyReason(sh(writeTypecheckCommand('t4')))).toBe('manifest-changed');
  });

  it('a tree an install has touched since priming is judged by its timestamp, not by the stamp', () => {
    const { app, sh } = sandbox();
    sh(PRIME_NODE_MODULES);
    // Something rewrote the tree (its mtime moved), then package.json changed again.
    sh('sleep 1; touch node_modules; sleep 1');
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'racer', ...STARTER_DEPS }));
    expect(sh(`if ${MANIFEST_CURRENT}; then echo CURRENT; else echo STALE; fi`).trim()).toBe('STALE');
  });

  it('no compiler, a torn compiler and a running install are each named', () => {
    const { app, root, sh } = sandbox();
    sh(PRIME_NODE_MODULES);
    rmSync(join(app, 'node_modules/typescript/lib/tsc.js'));
    expect(writeTypecheckNotReadyReason(sh(writeTypecheckCommand('t5')))).toBe('no-compiler');
    rmSync(join(app, 'node_modules/.bin/tsc'));
    expect(writeTypecheckNotReadyReason(sh(writeTypecheckCommand('t5')))).toBe('no-compiler');
    writeFileSync(join(root, 'install.lock'), '');
    expect(writeTypecheckNotReadyReason(sh(writeTypecheckCommand('t5')))).toBe('install-running');
  });

  it('the check never installs: no npm anywhere in the command', () => {
    expect(writeTypecheckCommand()).not.toMatch(/\bnpm\s+(?:install|ci|i)\b/);
  });
});

describe('the report names the condition, not one sentence for three facts', () => {
  it('fourteen writes skipped on a changed manifest say so', () => {
    const s = { ...emptyWriteTypecheckStats(), skipped: 14, skippedNotReady: 14, notReadyReasons: { 'manifest-changed': 14 } };
    expect(writeTypecheckSummary(s, true)).toBe('Write-time typecheck: never ran — 14 TypeScript write(s) skipped before the compiler was ready — '
      + '14 because package.json had changed since the last install (a dependency may be missing until one runs) (the check never installs and never waits).');
  });

  it('a mix names each, and a bare marker from an older command is still read as not ready', () => {
    const s = { ...emptyWriteTypecheckStats(), skipped: 5, skippedNotReady: 5, notReadyReasons: { 'install-running': 3, 'no-compiler': 2 } };
    expect(writeTypecheckSummary(s, true)).toMatch(/3 because an install of the app's dependencies was running; 2 because the TypeScript compiler was not installed yet/);
    expect(writeTypecheckNotReadyReason(`${WRITE_TYPECHECK_NOT_READY_MARKER}\n`)).toBe('unknown');
    expect(writeTypecheckNotReadyReason('error TS2304: x')).toBeNull();
  });
});

describe('the dispatcher counts each skipped write under the condition that fired', () => {
  it('reads the reason off the command\'s answer and adds it to the build\'s stats', () => {
    const dispatcher = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(dispatcher).toContain('notReadyWhy = writeTypecheckNotReadyReason(r.stdout)');
    expect(dispatcher).toMatch(/s\.notReadyReasons = \{ \.\.\.\(s\.notReadyReasons \?\? \{\}\), \[why\]:/);
  });
});

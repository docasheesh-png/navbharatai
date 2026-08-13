// PHASE 1 of the in-browser preview plan — can this project be PROVEN to run in the browser?
//
// ADMIN 2026-08-13: "sath me un logo ka bhi dhyan rakhna jo, apni already bani hui app (github/zip)
// navbharatai par layenge."
//
// THE WASTE THIS REMOVES. An imported project (GitHub / zip / folder) currently boots a full E2B
// sandbox and runs `npm install` before the user can see anything. For a plain React app that somebody
// only wants to LOOK at, that is a Linux VM and a dependency install to render files we already hold —
// and, unlike a generated build, there is no build to run, so the VM buys nothing at all. It is the one
// place in the plan with unambiguous waste (IN_BROWSER_PREVIEW_PLAN.md §0).
//
// THE RULE THAT KEEPS THIS HONEST: the default answer is NO.
//
// This module does not ask "is there a reason to think the browser might cope?" It asks "can I PROVE
// the browser will cope?", and anything it cannot prove goes to the sandbox exactly as today. That
// asymmetry is the whole design. A wrong "no" costs one VM — today's cost, no regression. A wrong "yes"
// shows the user a broken app and calls it their app, which is the second absolute rule's "built but
// not really working", and worth far more than a VM.
//
// It is therefore deliberately EASY to refuse and hard to accept. New blockers can be added freely;
// widening acceptance needs evidence.
//
// NOT A CAPABILITY REMOVAL. The Live-server tab keeps its "Diagnose" button, which runs the same
// model-free install-and-run on demand with staged progress. Skipping the automatic boot changes when
// the sandbox starts, never whether the user can have one.
//
// PURE and deterministic — file map in, verdict out. No I/O, no model call, no cost.

import { detectBackendPresence } from './BackendPresence';
import { usesImportMetaGlob } from '../runtime/previewImportMeta';

/** Why the browser cannot be trusted with this project. Each is a genuinely different refusal. */
export type PreviewBlocker =
  /** A framework whose single-file components we cannot compile in a browser (Svelte, Astro). */
  | 'unsupported-framework'
  /** The app has its own API/database — the sandbox has to answer those calls. Phase 2's territory. */
  | 'has-backend'
  /** A dependency that only exists on a real Node process (native bindings, a headless browser, …). */
  | 'node-only-dependency'
  /** App source imports a Node builtin. See the note on NODE_BUILTIN_RE — this one has real history. */
  | 'node-builtin-import'
  /** `import.meta.glob` — a BUILD-TIME expansion we cannot perform, so the app would render empty. */
  | 'import-meta-glob'
  /** Nothing the in-browser renderers know how to start from. */
  | 'no-renderable-entry';

export interface PreviewCapability {
  /** TRUE only when every check passed. Never true by default, never true on an empty tree. */
  browserRunnable: boolean;
  /** Every blocker found, most specific first. Empty exactly when `browserRunnable` is true. */
  blockers: PreviewBlocker[];
  /** One honest, user-facing sentence naming the first blocker. Empty when runnable. */
  reason: string;
}

/**
 * Single-file-component frameworks the in-browser renderers cannot compile.
 *
 * Mirrors PreviewService's own UNSUPPORTED_SFC rather than inventing a second opinion — two lists of
 * "what we cannot compile" is one list that will be wrong after the next change.
 */
const UNSUPPORTED_SFC = ['.svelte', '.astro'];

/**
 * Dependencies that cannot work in a browser at any effort, because they are a native binding, a
 * separate process, or direct machine access.
 *
 * Deliberately a SMALL list of certainties. A package that merely *usually* runs on a server does not
 * belong here — the other checks (backend presence, Node builtins) catch those with better reasons, and
 * a speculative entry here refuses an app that would have rendered perfectly.
 */
const NODE_ONLY_DEPS = [
  'sharp', 'canvas', 'puppeteer', 'puppeteer-core', 'playwright', 'playwright-core',
  'sqlite3', 'better-sqlite3', 'bcrypt', 'node-gyp', 'fsevents', 'chokidar',
  'nodemailer', 'node-cron', 'child_process', 'ioredis', 'redis', 'mongodb', 'mongoose',
];

/**
 * A Node builtin imported by APP source.
 *
 * WHY THIS BLOCKS RATHER THAN BEING STUBBED. `ReactPreview.ts` already stubs `node:` imports to a proxy
 * that returns `''` for everything, so one stray `import path from 'node:path'` in a config file cannot
 * kill a whole preview. That is a good narrow guard, and it stays. But it is the wrong answer for an app
 * that genuinely USES a builtin: a stubbed `node:crypto` returns `''` where a hash belongs, and the app
 * then renders happily while producing wrong data. Claiming that app "runs in the browser" would be the
 * exact "built but not really working" state the second absolute rule forbids. So an app that reaches
 * for a builtin goes to the sandbox, where the builtin is real.
 *
 * Both spellings are matched (`node:fs` and bare `fs`), since either resolves to the same builtin.
 */
const NODE_BUILTINS = [
  'fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'dns', 'tls',
  'worker_threads', 'cluster', 'zlib', 'readline', 'vm', 'perf_hooks',
];
const NODE_BUILTIN_RE = new RegExp(
  `(?:from|import|require\\()\\s*['"](?:node:)?(${NODE_BUILTINS.join('|')})(?:/[\\w.-]+)?['"]`,
);

/**
 * Files whose Node imports are EXPECTED and harmless, because they configure the build rather than run
 * in it. `vite.config.ts` importing `path` is the single most common shape in the entire JavaScript
 * ecosystem; blocking on it would refuse almost every real Vite project — including the ones this
 * feature exists to serve.
 */
const CONFIG_FILE = /(^|\/)(vite|vitest|tailwind|postcss|next|webpack|rollup|jest|playwright|svelte|astro|eslint|babel|capacitor|drizzle)\.config\.[cm]?[jt]s$/i;
const NON_APP_PATH = /(^|\/)(node_modules|dist|build|\.next|coverage|scripts|server|backend|api|functions|test|tests|__tests__|e2e)\//i;
const APP_SOURCE = /\.[cm]?[jt]sx?$/i;

function parseDeps(pkgRaw: string | undefined): Set<string> {
  if (typeof pkgRaw !== 'string') return new Set();
  try {
    const pkg = JSON.parse(pkgRaw);
    if (!pkg || typeof pkg !== 'object') return new Set();
    return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

/** Does the tree contain something an in-browser renderer can actually start from? */
function hasRenderableEntry(files: Record<string, string>, paths: string[]): boolean {
  const deps = parseDeps(files['package.json']);
  if (deps.has('react') || deps.has('vue')) return true;
  if (paths.some((p) => /\.(jsx|tsx|vue)$/i.test(p))) return true;
  return paths.some((p) => p === 'index.html' || p === 'public/index.html' || /(^|\/)index\.html$/i.test(p));
}

/** The one honest sentence a user is shown when we refuse. Names the blocker, never a vendor. */
const BLOCKER_REASON: Record<PreviewBlocker, string> = {
  'unsupported-framework': 'this project uses a framework NavBharatAI cannot compile in the browser yet, so it needs the live server',
  'has-backend': 'this project has its own server or database, which the live server has to run',
  'node-only-dependency': 'this project uses a package that only works on a real server',
  'node-builtin-import': 'this project’s code uses Node features that only exist on a real server',
  'import-meta-glob': 'this project builds part of itself while it compiles, which only the live server can do',
  'no-renderable-entry': 'no page could be found to render — the live server can start it properly',
};

/**
 * Can the browser be TRUSTED with this project? Pure.
 *
 * Every blocker is collected rather than short-circuiting on the first, because the honest refusal
 * screen is more useful when it can say "and also", and because a caller measuring these needs the
 * whole picture rather than whichever check happened to run first.
 */
export function proveBrowserRunnable(files: Record<string, string> | null | undefined): PreviewCapability {
  const map = files && typeof files === 'object' ? files : {};
  const paths = Object.keys(map);
  const blockers: PreviewBlocker[] = [];

  // An empty tree proves nothing. It must not fall through to "no blockers found, therefore runnable".
  if (paths.length === 0) {
    return { browserRunnable: false, blockers: ['no-renderable-entry'], reason: BLOCKER_REASON['no-renderable-entry'] };
  }

  if (paths.some((p) => UNSUPPORTED_SFC.some((ext) => p.toLowerCase().endsWith(ext)))) {
    blockers.push('unsupported-framework');
  }
  if (detectBackendPresence(map).hasBackend) blockers.push('has-backend');

  const deps = parseDeps(map['package.json']);
  if (NODE_ONLY_DEPS.some((d) => deps.has(d))) blockers.push('node-only-dependency');

  const usesBuiltin = paths.some((p) => {
    if (!APP_SOURCE.test(p) || CONFIG_FILE.test(p) || NON_APP_PATH.test(p)) return false;
    const src = map[p];
    return typeof src === 'string' && NODE_BUILTIN_RE.test(src);
  });
  if (usesBuiltin) blockers.push('node-builtin-import');

  /**
   * `import.meta.glob` is the one part of `import.meta` a value cannot answer. Phase 1b makes
   * `import.meta.env` work by supplying Vite's real dev values, but glob is a BUILD-TIME directory
   * expansion: with no `glob` on the object, an app that builds its routes from one would render with
   * no routes — working-looking and wrong, which is worse than an honest refusal.
   */
  if (usesImportMetaGlob(map)) blockers.push('import-meta-glob');

  if (!hasRenderableEntry(map, paths)) blockers.push('no-renderable-entry');

  return {
    browserRunnable: blockers.length === 0,
    blockers,
    reason: blockers.length === 0 ? '' : BLOCKER_REASON[blockers[0]],
  };
}

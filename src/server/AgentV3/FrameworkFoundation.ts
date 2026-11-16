// AgentV3 — Framework Foundation Guarantee: the fix for "the file-list planner omitted package.json".
//
// THE REAL BUG (deep-test Level-1, build 7c56b35a-dc3e-4236-a795-6bf738b065ae): the manifest planner
// planned only 5 files for a vite-react app — `src/index.css, src/components/HelloWorld.tsx,
// vite.config.ts, src/main.tsx, src/App.tsx` — with NO `package.json`. So the sandbox's very first
// `npm install` failed `ENOENT … package.json` (exit -1); the missing-dependency reconcile
// (`npm install <pkgs>`) then failed with exit 254 (there is no package.json to install INTO); and the
// dev server never started (`npm run dev` exit 1). The whole build degraded to BUILD_PARTIAL and the
// type-check could not run (VERIFY_DID_NOT_RUN) because node_modules was empty.
//
// ROOT CAUSE (the CLASS, not the instance): a framework build's FOUNDATIONAL files — the ones the
// toolchain needs before any app code can install or boot — were left entirely to the LLM planner,
// which can silently drop them. There was no invariant that guaranteed them. This module enforces that
// invariant deterministically: given the file set a build is about to install, it synthesizes ONLY the
// foundational files that are ABSENT (never overwriting a generated/scaffolded file), with the
// package.json's dependencies derived from the code's REAL imports (reusing the same import scanner the
// dependency reconciler uses, so there is one source of truth). PURE + dependency-free = fully
// unit-testable without a sandbox.

import { extractImportedPackages } from './DependencyReconciler';
import { stripTrailingConflictMarkup } from './conflictMarkerGuard';

export interface FoundationResult {
  /** ONLY the newly-synthesized foundational files, keyed by workspace-relative path. Empty when the
   *  project already has everything it needs to install & boot. */
  files: Record<string, string>;
  /** The basenames added (for an honest build-log line). Empty ⇒ nothing was missing. */
  added: string[];
}

export interface FoundationOptions {
  /** The build's declared framework (e.g. `vite-react`). Non-vite/react frameworks are left untouched. */
  framework?: string;
  /** A display name for index.html <title> / package.json name. Defaults to `App`. */
  appName?: string;
  /** Paths already present on disk (e.g. an actuator scaffold) but not in `files` — never re-created. */
  existingPaths?: string[];
}

/** Pinned, widely-compatible versions for the foundational toolchain. Everything the code imports beyond
 *  these is declared as `latest` (the same resolution the dependency reconciler's `npm install <pkg>`
 *  would use), so a synthesized package.json is never the thing that pins a user to a stale version. */
const RUNTIME_DEPS: Record<string, string> = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
};
const DEV_DEPS_BASE: Record<string, string> = {
  // 🔴 THE FOURTH PIN SITE, found by the sibling hunt and not by the report (autopsy 31dc61fd).
  //
  // `^5.4.x` resolves to 5.4.21 — the LAST 5.4 release — which still carries dev-server advisories,
  // so `npm audit fix` (compatible-only, what AGENTV3_AUDIT_FIX runs) can never clear them. The two
  // ViteReactProviderContents copies and the sandbox image's warm primer were moved to vite 8; this
  // one synthesizes a package.json for an app that has none, is live via
  // `ensureViteReactFoundation` in routes/agentv3.ts, and would have quietly put the vulnerable
  // range back into exactly the apps that never got a scaffold.
  //
  // Fixing three of four places is how a class survives a fix — see this file's own neighbours for
  // the measurement (real scaffold: 2 vulnerabilities before, 0 after; build clean, dev server
  // serving HTTP 200). `tests/theScaffoldShipsNoKnownVulnerability.test.ts` now holds all four.
  vite: '^8.3.0',
  '@vitejs/plugin-react': '^5.2.0',
};
const DEV_DEPS_TS: Record<string, string> = {
  typescript: '^5.6.3',
  '@types/react': '^18.3.12',
  '@types/react-dom': '^18.3.1',
};

/** True for a JS/TS/JSX/TSX source file whose imports we should scan. */
function isScannableSource(path: string): boolean {
  return /\.(?:m?[jt]sx?|cjs)$/i.test(path) && !/\.d\.ts$/i.test(path);
}

/**
 * Does this build target the vite-react toolchain (the one this module knows how to scaffold)? Frameworks
 * with a fundamentally different foundation (Next.js, Nuxt, Astro, Angular, Remix, SvelteKit, Gatsby,
 * Vue, Solid) are deliberately LEFT ALONE — synthesizing a vite package.json for them would be wrong.
 */
export function isViteReactTarget(framework: string | undefined, files: Record<string, string>): boolean {
  const f = (framework || '').toLowerCase();
  if (/next|nuxt|astro|angular|remix|svelte|solid|gatsby|\bvue\b/.test(f)) return false;
  // A next.config anywhere means it is a Next.js app regardless of the label.
  if (Object.keys(files).some((p) => /(?:^|\/)next\.config\.[cm]?[jt]s$/i.test(p))) return false;
  if (/vite|react/.test(f)) return true;
  if (f === '') {
    const hasReactImport = Object.values(files).some((c) => /from\s*['"]react['"]/.test(c || ''));
    const hasViteConfig = Object.keys(files).some((p) => /(?:^|\/)vite\.config\.[cm]?[jt]s$/i.test(p));
    return hasReactImport || hasViteConfig;
  }
  return false;
}

function slugName(appName: string): string {
  const s = (appName || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'app';
}

/** Build the package.json text: framework baseline + every third-party package the code actually imports. */
function synthesizePackageJson(files: Record<string, string>, appName: string, hasTs: boolean): string {
  const dependencies: Record<string, string> = { ...RUNTIME_DEPS };
  const devDependencies: Record<string, string> = { ...DEV_DEPS_BASE, ...(hasTs ? DEV_DEPS_TS : {}) };
  const baseline = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

  const imported = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!isScannableSource(path)) continue;
    for (const pkg of extractImportedPackages(content)) imported.add(pkg);
  }
  for (const pkg of [...imported].sort()) {
    if (baseline.has(pkg)) continue;
    // A `@types/*` import belongs in devDependencies; everything else is a runtime dependency.
    if (pkg.startsWith('@types/')) devDependencies[pkg] = 'latest';
    else dependencies[pkg] = 'latest';
  }

  const pkg = {
    name: slugName(appName),
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies,
    devDependencies,
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

/** Locate the app entry the HTML should boot (`/src/main.tsx` etc.), preferring an existing one. */
function detectEntry(present: Set<string>): string {
  const candidates = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/index.tsx', 'src/index.jsx'];
  for (const c of candidates) if (present.has(c)) return '/' + c;
  return '/src/main.tsx'; // the synthesized default entry when none exists
}

function synthesizeIndexHtml(appName: string, entry: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${entry}"></script>
  </body>
</html>
`;
}

const VITE_CONFIG_TS = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { host: true, allowedHosts: true },
});
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": false,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
`;

/**
 * The RELEASE typecheck config — the same rules as tsconfig.json, minus the tests.
 *
 * ROOT CAUSE (admin report 2026-08-11, a user's APK build): the release build runs `tsc && vite build`
 * and tsconfig includes ALL of `src`, so `src/components/Login.test.tsx` importing a member Login.tsx
 * does not export failed the build with exit code 2 — and the APK never got built. A broken TEST
 * stopped a RELEASE.
 *
 * That is the wrong shape. Tests are checked by the test runner; the release build should typecheck
 * what actually SHIPS. Tests keep their editor and vitest typechecking (tsconfig.json is unchanged) —
 * they simply cannot block a release any more.
 */
const TSCONFIG_BUILD_JSON = `{
  "extends": "./tsconfig.json",
  "exclude": [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/__tests__/**",
    "**/__mocks__/**"
  ]
}
`;

/** The canonical Vite React entry, synthesized only when the app has an App component but no entry at all. */
function synthesizeEntry(present: Set<string>, hasTs: boolean): string {
  const appImport = present.has('src/App.tsx') || present.has('src/App.jsx') ? "import App from './App';" : null;
  const body = appImport
    ? `${appImport}\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);`
    : `createRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <div>App</div>\n  </StrictMode>,\n);`;
  const cssImport = present.has('src/index.css') ? "\nimport './index.css';" : '';
  // The non-null assertion (`!`) is valid TS; in a `.jsx` project it is dropped by writing plain JS below.
  if (hasTs) {
    return `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';${cssImport}\n${body}\n`;
  }
  return `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';${cssImport}\n${body.replace('!)', ')')}\n`;
}

/**
 * Guarantee a vite-react app has the foundational files it needs to install & boot. Returns ONLY the
 * files that were MISSING (from both `files` and `existingPaths`) — a caller writes them and installs.
 * Idempotent: run it again on the completed set and it returns nothing. PURE.
 */
export function ensureViteReactFoundation(files: Record<string, string>, opts?: FoundationOptions): FoundationResult {
  const result: FoundationResult = { files: {}, added: [] };
  if (!isViteReactTarget(opts?.framework, files)) return result;

  const appName = (opts?.appName || 'App').trim() || 'App';
  const present = new Set<string>([...Object.keys(files), ...(opts?.existingPaths || [])]);
  const hasBasename = (name: string): boolean =>
    present.has(name) || [...present].some((p) => p === name || p.endsWith('/' + name));
  const hasTs = [...present].some((p) => /\.tsx?$/i.test(p) && !/\.d\.ts$/i.test(p))
    || Object.keys(files).some((p) => /\.tsx?$/i.test(p));

  const add = (path: string, content: string, label: string): void => {
    result.files[path] = content;
    result.added.push(label);
    present.add(path); // so downstream detectors see it (e.g. index.html referencing a just-added entry)
  };

  // 1. package.json — the evidenced failure. Without it NOTHING installs.
  if (!hasBasename('package.json')) {
    add('package.json', synthesizePackageJson(files, appName, hasTs), 'package.json');
  }
  // 2. An app entry — only when the app has code (an App component) but no entry to mount it.
  const hasEntry = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/index.tsx', 'src/index.jsx']
    .some((e) => present.has(e));
  const hasApp = present.has('src/App.tsx') || present.has('src/App.jsx');
  if (!hasEntry && hasApp) {
    add(hasTs ? 'src/main.tsx' : 'src/main.jsx', synthesizeEntry(present, hasTs), hasTs ? 'src/main.tsx' : 'src/main.jsx');
  }
  // 3. index.html — Vite serves it at the project root; without it the dev server has nothing to load.
  if (!hasBasename('index.html')) {
    add('index.html', synthesizeIndexHtml(appName, detectEntry(present)), 'index.html');
  }
  // 4. vite.config — its absence makes `vite` fall back to defaults that miss the React plugin (JSX breaks).
  if (!present.has('vite.config.ts') && !present.has('vite.config.js') && !present.has('vite.config.mts')) {
    add('vite.config.ts', VITE_CONFIG_TS, 'vite.config.ts');
  }
  // 5. tsconfig.json — only when the app actually contains TypeScript; a JS app needs none.
  if (hasTs && !hasBasename('tsconfig.json')) {
    add('tsconfig.json', TSCONFIG_JSON, 'tsconfig.json');
  }
  // The release typecheck config, so a broken test can never block a release build — see above.
  if (hasTs && !hasBasename('tsconfig.build.json')) {
    add('tsconfig.build.json', TSCONFIG_BUILD_JSON, 'tsconfig.build.json');
  }
  return result;
}

export interface TsconfigExtendsFix {
  file: string;
  removed: string[];
}
export interface TsconfigSanitizeResult {
  patch: Record<string, string>;
  fixes: TsconfigExtendsFix[];
  /** Paths whose trailing apply-patch / merge-conflict markup was dropped (BR1982). */
  stripped?: string[];
}

const TSCONFIG_BASENAME_RE = /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/i;

/** Tolerant JSONC parse (tsconfig allows // and block comments + trailing commas). Returns null on failure
 *  so the caller leaves the file untouched. */
export function parseTsconfigJsonc(text: string): Record<string, unknown> | null {
  return parseJsonc(text);
}

function parseJsonc(text: string): Record<string, unknown> | null {
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(text);
  if (direct) return direct;
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:"'])\/\/[^\n\r]*/g, '$1') // line comments (leave http:// etc.)
    .replace(/,(\s*[}\]])/g, '$1'); // trailing commas
  return attempt(stripped);
}

/** The package name of a BARE module specifier (null for a relative/absolute path, which is always kept). */
function tsconfigExtendsPackage(spec: unknown): string | null {
  if (typeof spec !== 'string' || !spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

function tsconfigDeclaredPackages(files: Record<string, string>): Set<string> {
  const set = new Set<string>();
  const raw = files['package.json'];
  if (typeof raw !== 'string') return set;
  const pkg = parseJsonc(raw);
  if (pkg) {
    const deps = { ...(pkg.dependencies as Record<string, unknown> | undefined), ...(pkg.devDependencies as Record<string, unknown> | undefined) };
    for (const k of Object.keys(deps)) set.add(k);
  }
  return set;
}

/**
 * Strip a tsconfig `extends` that points at a BARE package which is NOT an installed dependency — an
 * unresolvable base that hard-breaks the build. Autopsy buildId 9245f090: a generated `tsconfig.app.json`
 * did `"extends": "@tsconfig/react/tsconfig.json"`, but `@tsconfig/react` does NOT exist on npm (E404), so
 * Vite died at startup with `TSConfckParseError: failed to resolve "extends"` and the dev server never
 * came up — then the agent burned time trying to `npm install` the phantom package. A Vite-React tsconfig
 * is self-contained, so removing the dangling extends restores a working config.
 *
 * SAFE by construction: only ever removes a BARE-package extends whose package is absent from package.json
 * (a relative `./base.json` extends, or an extends whose package IS a declared dependency, is always kept),
 * and only touches tsconfig files that parse. Returns a patch of just the changed files. Pure — never
 * mutates its input. Unit-tested.
 */
export function sanitizeTsconfigExtends(files: Record<string, string>): TsconfigSanitizeResult {
  const patch: Record<string, string> = {};
  const fixes: TsconfigExtendsFix[] = [];
  if (!files || typeof files !== 'object') return { patch, fixes };
  const declared = tsconfigDeclaredPackages(files);
  for (const [path, content] of Object.entries(files)) {
    if (!TSCONFIG_BASENAME_RE.test(path) || typeof content !== 'string') continue;
    const json = parseJsonc(content);
    if (!json || json.extends == null) continue;
    const removed: string[] = [];
    const isResolvable = (entry: unknown): boolean => {
      const pkg = tsconfigExtendsPackage(entry);
      if (pkg === null) return true; // relative/absolute extends → keep
      if (declared.has(pkg)) return true; // an installed dependency → keep
      removed.push(String(entry));
      return false; // bare package NOT in package.json → unresolvable → drop
    };
    if (Array.isArray(json.extends)) {
      const kept = (json.extends as unknown[]).filter(isResolvable);
      if (removed.length === 0) continue;
      if (kept.length === 0) delete json.extends;
      else json.extends = kept.length === 1 ? kept[0] : kept;
    } else {
      if (isResolvable(json.extends)) continue;
      delete json.extends;
    }
    patch[path] = `${JSON.stringify(json, null, 2)}\n`;
    fixes.push({ file: path, removed });
  }
  return { patch, fixes };
}

/**
 * Strip a tsconfig `references` entry that points at a sibling `tsconfig.node.json` which is not
 * in the file set and not already on disk.
 *
 * Autopsy BR1979 (f6b4a1c4): the fast lane wrote a Vite-style tsconfig.json with
 * `"references": [{ "path": "./tsconfig.node.json" }]` and `"include": ["src"]`, but never wrote
 * tsconfig.node.json. `tsc` failed TS6053, the lane handed off, and the full builder spent the
 * next 15 minutes finishing an app that had already been generated. The official vite-react
 * starter tsconfig has `include: ["src"]` and no project references — the node config is a
 * sibling for vite.config.ts, not something the app tsconfig must list.
 *
 * SAFE by construction (owner t311u):
 *   - only drops a reference whose resolved basename is `tsconfig.node.json`
 *   - and only when that file is absent from `files` AND `existingPaths`
 *   - and only when the tsconfig already has a non-empty `include` or `files` (so a Vite 5
 *     solution-style `{ "files": [], "references": [...] }` is left untouched — stripping its
 *     last reference would leave a config that typechecks nothing)
 *   - other references, relative `extends`, and unparseable JSONC are never touched
 *   - never mutates its input
 *
 * Same kill switch as the extends sanitizer: AGENTV3_TSCONFIG_SANITIZE=off at the call sites.
 */
function normalizeRelPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Resolve a tsconfig `references[].path` against the tsconfig's own directory. Null if not a path. */
function resolveTsconfigReference(fromTsconfigPath: string, refPath: unknown): string | null {
  if (typeof refPath !== 'string' || !refPath.trim()) return null;
  const spec = refPath.trim();
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // bare package — not a file reference
  const dir = fromTsconfigPath.includes('/') ? fromTsconfigPath.slice(0, fromTsconfigPath.lastIndexOf('/')) : '';
  const joined = spec.startsWith('/') ? spec : (dir ? `${dir}/${spec}` : spec);
  return normalizeRelPath(joined);
}

function tsconfigHasOwnSources(json: Record<string, unknown>): boolean {
  return (Array.isArray(json.include) && json.include.length > 0)
    || (Array.isArray(json.files) && json.files.length > 0);
}

export function sanitizeTsconfigReferences(
  files: Record<string, string>,
  existingPaths: readonly string[] = [],
): TsconfigSanitizeResult {
  const patch: Record<string, string> = {};
  const fixes: TsconfigExtendsFix[] = [];
  const stripped: string[] = [];
  if (!files || typeof files !== 'object') return { patch, fixes, stripped };
  const known = new Set<string>([
    ...Object.keys(files).map(normalizeRelPath),
    ...existingPaths.map((p) => normalizeRelPath(String(p))),
  ]);
  for (const [path, content] of Object.entries(files)) {
    if (!TSCONFIG_BASENAME_RE.test(path) || typeof content !== 'string') continue;
    let text = content;
    const cut = stripTrailingConflictMarkup(content);
    if (cut.stripped && parseJsonc(cut.content)) {
      text = cut.content;
      stripped.push(path);
      patch[path] = text;
    }
    const json = parseJsonc(text);
    if (!json || !Array.isArray(json.references) || json.references.length === 0) continue;
    if (!tsconfigHasOwnSources(json)) continue; // solution-style configs stay as they are
    const removed: string[] = [];
    const kept: unknown[] = [];
    for (const entry of json.references as unknown[]) {
      const refPath = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as { path?: unknown }).path
        : undefined;
      const resolved = resolveTsconfigReference(path, refPath);
      const isDanglingNode = !!resolved
        && /(?:^|\/)tsconfig\.node\.json$/i.test(resolved)
        && !known.has(resolved);
      if (isDanglingNode) {
        removed.push(typeof refPath === 'string' ? refPath : resolved);
        continue;
      }
      kept.push(entry);
    }
    if (removed.length === 0) continue;
    if (kept.length === 0) delete json.references;
    else json.references = kept;
    patch[path] = `${JSON.stringify(json, null, 2)}\n`;
    fixes.push({ file: path, removed });
  }
  return { patch, fixes, stripped };
}

/**
 * The foundation's files that are REALLY absent, decided by asking the disk at write time.
 *
 * 🔴 WHY (autopsy 2720e553, 2026-09-27). `ensureViteReactFoundation` decides "missing" from a path
 * list, and the fast lane's list was captured once at the start of the lane and cut to 80 entries of
 * an UNSORTED `find` listing. A working scaffold `package.json` fell outside it, so the guard wrote a
 * generic one over it — the build then had to put back a plugin that was already installed, and the
 * dev server started against config files changed seconds earlier. A list is a hint; the disk is the
 * fact, and the promise this guard makes ("never overwriting an on-disk file") can only be kept by
 * asking the disk right before the write.
 *
 * `exists` answering false (or throwing) means absent — the same answer a missing file gives, so a
 * probe that cannot run leaves today's behaviour. Order preserved.
 */
export async function foundationFilesStillAbsent(
  foundation: FoundationResult,
  exists: (path: string) => Promise<boolean>,
): Promise<{ files: Record<string, string>; added: string[]; keptExisting: string[] }> {
  const files: Record<string, string> = {};
  const keptExisting: string[] = [];
  for (const [path, content] of Object.entries(foundation.files)) {
    let there = false;
    try { there = await exists(path); } catch { there = false; }
    if (there) keptExisting.push(path);
    else files[path] = content;
  }
  const added = foundation.added.filter((label) => !keptExisting.includes(label));
  return { files, added, keptExisting };
}

// ── A ONE-FILE PAGE IS NOT A REACT APP (single-file game autopsy, 2026-11-14) ──────────────────────────────────
//
// 🔴 WHAT SHIPPED. The admin imported their one-file game (index.html + media files, no package.json). The import was perfect —
// and the preview showed "Blocked request. This host (5173-….e2b.app) is not allowed". The Pro panel's default framework label is
// `vite-react`, so the preview boot ran `ensureViteReactFoundation` over a project that has not one line of React: it
// synthesized a React + Vite package.json and a `vite.config.ts` and started Vite on 5173 to serve a canvas game. Two defects, one
// chain:
//   1. a LABEL decided what the project IS, with no look at the files — the opposite of what `pastedAppFormat.ts` already
//      says for pasted pages ("the format that was pasted is the format that comes back");
//   2. the synthesized config was a drifted copy of the template's: `host: true` with no `allowedHosts`, so the E2B preview host
//      was refused by the very server the platform had just configured.
//
// 🔑 THE RULE: a project whose files are plain pages (html/css/classic scripts, no module imports, no JSX/TS, no package.json)
// is a STATIC SITE. It gets the static runner the static template already uses (`http-server`, port 3000), never Vite.
const STATIC_SITE_PACKAGE = JSON.stringify({
  name: 'static-site',
  version: '1.0.0',
  scripts: {
    dev: 'npx http-server . -p 3000 -c-1 --cors',
    start: 'npx http-server . -p 3000 -c-1 --cors',
    build: 'echo "Static site — no build step needed"',
  },
  devDependencies: {},
}, null, 2);

/** The static runner marks itself: a package.json whose dev script is `npx http-server …` is our static-site package. */
function isStaticSitePackage(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const dev = String(JSON.parse(raw)?.scripts?.dev ?? '');
    return /^npx\s+http-server\b/.test(dev);
  } catch { return false; }
}

/**
 * Is this file set a static site — pages, styles, classic scripts and media, with nothing that needs a bundler? PURE.
 * Either no package.json at all, or the static-site package.json this module writes (so a second boot is judged the same way).
 */
export function isStaticSiteProject(files: Record<string, string>): boolean {
  const paths = Object.keys(files);
  if (!paths.some((p) => /\.html?$/i.test(p))) return false;
  const pkgPath = paths.find((p) => p === 'package.json');
  if (paths.some((p) => /(^|\/)package\.json$/.test(p) && p !== 'package.json')) return false; // a nested package: not ours to judge
  if (pkgPath && !isStaticSitePackage(files[pkgPath])) return false;
  // Anything that needs compiling or bundling makes it a framework project.
  if (paths.some((p) => /\.(tsx|jsx|ts|vue|svelte|astro)$/i.test(p) && !/\.d\.ts$/i.test(p))) return false;
  if (paths.some((p) => /(^|\/)(vite|next|nuxt|astro|svelte|webpack|rollup)\.config\.[cm]?[jt]s$/i.test(p))) return false;
  // A script file that imports a module, or an inline module script, is a bundled app.
  const esImport = /(^|\n)\s*import\s[^\n]*\sfrom\s*['"]|(^|\n)\s*import\s*['"]|\brequire\(\s*['"]/;
  for (const [p, c] of Object.entries(files)) {
    if (/\.(m?js|cjs)$/i.test(p) && esImport.test(c ?? '')) return false;
    if (/\.html?$/i.test(p) && /<script[^>]*type\s*=\s*["']module["'][^>]*>[\s\S]*?\bimport\b/i.test(c ?? '')) return false;
  }
  return true;
}

/**
 * The foundation a static site needs to boot a live preview: ONE file, its static-server package.json, when it has none.
 * Empty `added` when the project is not a static site or already has it. Never overwrites. PURE.
 */
export function ensureStaticSiteFoundation(files: Record<string, string>): FoundationResult {
  const result: FoundationResult = { files: {}, added: [] };
  if (!isStaticSiteProject(files)) return result;
  if (Object.prototype.hasOwnProperty.call(files, 'package.json')) return result;
  result.files['package.json'] = STATIC_SITE_PACKAGE;
  result.added.push('package.json');
  return result;
}

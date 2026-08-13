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
  vite: '^5.4.10',
  '@vitejs/plugin-react': '^4.3.4',
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
  server: { host: true },
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
}

const TSCONFIG_BASENAME_RE = /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/i;

/** Tolerant JSONC parse (tsconfig allows // and block comments + trailing commas). Returns null on failure
 *  so the caller leaves the file untouched. */
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

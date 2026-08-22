// The app that cannot serve one request, because nobody loaded its own .env.
//
// ADMIN REPORT 2026-08-22 (an Express build). The preview answered every request with
// `{"message":"secret option required for sessions"}`. The engine's own diagnosis, in the transcript:
//
//     "The root cause is clear: the `.env` file exists with `SESSION_SECRET`, but the server never
//      loads it. The code uses `process.env.SESSION_SECRET` but there's no `dotenv` configuration."
//
// It then healed itself — read four files, ran four commands, edited the entry, restarted, re-probed.
// Minutes of a paid build spent cleaning up a defect the platform had just created.
//
// 🔴 WHY THIS MODULE EXISTS RATHER THAN A BETTER HEAL (the 50/50 law). This class has been fixed
// before, on 2026-08-02, after the Mitrify autopsy of the SAME failure with `DATABASE_URL` — and the
// fix was a runtime WORKAROUND: `E2BActuator` prefixes `set -a; . ./.env; set +a` onto the dev-server
// launch so the app inherits the values whether or not it loads them. That workaround has three holes:
//
//   1. It covers exactly ONE start path. A server the agent starts itself, a plain `node index.js`,
//      the recovery path — none of them get it.
//   2. It does not travel. `npm start` on the user's own machine, a Render deploy, a Docker image:
//      the app is still broken everywhere except inside our sandbox, so we would be shipping an app
//      that only works here. That is the worst kind of green.
//   3. It left the generator free to keep producing the bug, which is why the same class returned
//      three weeks later wearing a different variable name.
//
// So this is the OTHER half: make the app correct, in its own source, at build time. Deterministic,
// pure, free (no LLM, no sandbox), and conservative by construction — every rule below exists to make
// a false positive impossible, because injecting an import into a working app is the one way this
// could do harm.

/** A `.env`-family file: `.env`, `.env.local`, `.env.development`… but never `.env.example`. */
function isEnvFile(path: string): boolean {
  const name = path.split('/').pop() || path;
  if (!/^\.env(\..+)?$/i.test(name)) return false;
  // A sample file is documentation, not configuration — its keys are placeholders nobody reads.
  return !/\.(example|sample|template|dist)$/i.test(name);
}

/** The KEY names a dotenv file actually defines. Pure; ignores comments, blanks and `export` prefixes. */
export function envFileKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of String(content ?? '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(t);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/**
 * Keys the RUNTIME already provides, so reading one proves nothing about dotenv.
 *
 * `NODE_ENV` is set by every process manager; `PORT` is set by every host (and by our own sandbox), so
 * an app reading `process.env.PORT` with a `.env` that also sets it is not evidence of a bug — it runs
 * fine either way. Requiring at least one key OUTSIDE this set is what keeps the check honest.
 */
const RUNTIME_PROVIDED = new Set(['NODE_ENV', 'PORT', 'HOST', 'HOME', 'PATH', 'PWD', 'TZ', 'CI']);

/**
 * Frameworks that read `.env` THEMSELVES. Injecting dotenv into one of these is not merely redundant —
 * it can change which values win, since these tools apply their own precedence and prefixing rules
 * (Vite only exposes `VITE_*`, Next has its own `.env.local` order). Never touch them.
 */
const SELF_LOADING = [
  'vite', 'next', 'nuxt', 'astro', '@remix-run/dev', '@sveltejs/kit', 'react-scripts',
  'expo', '@angular/cli', 'gatsby', '@nestjs/config', 'dotenv-webpack',
];

/** Every way a Node project can already be loading its env. Pure. */
export function loadsEnvAlready(files: Record<string, string>): boolean {
  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string') continue;
    if (path === 'package.json') {
      // `node -r dotenv/config`, `dotenv -e .env --`, and Node 20's native `--env-file=.env` all load
      // it without a line of app code. Any of them means the app is already handled.
      if (/dotenv|--env-file/.test(raw)) return true;
      continue;
    }
    if (!/\.(m|c)?[jt]sx?$/i.test(path)) continue;
    if (/require\(\s*['"]dotenv['"]\s*\)/.test(raw)) return true;
    if (/from\s+['"]dotenv(\/config)?['"]/.test(raw)) return true;
    if (/import\s+['"]dotenv\/config['"]/.test(raw)) return true;
    if (/\bdotenv\s*\.\s*config\s*\(/.test(raw)) return true;
    if (/\bloadEnv(File)?\s*\(/.test(raw)) return true; // Vite's loadEnv / Node's experimental loader
  }
  return false;
}

function parsePackageJson(files: Record<string, string>): Record<string, unknown> | null {
  const raw = files['package.json'];
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    // An unreadable manifest is not a licence to guess at the project's shape.
    return null;
  }
}

function declaredDeps(pkg: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg[field];
    if (deps && typeof deps === 'object') out.push(...Object.keys(deps as Record<string, unknown>));
  }
  return out;
}

const ENTRY_CANDIDATES = [
  'src/index.ts', 'src/index.js', 'src/index.mjs',
  'src/server.ts', 'src/server.js',
  'src/app.ts', 'src/app.js',
  'src/main.ts', 'src/main.js',
  'server/index.ts', 'server/index.js',
  'index.ts', 'index.js', 'index.mjs',
  'server.ts', 'server.js', 'app.js', 'app.ts',
];

/**
 * The file the app actually STARTS from — the only correct place to load env, since a later import
 * would run after modules that read `process.env` at their top level.
 *
 * Authority order, most explicit first: the start/dev script the project itself runs, then `main`,
 * then convention. A guess that is not backed by one of those returns null, and null means we do
 * nothing at all. Pure.
 */
export function dotenvEntryFile(files: Record<string, string>): string | null {
  const pkg = parsePackageJson(files);
  const scripts = (pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}) as Record<string, unknown>;
  for (const name of ['start', 'dev', 'serve']) {
    const script = scripts[name];
    if (typeof script !== 'string') continue;
    // Any path-looking token in the script that is a real file in this project.
    for (const token of script.split(/\s+/)) {
      const cleaned = token.replace(/^\.\//, '');
      if (/\.(m|c)?[jt]sx?$/i.test(cleaned) && typeof files[cleaned] === 'string') return cleaned;
    }
  }
  const main = pkg?.main;
  if (typeof main === 'string') {
    const cleaned = main.replace(/^\.\//, '');
    if (typeof files[cleaned] === 'string') return cleaned;
  }
  return ENTRY_CANDIDATES.find((p) => typeof files[p] === 'string') ?? null;
}

export interface MissingEnvWiring {
  /** The entry file that should load the env. */
  entry: string;
  /** The keys the app reads from `.env` but would never receive. Sorted, for a stable message. */
  keys: string[];
  /** ESM gets `import 'dotenv/config'`, CommonJS gets `require('dotenv').config()`. */
  moduleKind: 'esm' | 'cjs';
}

/** True when the entry (or its package) is ES modules. */
function isEsm(files: Record<string, string>, entry: string): boolean {
  const pkg = parsePackageJson(files);
  if (pkg?.type === 'module') return true;
  if (/\.mts$|\.mjs$/i.test(entry)) return true;
  if (/\.cts$|\.cjs$/i.test(entry)) return false;
  const src = files[entry] ?? '';
  // A file that already uses `import x from` is ESM regardless of what package.json says, because
  // whatever runs it (tsx, ts-node/esm, a bundler) is already treating it that way.
  if (/^\s*import\s+[\w{*]/m.test(src)) return true;
  return !/\brequire\s*\(/.test(src) ? true : false;
}

/**
 * Does this project read its own `.env` without ever loading it? Returns null when it does not — and
 * null is the answer for every case we are not certain about. Pure.
 */
export function findMissingDotenvWiring(files: Record<string, string>): MissingEnvWiring | null {
  const pkg = parsePackageJson(files);
  if (!pkg) return null; // not a Node project, or a manifest we cannot read

  const deps = declaredDeps(pkg);
  // A self-loading framework handles .env with its own precedence rules — never interfere.
  if (deps.some((d) => SELF_LOADING.includes(d))) return null;
  if (loadsEnvAlready(files)) return null;

  // The keys the project's OWN .env defines, minus the ones the runtime supplies anyway.
  const defined = new Set<string>();
  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw === 'string' && isEnvFile(path)) for (const k of envFileKeys(raw)) defined.add(k);
  }
  if (defined.size === 0) return null;

  // …and of those, the ones the code actually reads. Reading is what turns a stale .env into a crash.
  const read = new Set<string>();
  for (const [path, raw] of Object.entries(files)) {
    if (typeof raw !== 'string') continue;
    if (!/\.(m|c)?[jt]sx?$/i.test(path)) continue;
    for (const m of raw.matchAll(/process\s*\.\s*env\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)) {
      const key = m[1] || m[2];
      if (key && defined.has(key) && !RUNTIME_PROVIDED.has(key)) read.add(key);
    }
  }
  if (read.size === 0) return null;

  const entry = dotenvEntryFile(files);
  if (!entry) return null;

  return { entry, keys: [...read].sort(), moduleKind: isEsm(files, entry) ? 'esm' : 'cjs' };
}

/** The one line that fixes it, in the entry's own module system. Pure. */
export function dotenvLoadLine(kind: 'esm' | 'cjs'): string {
  return kind === 'esm' ? "import 'dotenv/config';" : "require('dotenv').config();";
}

/**
 * DETERMINISTIC FIX: put the load FIRST in the entry file.
 *
 * First, not merely present — a module that reads `process.env` while being imported runs before any
 * statement below its import, so a dotenv call placed after the other imports is a fix that silently
 * does not work. In ESM the import is hoisted with the rest, and being first is what orders it ahead
 * of them.
 *
 * Returns the files unchanged (and `wired: null`) when there is nothing certain to do. `dotenv` itself
 * does not need declaring here: it is on DependencyAutoFix's well-known allowlist, so the import we add
 * is what causes it to be installed.
 */
export function injectDotenvLoad(
  files: Record<string, string>,
): { files: Record<string, string>; wired: MissingEnvWiring | null } {
  const missing = findMissingDotenvWiring(files);
  if (!missing) return { files, wired: null };
  const src = files[missing.entry];
  if (typeof src !== 'string') return { files, wired: null };
  const line = dotenvLoadLine(missing.moduleKind);
  if (src.includes(line)) return { files, wired: null };
  // Keep a shebang on line 1 — moving it turns an executable script into a syntax error.
  const shebang = /^#![^\n]*\n/.exec(src);
  const patched = shebang
    ? `${shebang[0]}${line}\n${src.slice(shebang[0].length)}`
    : `${line}\n${src}`;
  return { files: { ...files, [missing.entry]: patched }, wired: missing };
}

/** The honest one-liner for the build report. Pure. */
export function dotenvWiringMessage(w: MissingEnvWiring): string {
  const keys = w.keys.slice(0, 4).join(', ') + (w.keys.length > 4 ? `, +${w.keys.length - 4} more` : '');
  return `Your app read ${keys} from its .env file, but nothing loaded that file — every one of those `
    + `values would have been undefined at runtime. Added the one line that loads them to ${w.entry}.`;
}

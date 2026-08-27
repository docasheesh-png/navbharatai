// TAILWIND SETUP — detect a broken Tailwind wiring BEFORE the GitHub runner dies on it, and complete
// it deterministically.
//
// WHY (the APK-pipeline hardening, 2026-08-27): the compile preflight scans JS/TS imports, so an app
// that STYLES itself with Tailwind — `@tailwind base/components/utilities` in its CSS, or a
// tailwind.config.js — but never declares `tailwindcss` in package.json sailed straight through every
// check and died five minutes later on the runner, inside PostCSS, with a log a non-technical user
// cannot act on. CSS is not an import graph the reconciler walks, so this is its own check.
//
// WHY DETERMINISTIC: completing a Tailwind v3 setup has exactly one correct shape — the three packages
// at their curated pins, a postcss.config that names tailwindcss + autoprefixer, a tailwind.config with
// content globs. There is nothing for a model to decide, so nothing here calls one.
//
// 🔒 THE VERSION IS v3 ON PURPOSE, AND THIS MODULE MUST AGREE WITH THE ALLOWLIST. WELL_KNOWN_DEPS pins
// `tailwindcss: '^3'` (LedgerLoop autopsy 2026-07-20): v4 removed the CLI and moved to CSS-first config,
// so the v3 conventions every generated app carries all fail on it. The pin is IMPORTED from that one
// table, never re-typed — two copies of a version policy is how they drift apart.
//
// The v4 import line (`@import "tailwindcss";`) gets the same treatment in reverse: with v3 installed,
// that line is an unresolvable CSS import and the build dies. It is rewritten to the three v3
// directives — the exact same stylesheet under the major this project actually installs.
//
// PURE: files in, files out. No network, no filesystem.

import { WELL_KNOWN_DEPS } from '../AgentV3/DependencyAutoFix';

/** The v3 companion pins. tailwindcss itself comes from the shared allowlist. */
const POSTCSS_PIN = '^8';
const AUTOPREFIXER_PIN = '^10';

const TAILWIND_DIRECTIVE = /@tailwind\s+(?:base|components|utilities)\b/;
/** Tailwind v4's CSS-first entry — fatal under the v3 this pipeline installs. */
const V4_IMPORT = /^\s*@import\s+(['"])tailwindcss\1\s*;?\s*$/m;
const TAILWIND_CONFIG = /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/;
const POSTCSS_CONFIG = /(^|\/)postcss\.config\.(js|cjs|mjs|ts|json)$/;
const CSS_FILE = /\.css$/i;

export interface TailwindProblem {
  /** The file that proves Tailwind is in use. */
  path: string;
  kind: 'undeclared' | 'v4-import';
  message: string;
}

interface Pkg {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

function parsePkg(files: Record<string, string>): Pkg | null {
  const raw = files['package.json'];
  if (typeof raw !== 'string') return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as Pkg) : null;
  } catch {
    return null;
  }
}

function declaredRange(pkg: Pkg | null): string | null {
  if (!pkg) return null;
  return pkg.dependencies?.tailwindcss ?? pkg.devDependencies?.tailwindcss ?? null;
}

/** Does any file prove the app styles itself with Tailwind? Returns the proving file, or null. */
function tailwindEvidence(files: Record<string, string>): string | null {
  for (const [path, content] of Object.entries(files)) {
    if (TAILWIND_CONFIG.test(path)) return path;
    if (CSS_FILE.test(path) && typeof content === 'string'
      && (TAILWIND_DIRECTIVE.test(content) || V4_IMPORT.test(content))) return path;
  }
  return null;
}

/**
 * Name what is wrong with this app's Tailwind wiring. Empty array = nothing wrong (including: the app
 * simply does not use Tailwind, or it declares v4 deliberately — a declared ^4 is respected, not
 * "corrected", because rewriting a setup someone chose on purpose is how a working app gets broken).
 */
export function detectTailwindProblems(files: Record<string, string>): TailwindProblem[] {
  const evidence = tailwindEvidence(files);
  if (!evidence) return [];

  const problems: TailwindProblem[] = [];
  const range = declaredRange(parsePkg(files));

  if (!range) {
    problems.push({
      path: 'package.json',
      kind: 'undeclared',
      message: 'the app imports "tailwindcss" styles but package.json does not declare it',
    });
  }

  // The v4 import line only breaks a v3 install. Undeclared counts as v3 because that is what the
  // heal (and the allowlist) will install; an explicit 4.x declaration is left entirely alone.
  const effectiveV3 = !range || /^[\^~]?3(\.|$)/.test(range.trim());
  if (effectiveV3) {
    for (const [path, content] of Object.entries(files)) {
      if (CSS_FILE.test(path) && typeof content === 'string' && V4_IMPORT.test(content)) {
        problems.push({
          path,
          kind: 'v4-import',
          message: 'uses the new Tailwind import style, which the Tailwind version this app installs does not support',
        });
      }
    }
  }
  return problems;
}

export interface TailwindHealResult {
  files: Record<string, string>;
  /** Only what changed. Empty = nothing to do. */
  changed: Record<string, string>;
  notes: string[];
}

/**
 * Complete the v3 setup: declare the three packages at their pins, write the two configs when absent,
 * rewrite the v4 import line. Idempotent — running it on a healthy project changes nothing.
 */
export function applyTailwindSetup(input: Record<string, string>): TailwindHealResult {
  const unchanged: TailwindHealResult = { files: input, changed: {}, notes: [] };
  const problems = detectTailwindProblems(input);
  if (problems.length === 0) return unchanged;

  const pkg = parsePkg(input);
  if (!pkg) return unchanged; // an unparseable package.json is the syntax check's finding, not ours

  const files = { ...input };
  const changed: Record<string, string> = {};
  const notes: string[] = [];

  if (problems.some((p) => p.kind === 'undeclared')) {
    // devDependencies on purpose: Tailwind is a build-time tool; shipping it as a runtime dependency
    // is the mistake a careful reviewer would flag next.
    const dev = { ...(pkg.devDependencies ?? {}) };
    const before = JSON.stringify(dev);
    if (!pkg.dependencies?.tailwindcss && !dev.tailwindcss) dev.tailwindcss = WELL_KNOWN_DEPS.tailwindcss;
    if (!pkg.dependencies?.postcss && !dev.postcss) dev.postcss = POSTCSS_PIN;
    if (!pkg.dependencies?.autoprefixer && !dev.autoprefixer) dev.autoprefixer = AUTOPREFIXER_PIN;
    if (JSON.stringify(dev) !== before || !pkg.devDependencies) {
      const next = { ...pkg, devDependencies: dev };
      files['package.json'] = JSON.stringify(next, null, 2) + '\n';
      changed['package.json'] = files['package.json'];
      notes.push('Set up Tailwind so your app’s styling actually builds (it was used but never installed).');
    }

    // The configs only when the packages were missing too — an app that declared Tailwind but keeps
    // its config somewhere unusual is left alone.
    if (!Object.keys(files).some((p) => POSTCSS_CONFIG.test(p)) && !('postcss' in pkg)) {
      files['postcss.config.js'] = 'module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n';
      changed['postcss.config.js'] = files['postcss.config.js'];
    }
    if (!Object.keys(files).some((p) => TAILWIND_CONFIG.test(p))) {
      files['tailwind.config.js'] =
        '/** @type {import(\'tailwindcss\').Config} */\n'
        + 'module.exports = {\n'
        + "  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n"
        + '  theme: { extend: {} },\n'
        + '  plugins: [],\n'
        + '};\n';
      changed['tailwind.config.js'] = files['tailwind.config.js'];
    }
  }

  for (const p of problems) {
    if (p.kind !== 'v4-import') continue;
    const content = files[p.path];
    if (typeof content !== 'string') continue;
    const next = content.replace(V4_IMPORT, '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
    if (next !== content) {
      files[p.path] = next;
      changed[p.path] = next;
      notes.push('Adjusted your stylesheet to the Tailwind version this app installs.');
    }
  }

  return { files, changed, notes };
}

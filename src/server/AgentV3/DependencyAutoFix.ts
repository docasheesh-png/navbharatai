// P-PIPE.40 — dependency auto-fix planner (advisory).
//
// DependencyAnalysis already detects packages that are IMPORTED but not declared in package.json
// (kind: 'missing', high). Two problems with just reporting that bluntly: (1) a real missing npm
// package (e.g. `react-router-dom`) deserves an EXACT, version-pinned "add this" instruction, and
// (2) a false positive — a bare local path alias like `components/Button` or `lib/api` that the
// import scanner can't resolve (tsconfig `paths` / vite `resolve.alias` aren't resolved) — must NOT
// be reported as a missing npm package, or the user is told to install something that doesn't exist.
//
// This module PARTITIONS the missing set against a curated allowlist of well-known npm packages:
//   • on the allowlist  → an exact `name@^range` add suggestion the builder can apply with edit_file
//   • otherwise         → a softened "verify — may be a local alias, not an npm package" note
// It NEVER touches package.json or the install path (the builder applies fixes under its own
// judgment, a second false-positive filter). Pure, no I/O, never throws. Advisory report content only.

import { analyzeDependencies, type DependencyIssue } from './DependencyAnalysis';

/**
 * Curated well-known npm packages → a known-good caret range. Deliberately EXCLUDES bare names that
 * commonly collide with local path aliases (components, lib, utils, hooks, api, store, types, pages,
 * features, styles, assets, config) — those must fall through to "verify", never auto-suggested.
 * Every entry here is an unambiguous, real npm package an AgentV3-generated React/Vite app uses.
 */
/**
 * Test-runner packages — declared in devDependencies, never in dependencies.
 *
 * THE DEFECT (admin build report 2026-08-24, and the REVIEWER caught it before we did): a build wrote
 * `app/page.test.tsx`, `e2e/smoke.spec.ts` and `playwright.config.ts`, importing `vitest` and
 * `@playwright/test` — and declared neither. Its own reviewer wrote: *"Test file imports vitest but the
 * package is not listed in package.json devDependencies. The `declare module 'vitest'` block at the top
 * is a workaround for missing types."* The vaccine then reported TEST_SUITE_UNVERIFIED — a suite that
 * exists and cannot run, which is the worst of both: it looks like coverage and proves nothing.
 *
 * The reconciler that should have caught this has worked since 2026-07-13, and simply had no test
 * packages in its allowlist. So the app that most needed the fix — one the engine had just written
 * tests for — was the one shape it could not see.
 *
 * SEPARATE FROM `WELL_KNOWN_DEPS` BECAUSE THE SECTION MATTERS. Putting a test runner in `dependencies`
 * ships it to production, bloats every install and is exactly the mistake a careful reviewer would flag
 * next. Same allowlist discipline: real packages, known-good caret ranges, nothing ambiguous.
 */
export const WELL_KNOWN_DEV_DEPS: Record<string, string> = {
  vitest: '^2',
  '@vitest/coverage-v8': '^2',
  '@playwright/test': '^1',
  '@testing-library/react': '^16',
  '@testing-library/dom': '^10',
  '@testing-library/jest-dom': '^6',
  '@testing-library/user-event': '^14',
  jsdom: '^25',
  // TAILWIND IS A BUILD TOOL, AND THIS ENTRY MOVED HERE FROM THE PRODUCTION MAP (2026-08-27).
  // It was the last allowlisted package still written into `dependencies` despite being build-only,
  // where `detectMisplacedDevTools` then flagged it as the user's mistake — NavBharatAI creating
  // the very finding it reported, in the same build. Safe to move: every reader of this dependency
  // (styling detector, preference store, package health, deploy planner) reads BOTH sections or
  // detects from tailwind.config.*, and this repo's own package.json declares it as a devDependency.
  //
  // The v3 pin below is load-bearing and travels with it (LedgerLoop autopsy 2026-07-20): a bare
  // `npm install tailwindcss` pulls v4, which REMOVED the `tailwindcss init -p` CLI and the
  // `node_modules/.bin/tailwindcss` binary and switched to CSS-first config — so every v3
  // convention an LLM emits fails. The builder burned 5 failed commands on this.
  tailwindcss: '^3',
};

export const WELL_KNOWN_DEPS: Record<string, string> = {
  'react-router-dom': '^6',
  'react-router': '^6',
  zustand: '^4',
  axios: '^1',
  '@tanstack/react-query': '^5',
  swr: '^2',
  clsx: '^2',
  classnames: '^2',
  'tailwind-merge': '^2',
  'class-variance-authority': '^0.7.0',
  dayjs: '^1',
  'date-fns': '^3',
  'framer-motion': '^11',
  zod: '^3',
  yup: '^1',
  'react-hook-form': '^7',
  '@hookform/resolvers': '^3',
  'lucide-react': '^0.400.0',
  'react-icons': '^5',
  '@heroicons/react': '^2',
  '@headlessui/react': '^2',
  '@radix-ui/react-dialog': '^1',
  recharts: '^2',
  'chart.js': '^4',
  'react-chartjs-2': '^5',
  uuid: '^9',
  nanoid: '^5',
  immer: '^10',
  'react-hot-toast': '^2',
  sonner: '^1',
  '@supabase/supabase-js': '^2',
  firebase: '^10',
  'react-markdown': '^9',
  'react-dropzone': '^14',
  // Full-stack / backend allowlist (TaskFlow autopsy 2026-07-17): a Node+Express+Prisma app imported
  // socket.io but never declared it, so the dev server failed on a missing module. These are the
  // common backend packages a generated full-stack app uses — auto-declared when imported-but-missing.
  express: '^4',
  cors: '^2',
  dotenv: '^16',
  'cookie-parser': '^1',
  bcrypt: '^5',
  bcryptjs: '^2',
  jsonwebtoken: '^9',
  'socket.io': '^4',
  'socket.io-client': '^4',
  // Prisma pinned to the last well-understood pre-7 major (EventHive autopsy 2026-07-18). Prisma 7.8
  // moved the datasource `url` OUT of schema.prisma into a new `prisma.config.ts` and broke the ESM
  // seed loader — a bare `npm install prisma` pulled 7.x and bricked the DB setup. 6.x keeps the classic
  // format the scaffold/guards already generate. See pinKnownDepsInInstallCommand (enforces this on the
  // agent's bare install, not just the reconciler path).
  '@prisma/client': '^6',
  prisma: '^6',
  morgan: '^1',
  helmet: '^7',
  multer: '^1',
  'express-validator': '^7',
  ws: '^8',
  // Vue ecosystem (EventHive autopsy 2026-07-18): a full-stack Vue app imported vue-router/pinia but
  // never declared them, so the reconciler bare-installed `npm install vue-router` → npm pulled the
  // LATEST (5.x), whose peer wants Vite 7/8 while the Vue scaffold ships Vite 5 → ERESOLVE → dev server
  // never booted. Pinning the Vue-3-compatible majors here means applyWellKnownMissingDeps declares the
  // right range in package.json BEFORE the install, so a plain `npm install` resolves cleanly.
  'vue-router': '^4',
  pinia: '^2',
  '@vueuse/core': '^11',
  'vue-i18n': '^10',
  // Map ecosystem (CargoPilot autopsy 2026-07-19): a Next.js 14 app (react@18) ran
  // `npm install react-leaflet` → npm pulled the LATEST (5.x), whose peer REQUIRES react@^19 →
  // ERESOLVE, and the --legacy-peer-deps recovery corrupted node_modules until the `next` binary
  // itself was pruned → dev server dead. react-leaflet@4 is the react-18-compatible major; leaflet
  // is stable at 1.x. Pinning the bare install here resolves the tree cleanly on the react-18 scaffolds.
  'react-leaflet': '^4',
  leaflet: '^1',
};

/**
 * The pinned version for a package, from EITHER allowlist, or '' when it is not one of ours.
 *
 * One lookup, so a package can never be pinned in one place and unpinned in another purely because of
 * which section of package.json it belongs to. `hasOwnProperty` rather than a bare index, so a name
 * like `constructor` or `toString` cannot resolve through the prototype chain to something truthy. PURE.
 */
export function knownDepVersion(name: string): string {
  const n = String(name ?? '');
  if (Object.prototype.hasOwnProperty.call(WELL_KNOWN_DEPS, n)) return WELL_KNOWN_DEPS[n];
  if (Object.prototype.hasOwnProperty.call(WELL_KNOWN_DEV_DEPS, n)) return WELL_KNOWN_DEV_DEPS[n];
  return '';
}

// Matches an npm/pnpm/yarn INSTALL sub-command (not `npx prisma generate`, not `npm run`, not a bare
// `npm ci`). Only inside such a sub-command do we treat tokens as package specifiers to pin.
const INSTALL_SUBCOMMAND_RE = /(?:^|\s)(?:npm\s+(?:install|i|add)|pnpm\s+(?:install|i|add)|yarn\s+add)\b/;

/**
 * Pin BARE installs of known-volatile packages to their known-good range, in-place in a shell command.
 *
 * ROOT CAUSE this closes (EventHive/MelodyBox autopsies): the agent types `npm install prisma vue-router`
 * and npm resolves the LATEST — Prisma 7's breaking config/seed (or vue-router 5's Vite-7 peer) then
 * bricks the build. The reconciler's package.json pin never covers this because the explicit install
 * overwrites package.json to latest. Rewriting the command itself is the only choke point that catches it.
 *
 * SAFE by construction: only EXACT bare package tokens (no `@version`) that are in WELL_KNOWN_DEPS, and
 * only inside an install sub-command, are pinned. `npx prisma generate` (not an install) is untouched;
 * `prisma@7` (explicit version) is respected; flags and unknown packages pass through. Pure & deterministic.
 */
export function pinKnownDepsInInstallCommand(command: string): string {
  if (typeof command !== 'string' || !command) return command;
  if (!INSTALL_SUBCOMMAND_RE.test(command)) return command; // fast path: no install at all
  // Split on shell separators (keeping them) so each sub-command is judged independently.
  return command
    .split(/(\s*(?:&&|\|\||;)\s*)/)
    .map((segment) => {
      if (!INSTALL_SUBCOMMAND_RE.test(segment)) return segment; // separators + non-install commands
      // Tokenize on whitespace (keeping it) and pin exact bare known-dep tokens.
      return segment
        .split(/(\s+)/)
        // BOTH allowlists, exactly like planDependencyAutoFix (2026-08-27). A version pin is about WHICH
        // release is safe, never about which package.json section the package ends up in — and reading
        // only the production map meant that moving `tailwindcss` to the dev map silently dropped its
        // v3 pin, which is load-bearing: a bare install pulls v4 and every v3 convention then fails.
        // Its own test caught that, which is why this reads both rather than the pin being special-cased.
        .map((tok) => (knownDepVersion(tok) ? `${tok}@${knownDepVersion(tok)}` : tok))
        .join('');
    })
    .join('');
}

/**
 * The subset of WELL_KNOWN_DEPS where a NEWER MAJOR silently breaks the scaffold, so the version
 * declared IN package.json (not merely in an install command) must be held to the known-good major.
 * Keep this tiny + documented — it FORCES a value onto whatever the LLM wrote, so it must only ever
 * cover deps with a proven breaking major (never a matter of taste).
 */
export const PACKAGE_JSON_FORCE_PINS: Record<string, string> = {
  // Prisma 7 moved the datasource `url` out of schema.prisma into a prisma.config.ts + adapter — the
  // classic `url = env("DATABASE_URL")` the scaffold/guards generate is a hard validation error on 7.x.
  prisma: '^6',
  '@prisma/client': '^6',
};

/** First integer in a semver range ('^7.8.0' → 7, 'latest'/'*'/'' → null). Pure. */
function firstMajor(range: string): number | null {
  const m = /(\d+)/.exec(range || '');
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Force known-BREAKING deps to their known-good major inside a package.json's CONTENT.
 *
 * ROOT CAUSE this closes (LearnLoop autopsy 2026-07-18): #1526 pins bare INSTALL COMMANDS, but the LLM
 * can instead WRITE `package.json` with `"prisma": "^7"` / `"latest"` and then run a plain `npm install`
 * (no package tokens → the command pin never fires) → npm pulls Prisma 7 → its breaking datasource config
 * bricked DB setup and the build looped ~8 `prisma generate` failures + a hallucinated `@prisma/adapter-
 * sqlite@6` 404 downgrade. Pinning the package.json content at write time is the sibling choke point.
 *
 * SAFE by construction: only the curated PACKAGE_JSON_FORCE_PINS deps are touched, and only when the
 * declared MAJOR differs from the pin (or is unpinned like `latest`/`*`) — an already-good `^6.19.3` is
 * left alone. Values-only mutation preserves key order. Any non-JSON / non-object input returns unchanged.
 * Pure + deterministic + unit-testable.
 */
export function pinKnownDepsInPackageJson(content: string): { content: string; changed: string[] } {
  let pkg: unknown;
  try { pkg = JSON.parse(content); } catch { return { content, changed: [] }; }
  if (!pkg || typeof pkg !== 'object') return { content, changed: [] };
  const changed: string[] = [];
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const deps = (pkg as Record<string, unknown>)[section];
    if (!deps || typeof deps !== 'object') continue;
    const depObj = deps as Record<string, unknown>;
    for (const [name, pin] of Object.entries(PACKAGE_JSON_FORCE_PINS)) {
      if (!Object.prototype.hasOwnProperty.call(depObj, name)) continue;
      const cur = String(depObj[name] ?? '');
      if (firstMajor(cur) !== firstMajor(pin)) {
        depObj[name] = pin;
        changed.push(`${name}: ${cur || '(unset)'} → ${pin}`);
      }
    }
  }
  if (changed.length === 0) return { content, changed: [] };
  const trailingNl = content.endsWith('\n') ? '\n' : '';
  return { content: JSON.stringify(pkg, null, 2) + trailingNl, changed };
}

/**
 * The core RUNTIME deps a framework's dev server / build binary needs to exist. If the LLM rewrites
 * package.json and DROPS one of these (or a peer-conflict `npm install` prunes it), the framework
 * binary (`next`, `vite`) vanishes from node_modules and the dev server / build dies.
 *
 * ROOT CAUSE this closes (CargoPilot autopsy 2026-07-19): a Next.js build installed react-leaflet@5
 * (peer react@^19) → ERESOLVE → the `--legacy-peer-deps` recovery churned node_modules until a bare
 * `npm install` PRUNED the `next` package (`sh: 1: next: not found`, `ls node_modules/.bin/next` →
 * absent) → `next build`/dev dead → preview failed. Keys mirror the framework ids the scaffold uses.
 * Conservative majors matching the scaffolds (Next 14 / react 18 / Vue 3). ADD-ONLY — never downgrades
 * an existing pin, only re-adds a core dep that is entirely absent from BOTH deps and devDeps.
 */
export const FRAMEWORK_CORE_DEPS: Record<string, Record<string, string>> = {
  nextjs: { next: '^14', react: '^18', 'react-dom': '^18' },
  next: { next: '^14', react: '^18', 'react-dom': '^18' },
  'vite-react': { react: '^18', 'react-dom': '^18' },
  vite: { react: '^18', 'react-dom': '^18' },
  react: { react: '^18', 'react-dom': '^18' },
  vue: { vue: '^3' },
};

/**
 * Guarantee a written package.json keeps its framework's core runtime deps. ADD-ONLY: a core dep that
 * is present in EITHER `dependencies` or `devDependencies` (at any version) is left untouched; only a
 * fully-absent one is re-added (to `dependencies`) with the scaffold-matching major. Values-only,
 * preserves key order (missing keys appended). Non-JSON / non-object / unknown-framework → unchanged.
 * PURE + deterministic + unit-testable.
 */
export function ensureFrameworkCoreDeps(content: string, framework: string | undefined): { content: string; added: string[] } {
  const core = FRAMEWORK_CORE_DEPS[(framework ?? '').trim()];
  if (!core) return { content, added: [] };
  let pkg: unknown;
  try { pkg = JSON.parse(content); } catch { return { content, added: [] }; }
  if (!pkg || typeof pkg !== 'object') return { content, added: [] };
  const obj = pkg as Record<string, unknown>;
  const dev = obj.devDependencies && typeof obj.devDependencies === 'object' ? (obj.devDependencies as Record<string, unknown>) : {};
  const existingDeps = obj.dependencies && typeof obj.dependencies === 'object' ? (obj.dependencies as Record<string, unknown>) : null;
  const added: string[] = [];
  const toAdd: Array<[string, string]> = [];
  for (const [name, ver] of Object.entries(core)) {
    const inDeps = existingDeps ? Object.prototype.hasOwnProperty.call(existingDeps, name) : false;
    const inDev = Object.prototype.hasOwnProperty.call(dev, name);
    if (!inDeps && !inDev) { toAdd.push([name, ver]); added.push(`${name}@${ver}`); }
  }
  if (toAdd.length === 0) return { content, added: [] };
  const deps = existingDeps ?? {};
  for (const [name, ver] of toAdd) deps[name] = ver;
  obj.dependencies = deps;
  const trailingNl = content.endsWith('\n') ? '\n' : '';
  return { content: JSON.stringify(obj, null, 2) + trailingNl, added };
}

/** Any install sub-command whose real exit code the shell will MASK because it is piped to tail/head. */
const PIPED_INSTALL_RE = /(?:npm|pnpm|yarn)\s+(?:install|i|add|ci)\b[^\n]*\|\s*(?:tail|head)\b/;
/** npm/pnpm/yarn failure signatures that appear in stdout even when the pipe reports exit 0. */
const NPM_FAILURE_RE = /npm error|npm ERR!|ERESOLVE|unable to resolve dependency tree|code E[A-Z]+\b/i;

/**
 * True when an install command was PIPED to tail/head (so the shell reports the pipe's exit 0, not
 * npm's real failure) AND the captured output shows an npm failure. Root cause (CargoPilot autopsy):
 * `npm install … 2>&1 | tail -30` returned "exit 0" while stdout said "npm error code ERESOLVE" — the
 * build proceeded on a broken tree and only discovered the damage later (missing `next` binary). PURE.
 */
export function npmInstallMaskedFailure(command: string, output: string): boolean {
  if (typeof command !== 'string' || typeof output !== 'string') return false;
  return PIPED_INSTALL_RE.test(command) && NPM_FAILURE_RE.test(output);
}

export interface DependencyAutoFixPlan {
  /** Missing packages that are on the well-known allowlist — safe to suggest with an exact version. */
  autofixable: Array<{ package: string; version: string }>;
  /** Missing names NOT on the allowlist — likely a local path alias; ask the user/agent to verify. */
  needsReview: string[];
}

/**
 * Partition the `missing` dependency findings into confidently-fixable (allowlisted npm packages) vs
 * needs-review (probable local aliases). Only considers kind === 'missing'. Deduped, order-stable. Pure.
 */
export function planDependencyAutoFix(missing: readonly DependencyIssue[]): DependencyAutoFixPlan {
  const autofixable: Array<{ package: string; version: string }> = [];
  const needsReview: string[] = [];
  const seen = new Set<string>();
  for (const issue of missing || []) {
    if (!issue || issue.kind !== 'missing') continue;
    const name = issue.package;
    if (typeof name !== 'string' || !name || seen.has(name)) continue;
    seen.add(name);
    // Both allowlists, one planner. A test runner is as autofixable as axios — the only difference is
    // which SECTION of package.json it belongs in, and that is decided where it is written.
    const version = WELL_KNOWN_DEPS[name] ?? WELL_KNOWN_DEV_DEPS[name];
    if (version) autofixable.push({ package: name, version });
    else needsReview.push(name);
  }
  return { autofixable, needsReview };
}

export interface DependencyReconcileResult {
  /** The file set with package.json updated (unchanged when nothing was safely addable). */
  files: Record<string, string>;
  /** Every dependency added, for honest diagnostics. Empty when nothing was applied. */
  added: Array<{ package: string; version: string }>;
}

/** Matches import/require specifiers so external package imports can be collected without a parser. */
const IMPORT_SPECIFIER_RE = /(?:import\s[^'"\n]*?from\s*|import\s*|export\s[^'"\n]*?from\s*|require\(\s*)['"]([^'"\n]+)['"]/g;
const CODE_FILE_RE = /\.(?:m?[jt]sx?)$/i;

/**
 * Deterministically ADD the well-known, version-pinned missing dependencies to package.json (P-PIPE
 * reconciler). This is the apply-half of the advisory `planDependencyAutoFix`: DependencyAnalysis detects
 * a package imported but not declared, and — ONLY for the curated `WELL_KNOWN_DEPS` allowlist (real npm
 * packages with a known-good caret range; names that collide with local aliases are deliberately excluded)
 * — the package is written into `dependencies` so the app actually installs and runs.
 *
 * WHY (autopsy theme, 2026-07-13): an app that imports `axios`/`zustand`/`react-router-dom` without
 * declaring it fails at install/runtime with "Cannot find module". Leaving that to the builder LLM to
 * notice the advisory is unreliable; the unambiguous, allowlisted subset can be reconciled deterministically.
 *
 * Paranoid-safe: only the allowlist is added (never a `needsReview` alias), idempotent (skips a package
 * already in deps/devDeps/peerDeps), and it validates the rewritten package.json re-parses before returning
 * — any parse/shape problem returns the input unchanged. It can only turn a missing-dependency build into a
 * working one. Pure; never throws.
 */
export function applyWellKnownMissingDeps(files: Record<string, string>): DependencyReconcileResult {
  const unchanged: DependencyReconcileResult = { files, added: [] };
  const pkgRaw = files?.['package.json'];
  if (typeof pkgRaw !== 'string') return unchanged;

  const external: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE_RE.test(path) || typeof content !== 'string') continue;
    let m: RegExpExecArray | null;
    IMPORT_SPECIFIER_RE.lastIndex = 0;
    while ((m = IMPORT_SPECIFIER_RE.exec(content))) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue; // local, not npm
      external.push(spec);
    }
  }
  if (external.length === 0) return unchanged;

  let missing: DependencyIssue[];
  try { missing = analyzeDependencies(external, pkgRaw).filter((d) => d.kind === 'missing'); }
  catch { return unchanged; }
  const plan = planDependencyAutoFix(missing);
  if (plan.autofixable.length === 0) return unchanged;

  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(pkgRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return unchanged;
    pkg = parsed as Record<string, unknown>;
  } catch { return unchanged; }

  const asObj = (v: unknown): Record<string, string> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  const deps = { ...asObj(pkg.dependencies) };
  const devDeps = { ...asObj(pkg.devDependencies) };
  const peer = new Set(Object.keys(asObj(pkg.peerDependencies)));
  const added: Array<{ package: string; version: string }> = [];
  let addedDev = false;
  for (const fix of plan.autofixable) {
    // Already declared ANYWHERE — dependencies, devDependencies or peerDependencies — is left alone.
    // Idempotent by construction; this must never overwrite a version the project chose.
    if (fix.package in deps || fix.package in devDeps || peer.has(fix.package)) continue;
    // THE SECTION IS PART OF THE FIX, not a detail. A test runner in `dependencies` ships to production
    // and bloats every install — the very thing a careful reviewer flags next.
    if (Object.prototype.hasOwnProperty.call(WELL_KNOWN_DEV_DEPS, fix.package)) {
      devDeps[fix.package] = fix.version;
      addedDev = true;
    } else {
      deps[fix.package] = fix.version;
    }
    added.push(fix);
  }
  if (added.length === 0) return unchanged;

  pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  // Written only when something was actually added, so a project with no devDependencies does not gain
  // an empty block it never had.
  if (addedDev) pkg.devDependencies = Object.fromEntries(Object.entries(devDeps).sort(([a], [b]) => a.localeCompare(b)));
  let out: string;
  try { out = `${JSON.stringify(pkg, null, 2)}\n`; JSON.parse(out); } catch { return unchanged; }
  return { files: { ...files, 'package.json': out }, added };
}

/** Advisory report line(s), or '' when there is nothing to say. Pure. */
export function dependencyAutoFixSummary(plan: DependencyAutoFixPlan): string {
  if (!plan.autofixable.length && !plan.needsReview.length) return '';
  const lines: string[] = [];
  if (plan.autofixable.length) {
    lines.push(
      `Dependency auto-fix — add these to package.json, then reinstall: ${plan.autofixable
        .map((d) => `${d.package}@${d.version}`)
        .join(', ')}`,
    );
  }
  if (plan.needsReview.length) {
    lines.push(
      `Verify (imported but not in package.json — likely a local path alias in tsconfig/vite, NOT an npm package): ${plan.needsReview.join(
        ', ',
      )}`,
    );
  }
  return lines.join('\n');
}

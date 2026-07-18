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
};

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
        .map((tok) => (Object.prototype.hasOwnProperty.call(WELL_KNOWN_DEPS, tok) ? `${tok}@${WELL_KNOWN_DEPS[tok]}` : tok))
        .join('');
    })
    .join('');
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
    const version = WELL_KNOWN_DEPS[name];
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
  const declaredElsewhere = new Set([...Object.keys(asObj(pkg.devDependencies)), ...Object.keys(asObj(pkg.peerDependencies))]);
  const added: Array<{ package: string; version: string }> = [];
  for (const fix of plan.autofixable) {
    if (fix.package in deps || declaredElsewhere.has(fix.package)) continue; // idempotent — never overwrite
    deps[fix.package] = fix.version;
    added.push(fix);
  }
  if (added.length === 0) return unchanged;

  pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
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

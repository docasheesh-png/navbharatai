// DID THE BUILD PRODUCE A SITE — or merely a FOLDER?
//
// 🔒 ROOT CAUSE (admin 2026-08-25, publishing the UPI API). Publish reported, in the user's own words:
//
//     Error: Could not read the built site: No build output found in dist/ or out/.
//     Run "npm run build" first … dist/ and out/ are empty or do not exist.
//
// That message is the DEPLOY tool's, thrown deep in the actuator — the raw end of the pipeline. The
// route has a gate whose entire job is to catch this earlier and say something useful, and it let the
// build through. Its check was:
//
//     ls -d dist out build .output .next 2>/dev/null | head -5
//     if (!stdout.trim()) → refuse
//
// `ls -d` answers "does this directory EXIST". The question that matters is "does it CONTAIN a site".
// Those come apart exactly when a workspace has been reused: the previous app in it left a `dist/`
// behind, or `npm run build` created the directory and then failed to fill it. The folder is there,
// the gate is satisfied, and the failure resurfaces two steps later as the vendor's own error — with
// none of the explanation the gate existed to provide.
//
// ⚠️ AND IT IS THE SAME SHAPE AS THE DAY'S OTHER SEVEN: a check that verifies the wrong thing, and a
// leftover from a previous app in the same workspace turning that wrong thing true. `dist/` here is
// the piano's `5173` from the preview bug — a real artefact of a real app, just not THIS one.
//
// 🔒 WHY THIS IS A COUNT AND NOT A "NOT EMPTY" TEST. A directory holding only `.gitkeep`, or only the
// `.vite` cache folder, is empty in every sense the user cares about. Counting FILES (not entries) at
// any depth is the question actually being asked: is there anything here to upload?

import { detectWebDir, isNextStaticExport } from '../lib/mobileProjectAssembler';

// 🔒 THE SECOND ROOT CAUSE, FOUND WHILE FIXING THE FIRST — and it produces the SAME sentence.
//
// The gate searched `dist out build .output .next`. The DEPLOY step reads `dist` and `out`, and nothing
// else (E2BActuator.downloadDistFiles). So the two disagreed about what "built" means, and every app
// whose framework writes somewhere else passed the gate and then died at the deploy with the vendor's
// message. That is not a hypothetical set: the 24-framework sweep measured it — Create React App and
// SvelteKit write to `build/`, Nuxt to `.output/public`, Remix to `build/client`, Angular NESTS the site
// inside `dist/<app>/browser` (so `dist/` exists, full of server bundles, with no index.html in it).
//
// `.next` was the worst entry of the five, because it made the gate WRONG rather than merely incomplete:
// a Next.js app without static export always has a `.next/`, so the gate would confirm a site had been
// built for the one case where a static site genuinely had not been. It is deliberately absent below,
// and that case now gets its own sentence.
//
// One list, used by BOTH the gate and the upload, is the fix for the class — not a longer list on one
// side of a disagreement.

/** Where a STATIC site can really land, in search order. Never `.next` — see above. */
export const BUILD_OUTPUT_DIRS = ['dist', 'out', 'build', '.output/public', 'build/client'] as const;

/**
 * The directories to search FOR THIS PROJECT — its framework's real answer first, then the defaults.
 *
 * Order is the whole point. Angular's site is `dist/app/browser`; searching `dist` first would find
 * files (server bundles, stats.json) and upload a folder with no index.html at its root — a publish
 * that "succeeds" and serves nothing. The framework's own answer therefore goes ahead of the generic
 * list, and the generic list stays as the fallback for everything unrecognised.
 *
 * `files` is best-effort: pass whatever of package.json / vite.config.* / angular.json could be read.
 * With none of them this returns exactly BUILD_OUTPUT_DIRS, which is the safe default.
 */
export function buildOutputCandidates(files: Record<string, string>): string[] {
  const out: string[] = [];
  const push = (d: string): void => {
    const clean = String(d || '').replace(/^\.\//, '').replace(/\/+$/, '').trim();
    if (clean && !clean.startsWith('/') && !clean.includes('..') && !out.includes(clean)) out.push(clean);
  };
  try { push(detectWebDir(files, 'built')); } catch { /* unreadable config ⇒ the defaults below stand */ }
  for (const d of BUILD_OUTPUT_DIRS) push(d);
  return out;
}

/**
 * A Next.js app that was never told to export a static site.
 *
 * Worth its own answer because the fix is one line in one file, and because without it this user is
 * told "your build produced no website files" about a build that produced a perfectly good SERVER
 * application. Naming the actual situation is the difference between a dead end and a next step.
 */
export function isNextWithoutStaticExport(files: Record<string, string>): boolean {
  let pkg: Record<string, unknown> = {};
  try { pkg = JSON.parse(files['package.json'] || '{}') as Record<string, unknown>; } catch { return false; }
  const deps = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };
  const build = String((pkg.scripts as Record<string, string> | undefined)?.build || '');
  if (!deps.next && !/next build/.test(build)) return false;
  return !isNextStaticExport(files);
}

/**
 * ONE shell command that reports, per candidate directory, how many FILES it holds.
 *
 * Prints `NB_OUT=<dir>:<count>` for each directory that exists. A directory that is absent prints
 * nothing — absent and empty are different facts and the caller distinguishes them.
 *
 * `find -type f` counts at any depth, because a real build nests (`dist/assets/…`). Hidden files count:
 * a `.nojekyll` or a dotted asset is still a file that would ship.
 */
export function buildOutputCensusCommand(dirs: readonly string[] = BUILD_OUTPUT_DIRS): string {
  return dirs
    .map((d) => `if [ -d ${JSON.stringify(d)} ]; then echo "NB_OUT=${d}:$(find ${JSON.stringify(d)} -type f 2>/dev/null | wc -l)"; fi`)
    .join('; ');
}

/** The small config files that decide where a build lands. Nothing here is ever large. */
export const OUTPUT_CONFIG_FILES = [
  'package.json', 'angular.json',
  'vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts', 'vite.config.cjs',
  'next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs',
] as const;

const DUMP_MARK = '@@NBCFG@@';

/**
 * ONE command that returns those config files, so the framework can be identified in a single round
 * trip instead of eleven `readFile` calls against a sandbox — most of which would be for files that do
 * not exist. Absent files print nothing.
 */
export function configDumpCommand(names: readonly string[] = OUTPUT_CONFIG_FILES): string {
  return names
    .map((n) => `if [ -f ${JSON.stringify(n)} ]; then echo "${DUMP_MARK}${n}"; cat ${JSON.stringify(n)}; echo; fi`)
    .join('; ');
}

/**
 * Read that dump back. PURE, and deliberately forgiving: this only ever IMPROVES a guess that already
 * has a safe default, so a config it cannot parse costs nothing.
 */
export function parseConfigDump(stdout: string): Record<string, string> {
  const files: Record<string, string> = {};
  let current = '';
  const lines = String(stdout ?? '').split('\n');
  const buf: string[] = [];
  const flush = (): void => { if (current) files[current] = buf.join('\n').trim(); buf.length = 0; };
  for (const line of lines) {
    if (line.startsWith(DUMP_MARK)) { flush(); current = line.slice(DUMP_MARK.length).trim(); continue; }
    if (current) buf.push(line);
  }
  flush();
  return files;
}

export interface BuiltSiteVerdict {
  /** A directory that genuinely holds files, or '' when none does. */
  dir: string;
  /** How many files it holds. */
  files: number;
  /** Directories that exist but hold nothing — the case the old gate could not see. */
  emptyDirs: string[];
  /** True only when there is something real to upload. */
  ok: boolean;
}

/**
 * Read the census. PURE.
 *
 * 🔒 UNPARSEABLE OUTPUT IS `ok: true`, DELIBERATELY. This gate can only ever REFUSE a publish, so a
 * gate that fails closed on its own confusion would block working apps whenever a shell behaved
 * unexpectedly — trading a clear error for an outage. It refuses only on positive evidence that every
 * candidate directory is empty or missing, which is exactly the evidence the deploy step would hit
 * two steps later anyway.
 */
export function readBuildOutputCensus(stdout: string): BuiltSiteVerdict {
  const text = String(stdout ?? '');
  const hits = [...text.matchAll(/NB_OUT=([^\s:]+):(\d+)/g)];
  if (hits.length === 0) {
    // SILENCE AND NOISE ARE DIFFERENT ANSWERS, and the difference decides whether we may refuse.
    //
    // The command prints one line per directory that exists, so BLANK output is the real, positive
    // answer "none of them are here" — the one case the old gate got right, and the message for it is
    // unchanged. Output that is not blank but says nothing we recognise means the shell did something
    // we did not anticipate; that is OUR confusion, not evidence about the user's build, so it passes.
    if (text.trim() === '') return { dir: '', files: 0, emptyDirs: [], ok: false };
    return { dir: '', files: 0, emptyDirs: [], ok: true };
  }
  const empty: string[] = [];
  for (const h of hits) {
    const count = Number(h[2]);
    if (Number.isFinite(count) && count > 0) return { dir: h[1], files: count, emptyDirs: empty, ok: true };
    empty.push(h[1]);
  }
  return { dir: '', files: 0, emptyDirs: empty, ok: false };
}

/**
 * What to tell the user, or '' when the build is fine.
 *
 * The empty-directory case gets its OWN sentence, because it is a genuinely different situation from
 * "nothing was built" and the difference is the thing the user needs: a folder that exists but is
 * empty is usually a leftover from an earlier app in this workspace, or a build that created its
 * output directory and then failed to fill it. Naming that is what turns a dead end into a next step.
 */
export function builtSiteRefusal(
  v: BuiltSiteVerdict,
  buildSaid: string,
  opts: { checked?: readonly string[]; files?: Record<string, string> } = {},
): { error: string; detail: string } | null {
  if (v.ok) return null;
  const tail = buildSaid.trim() ? `\n\nWhat the build printed:\n${buildSaid.trim()}` : '';
  const checked = (opts.checked && opts.checked.length ? opts.checked : BUILD_OUTPUT_DIRS) as readonly string[];
  if (opts.files && isNextWithoutStaticExport(opts.files)) {
    return {
      error: 'This app is built to run on a server, so there is no website folder to put online yet.',
      detail: 'It compiled successfully — but it produces a server application rather than a set of files a '
        + 'website host can serve. To publish it as a website, add output: \'export\' to next.config.js and '
        + `build again; that produces the out/ folder this step is looking for.${tail}`,
    };
  }
  if (v.emptyDirs.length > 0) {
    return {
      error: `Your app built, but the folder it built into (${v.emptyDirs.join(', ')}) is empty — so there is `
        + 'nothing to put online yet.',
      detail: `Checked ${v.emptyDirs.join(', ')} — the folder exists but holds no files. This usually means the `
        + 'build did not finish writing its output, or the folder was left behind by an earlier version of '
        + `this app. Ask me to build it again and I will look at what the build is actually doing.${tail}`,
    };
  }
  return {
    error: 'Your app compiled without errors but produced no website files, so there is nothing to publish yet.',
    detail: `Checked for: ${checked.map((d) => `${d}/`).join(', ')} — none exist.${tail}`,
  };
}

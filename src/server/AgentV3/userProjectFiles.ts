/**
 * DOES THIS WORKSPACE HOLD THE USER'S APP, OR ONLY OUR OWN SCAFFOLD?
 *
 * 🔴 WHY (autopsy e9b25b08, 2026-09-18, and autopsy 2026-07-07 before it). The build route decides
 * whether a turn is a fresh build or an edit, and one input is `projectExists = fileCount > 0`. That
 * counts FILES, and it cannot tell the user's application from the golden scaffold the platform seeds
 * into every workspace itself.
 *
 * `"Build a search engines like google"` was consequently built as an EDIT of a four-file scaffold:
 * the user was told *"✏️ Editing your existing app (4 source files)"* about an app they had never
 * written, Software Project Mode recorded *"this turn is not a fresh build, so no plan was created"*
 * — the admin's own first test of that flag, blocked here — and the user stopped the build at 69
 * seconds having seen nothing produced. `GREEN_GUARD_NONE` confirms no working state had ever
 * existed there.
 *
 * ⚠️ THE 2026-07-07 REPORT NAMED THIS EXACT CAUSE AND IT WAS TREATED IN VOCABULARY INSTEAD. Its own
 * words, still in `IntentClassifier.ts`: *"a handful of scaffold/test files had been restored from
 * history (projectExists=true)"*. The remedy chosen then was `isExplicitCompleteBuild`, a PROMPT
 * guard — so the cause survived, and two months later a prompt one word outside that guard hit it
 * again. This is the same finding treated at the cause: in STATE, where it lives.
 *
 * 🔒 IT CANNOT ENDANGER A REAL APP. Any application a user has actually built carries files the
 * scaffold does not, so `userOwnedFileCount` is positive and every caller behaves exactly as before.
 * The only population that moves is a workspace holding nothing but our own starter files.
 *
 * 🔒 THE PATH LIST IS DERIVED, NEVER RE-LISTED. `goldenBaseFiles` is the one place the scaffold's
 * shape is decided; a second hand-maintained copy is precisely the drift this repo has paid for in
 * four `safeRelPath`s and two complex-app detectors. Adding a file to the scaffold updates this
 * automatically.
 *
 * PURE. No I/O, no clock, no env.
 */
import { goldenBaseFiles } from './goldenScaffolds/base';
import { isBinaryAsset } from './fileClassification';

/** Every path the platform's own starter project writes. Derived from its single source of truth. */
export const SCAFFOLD_PATHS: ReadonlySet<string> = new Set(
  Object.keys(goldenBaseFiles('NavBharatAI App', '')).map((p) => normalize(p)),
);

/** `./src/App.tsx`, `/src/App.tsx` and `src/App.tsx` are one file. */
function normalize(raw: string): string {
  return String(raw ?? '').trim().replace(/^\.?\/+/, '').replace(/\\/g, '/');
}

/**
 * Repository housekeeping: files that sit beside an app but are never one. `.gitignore` is created by
 * the GitHub connection itself, before a line of the app exists.
 */
const HOUSEKEEPING = /^(\.gitignore|\.gitattributes|\.gitkeep|\.keep|\.editorconfig|\.ds_store|thumbs\.db|license(\.[a-z]+)?|licence(\.[a-z]+)?)$/i;

/**
 * 🔴 COULD THIS FILE BE PART OF AN APPLICATION? (autopsy "Universal Remote", 2026-09-27.)
 *
 * A workspace holding `.gitignore` and a ZERO-BYTE `Minecraft.apk` was told *"✏️ Editing your existing
 * app (2 source files)"*, and the order *"Build an app which contain an IR blaster…"* was run as an EDIT
 * — no plan, no feature confirmation, and a model told to make "targeted changes" to an app that did
 * not exist. Neither file can be app code: one is git housekeeping, the other a binary package (and
 * `.apk` was missing from the binary list, so every count called it "source"). Dependency, build-output
 * and git internals are excluded for the same reason. PURE.
 */
export function couldBeAppCode(path: string): boolean {
  const p = normalize(path);
  if (!p) return false;
  if (/^(node_modules|dist|build|\.git|coverage)\//.test(p) || /\/node_modules\//.test(p)) return false;
  const base = p.split('/').pop() ?? p;
  if (HOUSEKEEPING.test(base)) return false;
  if (isStrayRootName(p)) return false;
  return !isBinaryAsset(p);
}

/**
 * Extensionless ROOT files that ARE part of a project: build and manifest files every ecosystem names
 * without an extension. Anything else at the root with no extension and no leading dot is not code.
 */
const EXTENSIONLESS_PROJECT_FILES = /^(dockerfile|containerfile|makefile|gnumakefile|procfile|gemfile|rakefile|podfile|brewfile|pipfile|vagrantfile|jenkinsfile|caddyfile|justfile|cname|readme|changelog|authors|contributing|codeowners)$/i;

/**
 * 🔴 THE CLASS CAME BACK, ONE FILE NAME LATER (autopsy 6db0ff31, 2026-09-30). After "Universal Remote"
 * a zero-byte `Minecraft.apk` was excluded — by adding `.apk` to the binary list. The next report
 * carried a zero-byte file named `java`, created in Code Studio, and it was counted as "1 source file":
 * *"✏️ Editing your existing app (1 source file)"*, the intent reader was told the user already had a
 * project, "A app for my online business of digital marketing agency" ran as an EDIT of our scaffold,
 * and Software Project Mode declined to plan it. The earlier fix taught the list one extension; the
 * fact it needed is the SHAPE. A root-level name with no extension, no leading dot and no place in any
 * ecosystem's build files is a stray — a typed name, a redirect target (`cmd > java`), a note — never
 * application code. Nested extensionless files (`bin/www`) are real code and are untouched. PURE.
 */
export function isStrayRootName(path: string): boolean {
  const p = normalize(path);
  if (!p || p.includes('/')) return false;
  if (p.startsWith('.') || p.includes('.')) return false;
  return !EXTENSIONLESS_PROJECT_FILES.test(p);
}

/**
 * How many files here could be application code — scaffold paths INCLUDED, because after a build
 * `src/App.tsx` holds the user's real app. This is the count a guard that PROTECTS an existing app
 * must weigh (the rebuild guard, the rebuild confirmation, the edit banner): it drops only what can
 * never be code — housekeeping, binaries, dependencies, build output and stray root names. PURE.
 */
export function appSourceFileCount(paths: readonly string[] | null | undefined): number {
  if (!Array.isArray(paths)) return 0;
  const seen = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const p = normalize(raw);
    if (p && couldBeAppCode(p)) seen.add(p);
  }
  return seen.size;
}

/**
 * How many of these files are the USER's, rather than the scaffold we seeded.
 *
 * ⚠️ `src/App.tsx` IS a scaffold path, and a very small app can live entirely inside it. Stated
 * plainly rather than discovered later: such a workspace reads as "no app of your own yet", so an
 * explicit build order there starts a fresh build instead of an edit. That is what the order asked
 * for, and it is the conservative direction for the case this module exists to fix — a scaffold the
 * user never wrote must never be presented to them as "your existing app".
 */
export function userOwnedFileCount(paths: readonly string[] | null | undefined): number {
  if (!Array.isArray(paths)) return 0;
  const seen = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const p = normalize(raw);
    if (!p || SCAFFOLD_PATHS.has(p) || !couldBeAppCode(p)) continue;
    seen.add(p);
  }
  return seen.size;
}

/**
 * Has the user got an application here at all?
 *
 * 🔒 UNKNOWN MEANS YES. A listing we could not read must never be treated as an empty workspace —
 * that would be the one direction in which this change could reach a real app. `null` therefore
 * answers `true`, which is today's behaviour exactly.
 */
export function workspaceHoldsUserApp(paths: readonly string[] | null | undefined): boolean {
  if (paths === null || paths === undefined) return true;
  return userOwnedFileCount(paths) > 0;
}

/**
 * The line that opens an edit turn. When the chat holds nothing of the user's (only the starter setup
 * wrote), it must not call those files "your existing app" (autopsy 981ce4cc: "✏️ Editing your existing
 * app (11 source files)" about our 11-file starter). PURE.
 */
export function editBannerText(sourceCount: number, userHasApp: boolean): string {
  if (!userHasApp) return '✏️ Starting from the starter project — I\'ll change it into what you asked for.';
  return `✏️ Editing your existing app (${sourceCount} source file${sourceCount === 1 ? '' : 's'}) — I'll make targeted changes, not rebuild it.`;
}

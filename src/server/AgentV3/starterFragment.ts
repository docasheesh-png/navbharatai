// A FRAGMENT OF OUR OWN STARTER IS NOT A PROJECT (autopsy 19641ab5, 2026-10-01).
//
// 🔴 WHAT HAPPENED. The build's workspace held one file, our starter's `index.html` (which loads
// `/src/main.tsx`), and nothing else: no `package.json`, no `src/`. The architect's first read of
// `package.json` failed, it gave up on the project and wrote a single-file HTML page over the entry —
// in a build recorded as `vite-react`.
//
// How a workspace ends up like that: the machine was created by a Files-tab request, not by the build
// (`started-by=files`), and a fresh machine is refilled from the durable store plus this instance's
// warm file cache (`_restoreFreshSandbox`). The store was empty; the cache held only the one file it had
// read. The build's `ensureWorkspace` then asked "does the workspace directory exist?", got yes, and
// skipped the template — "the directory exists" was standing in for "the project is set up".
//
// 🔑 THE CLASS: a presence check that answers a different question. The directory existing says nothing
// about whether a project is in it. The precise question is answered here: is everything present a piece
// of OUR starter, byte for byte? Then the starter was interrupted, not replaced, and the missing template
// files are put back. Any file that is not ours (or ours but edited) means a project is here, and nothing
// is written — a user's own static `index.html` is never joined by a `package.json` it did not ask for.
//
// PURE. The actuator does the reads and the writes.

import { withoutPreviewBridge } from './previewBridge';
import { TemplateRegistry } from './sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from './goldenScaffolds/registry';
import { strictTsconfig } from './strictTrial';

/** More files than this present and it is not a fragment of a starter (a template is a handful). */
export const MAX_FRAGMENT_FILES = 24;

function sameFile(path: string, present: string, template: string): boolean {
  const norm = (c: string) => c.replace(/\r\n/g, '\n').trim();
  if (norm(withoutPreviewBridge(path, present)) === norm(template)) return true;
  // A seeded tsconfig has two forms: loose, and strict for a workspace in the strict trial (Q-008,
  // strictTrial.ts). Either is our own starter, so compare them in their strict form.
  return path.replace(/^\.?\/+/, '') === 'tsconfig.json' && norm(strictTsconfig(present)) === norm(strictTsconfig(template));
}

/**
 * The template files to write, or [] when nothing should be written.
 *
 * `present` maps workspace-relative paths to their content (`null` when a file could not be read —
 * treated as "not ours", so an unreadable file can never be overwritten or joined). An EMPTY workspace is
 * the starter not yet written: every template file is returned.
 */
export function starterFilesToComplete(
  present: Readonly<Record<string, string | null>>,
  template: Readonly<Record<string, string>>,
): string[] {
  const paths = Object.keys(present);
  const templatePaths = Object.keys(template);
  if (templatePaths.length === 0) return [];
  if (paths.length > MAX_FRAGMENT_FILES) return [];
  for (const p of paths) {
    const tpl = template[p];
    const got = present[p];
    if (typeof tpl !== 'string' || typeof got !== 'string') return [];
    if (!sameFile(p, got, tpl)) return [];
  }
  return templatePaths.filter((p) => !(p in present));
}

/**
 * The admin line for SETUP_TIMING. PURE.
 *
 * 🔴 `presentBefore` SAYS WHICH OF TWO DIFFERENT THINGS HAPPENED (autopsy 31254f9a, 2026-10-01). Every
 * fresh machine's workspace directory already EXISTS, because the sandbox image ends `WORKDIR
 * /home/user/workspace` — so an empty workspace also reaches the completion, and it is completed whole.
 * That report read "completed 11 missing template file(s) — the workspace held only a piece of our own
 * starter" about a workspace that held nothing at all (11 is the whole template), which sent the
 * autopsy looking for a writer that did not exist. Omitted ⇒ the old wording, for an older caller.
 */
export function starterCompletedNote(count: number, presentBefore?: number): string {
  if (count <= 0) return '';
  if (presentBefore === 0) return ` · starter=wrote our ${count}-file starter into an empty workspace`;
  const had = typeof presentBefore === 'number' && presentBefore > 0 ? ` (${presentBefore} were already there)` : '';
  return ` · starter=completed ${count} missing template file(s)${had} — the workspace held only a piece of our own starter`;
}

/** Every template's files, built once — what "our own starter file" means anywhere in the engine. */
let starterTemplateCache: Array<Record<string, string>> | null = null;
export function starterTemplates(): Array<Record<string, string>> {
  if (starterTemplateCache) return starterTemplateCache;
  const reg = new TemplateRegistry();
  const out: Array<Record<string, string>> = [];
  for (const key of reg.listFrameworks()) {
    try { out.push(reg.getProvider(key).getFiles([])); } catch { /* a template that cannot list is skipped */ }
  }
  starterTemplateCache = out;
  return out;
}

/**
 * Everything the PLATFORM writes into a workspace on its own: every framework starter AND every starter
 * chip's tested template. An untouched copy of any of them is our work, never the user's.
 */
let seedTemplateCache: Array<Record<string, string>> | null = null;
export function platformSeedTemplates(): Array<Record<string, string>> {
  if (seedTemplateCache) return seedTemplateCache;
  const out = [...starterTemplates()];
  for (const g of GOLDEN_SCAFFOLDS) {
    try { out.push(goldenScaffoldFiles(g)); } catch { /* a template that cannot list is skipped */ }
  }
  seedTemplateCache = out;
  return out;
}

/**
 * Does `present` hold NOTHING but untouched files of our own starter (or nothing at all)? PURE.
 *
 * 🔴 THE GOLDEN SCAFFOLD ASKED "IS src/ EMPTY?" AND THE ANSWER CHANGED UNDER IT (autopsy 31254f9a). The
 * pre-seed of a starter chip's tested template was guarded by `src/` holding no file, which meant "no
 * app is here yet" only while setup left a fresh workspace EMPTY. Since setup started writing our
 * starter into it (#3435, the same day), `src/` always holds `src/App.tsx` and friends — so the guard
 * refused every pre-seed, the calculator chip was built from scratch by the fast lane, and the routing
 * line still said the template was seeded. Same class as the one #3435 fixed: a presence check
 * standing in for the real question, which is "is anything here somebody's work?". Our own untouched
 * starter (or a chip's untouched template) is not; any other file, or one of ours that was edited, or
 * one we could not read (`null`), is. The rebuild guard asks the same question of the durable store.
 */
export function holdsOnlyOurStarter(
  present: Readonly<Record<string, string | null>>,
  templates: ReadonlyArray<Readonly<Record<string, string>>> = platformSeedTemplates(),
): boolean {
  for (const [p, content] of Object.entries(present)) {
    if (typeof content !== 'string' || !isOurStarterFile(p, content, templates)) return false;
  }
  return true;
}

/**
 * Is this exactly one of OUR starter files (any template), untouched? Replacing it is the job, not a
 * risk: autopsy 19641ab5's first write replaced the starter's 300-byte `index.html` and was answered with a
 * FULL-REWRITE WARNING plus the whole old file, as if the model had trampled user code. PURE.
 */
export function isOurStarterFile(
  path: string,
  content: string,
  templates: ReadonlyArray<Readonly<Record<string, string>>>,
): boolean {
  if (typeof content !== 'string' || !content.trim()) return false;
  return templates.some((t) => typeof t[path] === 'string' && sameFile(path, content, t[path]));
}

/**
 * May the tested template for a starter chip be written here? Reads every `src/` file through `read`
 * and asks `holdsOnlyOurStarter`. More files than a starter has ⇒ no (somebody's app is here). A read
 * that fails counts as somebody's work, so an unreadable workspace is never overwritten.
 */
export async function srcHoldsOnlyOurStarter(
  srcPaths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<boolean> {
  if (srcPaths.length > MAX_FRAGMENT_FILES) return false;
  const entries = await Promise.all(srcPaths.map(async (p) => [p, await read(p).catch(() => null)] as const));
  return holdsOnlyOurStarter(Object.fromEntries(entries));
}

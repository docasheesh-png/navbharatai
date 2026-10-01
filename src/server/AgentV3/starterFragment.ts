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

/** The admin line for SETUP_TIMING. PURE. */
export function starterCompletedNote(count: number): string {
  return count > 0 ? ` · starter=completed ${count} missing template file(s) — the workspace held only a piece of our own starter` : '';
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

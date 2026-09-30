// AgentV3 — a stale copy of a module must not run INSTEAD of the file the build just wrote.
//
// 🔴 AUTOPSY e725e002 (2026-09-29, "mkdir src", Weak tier, 17.6 min). The reviewer's file listing held
// `src/data/products.ts` AND `src/data/products.js`, `src/context/AuthContext.tsx` AND
// `src/context/AuthContext.js`, and so on for every module the build wrote. The `.js` files were never
// written by this build: the durable store held 0 files, the sandbox came up WARM on a resumed id, and
// an earlier attempt that was never saved had left its own JavaScript copies of the same modules
// behind. Nothing ever looked at them again.
//
// 🔑 WHY IT IS A BUG AND NOT DEBRIS: every import in the app is extensionless
// (`import { AuthProvider } from "@/context/AuthContext"`), and Vite resolves an extensionless import
// by trying `resolve.extensions` IN ORDER — `.mjs`, `.js`, `.mts`, `.ts`, `.jsx`, `.tsx`. So the stale
// `.js` wins over the `.tsx` the build just wrote, and the running app is the OLD code. Every edit to
// the `.tsx` is invisible in the preview, `tsc` checks a file the app never loads, and a green render
// proves nothing about what was built. The same order decides which config file Vite and Tailwind load.
//
// THE RULE, stated once: when the build writes a module, any same-named file in the same directory
// with a code extension that resolves EARLIER shadows it and is removed — provided this build did not
// write that twin itself (a file the build wrote is its own decision, never ours to undo). A twin that
// resolves LATER is left alone: it cannot shadow what was written, and deleting it is not needed to
// make the build's code the code that runs.
//
// 🔒 UNKNOWN MEANS KEEP. Without the set of files this build wrote there is no way to tell a stale
// twin from one the build just created, so the answer is "remove nothing" — the same asymmetry as
// `fileDeletion.ts`.
//
// PURE — no I/O. The sandbox listing and the delete live at the call site (ToolDispatcher).

/** Vite's default `resolve.extensions`, in the order it tries them. Earlier wins. */
export const RESOLUTION_ORDER = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx'] as const;

const PRUNED_SEGMENT = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.git|coverage)(\/|$)/;
const DECLARATION = /\.d\.(m|c)?ts$/i;

/** Kill switch `AGENTV3_SHADOW_TWIN=off`; default on. */
export function shadowTwinEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SHADOW_TWIN ?? '').trim().toLowerCase() !== 'off';
}

/** `[stem, extension]` for a module path Vite could resolve, or null (declarations, other files). */
function splitModule(path: string): [string, number] | null {
  if (DECLARATION.test(path)) return null;
  const lower = path.toLowerCase();
  for (let rank = 0; rank < RESOLUTION_ORDER.length; rank++) {
    const ext = RESOLUTION_ORDER[rank];
    if (lower.endsWith(ext)) return [path.slice(0, path.length - ext.length), rank];
  }
  return null;
}

/**
 * The files in `tree` that would be loaded INSTEAD of `writtenPath`, and so must go.
 *
 * @param writtenPath the module the build just wrote
 * @param tree        the files in the sandbox (any order; may include `writtenPath`)
 * @param authored    every path this build has written, or `undefined` when that is unknown
 */
export function shadowingTwins(
  writtenPath: string,
  tree: Iterable<string>,
  authored: ReadonlySet<string> | undefined,
): string[] {
  if (!authored) return [];
  const written = splitModule(writtenPath);
  if (!written || PRUNED_SEGMENT.test(writtenPath)) return [];
  const [stem, writtenRank] = written;
  const out: string[] = [];
  for (const candidate of tree) {
    if (candidate === writtenPath || authored.has(candidate)) continue;
    const other = splitModule(candidate);
    if (!other || other[0] !== stem) continue;
    if (other[1] < writtenRank) out.push(candidate);
  }
  return out.sort();
}

/** A path safe to hand to `rm -f` inside single quotes. */
export function removablePath(path: string): boolean {
  return /^[A-Za-z0-9._@/-]+$/.test(path) && !path.split('/').includes('..') && !path.startsWith('/');
}

/** What the model is told in the tool result, so it does not recreate the file it lost. */
export function shadowTwinToolNote(writtenPath: string, removed: readonly string[]): string {
  if (removed.length === 0) return '';
  return `\nℹ️ REMOVED STALE COPY: ${removed.join(', ')} — an older version of ${writtenPath} under another `
    + `extension, left from an earlier attempt. The dev server resolves ${removed.map((p) => p.slice(p.lastIndexOf('.'))).join('/')} `
    + `before ${writtenPath.slice(writtenPath.lastIndexOf('.'))}, so it would have run INSTEAD of the file you just wrote. `
    + 'Do not recreate it; keep one file per module.';
}

/** Shared by a build's dispatchers so a sub-agent's removals reach the parent's report and store. */
export type ShadowTwinTally = {
  removed: string[];
  /** Every path this build wrote. Unset ⇒ unknown ⇒ nothing is ever removed. */
  authored?: () => Iterable<string>;
};

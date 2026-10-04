// AgentV3 — two files whose names differ only in letter case are one file almost everywhere else.
//
// 🔴 WHY (autopsy Sur Taal / cda57ed6, 2026-10-04). Parallel specialists wrote `src/components/icons.tsx` and
// `src/components/Icons.tsx`. The sandbox is Linux, so both existed, and imports of `./icons` and `./Icons`
// each loaded a different file with different exports — "CloseIcon is not exported by ../Icons" was the last
// blocker of a 25-minute build, and the model spent minutes finding it with `ls | grep -i icon` before
// deleting one. On Windows and macOS, and in a phone build checked out there, the two cannot both exist.
//
// The shadow-twin guard (`shadowTwin.ts`) handles the same stem with another extension. This is its sibling:
// the same stem in another letter case. It is a NOTE, never a removal: which of the two holds the code the
// app needs is not ours to decide.
//
// PURE. The dispatcher lists the directory and appends the note.

const MODULE_OR_STYLE = /\.(?:m?[jt]sx?|css|scss|less)$/i;

function splitPath(path: string): { dir: string; base: string } {
  const p = String(path ?? '').replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i < 0 ? { dir: '', base: p } : { dir: p.slice(0, i), base: p.slice(i + 1) };
}

function stem(base: string): string {
  return base.replace(MODULE_OR_STYLE, '');
}

/** Should a write of this path be checked at all? PURE. */
export function caseTwinCheckable(path: string): boolean {
  return MODULE_OR_STYLE.test(String(path ?? ''));
}

/**
 * The entries of the written file's directory whose stem equals its stem in another letter case
 * (`icons.tsx` ↔ `Icons.tsx`, `Icons.ts`). `entries` are bare names from that directory. PURE.
 */
export function caseOnlyTwins(path: string, entries: readonly string[]): string[] {
  const { dir, base } = splitPath(path);
  if (!caseTwinCheckable(base)) return [];
  const own = stem(base);
  const ownLower = own.toLowerCase();
  const out: string[] = [];
  for (const e of entries) {
    const name = String(e ?? '').trim();
    if (!name || name === base || !caseTwinCheckable(name)) continue;
    const s = stem(name);
    if (s !== own && s.toLowerCase() === ownLower) out.push(dir ? `${dir}/${name}` : name);
  }
  return out;
}

/** The note for the tool result. Empty when there is no twin. PURE. */
export function caseTwinNote(path: string, twins: readonly string[]): string {
  if (!twins || twins.length === 0) return '';
  const list = twins.map((t) => `\`${t}\``).join(', ');
  return `\n\n[case twin] \`${path}\` and ${list} differ only in letter case. On Windows, macOS and in a phone `
    + 'build they are ONE file, and an import of either name can load the other. Keep one: move what the '
    + 'other file adds into it, point every import at that one name, and delete the other.';
}

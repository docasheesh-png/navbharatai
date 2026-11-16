// BR1997: a shell `rm` deleted a stylesheet that another module still imported.
//
// The builder took a stylesheet under `src/assets/styles/` for an unused duplicate and removed it with
// `rm`. `src/main.tsx` still imported it (the platform had wired that orphan stylesheet into the entry).
// tsc does not resolve a side-effect CSS import, so every typecheck stayed clean. The next real-browser
// look found a build-error overlay, and the repair took several more minutes.
//
// THE NOTE, NOT A REFUSAL. When a shell command's deletion is confirmed, the bash result now names any
// module that still imports the deleted file, so the builder can repoint or restore it in the same turn.
// It never blocks a command, never edits a file and never undoes the delete.
//
// PRECISION (BR1990 rule: act only on positive evidence). An importer is named only when its CURRENT
// sandbox text has a relative import that resolves exactly to the deleted path. Commented-out imports
// are ignored. Bare specifiers (packages, aliases) are ignored. Anything unreadable stays silent.
// PURE. No I/O.

import { importSpecifiers } from './missingAssetCheck';
import { resolveLocalImport } from './ArchitectureAnalysis';

const SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs)$/i;

export interface DanglingImport {
  importer: string;
  specifier: string;
  deleted: string;
}

/** Drop block comments and whole-line `//` comments, so a commented-out import is not read as live. */
function withoutComments(source: string): string {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** The live relative imports in `sources` that resolve exactly to a deleted path. Pure. */
export function importsOfDeletedFiles(
  deleted: readonly string[],
  sources: Readonly<Record<string, string>>,
): DanglingImport[] {
  const gone = new Set(
    (deleted ?? []).map((p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean),
  );
  if (gone.size === 0) return [];
  const out: DanglingImport[] = [];
  const seen = new Set<string>();
  for (const importer of Object.keys(sources ?? {}).sort()) {
    if (gone.has(importer) || !SOURCE_RE.test(importer)) continue;
    const text = sources[importer];
    if (typeof text !== 'string' || text === '') continue;
    for (const specifier of importSpecifiers(withoutComments(text))) {
      if (!specifier.startsWith('.')) continue;
      const clean = specifier.split('?')[0].split('#')[0];
      const target = resolveLocalImport(importer, clean, gone);
      if (!target) continue; // resolveLocalImport answers only members of `gone`
      const key = `${importer}\u0000${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ importer, specifier, deleted: target });
    }
  }
  return out;
}

/** The line appended to the bash result, or '' when nothing still imports a deleted file. Pure. */
export function danglingImportNote(list: readonly DanglingImport[]): string {
  if (!list || list.length === 0) return '';
  const shown = list.slice(0, 5).map((d) => `${d.importer} imports '${d.specifier}' (${d.deleted} is gone)`);
  const more = list.length > 5 ? `; +${list.length - 5} more` : '';
  return `[deleted-file check] ⚠️ A file this command deleted is still imported: ${shown.join('; ')}${more}. `
    + 'The dev server will fail on that import. Remove or repoint the import, or restore the file, before continuing.';
}

export function deletedImportNoteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AGENTV3_DELETED_IMPORT_NOTE ?? '').trim().toLowerCase() !== 'off';
}

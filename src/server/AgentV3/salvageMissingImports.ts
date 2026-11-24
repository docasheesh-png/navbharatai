/**
 * 🧩 A FILE THE SAVED WORK IMPORTS BUT NOBODY WROTE IS NAMED IN THE HAND-OFF (Q-2768, BR2002 D3+D4).
 *
 * The fast lane stopped after 8 of its 12 planned files and handed the 8 to the full builder. One of them imported
 * `./ServicesSection.css`, which the lane had planned and never written. The hand-off listed the 8 saved files and the
 * missing entry, but not this — and the hand-off typecheck cannot see it (a stylesheet is not TypeScript), so the app
 * stayed broken for about 40 s until the full builder happened to write it.
 *
 * Class: the hand-off named what EXISTS and the missing ENTRY, never "what the saved files need that does not exist".
 * This reads every relative import of the saved files — `import x from`, `export … from`, a bare `import './a.css'`, and
 * a dynamic `import('./b')` — and names each one that resolves to no file in the workspace. PURE.
 */
import { candidatePaths } from './writeTimeImportCheck';

const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
// The span before `from` never crosses a quote or a semicolon, so a bare `import './a.css';` is never swallowed by
// the next line's `from`.
const SPEC = /(?:\bimport\s*(?:[^;'"]{0,300}?\bfrom\s*)?|\bexport\s+[^;'"]{0,300}?\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g;

/** Relative specifiers a file loads: named, re-exported, side-effect (a stylesheet) and dynamic. PURE. */
export function loadedRelativeSpecifiers(content: string): string[] {
  const out = new Set<string>();
  const code = String(content ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const m of code.matchAll(SPEC)) out.add(m[1]);
  return [...out];
}

export interface MissingImport { path: string; importedBy: string }

/**
 * The files the saved work imports that are not in the workspace. `saved` holds the saved files' contents; `known`
 * answers from what the turn already holds; `onDisk` asks the sandbox for anything else (a starter file the turn never
 * read), so a file that exists is never named as missing. At most `max` are named and `maxReads` sandbox reads made.
 * Never throws: a read that fails counts as absent, a check that fails as a whole names nothing.
 */
export async function missingImportsOfSaved(
  saved: Record<string, string>,
  known: (path: string) => boolean,
  onDisk: (path: string) => Promise<boolean>,
  max = 12,
  maxReads = 60,
): Promise<MissingImport[]> {
  const out: MissingImport[] = [];
  const named = new Set<string>();
  let reads = 0;
  try {
    for (const [file, content] of Object.entries(saved)) {
      if (!CODE.test(file) || typeof content !== 'string') continue;
      for (const spec of loadedRelativeSpecifiers(content)) {
        const cands = candidatePaths(file, spec);
        if (cands.some((c) => known(c))) continue;
        let found = false;
        for (const c of cands) {
          if (reads >= maxReads) return out; // could not finish looking: name only what was proven missing
          reads++;
          if (await onDisk(c).catch(() => false)) { found = true; break; }
        }
        if (found) continue;
        const path = cands[0];
        if (!path || named.has(path)) continue;
        named.add(path);
        out.push({ path, importedBy: file });
        if (out.length >= max) return out;
      }
    }
  } catch { return []; }
  return out;
}

/** The hand-off line, or '' when every import of the saved work resolves. PURE. */
export function missingImportsHandoffLine(missing: readonly MissingImport[]): string {
  if (!missing.length) return '';
  return ` These files are IMPORTED by the saved work but were never written — write each one FIRST, or the app does not load (the typecheck cannot see a missing stylesheet or asset): ${missing.map((m) => `${m.path} (imported by ${m.importedBy})`).join('; ')}.`;
}

/**
 * The one call every hand-off door makes: the line for the saved paths, read from what the turn wrote, what the project
 * held at the turn's start, and the sandbox. '' when nothing is missing, when there is nothing saved, or when the look
 * takes longer than `ms` (it never holds a build up). Never throws.
 */
export async function savedWorkMissingLine(
  savedPaths: readonly string[] | null | undefined,
  written: ReadonlyMap<string, string>,
  atStart: Readonly<Record<string, string>> | null | undefined,
  read: (path: string) => Promise<unknown>,
  ms = 10_000,
): Promise<string> {
  try {
    if (!savedPaths?.length) return '';
    const saved = Object.fromEntries([...written].filter(([p]) => savedPaths.includes(p)));
    const look = missingImportsOfSaved(saved, (p) => written.has(p) || (!!atStart && p in atStart), (p) => read(p).then(() => true, () => false));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<MissingImport[]>((resolve) => { timer = setTimeout(() => resolve([]), ms); });
    const missing = await Promise.race([look, late]);
    if (timer) clearTimeout(timer);
    return missingImportsHandoffLine(missing);
  } catch { return ''; }
}

// BR1997: a shell `rm` deleted a stylesheet that another module still imported.
//
// The builder took a stylesheet under `src/assets/styles/` for an unused duplicate and removed it with
// `rm`. `src/main.tsx` still imported it (the platform had wired that orphan stylesheet into the entry).
// tsc does not resolve a side-effect CSS import, so every typecheck stayed clean. The next real-browser
// look found a build-error overlay, and the repair took several more minutes.
//
// THE NOTE, NOT A REFUSAL. When a shell command's deletion is confirmed, the builder's bash result
// names any module that still imports the deleted file, so it can repoint or restore it in the same
// turn. It never blocks a command, never edits a file and never undoes the delete.
//
// PRECISION (BR1990 rule: act only on positive evidence; stay silent when unsure).
// - Only a LIVE import counts: comments, string literals and template literals are skipped by a small
//   tokenizer, so `x(); // import './a.css'` and `"import './a.css'"` are not imports.
// - Only a relative specifier WITH an extension that joins to exactly a deleted path counts. An
//   extensionless or directory specifier (`./foo`) could still resolve to a remaining sibling
//   (`foo.tsx`, `foo/index.ts`), so it is never named. tsc already reports a missing TS module.
// - Bare specifiers (packages, aliases) are ignored. Anything unreadable stays silent.
//
// BOUNDED (audit P0-C, review of the first version). The reads run on the bash critical path, so they
// are concurrent (12), each capped at 5 s, and the whole pass has an 8 s wall-clock budget; on expiry
// it uses what it has already read. Likely entry modules are read first.

import { mapWithConcurrency, withTimeout } from './asyncUtils';

const SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs)$/i;
/** Marks the note, so the user-facing tool summary can leave it out. */
export const DELETED_IMPORT_NOTE_MARKER = '[deleted-file check]';

const NOTE_LINE_RE = /\n*\[deleted-file check\] ⚠️ A file this command deleted is still imported:[^\n]*/g;

export interface DanglingImport {
  importer: string;
  specifier: string;
  deleted: string;
}

type Tok = { k: 'id' | 'str' | 'p'; v: string };

function tokens(source: string): Tok[] {
  const s = String(source ?? '');
  const n = s.length;
  const out: Tok[] = [];
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let v = '';
      let closed = false;
      while (j < n) {
        const d = s[j];
        if (d === '\\') { v += s[j + 1] ?? ''; j += 2; continue; }
        if (d === c) { closed = true; break; }
        if (d === '\n') break;
        v += d;
        j++;
      }
      out.push(closed ? { k: 'str', v } : { k: 'p', v: c });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n && s[j] !== '`') j += s[j] === '\\' ? 2 : 1;
      out.push({ k: 'p', v: '`' });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (!/\s/.test(c)) out.push({ k: 'p', v: c });
    i++;
  }
  return out;
}

/** The module specifiers of LIVE import/export/require statements; comments and strings never count. Pure. */
export function liveImportSpecifiers(source: string): string[] {
  const t = tokens(source);
  const out: string[] = [];
  const at = (i: number, k: Tok['k'], v?: string): boolean => t[i]?.k === k && (v === undefined || t[i].v === v);
  for (let i = 0; i < t.length; i++) {
    if (t[i].k !== 'id' || at(i - 1, 'p', '.')) continue;
    const word = t[i].v;
    if (word === 'require') {
      if (at(i + 1, 'p', '(') && at(i + 2, 'str') && at(i + 3, 'p', ')')) out.push(t[i + 2].v);
      continue;
    }
    if (word !== 'import' && word !== 'export') continue;
    if (word === 'import' && at(i + 1, 'str')) { out.push(t[i + 1].v); continue; }
    if (word === 'import' && at(i + 1, 'p', '(')) { if (at(i + 2, 'str')) out.push(t[i + 2].v); continue; }
    for (let j = i + 1; j < Math.min(t.length, i + 200); j++) {
      const x = t[j];
      if (x.k === 'p' && (x.v === ';' || x.v === '(' || x.v === '=')) break;
      if (x.k === 'id' && (x.v === 'import' || x.v === 'export')) break;
      if (x.k === 'id' && x.v === 'from' && at(j + 1, 'str')) { out.push(t[j + 1].v); break; }
    }
  }
  return out;
}

/** The exact workspace path a relative, extensioned specifier names, or null when it is not certain. Pure. */
export function exactImportTarget(importer: string, specifier: string): string | null {
  const spec = String(specifier ?? '').split('?')[0].split('#')[0];
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const last = spec.split('/').pop() ?? '';
  if (!/^[^.].*\.[A-Za-z0-9]+$/.test(last)) return null; // extensionless or a directory: a sibling may serve it
  const parts = String(importer ?? '').replace(/\\/g, '/').split('/').slice(0, -1).filter((p) => p && p !== '.');
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** The live imports in `sources` that name exactly a deleted path. Pure. */
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
    for (const specifier of liveImportSpecifiers(text)) {
      const target = exactImportTarget(importer, specifier);
      if (!target || !gone.has(target)) continue;
      const key = `${importer}\u0000${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ importer, specifier, deleted: target });
    }
  }
  return out;
}

const ENTRY_RE = /(^|\/)(main|index|App)\.(tsx?|jsx?|mjs|cjs)$/;

/** Likely entry modules first (shallow main/index/App, then deeper ones), then the rest in order. Pure. */
export function orderImportCandidates(paths: readonly string[]): string[] {
  const rank = (p: string): number => (ENTRY_RE.test(p) ? (p.split('/').length <= 2 ? 0 : 1) : 2);
  return [...paths].map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p);
}

export interface ReadBudget { concurrency?: number; perFileMs?: number; budgetMs?: number }

/**
 * Read `paths` with bounded concurrency, a per-file timeout and an overall wall-clock budget. Never
 * throws and never waits past the budget: it returns whatever was read by then. Failures are skipped.
 */
export async function readSourcesWithinBudget(
  paths: readonly string[],
  read: (path: string) => Promise<string>,
  { concurrency = 12, perFileMs = 5_000, budgetMs = 8_000 }: ReadBudget = {},
): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  let expired = false;
  const work = mapWithConcurrency([...paths], concurrency, async (p) => {
    if (expired) return;
    try {
      const text = await withTimeout(Promise.resolve().then(() => read(p)), perFileMs, 'deletedImportNote');
      if (!expired && typeof text === 'string') sources[p] = text;
    } catch { /* a failed or slow read is skipped */ }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
  try {
    await Promise.race([work.then(() => undefined, () => undefined), budget]);
  } finally {
    if (timer) clearTimeout(timer);
    expired = true;
  }
  return { ...sources };
}

/** The line appended to the bash result, or '' when nothing still imports a deleted file. Pure. */
export function danglingImportNote(list: readonly DanglingImport[]): string {
  if (!list || list.length === 0) return '';
  const shown = list.slice(0, 5).map((d) => `${d.importer} imports '${d.specifier}' (${d.deleted} is gone)`);
  const more = list.length > 5 ? `; +${list.length - 5} more` : '';
  return `${DELETED_IMPORT_NOTE_MARKER} ⚠️ A file this command deleted is still imported: ${shown.join('; ')}${more}. `
    + 'The dev server will fail on that import. Remove or repoint the import, or restore the file, before continuing.';
}

/** `content` without the note, for the user-facing tool summary. Unchanged when there is no note. Pure. */
export function withoutDeletedImportNote(content: string): string {
  if (typeof content !== 'string' || !content.includes(DELETED_IMPORT_NOTE_MARKER)) return content;
  return content.replace(NOTE_LINE_RE, '');
}

export function deletedImportNoteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AGENTV3_DELETED_IMPORT_NOTE ?? '').trim().toLowerCase() !== 'off';
}

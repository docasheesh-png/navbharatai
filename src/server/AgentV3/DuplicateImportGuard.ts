// AgentV3 — write-time duplicate-import guard (build-report autopsy 2026-08-01, buildId 1047276c).
//
// A weak model routinely re-imports a symbol it has already imported — the scaffold's main.tsx already
// has `import ErrorBoundary from './ErrorBoundary'` and the model adds `import { ErrorBoundary } from
// './ErrorBoundary'`; or App.tsx imports a page `Team` twice. esbuild's parse-only check accepts this
// (verified), so the write-guard misses it — but the in-browser preview (Babel) rejects it with
// "Duplicate declaration", so the user sees a BROKEN PREVIEW on an otherwise-shipped build. This pure
// transform removes a FULLY-REDUNDANT duplicate import statement (every identifier it binds is already
// bound from the SAME module by an earlier import) — a change that can never break anything, because it
// only drops a binding that already exists. Conservative by design: partial overlaps and different-module
// name collisions are left alone (a real error the backstop still reports). Pure; never throws.

/** Local binding names introduced by one import clause (the part between `import` and `from`). */
function parseImportBindingNames(clause: string): string[] {
  const c = clause.replace(/^\s*type\s+/, '').trim(); // `import type { X }` — bindings are still X
  if (!c) return [];
  const names: string[] = [];
  // Namespace: `* as NS`
  const ns = c.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (ns) return [ns[1]];
  // Split a possible `Default, { a, b }` into the default part and the braced part.
  const brace = c.match(/\{([^}]*)\}/);
  const beforeBrace = brace ? c.slice(0, c.indexOf('{')) : c;
  const defaultName = beforeBrace.replace(/,/g, '').trim();
  if (defaultName && /^[A-Za-z_$][\w$]*$/.test(defaultName)) names.push(defaultName);
  if (brace) {
    for (const part of brace[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      // `a as b` binds `b`; `a` binds `a`.
      const asMatch = seg.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const local = asMatch ? asMatch[1] : seg;
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
    }
  }
  return names;
}

const IMPORT_RE = /import\s+((?:type\s+)?[^;]*?)\s+from\s*['"]([^'"]+)['"]\s*;?/gs;

export interface DedupeResult {
  content: string;
  /** Human-readable descriptions of the import statements that were removed. */
  removed: string[];
}

/**
 * Remove fully-redundant duplicate import statements. A later `import … from 'mod'` is dropped only when
 * EVERY identifier it binds was already bound from the SAME module by an earlier import — so the removal
 * is always safe (the binding already exists). Returns the (possibly unchanged) content + what was removed.
 * Pure.
 */
export function dedupeDuplicateImports(content: string): DedupeResult {
  const src = typeof content === 'string' ? content : '';
  if (!src.includes('import')) return { content: src, removed: [] };
  const seen = new Map<string, string>(); // name -> module it was first bound from
  const removed: string[] = [];
  let out = '';
  let last = 0;
  IMPORT_RE.lastIndex = 0;
  for (let m = IMPORT_RE.exec(src); m; m = IMPORT_RE.exec(src)) {
    const [full, clause, mod] = m;
    const names = parseImportBindingNames(clause);
    // Fully redundant = has at least one binding AND every binding is already seen from the SAME module.
    const redundant = names.length > 0 && names.every((n) => seen.get(n) === mod);
    if (redundant) {
      out += src.slice(last, m.index); // keep everything up to this statement
      // Drop the statement AND a single trailing newline it owns, so no blank line is left behind.
      let end = m.index + full.length;
      if (src[end] === '\n') end += 1;
      last = end;
      removed.push(`${clause.trim()} from '${mod}'`);
    } else {
      for (const n of names) if (!seen.has(n)) seen.set(n, mod);
    }
  }
  if (removed.length === 0) return { content: src, removed: [] };
  out += src.slice(last);
  return { content: out, removed };
}

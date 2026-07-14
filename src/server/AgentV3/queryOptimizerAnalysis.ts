// GA-16 (performance intelligence) — query-optimizer analyzer.
//
// Distinct from the N+1 detector (queryPatternAnalysis): this flags per-QUERY over-fetch / unbounded / whole-
// table anti-patterns that ship "working" but degrade or lock up under real data volume:
//   • select-star       — `SELECT * FROM ...` in a raw SQL string (over-fetch; couples to schema shape).
//   • unbounded-read     — an awaited `findMany()`/`find()` with NO `where`/`take`/`limit`/`first`/`cursor`
//                          (a full-table scan that grows without bound).
//   • missing-where-mutation — `deleteMany()`/`updateMany()` with no `where` (or an empty `{}`) — a
//                          whole-table wipe/overwrite, one of the most destructive silent bugs.
// ADVISORY only: surfaced in `evaluate`, NEVER a readiness blocker (query weight is a quality/scale concern,
// not a correctness failure). AST-accurate via ts-morph; PURE; never throws (any parse/library problem yields
// no findings, so it can only add a true signal, never a false block). Mirrors queryPatternAnalysis.ts.

export interface QueryOptimizerIssue {
  kind: 'select-star' | 'unbounded-read' | 'missing-where-mutation';
  file: string;
  line: number;
  detail: string;
}

const CODE_FILE = /\.(?:m?[jt]sx?)$/i;
const EXCLUDE = /(\.test\.|\.spec\.|\.d\.ts$)/;
const SELECT_STAR = /\bselect\s+\*\s+from\b/i;
// Prisma/ORM read methods that should be bounded.
const UNBOUNDED_METHODS = new Set<string>(['findMany', 'find']);
// Bounding options whose presence means the read/mutation is scoped, not whole-table.
const BOUND_KEYS = new Set<string>(['where', 'take', 'limit', 'first', 'cursor', 'skip']);
const MUTATION_METHODS = new Set<string>(['deleteMany', 'updateMany']);
const MAX_ISSUES = 20;

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

/** The property-access method name of a call `x.method(...)`, or '' . */
function calleeMethod(call: any, SyntaxKind: any): string {
  try {
    const callee = call.getExpression?.();
    if (callee?.getKind?.() === SyntaxKind.PropertyAccessExpression) return callee.getName?.() ?? '';
  } catch { /* ignore */ }
  return '';
}

/** True when the first arg is an object literal that has one of the BOUND_KEYS. */
function firstArgHasBound(call: any, SyntaxKind: any): boolean {
  try {
    const arg = call.getArguments?.()[0];
    if (!arg || arg.getKind?.() !== SyntaxKind.ObjectLiteralExpression) return false;
    for (const prop of arg.getProperties?.() ?? []) {
      const name = prop.getName?.();
      if (typeof name === 'string' && BOUND_KEYS.has(name)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** True when the call's first arg is absent OR an object literal whose `where` is missing/empty `{}`. */
function mutationLacksWhere(call: any, SyntaxKind: any): boolean {
  try {
    const args = call.getArguments?.() ?? [];
    if (args.length === 0) return true;
    const arg = args[0];
    if (arg.getKind?.() !== SyntaxKind.ObjectLiteralExpression) return false; // dynamic arg — don't guess
    let whereProp: any;
    for (const prop of arg.getProperties?.() ?? []) if (prop.getName?.() === 'where') { whereProp = prop; break; }
    if (!whereProp) return true; // no where → whole table
    const init = whereProp.getInitializer?.();
    if (init?.getKind?.() === SyntaxKind.ObjectLiteralExpression && (init.getProperties?.() ?? []).length === 0) return true; // where: {}
    return false;
  } catch { return false; }
}

/**
 * Flag per-query over-fetch / unbounded / whole-table-mutation anti-patterns. Deterministic, AST-accurate,
 * advisory. Sorted by file+line, capped, deduped. Never throws.
 */
export async function analyzeQueryOptimizer(
  sources: ReadonlyArray<{ path: string; content: string }>,
): Promise<QueryOptimizerIssue[]> {
  const mod = await loadTsMorph();
  if (!mod) return [];
  const { SyntaxKind } = mod;
  let project: any;
  try { project = new mod.Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, jsx: 2 } }); }
  catch { return []; }

  const issues: QueryOptimizerIssue[] = [];
  const seen = new Set<string>();
  const push = (i: QueryOptimizerIssue) => {
    const key = `${i.file}:${i.line}:${i.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(i);
  };

  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!CODE_FILE.test(path) || EXCLUDE.test(path)) continue;
    let sf: any;
    try { sf = project.createSourceFile(path, content, { overwrite: true }); } catch { continue; }

    // select-star — over string + template literals.
    try {
      const strings = [
        ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
        ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
        ...sf.getDescendantsOfKind(SyntaxKind.TemplateExpression),
      ];
      for (const s of strings) {
        let text = '';
        try { text = s.getText?.() ?? ''; } catch { continue; }
        if (!SELECT_STAR.test(text)) continue;
        const line = (() => { try { return s.getStartLineNumber?.() ?? 0; } catch { return 0; } })();
        push({ kind: 'select-star', file: path, line, detail: `'SELECT *' at ${path}:${line} over-fetches every column and silently couples the code to the table's shape. Select only the columns you use.` });
      }
    } catch { /* ignore */ }

    // unbounded-read + missing-where-mutation — over call expressions.
    let calls: any[];
    try { calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression); } catch { calls = []; }
    for (const call of calls) {
      const method = calleeMethod(call, SyntaxKind);
      if (!method) continue;
      const line = (() => { try { return call.getStartLineNumber?.() ?? 0; } catch { return 0; } })();
      if (UNBOUNDED_METHODS.has(method) && !firstArgHasBound(call, SyntaxKind)) {
        push({ kind: 'unbounded-read', file: path, line, detail: `'${method}()' at ${path}:${line} has no where/take/limit/cursor — a full-table read that grows without bound as data accumulates. Add a filter and/or a page size.` });
      } else if (MUTATION_METHODS.has(method) && mutationLacksWhere(call, SyntaxKind)) {
        push({ kind: 'missing-where-mutation', file: path, line, detail: `'${method}()' at ${path}:${line} has no 'where' clause — it affects the WHOLE table (every row deleted/updated). Add a where clause, or confirm the whole-table operation is intended.` });
      }
      if (issues.length >= MAX_ISSUES) break;
    }
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Advisory report line(s), or '' when clean. Pure. */
export function queryOptimizerSummary(issues: QueryOptimizerIssue[]): string {
  if (!issues || issues.length === 0) return '';
  const label: Record<QueryOptimizerIssue['kind'], string> = {
    'select-star': 'SELECT *', 'unbounded-read': 'unbounded read', 'missing-where-mutation': 'whole-table mutation',
  };
  const shown = issues.slice(0, 8).map((i) => `  ⚠️ ${i.file}:${i.line} — ${label[i.kind]}`);
  return `Performance — ${issues.length} query-optimization issue(s) (over-fetch / unbounded / whole-table — scale + safety):\n${shown.join('\n')}${issues.length > 8 ? `\n  …and ${issues.length - 8} more` : ''}`;
}

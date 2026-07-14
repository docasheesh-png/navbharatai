// GA-16 (roadmap Tier 2C) — query-pattern / performance analyzer: the N+1 query anti-pattern.
//
// The #1 backend performance killer is a database query run PER ITERATION of a loop (N+1): a page that lists
// 100 orders and then fetches each order's customer inside the loop fires 101 queries instead of 1–2. It
// ships "working" but falls over under real load. This flags an AWAITED query call that lives inside a loop
// (for / for-of / while) or an array-iteration callback (map / forEach / filter / reduce) — the exact N+1
// shape — so the agent can batch it (a single WHERE-IN / include / join) before shipping. ADVISORY only:
// surfaced in `evaluate`, NEVER a readiness blocker (it is a quality concern, not a correctness failure —
// degrading a working app over it would break the one absolute rule). AST-accurate via ts-morph; PURE; never
// throws (any parse/library problem yields no findings, so it can only add a true signal, never false-block).

export interface QueryPatternIssue {
  kind: 'n-plus-one';
  file: string;
  line: number;
  /** The query method called in the loop (e.g. 'findMany', 'query'). */
  method: string;
  detail: string;
}

const CODE_FILE = /\.(?:m?[jt]sx?)$/i;
const EXCLUDE = /(\.test\.|\.spec\.|\.d\.ts$)/;

// ORM/driver query methods across Prisma, Mongoose, TypeORM, Knex/Drizzle, node-postgres, Firestore.
const QUERY_METHODS = new Set<string>([
  'find', 'findOne', 'findMany', 'findFirst', 'findUnique', 'findById', 'findByIdAndUpdate',
  'query', 'aggregate', 'count', 'exec', 'save', 'insertOne', 'insertMany', 'updateOne', 'updateMany',
  'deleteOne', 'deleteMany', 'getDocs', 'getDoc',
]);
// Array-iteration callbacks that are effectively a loop body.
const ITERATION_METHODS = new Set<string>(['map', 'forEach', 'filter', 'reduce', 'flatMap', 'some', 'every']);
const MAX_ISSUES = 20;

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

/**
 * Flag an awaited DB query that runs inside a loop / iteration callback (the N+1 pattern). Deterministic,
 * AST-accurate, advisory. Sorted by file+line, capped. Never throws.
 */
export async function analyzeQueryPatterns(
  sources: ReadonlyArray<{ path: string; content: string }>,
): Promise<QueryPatternIssue[]> {
  const mod = await loadTsMorph();
  if (!mod) return [];
  const { SyntaxKind } = mod;
  let project: any;
  try { project = new mod.Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, jsx: 2 } }); }
  catch { return []; }

  const issues: QueryPatternIssue[] = [];
  const seen = new Set<string>();

  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!CODE_FILE.test(path) || EXCLUDE.test(path)) continue;
    let sf: any;
    try { sf = project.createSourceFile(path, content, { overwrite: true }); } catch { continue; }

    let awaits: any[];
    try { awaits = sf.getDescendantsOfKind(SyntaxKind.AwaitExpression); } catch { continue; }
    for (const aw of awaits) {
      // The awaited expression must be a method call `x.method(...)` whose method is a known query.
      let call: any;
      try { call = aw.getExpression?.(); } catch { continue; }
      if (!call || call.getKind?.() !== SyntaxKind.CallExpression) continue;
      let method = '';
      try {
        const callee = call.getExpression?.();
        if (callee?.getKind?.() === SyntaxKind.PropertyAccessExpression) method = callee.getName?.() ?? '';
      } catch { /* ignore */ }
      if (!method || !QUERY_METHODS.has(method)) continue;

      // Is this await inside a loop or an iteration callback?
      let inLoop = false;
      try {
        for (let p = aw.getParent?.(); p; p = p.getParent?.()) {
          const k = p.getKind?.();
          if (k === SyntaxKind.ForStatement || k === SyntaxKind.ForOfStatement || k === SyntaxKind.ForInStatement ||
              k === SyntaxKind.WhileStatement || k === SyntaxKind.DoStatement) { inLoop = true; break; }
          // `items.map(async x => await query())` — an iteration method's callback argument.
          if (k === SyntaxKind.CallExpression) {
            const callee = p.getExpression?.();
            if (callee?.getKind?.() === SyntaxKind.PropertyAccessExpression && ITERATION_METHODS.has(callee.getName?.() ?? '')) { inLoop = true; break; }
          }
          if (k === SyntaxKind.FunctionDeclaration || k === SyntaxKind.MethodDeclaration) break; // a nested fn boundary — stop climbing
        }
      } catch { /* ignore */ }
      if (!inLoop) continue;

      const line = (() => { try { return aw.getStartLineNumber?.() ?? 0; } catch { return 0; } })();
      const key = `${path}:${line}:${method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        kind: 'n-plus-one', file: path, line, method,
        detail: `'${method}()' is awaited inside a loop at ${path}:${line} — an N+1 query pattern that fires one DB round-trip per item and collapses under load. Batch it into a single query (WHERE ... IN / a join / Prisma \`include\`) outside the loop.`,
      });
      if (issues.length >= MAX_ISSUES) return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    }
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Advisory report line(s), or '' when clean. Pure. */
export function queryPatternSummary(issues: QueryPatternIssue[]): string {
  if (!issues || issues.length === 0) return '';
  const shown = issues.slice(0, 8).map((i) => `  ⚠️ ${i.file}:${i.line} — awaited '${i.method}()' inside a loop (N+1)`);
  return `Performance — ${issues.length} likely N+1 query pattern(s) (a DB query per loop iteration; batch into one):\n${shown.join('\n')}${issues.length > 8 ? `\n  …and ${issues.length - 8} more` : ''}`;
}

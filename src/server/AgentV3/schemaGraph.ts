// GA-5 (relationship graphs) — Prisma schema / foreign-key relationship graph.
//
// A fullstack app's data model is a graph: models (tables) linked by relations (foreign keys). The silent,
// migration-breaking bug is a RELATION that points at a model the schema never defines — e.g. a `Post` with
// `author User @relation(...)` when there is no `model User`. It looks fine in the editor, but `prisma
// migrate` (or the app at query time) fails on the dangling reference. This builds the model→relation graph
// from every `.prisma` file and flags those dangling relations deterministically.
//
// Scoped to PRISMA (the dominant schema NavBharatAI generates); SQL-DDL foreign keys are a future slice.
// PURE + dependency-free (line/regex parse over schema text — .prisma is not TypeScript, so no AST library
// is needed or appropriate). Names are aggregated across ALL .prisma files first (a schema can be split into
// a folder), so a model defined in a sibling file is NOT mis-flagged as dangling. Conservative by design:
// when a field's type cannot be confidently classified as a relation, it is left alone — under-report rather
// than raise a false "dangling relation" that could push the agent to change correct code (rule 1). Never
// throws.

export interface SchemaModel { name: string; file: string; }
export interface SchemaRelation {
  /** The model that declares the relation field. */
  from: string;
  /** The referenced model type (base name, `?`/`[]` stripped). */
  to: string;
  field: string;
  file: string;
  line: number;
}
export interface SchemaGraph {
  models: SchemaModel[];
  relations: SchemaRelation[];
  /** Relations whose `to` model is not defined anywhere in the schema — the actionable, migration-breaking set. */
  dangling: SchemaRelation[];
}

const PRISMA_FILE = /(^|\/)[^/]*\.prisma$/i;

// Prisma scalar types are never relations.
const SCALARS = new Set<string>([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
]);

// Block openers we must know the names of so a field typed as one of them is not mistaken for a dangling
// relation: `model`, `enum`, `type` (composite/embedded). `view` is treated like a model (it is referable).
const BLOCK_RE = /^\s*(model|enum|type|view)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
// A field line inside a model: `name  Type modifiers...`. Type may carry `?` or `[]`.
const FIELD_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\?|\[\])?/;

/** Strip a `//` line comment (not inside a string — Prisma field lines don't contain string literals here). */
function stripComment(line: string): string {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
}

/**
 * Build the Prisma model→relation graph and flag dangling relations (a relation to an undefined model).
 * Deterministic; conservative; never throws. `dangling` is the actionable set.
 */
export function analyzeSchemaGraph(sources: ReadonlyArray<{ path: string; content: string }>): SchemaGraph {
  const files: Array<{ path: string; content: string }> = [];
  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!PRISMA_FILE.test(path)) continue;
    files.push({ path, content });
  }
  if (files.length === 0) return { models: [], relations: [], dangling: [] };

  // Pass 1 — collect every referable type name (model/view) and every non-relation type name (enum/type),
  // aggregated across ALL files (a schema folder can split definitions).
  const models: SchemaModel[] = [];
  const referable = new Set<string>();   // model + view names — a relation may legitimately point here
  const nonRelation = new Set<string>(); // enum + composite type names — a field of this type is NOT a relation
  for (const { path, content } of files) {
    let lines: string[];
    try { lines = content.split(/\r?\n/); } catch { continue; }
    for (const raw of lines) {
      const m = BLOCK_RE.exec(raw);
      if (!m) continue;
      const kind = m[1];
      const name = m[2];
      if (kind === 'model' || kind === 'view') { referable.add(name); models.push({ name, file: path }); }
      else { nonRelation.add(name); } // enum | type
    }
  }

  // Pass 2 — within each model/view block, resolve every relation field and check it against `referable`.
  const relations: SchemaRelation[] = [];
  const dangling: SchemaRelation[] = [];
  const seen = new Set<string>();
  for (const { path, content } of files) {
    let lines: string[];
    try { lines = content.split(/\r?\n/); } catch { continue; }
    let current: string | null = null;
    let inBlockKind: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const open = BLOCK_RE.exec(raw);
      if (open) { inBlockKind = open[1]; current = (open[1] === 'model' || open[1] === 'view') ? open[2] : null; continue; }
      if (/^\s*\}/.test(raw)) { current = null; inBlockKind = null; continue; }
      if (!current || inBlockKind === null) continue; // only inside a model/view body

      const line = stripComment(raw);
      if (line.includes('Unsupported(')) continue; // raw DB type, not a relation
      const f = FIELD_RE.exec(line);
      if (!f) continue;
      const field = f[1];
      const baseType = f[2];
      // Skip block keywords and attributes that FIELD_RE could catch at odd indentation.
      if (baseType === current) continue;
      if (SCALARS.has(baseType) || nonRelation.has(baseType)) continue; // scalar or enum/composite → not a relation
      // A relation field's type is a capitalized identifier that is not a scalar/enum/composite.
      if (!/^[A-Z]/.test(baseType)) continue;

      const rel: SchemaRelation = { from: current, to: baseType, field, file: path, line: i + 1 };
      const key = `${path}:${i + 1}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push(rel);
      if (!referable.has(baseType)) dangling.push(rel);
    }
  }

  return {
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
    relations,
    dangling: dangling.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  };
}

// GA-5 (change-propagation blast-radius) — given a model/table, which OTHER models/tables depend on it.

export interface SchemaDependent {
  /** The model/table that references the target. */
  from: string;
  field: string;
  file: string;
  line: number;
}

/**
 * The blast radius of a model/table: every relation/FK that points AT it — i.e. the models that would break
 * or need review if it is renamed, dropped, or its key changes. Case-insensitive match (Prisma models are
 * case-sensitive but SQL tables aren't; matching loosely only ever WIDENS the safety net). Pure.
 */
export function schemaDependents(graph: SchemaGraph, target: string): SchemaDependent[] {
  if (!graph || !graph.relations || !target) return [];
  const t = String(target).toLowerCase();
  const out: SchemaDependent[] = [];
  const seen = new Set<string>();
  for (const r of graph.relations) {
    if (String(r.to).toLowerCase() !== t) continue;
    const key = `${r.file}:${r.line}:${r.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: r.from, field: r.field, file: r.file, line: r.line });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
}

/**
 * Render the schema relationship graph + per-model blast radius (how many models reference each) as a compact
 * report for the `schema_graph` tool. `target` (optional) drills into one model's dependents. Pure; '' when
 * there is no schema.
 */
export function schemaGraphReport(graph: SchemaGraph, target?: string): string {
  if (!graph || graph.models.length === 0) return '';
  if (target) {
    const deps = schemaDependents(graph, target);
    if (deps.length === 0) return `Blast radius of '${target}': nothing references it — safe to change in isolation (or it is not a defined model/table).`;
    const shown = deps.map((d) => `  • ${d.from}.${d.field} (${d.file}:${d.line})`);
    return `Blast radius of '${target}' — ${deps.length} model(s)/table(s) reference it (review these before renaming/dropping it or changing its key):\n${shown.join('\n')}`;
  }
  const lines = graph.models.map((m) => {
    const n = schemaDependents(graph, m.name).length;
    return `  • ${m.name} — referenced by ${n} model(s)/table(s)`;
  });
  const dangle = graph.dangling.length ? `\n\n⚠️ ${graph.dangling.length} dangling reference(s) — see the readiness check.` : '';
  return `Schema relationship graph (${graph.models.length} models/tables, ${graph.relations.length} relations):\n${lines.join('\n')}${dangle}`;
}

/** Advisory `evaluate` line for dangling relations, or '' when the schema graph is clean / absent. Pure. */
export function schemaGraphSummary(graph: SchemaGraph): string {
  if (!graph || !graph.dangling || graph.dangling.length === 0) return '';
  const shown = graph.dangling.slice(0, 8).map((r) =>
    `  ⚠️ ${r.file}:${r.line} — model '${r.from}'.${r.field} references '${r.to}', which no model defines`);
  return `Schema — ${graph.dangling.length} dangling relation(s) (a Prisma relation to a model the schema never defines; breaks \`prisma migrate\`):\n${shown.join('\n')}${graph.dangling.length > 8 ? `\n  …and ${graph.dangling.length - 8} more` : ''}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
// GA-5 (SQL-DDL slice) — foreign-key graph for plain SQL migration/schema files.
//
// The same dangling-reference bug exists in raw SQL apps: a `FOREIGN KEY (...) REFERENCES orders(id)` when no
// `CREATE TABLE orders` exists anywhere → the migration fails at apply time. This parses `.sql` files for
// CREATE TABLE definitions + foreign-key references (both table-level `FOREIGN KEY ... REFERENCES t(...)` and
// inline column `... REFERENCES t(col)`) and flags FKs whose target table is never defined. Kept SEPARATE
// from the Prisma path (a Prisma model and a SQL table are different namespaces — never cross-resolved).
// Case-insensitive table matching (SQL identifiers are case-insensitive unquoted) so a `Users` FK matches a
// `users` table — under-report a dangling FK rather than raise a false one (rule 1). PURE; never throws.

const SQL_FILE = /(^|\/)[^/]*\.sql$/i;
// CREATE TABLE [IF NOT EXISTS] [schema.]name ( — name may be quoted "x", `x`, [x], or bare.
const CREATE_TABLE_RE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s*\(/gi;
// REFERENCES [schema.]table — the referenced table of a foreign key.
const REFERENCES_RE = /\bREFERENCES\s+([`"[\]\w.]+)/gi;

/** Normalize a SQL table identifier: drop quotes/backticks/brackets + schema prefix, lower-case. */
function normSqlTable(raw: string): string {
  let s = String(raw || '').trim().replace(/[`"[\]]/g, '');
  const dot = s.lastIndexOf('.');
  if (dot >= 0) s = s.slice(dot + 1); // strip schema qualifier (public.users → users)
  return s.toLowerCase();
}

/** Line number (1-based) of a character offset within text. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** Scan from the '(' at `openIdx` to its balanced ')'. Returns the end index (of the ')'), or text.length. */
function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return text.length;
}

/**
 * Build the SQL table→foreign-key graph and flag dangling FKs (a FK to a table no CREATE TABLE defines).
 * Deterministic; conservative; never throws. Table names aggregated across ALL .sql files first.
 */
export function analyzeSqlSchema(sources: ReadonlyArray<{ path: string; content: string }>): SchemaGraph {
  const files: Array<{ path: string; content: string }> = [];
  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!SQL_FILE.test(path)) continue;
    files.push({ path, content });
  }
  if (files.length === 0) return { models: [], relations: [], dangling: [] };

  // Pass 1 — collect every defined table name (normalized), across all files.
  const models: SchemaModel[] = [];
  const defined = new Set<string>();
  for (const { path, content } of files) {
    CREATE_TABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_TABLE_RE.exec(content)) !== null) {
      const name = normSqlTable(m[1]);
      if (name) { defined.add(name); models.push({ name, file: path }); }
    }
  }

  // Pass 2 — for each CREATE TABLE block, collect its FK references and check against `defined`.
  const relations: SchemaRelation[] = [];
  const dangling: SchemaRelation[] = [];
  const seen = new Set<string>();
  for (const { path, content } of files) {
    CREATE_TABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_TABLE_RE.exec(content)) !== null) {
      const fromTable = normSqlTable(m[1]);
      const openIdx = content.indexOf('(', m.index);
      if (openIdx < 0) continue;
      const closeIdx = matchParen(content, openIdx);
      const body = content.slice(openIdx + 1, closeIdx);
      CREATE_TABLE_RE.lastIndex = closeIdx; // resume scanning after this table's body
      REFERENCES_RE.lastIndex = 0;
      let r: RegExpExecArray | null;
      while ((r = REFERENCES_RE.exec(body)) !== null) {
        const toTable = normSqlTable(r[1]);
        if (!toTable) continue;
        const line = lineAt(content, openIdx + 1 + r.index);
        const rel: SchemaRelation = { from: fromTable, to: toTable, field: 'FOREIGN KEY', file: path, line };
        const key = `${path}:${line}:${fromTable}->${toTable}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push(rel);
        if (!defined.has(toTable)) dangling.push(rel);
      }
    }
  }

  return {
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
    relations,
    dangling: dangling.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  };
}

/** Advisory `evaluate` line for dangling SQL foreign keys, or '' when clean / absent. Pure. */
export function sqlSchemaSummary(graph: SchemaGraph): string {
  if (!graph || !graph.dangling || graph.dangling.length === 0) return '';
  const shown = graph.dangling.slice(0, 8).map((r) =>
    `  ⚠️ ${r.file}:${r.line} — table '${r.from}' foreign key references '${r.to}', which no CREATE TABLE defines`);
  return `Schema — ${graph.dangling.length} dangling foreign key(s) (a SQL FK to a table the schema never defines; breaks the migration):\n${shown.join('\n')}${graph.dangling.length > 8 ? `\n  …and ${graph.dangling.length - 8} more` : ''}`;
}

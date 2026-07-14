// GA-10 (schema intelligence) — schema → TypeScript type generator.
//
// A fullstack app's frontend and backend should share ONE typed shape of the database, but the types are
// usually hand-written and drift from the schema. This generates `src/types/db.ts` from the real schema — an
// `export interface` per Prisma model / SQL table, an `export type` union per Prisma enum — so both sides
// import the same source-of-truth types. Deterministic string generation (regex parse, same shapes as
// schemaGraph.ts — no schema/DB dependency); never throws; conservative (an unrecognized type → `unknown`,
// never a wrong type).

export interface GeneratedType { name: string; kind: 'interface' | 'enum'; code: string; }
export interface TypeGenResult { source: 'prisma' | 'sql'; types: GeneratedType[]; fileContent: string; }

const PRISMA_FILE = /(^|\/)[^/]*\.prisma$/i;
const SQL_FILE = /(^|\/)[^/]*\.sql$/i;
const BLOCK_RE = /^\s*(model|enum|type|view)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
const FIELD_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\?|\[\])?/;

const PRISMA_SCALAR: Record<string, string> = {
  String: 'string', Boolean: 'boolean', Int: 'number', BigInt: 'number', Float: 'number',
  Decimal: 'number', DateTime: 'Date', Json: 'unknown', Bytes: 'Uint8Array',
};

function stripComment(line: string): string {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
}

/** Prisma models/views → interfaces, enums → unions. Pure. */
export function prismaToTypeScript(sources: ReadonlyArray<{ path: string; content: string }>): GeneratedType[] {
  const files = (sources || []).filter((s) => s && typeof s.path === 'string' && typeof s.content === 'string' && PRISMA_FILE.test(s.path));
  if (files.length === 0) return [];
  // Pass 1 — collect names.
  const models = new Set<string>();
  const enums = new Map<string, string[]>();
  const composites = new Set<string>();
  for (const { content } of files) {
    for (const line of content.split(/\r?\n/)) {
      const m = BLOCK_RE.exec(line);
      if (!m) continue;
      if (m[1] === 'model' || m[1] === 'view') models.add(m[2]);
      else if (m[1] === 'type') composites.add(m[2]);
    }
    // Enums (inline `{ A B }` OR multi-line) — captured whole so single-line enums parse correctly.
    const enumRe = /\benum\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g;
    let em: RegExpExecArray | null;
    while ((em = enumRe.exec(content)) !== null) {
      const vals: string[] = [];
      for (const tok of em[2].split(/\r?\n/).map(stripComment).join(' ').split(/\s+/)) {
        if (tok && /^[A-Za-z_]\w*$/.test(tok)) vals.push(tok);
      }
      enums.set(em[1], vals);
    }
  }
  const out: GeneratedType[] = [];
  for (const [name, vals] of enums) {
    out.push({ name, kind: 'enum', code: `export type ${name} = ${vals.length ? vals.map((v) => `'${v}'`).join(' | ') : 'string'};` });
  }
  // Pass 2 — model/view interfaces.
  for (const { content } of files) {
    const lines = content.split(/\r?\n/);
    let current: string | null = null;
    let fields: string[] = [];
    for (const raw of lines) {
      const open = BLOCK_RE.exec(raw);
      if (open) { current = (open[1] === 'model' || open[1] === 'view') ? open[2] : null; fields = []; continue; }
      if (/^\s*\}/.test(raw)) {
        if (current) out.push({ name: current, kind: 'interface', code: `export interface ${current} {\n${fields.join('\n')}\n}` });
        current = null; continue;
      }
      if (!current) continue;
      const line = stripComment(raw);
      if (line.includes('Unsupported(') || /^\s*@@/.test(line)) continue;
      const f = FIELD_RE.exec(line);
      if (!f) continue;
      const [, fname, base, mod] = f;
      if (fname === current) continue;
      let ts: string;
      if (PRISMA_SCALAR[base]) ts = PRISMA_SCALAR[base];
      else if (enums.has(base)) ts = base;
      else if (composites.has(base) || models.has(base)) ts = base; // relation / composite → interface ref
      else if (/^[A-Z]/.test(base)) ts = base; // unknown capitalized → assume a defined type (best-effort)
      else continue; // lowercase non-scalar → not a field type
      const isArray = mod === '[]';
      const isOpt = mod === '?';
      const tsType = isArray ? `${ts}[]` : isOpt ? `${ts} | null` : ts;
      fields.push(`  ${fname}${isOpt ? '?' : ''}: ${tsType};`);
    }
  }
  return out;
}

const SQL_TYPE_RULES: Array<[RegExp, string]> = [
  [/^(int|integer|serial|bigserial|smallserial|bigint|smallint|int2|int4|int8|numeric|decimal|real|double|float|money)\b/i, 'number'],
  [/^(varchar|char|character|text|uuid|citext|name|bpchar)\b/i, 'string'],
  [/^(bool|boolean)\b/i, 'boolean'],
  [/^(timestamp|timestamptz|date|time|timetz|datetime)\b/i, 'Date'],
  [/^(json|jsonb)\b/i, 'unknown'],
  [/^(bytea|blob)\b/i, 'Uint8Array'],
];

function pascalSingular(table: string): string {
  let t = table.replace(/[^A-Za-z0-9_]/g, '');
  if (/ies$/i.test(t)) t = t.replace(/ies$/i, 'y');
  else if (/(sh|ch|x|s)es$/i.test(t)) t = t.replace(/es$/i, '');
  else if (/s$/i.test(t) && !/ss$/i.test(t)) t = t.replace(/s$/i, '');
  return t.split(/[_-]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Row';
}

const CREATE_TABLE_RE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[\]\w.]+)\s*\(/gi;
function normTable(raw: string): string { let s = String(raw).replace(/[`"\[\]]/g, ''); const d = s.lastIndexOf('.'); return d >= 0 ? s.slice(d + 1) : s; }
function matchParen(text: string, open: number): number { let d = 0; for (let i = open; i < text.length; i++) { if (text[i] === '(') d++; else if (text[i] === ')') { d--; if (d === 0) return i; } } return text.length; }

/** SQL CREATE TABLE → interfaces. Pure. */
export function sqlToTypeScript(sources: ReadonlyArray<{ path: string; content: string }>): GeneratedType[] {
  const files = (sources || []).filter((s) => s && typeof s.path === 'string' && typeof s.content === 'string' && SQL_FILE.test(s.path));
  if (files.length === 0) return [];
  const out: GeneratedType[] = [];
  const seen = new Set<string>();
  for (const { content } of files) {
    CREATE_TABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_TABLE_RE.exec(content)) !== null) {
      const table = normTable(m[1]);
      const name = pascalSingular(table);
      if (seen.has(name)) continue;
      const open = content.indexOf('(', m.index);
      if (open < 0) continue;
      const close = matchParen(content, open);
      CREATE_TABLE_RE.lastIndex = close;
      const body = content.slice(open + 1, close);
      // Split on top-level commas (ignore commas inside parens like NUMERIC(10,2)).
      const cols: string[] = []; let depth = 0, buf = '';
      for (const ch of body) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && depth === 0) { cols.push(buf); buf = ''; } else buf += ch; }
      if (buf.trim()) cols.push(buf);
      const fields: string[] = [];
      for (const col of cols) {
        const c = col.trim();
        if (!c || /^(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|UNIQUE|CHECK|INDEX|KEY|EXCLUDE)\b/i.test(c)) continue;
        const cm = c.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+([A-Za-z0-9_]+)/);
        if (!cm) continue;
        const [, colName, colType] = cm;
        let ts = 'unknown';
        for (const [re, t] of SQL_TYPE_RULES) if (re.test(colType)) { ts = t; break; }
        const notNull = /\bNOT\s+NULL\b/i.test(c) || /\bPRIMARY\s+KEY\b/i.test(c);
        fields.push(`  ${colName}${notNull ? '' : '?'}: ${ts}${notNull ? '' : ' | null'};`);
      }
      if (fields.length) { seen.add(name); out.push({ name, kind: 'interface', code: `export interface ${name} {\n${fields.join('\n')}\n}` }); }
    }
  }
  return out;
}

/** Generate the db types file from whichever schema is present (Prisma preferred). null when nothing usable. */
export function generateSchemaTypes(sources: ReadonlyArray<{ path: string; content: string }>): TypeGenResult | null {
  const hasPrisma = (sources || []).some((s) => s && typeof s.path === 'string' && PRISMA_FILE.test(s.path));
  const source: 'prisma' | 'sql' = hasPrisma ? 'prisma' : 'sql';
  const types = source === 'prisma' ? prismaToTypeScript(sources) : sqlToTypeScript(sources);
  if (types.length === 0) return null;
  const header = '// Auto-generated from your database schema by NavBharatAI. Do not edit by hand.\n// Regenerate with the generate_types tool after a schema change.\n\n';
  const fileContent = header + types.map((t) => t.code).join('\n\n') + '\n';
  return { source, types, fileContent };
}

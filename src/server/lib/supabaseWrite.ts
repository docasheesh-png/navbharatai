/**
 * Changing a row in the user's OWN database (ROADMAP #1 Phase 2.2).
 *
 * This is the dangerous half of a data GUI. Reading a table wrong shows the wrong screen; writing a
 * table wrong destroys someone's data, and there is no undo. Two rules make that structurally
 * impossible rather than merely unlikely:
 *
 *   1. NO WHERE, NO WRITE. Every UPDATE and DELETE is built from the table's real PRIMARY KEY, read
 *      from the database's own catalogue. A table with no primary key is REFUSED — not "handled
 *      carefully", refused — because without one there is no expression that provably identifies a
 *      single row, and an UPDATE that matches four rows looks exactly like one that matches one until
 *      the damage is done. The builders throw on an empty key rather than emitting a bare statement.
 *
 *   2. EVERY VALUE IS A LITERAL, BUILT HERE. Supabase's Management endpoint takes SQL as a string, so
 *      there are no bind parameters to hide behind. `sqlLiteral` is the single encoder, it handles
 *      every type the UI can produce, and it THROWS on anything it does not understand instead of
 *      falling back to `String(value)` — a stringified surprise is precisely how a value stops being
 *      a value and becomes syntax.
 *
 * Each statement ends in `returning *`, so the caller can verify what actually changed instead of
 * assuming, and report the real row back to the screen.
 */

import { isSafeIdentifier, quoteIdent } from './supabaseData';

/**
 * A value, as Postgres source text.
 *
 * Strings double their single quotes, which is the whole escape needed while
 * `standard_conforming_strings` is on — it has been the default since Postgres 9.1 and Supabase does
 * not change it. Objects and arrays become a jsonb literal, because that is what a jsonb column
 * round-trips as; a caller that means "text containing JSON" passes a string and gets a text literal.
 *
 * THROWS on anything else. `undefined`, NaN, Infinity, functions and symbols have no honest Postgres
 * spelling, and inventing one (NULL for undefined, 'NaN' for NaN) would silently write something the
 * user did not ask for.
 */
export function sqlLiteral(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('cannot store a non-finite number');
    return String(value);
  }
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('cannot store an invalid date');
    return `'${value.toISOString()}'`;
  }
  if (typeof value === 'object') {
    let json: string;
    try { json = JSON.stringify(value); } catch { throw new Error('cannot store this value'); }
    if (json === undefined) throw new Error('cannot store this value');
    return `'${json.replace(/'/g, "''")}'::jsonb`;
  }
  throw new Error(`cannot store a value of type ${typeof value}`);
}

/** The table's primary-key columns, in key order. Empty for a table that has none. */
export function primaryKeySql(table: string): string {
  if (!isSafeIdentifier(table)) throw new Error(`unsafe identifier: ${String(table).slice(0, 40)}`);
  return `select a.attname as column_name
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
 where i.indrelid = ${literalRegclass(table)} and i.indisprimary
 order by array_position(i.indkey, a.attnum)`;
}

/** `'public."users"'::regclass` — the table, resolved by the database rather than matched by name. */
function literalRegclass(table: string): string {
  return `'public.${quoteIdent(table)}'::regclass`;
}

export interface RowKey { [column: string]: unknown }

/**
 * `where` from the primary key.
 *
 * Refuses an empty key, a key column the table did not declare, and a NULL key value. The last one
 * matters more than it looks: `col = NULL` is never true in SQL, so a NULL key would produce a
 * statement that silently changes NOTHING and still reports success — the exact shape of a write that
 * appears to work and does not.
 */
export function whereFromKey(key: RowKey, pkColumns: string[]): string {
  if (!Array.isArray(pkColumns) || pkColumns.length === 0) {
    throw new Error('this table has no primary key');
  }
  const parts: string[] = [];
  for (const col of pkColumns) {
    if (!(col in (key ?? {}))) throw new Error(`missing key column: ${col}`);
    const value = key[col];
    if (value === null || value === undefined) throw new Error(`key column ${col} cannot be empty`);
    parts.push(`${quoteIdent(col)} = ${sqlLiteral(value)}`);
  }
  return parts.join(' and ');
}

/** Reject a payload that names a column the table does not have, before any statement is built. */
function assertKnownColumns(values: Record<string, unknown>, known: string[]): string[] {
  const names = Object.keys(values ?? {});
  if (names.length === 0) throw new Error('nothing to save');
  const allowed = new Set(known ?? []);
  for (const name of names) {
    if (!isSafeIdentifier(name)) throw new Error(`unsafe column: ${String(name).slice(0, 40)}`);
    // An unknown column is the user's mistake, not something to quietly drop: dropping it would save
    // "successfully" while leaving out the field they actually typed.
    if (allowed.size > 0 && !allowed.has(name)) throw new Error(`no such column: ${name}`);
  }
  return names;
}

export function buildInsertSql(opts: { table: string; values: Record<string, unknown>; columns?: string[] }): string {
  const table = quoteIdent(opts.table);
  const names = assertKnownColumns(opts.values, opts.columns ?? []);
  const cols = names.map(quoteIdent).join(', ');
  const vals = names.map((n) => sqlLiteral(opts.values[n])).join(', ');
  return `insert into public.${table} (${cols}) values (${vals}) returning *`;
}

export function buildUpdateSql(opts: {
  table: string; values: Record<string, unknown>; key: RowKey; pkColumns: string[]; columns?: string[];
}): string {
  const table = quoteIdent(opts.table);
  const names = assertKnownColumns(opts.values, opts.columns ?? []);
  const where = whereFromKey(opts.key, opts.pkColumns); // throws before any SET is emitted
  const sets = names.map((n) => `${quoteIdent(n)} = ${sqlLiteral(opts.values[n])}`).join(', ');
  return `update public.${table} set ${sets} where ${where} returning *`;
}

export function buildDeleteSql(opts: { table: string; key: RowKey; pkColumns: string[] }): string {
  const table = quoteIdent(opts.table);
  const where = whereFromKey(opts.key, opts.pkColumns);
  return `delete from public.${table} where ${where} returning *`;
}

/**
 * Did the write hit exactly the one row it was supposed to?
 *
 * `returning *` makes this checkable instead of assumed. Zero rows means the row was already gone or
 * changed by someone else — the user must be told, not shown a success. More than one means the key
 * we trusted was not unique, which is a bug in our own key resolution, and saying "saved" would be
 * covering up a write that touched rows nobody asked about.
 */
export function verifySingleRow(rows: unknown[]): { ok: true; row: Record<string, unknown> } | { ok: false; message: string } {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 1) return { ok: true, row: list[0] as Record<string, unknown> };
  if (list.length === 0) {
    return { ok: false, message: 'That row no longer exists — it may have been changed or deleted elsewhere. Refresh to see the current data.' };
  }
  return { ok: false, message: `This change would have affected ${list.length} rows, so NavBharatAI stopped. Please report this — it should never happen.` };
}

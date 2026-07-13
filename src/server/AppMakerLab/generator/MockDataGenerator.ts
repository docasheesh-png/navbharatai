// P-CGE.13 — Seed / Mock / Fixture Data Generator.
//
// Generated apps shipped with no test data, so a developer couldn't exercise the app without hand-
// creating rows. This produces realistic, DETERMINISTIC seed data for an app's entities as
// fixtures/seed.json. Dependency-free by design: the spec named `@faker-js/faker` (a heavy dep,
// against the dependency-free policy) — instead we derive realistic values from field-name + type
// heuristics, seeded by row index so the data is varied but reproducible (stable across runs, good
// for snapshot tests). Pure → unit-tested.

export interface FieldSpec {
  name: string;
  /** Optional explicit type hint; otherwise inferred from the field name. */
  type?: string;
}

export interface EntitySpec {
  name: string;
  fields: FieldSpec[];
}

const FIRST_NAMES = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Saanvi', 'Reyansh', 'Ishita', 'Kabir', 'Myra'];
const LAST_NAMES = ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Khan', 'Nair', 'Gupta', 'Singh', 'Bose', 'Mehta'];
const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Kolkata', 'Pune', 'Hyderabad', 'Jaipur'];
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Canada', 'Germany', 'Japan'];
const STATUSES = ['active', 'pending', 'inactive', 'archived'];
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'];
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'eiusmod'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

/**
 * A short deterministic 8-hex-char id from a seed. Uses an int32-safe integer hash (fmix-style with
 * Math.imul) so distinct seeds map to distinct ids — the previous LCG overflowed 2^53 on `x * k`,
 * losing low-bit precision and COLLIDING for small consecutive seeds (duplicate primary keys). Pure.
 */
function hexId(seed: number): string {
  let x = ((seed + 1) * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0).toString(16).padStart(8, '0');
}

function lorem(i: number, words: number): string {
  const out: string[] = [];
  for (let k = 0; k < words; k++) out.push(pick(WORDS, i + k));
  const s = out.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Generate a realistic value for one field of row `i`. Pure, deterministic. */
export function mockValue(field: FieldSpec, i: number): unknown {
  const name = String(field.name || '').toLowerCase();
  const type = String(field.type || '').toLowerCase();

  // Explicit type hints win.
  if (type === 'boolean' || type === 'bool') return i % 2 === 0;
  if (type === 'number' || type === 'integer' || type === 'int' || type === 'float') {
    return type === 'float' ? Math.round((10 + i * 3.5) * 100) / 100 : 10 + i;
  }
  if (type === 'date' || type === 'datetime' || type === 'timestamp') {
    return new Date(Date.UTC(2024, 0, 1 + i)).toISOString();
  }
  if (type === 'email') return `${pick(FIRST_NAMES, i).toLowerCase()}${i}@example.com`;

  // Name-based heuristics.
  if (/^id$|_id$|uuid|guid/.test(name)) return hexId(i);
  if (/email/.test(name)) return `${pick(FIRST_NAMES, i).toLowerCase()}${i}@example.com`;
  if (/firstname|first_name/.test(name)) return pick(FIRST_NAMES, i);
  if (/lastname|last_name|surname/.test(name)) return pick(LAST_NAMES, i);
  if (/name|fullname|full_name/.test(name)) return `${pick(FIRST_NAMES, i)} ${pick(LAST_NAMES, i)}`;
  if (/phone|mobile|contact/.test(name)) return `+91-9${String(800000000 + i).slice(0, 9)}`;
  if (/price|amount|cost|total|salary|fee|balance/.test(name)) return Math.round((9.99 + i * 5) * 100) / 100;
  if (/age|count|quantity|qty|stock|num/.test(name)) return 1 + (i % 100);
  if (/(^|_)(is|has|can|active|enabled|verified|published|deleted)/.test(name)) return i % 2 === 0;
  if (/created|updated|date|time|dob|birth/.test(name)) return new Date(Date.UTC(2024, 0, 1 + i)).toISOString();
  if (/description|bio|content|body|notes?|summary|message/.test(name)) return lorem(i, 8);
  if (/title|subject|heading|label/.test(name)) return lorem(i, 3);
  if (/url|link|website|href|avatar|image|photo/.test(name)) return `https://example.com/${name}/${i}`;
  if (/status|state/.test(name)) return pick(STATUSES, i);
  if (/colou?r/.test(name)) return pick(COLORS, i);
  if (/city|town/.test(name)) return pick(CITIES, i);
  if (/country|nation/.test(name)) return pick(COUNTRIES, i);
  if (/slug|code|sku/.test(name)) return `${name}-${hexId(i).slice(0, 6)}`;

  // Fallback: a stable readable string.
  return `${field.name}_${i + 1}`;
}

/** Generate `count` deterministic rows for one entity. Pure. */
export function mockRows(entity: EntitySpec, count: number): Array<Record<string, unknown>> {
  const fields = Array.isArray(entity.fields) ? entity.fields.filter((f) => f && f.name) : [];
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const row: Record<string, unknown> = {};
    for (const f of fields) row[f.name] = mockValue(f, i);
    rows.push(row);
  }
  return rows;
}

export interface SeedDataResult {
  /** Map of entity name → generated rows. */
  data: Record<string, Array<Record<string, unknown>>>;
  /** Pretty-printed fixtures/seed.json content. */
  json: string;
  summary: string;
}

/** Normalized comparison key for an entity/reference name (lowercased, alphanumerics only). */
function normKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A naive singular form of a normalized key (`users`→`user`, `categories`→`category`). */
function singular(k: string): string {
  if (k.endsWith('ies')) return `${k.slice(0, -3)}y`;
  if (k.endsWith('ses')) return k.slice(0, -2);
  if (k.endsWith('s') && !k.endsWith('ss')) return k.slice(0, -1);
  return k;
}

/** The foreign-key reference name of a field, or null. `author_id`/`authorId` → 'author'; 'id' → null. */
function fkRef(fieldName: string): string | null {
  const m = String(fieldName || '').match(/^(.+?)(?:_id|Id|_ID)$/);
  return m && m[1] ? m[1] : null;
}

/**
 * Generate seed data for a set of entities. `count` rows per entity (default 10). Foreign-key fields
 * (`<entity>_id` / `<entity>Id`) are linked to REAL ids of the referenced entity so the seed loads into
 * a DB with FK constraints (an unmatched FK keeps its generated value). Returns the data, a pretty JSON
 * string for fixtures/seed.json, and a summary. Pure; never throws.
 */
export function generateSeedData(entities: EntitySpec[], count = 10): SeedDataResult {
  const list = Array.isArray(entities) ? entities.filter((e) => e && e.name && Array.isArray(e.fields)) : [];
  const n = Math.min(Math.max(1, count), 1000);
  const data: Record<string, Array<Record<string, unknown>>> = {};
  for (const e of list) data[e.name] = mockRows(e, n);

  // Referential integrity: index each entity that has an `id` field by its id values (under both its
  // own key and singular form), then point every foreign-key field at a real referenced id.
  const idsByKey = new Map<string, unknown[]>();
  const idFieldByEntity = new Map<string, string>();
  for (const e of list) {
    const idF = e.fields.find((f) => f && f.name && normKey(f.name) === 'id');
    if (!idF) continue;
    idFieldByEntity.set(e.name, idF.name);
    const ids = data[e.name].map((r) => r[idF.name]);
    const key = normKey(e.name);
    idsByKey.set(key, ids);
    if (!idsByKey.has(singular(key))) idsByKey.set(singular(key), ids);
  }
  for (const e of list) {
    const pk = idFieldByEntity.get(e.name);
    for (const f of e.fields) {
      if (!f || !f.name || f.name === pk) continue; // never rewrite the primary key
      const ref = fkRef(f.name);
      if (!ref) continue;
      const refKey = normKey(ref);
      const targetIds = idsByKey.get(refKey) || idsByKey.get(singular(refKey));
      if (!targetIds || !targetIds.length) continue; // no matching entity → keep the generated value
      const rows = data[e.name];
      for (let i = 0; i < rows.length; i++) rows[i][f.name] = targetIds[i % targetIds.length];
    }
  }

  const json = JSON.stringify(data, null, 2) + '\n';
  const summary = list.length
    ? `Generated ${n} seed row(s) each for ${list.length} entit${list.length > 1 ? 'ies' : 'y'}: ${list.map((e) => e.name).join(', ')}.`
    : 'No entities provided — nothing to seed.';
  return { data, json, summary };
}

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

/** A short deterministic hex id from a seed. */
function hexId(seed: number): string {
  // Simple LCG → hex; deterministic and dependency-free.
  let x = (seed + 1) * 2654435761;
  let out = '';
  for (let i = 0; i < 8; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += (x % 16).toString(16);
  }
  return out;
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

/**
 * Generate seed data for a set of entities. `count` rows per entity (default 10). Returns the data,
 * a pretty JSON string for fixtures/seed.json, and a summary. Pure; never throws.
 */
export function generateSeedData(entities: EntitySpec[], count = 10): SeedDataResult {
  const list = Array.isArray(entities) ? entities.filter((e) => e && e.name && Array.isArray(e.fields)) : [];
  const n = Math.min(Math.max(1, count), 1000);
  const data: Record<string, Array<Record<string, unknown>>> = {};
  for (const e of list) data[e.name] = mockRows(e, n);
  const json = JSON.stringify(data, null, 2) + '\n';
  const summary = list.length
    ? `Generated ${n} seed row(s) each for ${list.length} entit${list.length > 1 ? 'ies' : 'y'}: ${list.map((e) => e.name).join(', ')}.`
    : 'No entities provided — nothing to seed.';
  return { data, json, summary };
}

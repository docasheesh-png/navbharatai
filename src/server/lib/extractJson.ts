/**
 * Shared, robust JSON extractor for arbitrary model output.
 *
 * Why this exists: several call sites independently sliced JSON out of an LLM reply with the naive
 * `text.indexOf('{') … text.lastIndexOf('}')` (or `lastIndexOf(']')`). That is a silent-failure trap —
 * `lastIndexOf` grabs the LAST closing bracket ANYWHERE in the reply, so any trailing (or leading)
 * prose that contains a bracket — a markdown link `[docs](url)`, a checkbox `[ ]`, "thanks [x]",
 * a `${...}` — makes the slice include that prose, `JSON.parse` throws, and the caller gets NOTHING.
 * On the edit path that means every edit is dropped and the whole build turn becomes a silent no-op.
 *
 * `extractFirstJson` instead finds the FIRST bracket that opens a COMPLETE, balanced, parseable JSON
 * value. It is string/escape aware (a bracket inside a JSON string literal never moves the depth
 * counter) and it tries each candidate opener left-to-right, so a stray bracket in leading prose is
 * skipped rather than mistaken for the start of the value. Pure + fully unit-testable.
 */

/** Scan from `start` (which must be an opener) and return the balanced JSON value, or undefined. */
function tryBalancedFrom(s: string, start: number, open: '[' | '{'): unknown {
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return undefined; }
      }
    }
  }
  return undefined; // never balanced
}

/** Which JSON shape a caller will accept. 'any' = the first array OR object; else restrict. */
export type JsonKind = 'array' | 'object' | 'any';

function matchesKind(v: unknown, kind: JsonKind): boolean {
  if (kind === 'any') return true;
  if (kind === 'array') return Array.isArray(v);
  return v !== null && typeof v === 'object' && !Array.isArray(v); // 'object'
}

/**
 * Extract the first complete JSON value embedded in arbitrary text. Strips a ```json fence if
 * present, tries a direct parse, then falls back to a balanced, string-aware scan. `kind` restricts
 * which shape is accepted ('object' won't return a stray leading array, and vice versa). Returns the
 * parsed value, or null if nothing of the requested kind parses.
 */
export function extractFirstJson(raw: string, kind: JsonKind = 'any'): unknown {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fast path: the whole (fence-stripped) text is already valid JSON of the requested kind.
  try {
    const v = JSON.parse(s);
    if (matchesKind(v, kind)) return v;
  } catch { /* fall through to balanced scan */ }
  // Try each bracket opener as a candidate start; return the first that balance-parses AND matches
  // kind. This skips a stray bracket in leading prose (it won't parse) and stops at the value's own
  // close (ignoring trailing prose), fixing the naive lastIndexOf trap in both directions.
  const wantOpen = kind === 'array' ? '[' : kind === 'object' ? '{' : null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (wantOpen ? ch !== wantOpen : (ch !== '[' && ch !== '{')) continue;
    const parsed = tryBalancedFrom(s, i, ch as '[' | '{');
    if (parsed !== undefined && matchesKind(parsed, kind)) return parsed;
  }
  return null;
}

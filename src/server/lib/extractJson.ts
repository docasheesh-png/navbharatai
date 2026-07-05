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
 * These helpers instead find the FIRST bracket that opens a COMPLETE, balanced, parseable JSON value.
 * They are string/escape aware (a bracket inside a JSON string literal never moves the depth counter)
 * and try each candidate opener left-to-right, so a stray bracket in leading prose is skipped rather
 * than mistaken for the start of the value. Pure + fully unit-testable.
 */

/** Which JSON shape a caller will accept. 'any' = the first array OR object; else restrict. */
export type JsonKind = 'array' | 'object' | 'any';

function matchesKind(v: unknown, kind: JsonKind): boolean {
  if (kind === 'any') return true;
  if (kind === 'array') return Array.isArray(v);
  return v !== null && typeof v === 'object' && !Array.isArray(v); // 'object'
}

/** Return the balanced substring starting at `start` (an opener), or undefined if it never closes. */
function balancedSliceFrom(s: string, start: number, open: '[' | '{'): string | undefined {
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
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return undefined; // never balanced
}

/**
 * Extract the first COMPLETE JSON substring embedded in arbitrary text, as a raw (unparsed) string.
 * Strips a ```json fence, tries a direct parse, then does a string/escape-aware balanced scan trying
 * each opener left-to-right. `kind` restricts which shape is accepted. Returns the substring, or null.
 */
export function extractFirstJsonSlice(raw: string, kind: JsonKind = 'any'): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fast path: the whole (fence-stripped) text is already valid JSON of the requested kind.
  try {
    const v = JSON.parse(s);
    if (matchesKind(v, kind)) return s;
  } catch { /* fall through to balanced scan */ }
  // Try each bracket opener as a candidate start; return the first that balance-parses AND matches
  // kind. This skips a stray bracket in leading prose (won't parse) and stops at the value's own
  // close (ignoring trailing prose), fixing the naive lastIndexOf trap in both directions.
  const wantOpen = kind === 'array' ? '[' : kind === 'object' ? '{' : null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (wantOpen ? ch !== wantOpen : (ch !== '[' && ch !== '{')) continue;
    const slice = balancedSliceFrom(s, i, ch as '[' | '{');
    if (slice === undefined) continue;
    try {
      if (matchesKind(JSON.parse(slice), kind)) return slice;
    } catch { /* balanced but not valid JSON (e.g. "[docs]") — try the next opener */ }
  }
  return null;
}

/**
 * Extract the first complete JSON value (parsed) embedded in arbitrary text. Same scan as
 * `extractFirstJsonSlice`, but returns the parsed value, or null if nothing of the requested kind parses.
 */
export function extractFirstJson(raw: string, kind: JsonKind = 'any'): unknown {
  const slice = extractFirstJsonSlice(raw, kind);
  return slice === null ? null : JSON.parse(slice); // slice already validated by the scan
}

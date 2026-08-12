/**
 * WILL THIS APP SURVIVE REAL TRAFFIC? — scaling analysis with real numbers.
 *
 * ROADMAP §2: "Scaling / load estimates with real numbers — today's critique is qualitative only."
 *
 * 🔒 THE HONESTY CONSTRAINT, WHICH SHAPES THE WHOLE MODULE. The obvious reading of "load estimates
 * with real numbers" is a headline like "your app can handle 8,000 concurrent users". We do not
 * produce that, and not out of caution — it would be a FABRICATION. Real capacity depends on the
 * database plan, the hosting tier, the network and the actual traffic mix, none of which this code can
 * see. A confident invented number is worse than no number: the user would plan a launch around it.
 *
 * So the numbers here are about the thing we CAN read exactly — how the code's cost grows with the
 * user's data. "This query returns every row: fine at 1,000, 100× the data at 100,000" is a real,
 * checkable number derived from the query's own shape. That is the honest form of this feature.
 *
 * THE THREE THINGS DETECTED are the ones that actually kill a small app as it grows, and each is
 * mechanically detectable with low false-positive risk:
 *   1. UNBOUNDED QUERY  — reads every row; the single most common cause of an app that was fast in
 *      testing and times out in month three.
 *   2. QUERY IN A LOOP  — the N+1: one request becomes N round-trips, so latency scales with data.
 *   3. MISSING INDEX    — a filter on a column with no index; a full table scan on every request.
 *
 * Precision over recall, deliberately. A scan that cries wolf gets ignored, and an ignored warning is
 * worth less than no warning. Anything ambiguous is not reported — see the guards in each detector.
 */

/** Kinds of finding. Kept narrow on purpose — see the precision note in the header. */
export type ScaleFindingKind = 'unbounded-query' | 'query-in-loop' | 'missing-index';

export type ScaleSeverity = 'critical' | 'warning';

export interface ScaleFinding {
  kind: ScaleFindingKind;
  severity: ScaleSeverity;
  file: string;
  /** 1-indexed, so it can be clicked straight to the line. */
  line: number;
  /** The offending code, trimmed to one readable line. */
  snippet: string;
  /** What is wrong, in language the app's owner can act on. */
  problem: string;
  /** How the cost grows with data — the "real numbers" half, derived from the query's own shape. */
  atScale: string;
  /** The concrete change that fixes it. */
  fix: string;
}

export interface ScaleReport {
  ok: boolean;
  findings: ScaleFinding[];
  filesScanned: number;
  counts: Record<ScaleFindingKind, number>;
  /** Plain-language headline. Never an invented capacity figure — see the header. */
  verdict: string;
}

/** Files above this are generated bundles or data, not hand-written code worth scanning. */
const MAX_FILE_BYTES = 400_000;
/** A statement window: long enough for a chained query, short enough to stay local. */
const WINDOW = 400;
/** Ceiling on reported findings, so a pathological project cannot produce a 5,000-row report. */
const MAX_FINDINGS = 100;

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|dist|build|coverage|\.next|out)\//;
const IS_TEST = /(\.(test|spec)\.[tj]sx?$)|(^|\/)(tests?|__tests__)\//;

/** A call that reads rows from a database, across the shapes a generated app actually uses. */
const QUERY_CALL =
  /\.(select|find|findMany|findAll|aggregate)\s*\(|\bfrom\s+[`'"]?\w+[`'"]?\s+(?:where|order|limit)|\bselect\s+[\w*,\s]+\s+from\b/i;

/** Markers that a query is already bounded. Any one of these makes it not-unbounded. */
const BOUNDED =
  /\.limit\s*\(|\.range\s*\(|\.single\s*\(|\.maybeSingle\s*\(|\btake\s*:|\blimit\s*:|\bfirst\s*:|\blimit\s+\d+|\.first\s*\(|\.findOne\s*\(|\.findUnique\s*\(|\.findFirst\s*\(/i;

const LOOP_HEAD = /\bfor\s*(?:await\s*)?\(|\bwhile\s*\(|\.(map|forEach|flatMap|filter)\s*\(\s*(?:async\s*)?\(?/g;

/**
 * "Is this a database call at all?" — a BROADER question than QUERY_CALL's "could this be unbounded?",
 * and they must stay separate. `findUnique` returns exactly one row, so it can never be unbounded — but
 * one `findUnique` per item is the textbook N+1, and folding the two questions into one regex is
 * precisely why that went undetected. Writes count too: an insert per item is the same round-trip cost.
 */
const DB_CALL =
  /\.(select|find|findMany|findAll|findOne|findUnique|findFirst|aggregate|rpc|insert|upsert)\s*\(|\.from\s*\(\s*['"`]|\bselect\s+[\w*,\s]+\s+from\b/i;

const line1 = (src: string, index: number): number => src.slice(0, index).split('\n').length;

const snippetAt = (src: string, index: number): string => {
  const start = src.lastIndexOf('\n', index) + 1;
  const end = src.indexOf('\n', index);
  return src.slice(start, end === -1 ? src.length : end).trim().slice(0, 200);
};

/**
 * The text of the statement starting at `index` — to the terminating `;` or a bounded window.
 *
 * This is what makes "unbounded" accurate: `.select()` and its `.limit()` are different lines of ONE
 * chained statement, so judging a single line would report every paginated query in the app.
 */
const statementAt = (src: string, index: number): string => {
  const semi = src.indexOf(';', index);
  const end = semi === -1 ? index + WINDOW : Math.min(semi + 1, index + WINDOW);
  return src.slice(index, end);
};

/** Scannable, hand-written source only. */
function scannableFiles(files: Record<string, string>): string[] {
  return Object.keys(files ?? {})
    .filter((p) => CODE_EXT.test(p) && !SKIP.test(p) && !IS_TEST.test(p))
    .filter((p) => typeof files[p] === 'string' && files[p].length <= MAX_FILE_BYTES)
    .sort();
}

/** Scan forward from an opening bracket to its partner. -1 if it never closes inside the ceiling. */
function matchBracket(src: string, open: number, openCh: string, closeCh: string, limit: number): number {
  let depth = 0;
  for (let i = open; i < limit; i += 1) {
    if (src[i] === openCh) depth += 1;
    else if (src[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The code a loop actually repeats.
 *
 * ⚠️ PARENS AND BRACES ARE BALANCED SEPARATELY, and that is the whole point. A single counter that
 * treated `(` and `{` as interchangeable returned at the first `)` it met — which in real code is the
 * one in `.from('users')`, two tokens into the body — so every N+1 in the codebase went undetected
 * while the detector looked like it worked. Its own tests caught that.
 *
 * Two shapes, both handled: a CALLBACK (`.map(async (x) => { … })`), whose body is inside the call's
 * own parens, and a BLOCK (`for (…) { … }`), whose body is the braces after the head closes — including
 * the C-style `for (let i = 0; i < n; i++)`, whose head legitimately contains semicolons.
 */
function blockBody(src: string, matchStart: number): string {
  const limit = Math.min(src.length, matchStart + 4000);
  const open = src.indexOf('(', matchStart);
  if (open === -1 || open >= limit) return '';

  const headClose = matchBracket(src, open, '(', ')', limit);
  if (headClose === -1) return src.slice(open, limit);   // truncated file — bounded, never runs away

  // A callback's body lives inside those parens; a loop head's does not, but including it is harmless.
  let body = src.slice(open + 1, headClose);

  // For `for`/`while`, the repeated code is the block that follows the head.
  const after = src.slice(headClose + 1, Math.min(headClose + 40, limit));
  const braceOffset = after.search(/\S/);
  if (braceOffset >= 0 && after[braceOffset] === '{') {
    const brace = headClose + 1 + braceOffset;
    const end = matchBracket(src, brace, '{', '}', limit);
    body += src.slice(brace, end === -1 ? limit : end);
  }
  return body;
}

/** 1 — a query with no bound. Reads every row, forever, as the table grows. */
function findUnboundedQueries(file: string, src: string, out: ScaleFinding[]): void {
  const re = new RegExp(QUERY_CALL.source, 'gi');
  for (const m of src.matchAll(re)) {
    const idx = m.index ?? 0;
    const stmt = statementAt(src, idx);
    if (BOUNDED.test(stmt)) continue;
    // A count is O(1)-ish to return and is not a row-transfer problem.
    if (/count\s*\(|\bcount\s*:/i.test(stmt)) continue;
    out.push({
      kind: 'unbounded-query',
      severity: 'critical',
      file,
      line: line1(src, idx),
      snippet: snippetAt(src, idx),
      problem: 'This reads EVERY row from the table — there is no limit and no paging.',
      atScale:
        'Cost grows straight-line with your data: at 1,000 rows it is fine, at 100,000 rows the same ' +
        'request moves about 100× more data, and the page gets slower for every user each time the ' +
        'table grows. This is the usual reason an app that was fast in testing times out months later.',
      fix: 'Add a page size — e.g. `.limit(50)` (or `.range(from, to)` / `take: 50`) — and load more on demand.',
    });
    if (out.length >= MAX_FINDINGS) return;
  }
}

/**
 * 2 — the N+1: one query per item in a list.
 *
 * SEQUENTIAL vs PARALLEL is reported differently, because they fail differently and a single wording
 * would be wrong for one of them. `for (…) { await q }` multiplies LATENCY. `Promise.all(ids.map(q))`
 * does not — it fires them at once — but it still issues N queries and grabs N connections, so it
 * fails as pool exhaustion instead. Quoting the sequential "500 items ≈ 10 s" figure for the parallel
 * case would be a real number attached to the wrong claim.
 */
function findQueriesInLoops(file: string, src: string, out: ScaleFinding[]): void {
  const re = new RegExp(LOOP_HEAD.source, 'gi');
  for (const m of src.matchAll(re)) {
    const start = m.index ?? 0;
    const body = blockBody(src, start);
    if (!DB_CALL.test(body)) continue;
    // A per-item promise counts even with no `await` inside — that is the Promise.all shape below.
    const isAsyncCallback = /\basync\b/.test(m[0]) || /\basync\b/.test(body.slice(0, 40));
    if (!/\bawait\b/.test(body) && !isAsyncCallback) continue;   // a sync loop makes no round-trips
    // A loop over a bounded literal list is not the N+1 this warns about.
    if (/\[\s*['"][^\]]{0,120}\]\s*\)?\s*\.(map|forEach)/.test(m[0])) continue;

    // `await Promise.all(ids.map(…))` — the collection expression sits between `all(` and `.map(`, so
    // this looks back over a window rather than expecting them to be adjacent.
    const parallel = /Promise\.(all|allSettled)\s*\(/.test(src.slice(Math.max(0, start - 80), start));
    out.push({
      kind: 'query-in-loop',
      severity: 'critical',
      file,
      line: line1(src, start),
      snippet: snippetAt(src, start),
      problem: 'A database call runs once PER ITEM of a list, instead of once for the whole list.',
      atScale: parallel
        ? 'These run at the same time, so the page is not N times slower — but it still opens one ' +
          'connection per item: 500 items means 500 simultaneous queries. Typical pools hold 10–20, so ' +
          'a single request like this can starve every other user until it finishes.'
        : 'Latency grows with the list, not with the page: 10 items ≈ 10 queries, 500 items ≈ 500 ' +
          'queries. At roughly 20 ms each that is 0.2 s versus 10 s for the same screen — and each ' +
          'round-trip holds a database connection while it waits.',
      fix:
        'Fetch once for the whole list instead of once per item — one query with `.in("id", ids)` (or a ' +
        'join / `include`), then match the rows up in memory.',
    });
    if (out.length >= MAX_FINDINGS) return;
  }
}

interface SchemaFacts {
  /** table → columns declared in a `create table`. */
  tables: Map<string, Set<string>>;
  /** table → columns that carry an index (explicit index, primary key, or unique). */
  indexed: Map<string, Set<string>>;
}

/**
 * Split a column list on its TOP-LEVEL commas only.
 *
 * `numeric(10, 2)` and `primary key (a, b)` both carry commas that do not separate columns, so a plain
 * `.split(',')` would invent columns named `2` and `b)`.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const addTo = (m: Map<string, Set<string>>, key: string, value: string): void => {
  const k = key.toLowerCase();
  if (!m.has(k)) m.set(k, new Set());
  m.get(k)!.add(value.toLowerCase());
};

/**
 * What the migrations actually declare.
 *
 * Read from the SQL rather than guessed, which is what keeps detector 3 honest: a missing index is
 * only reported for a table we have genuinely seen created, so an app whose schema lives somewhere we
 * cannot read produces NO index findings instead of wrong ones.
 */
export function readSchemaFacts(files: Record<string, string>): SchemaFacts {
  const facts: SchemaFacts = { tables: new Map(), indexed: new Map() };
  for (const [path, content] of Object.entries(files ?? {})) {
    if (!path.endsWith('.sql') || typeof content !== 'string') continue;
    const sql = content.toLowerCase();

    // ⚠️ The column list is delimited by BRACKET MATCHING, not by a regex looking for `)` at the end of
    // a line. A single-line `create table t (id uuid primary key, city text);` is perfectly valid SQL
    // and a line-shaped regex silently skips it — which means no schema, which means (correctly, but
    // uselessly) no index findings at all for that app.
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)["`]?\s*\(/g)) {
      const table = (m[1] || '').split('.').pop() || '';
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = matchBracket(sql, open, '(', ')', sql.length);
      if (close === -1) continue;                       // truncated migration — do not guess at it
      const body = sql.slice(open + 1, close);

      for (const part of splitTopLevel(body)) {
        // A table-level constraint, not a column definition.
        if (/^(primary\s+key|unique|foreign\s+key|constraint|check)\b/.test(part.trim())) continue;
        const col = part.trim().match(/^["`]?(\w+)["`]?\s+[a-z]/);
        if (!col) continue;
        addTo(facts.tables, table, col[1]);
        // A primary key or a unique column is already indexed by the database.
        if (/primary\s+key|unique/.test(part)) addTo(facts.indexed, table, col[1]);
      }
      for (const pk of body.matchAll(/(?:primary\s+key|unique)\s*\(([^)]+)\)/g)) {
        // Only the first column of a composite key serves a lone filter — same rule as an index.
        const first = pk[1].split(',')[0]?.trim().replace(/["`]/g, '');
        if (first) addTo(facts.indexed, table, first);
      }
    }

    for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w"`]*\s*on\s+["`]?([\w.]+)["`]?\s*(?:using\s+\w+\s*)?\(([^)]+)\)/g)) {
      const table = (m[1] || '').split('.').pop() || '';
      // Only the FIRST column of a composite index can serve a lone filter on that column.
      const first = (m[2] || '').split(',')[0]?.trim().replace(/["`]/g, '').replace(/\s+(asc|desc)$/, '');
      if (first) addTo(facts.indexed, table, first);
    }
  }
  return facts;
}

/** 3 — a filter on a column the schema never indexed: a full table scan on every request. */
function findMissingIndexes(file: string, src: string, facts: SchemaFacts, out: ScaleFinding[]): void {
  if (facts.tables.size === 0) return;   // no schema read ⇒ no guessing (see readSchemaFacts)

  for (const m of src.matchAll(/\.from\s*\(\s*['"`](\w+)['"`]\s*\)/g)) {
    const table = (m[1] || '').toLowerCase();
    const columns = facts.tables.get(table);
    if (!columns) continue;              // a table we never saw created

    const stmt = statementAt(src, m.index ?? 0);
    const indexed = facts.indexed.get(table) ?? new Set<string>();

    for (const f of stmt.matchAll(/\.(eq|neq|gt|gte|lt|lte|like|ilike|order)\s*\(\s*['"`](\w+)['"`]/g)) {
      const col = (f[2] || '').toLowerCase();
      if (!columns.has(col)) continue;   // not a column of this table — do not guess
      if (indexed.has(col)) continue;
      out.push({
        kind: 'missing-index',
        severity: 'warning',
        file,
        line: line1(src, m.index ?? 0),
        snippet: snippetAt(src, m.index ?? 0),
        problem: `The app filters "${table}" by "${col}", but no index on that column exists in your migrations.`,
        atScale:
          'Without an index the database reads the whole table to answer this, so the query gets ' +
          'slower in direct proportion to the rows: roughly 10× the rows, 10× the time. With an index ' +
          'it stays almost flat as the table grows — this is usually a one-line change with a large effect.',
        fix: `Add to a migration: create index on ${table} (${col});`,
      });
      if (out.length >= MAX_FINDINGS) return;
    }
  }
}

/** The honest headline. States what was checked and — just as important — what was NOT. */
function buildVerdict(findings: ScaleFinding[], filesScanned: number): string {
  const caveat =
    'This reads your code, not a live load test — real capacity also depends on your database plan and hosting.';
  if (filesScanned === 0) return `No app code to check yet. ${caveat}`;
  if (findings.length === 0) {
    return `No scaling problems found in ${filesScanned} file${filesScanned === 1 ? '' : 's'}: queries are bounded, none run inside a loop, and the columns you filter on are indexed. ${caveat}`;
  }
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const head =
    critical > 0
      ? `${critical} thing${critical === 1 ? '' : 's'} in this app will get dramatically slower as your data grows`
      : `${findings.length} thing${findings.length === 1 ? '' : 's'} worth fixing before your data grows`;
  return `${head}. Each one below says what happens and the exact change that fixes it. ${caveat}`;
}

/**
 * Analyse a generated app for the scaling problems that actually break small apps as they grow.
 *
 * Pure and deterministic — no model call, so it costs nothing, cannot hallucinate a problem that is
 * not in the code, and gives the same answer every time.
 */
export function analyzeScaling(files: Record<string, string>): ScaleReport {
  const source = files ?? {};
  const paths = scannableFiles(source);
  const facts = readSchemaFacts(source);
  const findings: ScaleFinding[] = [];

  for (const path of paths) {
    if (findings.length >= MAX_FINDINGS) break;
    const src = source[path];
    findUnboundedQueries(path, src, findings);
    findQueriesInLoops(path, src, findings);
    findMissingIndexes(path, src, facts, findings);
  }

  const counts: Record<ScaleFindingKind, number> = {
    'unbounded-query': 0,
    'query-in-loop': 0,
    'missing-index': 0,
  };
  for (const f of findings) counts[f.kind] += 1;

  return {
    ok: findings.length === 0,
    findings: findings.slice(0, MAX_FINDINGS),
    filesScanned: paths.length,
    counts,
    verdict: buildVerdict(findings, paths.length),
  };
}

// GA-5 (roadmap Tier 2) — API-endpoint graph: map the backend routes a project DEFINES against the API
// calls its frontend MAKES, and flag the mismatches. The #1 silent full-stack bug is a frontend calling
// an endpoint the backend never implemented (or at the wrong method/path) — it compiles, the preview
// loads, and the feature is just broken at runtime. This module finds those deterministically.
//
// PURE + dependency-free (regex extraction over source text) so it is fully unit-testable without a
// sandbox. The ToolDispatcher `api_graph` tool renders the result for the agent. Best-effort by nature
// (it reads call sites, not a running server), so it frames findings as "likely", never as certainty.

export interface Endpoint {
  method: string; // GET/POST/... or ALL
  path: string; // normalized (params → :p)
  file: string;
}

export interface ApiCall {
  method: string; // GET/POST/... or ANY when it couldn't be determined
  path: string; // query/hash stripped
  file: string;
}

export interface ApiGraphResult {
  defined: Endpoint[];
  called: ApiCall[];
  /** Frontend calls with no matching backend route — the actionable bug list. */
  missing: ApiCall[];
  /** Defined routes nothing calls — dead endpoints (best-effort). */
  unused: Endpoint[];
}

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']);

/** Normalize a route/path for matching: strip query/hash + trailing slash, and collapse path params. */
function normPath(raw: string): string {
  let s = raw.split('?')[0].split('#')[0].trim();
  s = s.replace(/\{[^}]+\}/g, ':p'); // {id}, ${id}
  s = s.replace(/<[^>]+>/g, ':p'); // <int:id> (Flask/Django)
  s = s.replace(/:[A-Za-z0-9_]+/g, ':p'); // :id (Express)
  s = s.replace(/\/+$/, '');
  if (!s.startsWith('/')) s = '/' + s;
  return s || '/';
}

/** Strip only query/hash + trailing slash from a CALL path (keep concrete ids so they match :p wildcards). */
function callPath(raw: string): string {
  let s = raw.split('?')[0].split('#')[0].trim();
  s = s.replace(/\/+$/, '');
  return s || '/';
}

/** Extract backend route DEFINITIONS from Express/Fastify, FastAPI/Flask, and Spring sources. */
export function extractEndpoints(files: { path: string; content: string }[]): Endpoint[] {
  const out: Endpoint[] = [];
  const push = (method: string, p: string, file: string) => {
    if (!p.startsWith('/')) return;
    out.push({ method: method.toUpperCase(), path: normPath(p), file });
  };
  for (const { path: file, content } of files) {
    // Express / Fastify / Koa-ish: app.get('/x'), router.post("/x"), api.delete('/x')
    for (const m of content.matchAll(/\b(?:app|router|api|server|route[rs]?)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
      push(m[1], m[2], file);
    }
    // FastAPI / Flask decorators: @app.get("/x"), @router.post('/x')
    for (const m of content.matchAll(/@\w+\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
      push(m[1], m[2], file);
    }
    // Flask @app.route("/x", methods=["POST"]) — default GET when no methods given
    for (const m of content.matchAll(/@\w+\.route\s*\(\s*['"`]([^'"`]+)['"`]([^)]*)\)/gi)) {
      const methods = [...m[2].matchAll(/['"`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"`]/gi)].map(x => x[1]);
      if (methods.length) methods.forEach(mm => push(mm, m[1], file));
      else push('GET', m[1], file);
    }
    // Spring: @GetMapping("/x"), @PostMapping("/x"), @RequestMapping("/x")
    for (const m of content.matchAll(/@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g)) {
      push(m[1] === 'Request' ? 'ALL' : m[1], m[2], file);
    }
  }
  return out;
}

/** Extract frontend API CALLS (fetch / axios) that target a same-origin path (starting with "/"). */
export function extractApiCalls(files: { path: string; content: string }[]): ApiCall[] {
  const out: ApiCall[] = [];
  const push = (method: string, p: string, file: string) => {
    const cp = callPath(p);
    if (!cp.startsWith('/') || cp.startsWith('//')) return; // same-origin paths only (skip //cdn, http)
    out.push({ method: method.toUpperCase(), path: cp, file });
  };
  for (const { path: file, content } of files) {
    // axios.get('/x'), axios.post("/x"), axios.delete(`/x`)
    for (const m of content.matchAll(/\baxios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
      push(m[1], m[2], file);
    }
    // fetch('/x', { method: 'POST' })  — read the method from the (nearby) options object, else GET
    for (const m of content.matchAll(/\bfetch\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*\{([^}]*)\})?/gi)) {
      const opts = m[2] ?? '';
      const method = opts.match(/method\s*:\s*['"`](\w+)['"`]/i)?.[1] ?? 'GET';
      push(method, m[1], file);
    }
    // bare axios('/x', { method }) or axios({ url: '/x', method: 'post' })
    for (const m of content.matchAll(/\baxios\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*\{([^}]*)\})?/gi)) {
      const method = (m[2] ?? '').match(/method\s*:\s*['"`](\w+)['"`]/i)?.[1] ?? 'GET';
      push(method, m[1], file);
    }
    for (const m of content.matchAll(/\baxios\s*\(\s*\{([^}]*)\}/gi)) {
      const body = m[1];
      const url = body.match(/url\s*:\s*['"`]([^'"`]+)['"`]/i)?.[1];
      const method = body.match(/method\s*:\s*['"`](\w+)['"`]/i)?.[1] ?? 'GET';
      if (url) push(method, url, file);
    }
  }
  return out;
}

/** True when a frontend call is satisfied by a defined endpoint (method-compatible + path pattern match). */
function callMatches(call: ApiCall, endpoints: Endpoint[]): boolean {
  return endpoints.some(ep => {
    const methodOk =
      ep.method === 'ALL' || call.method === 'ANY' || ep.method === call.method ||
      (call.method === 'GET' && ep.method === 'GET');
    if (!methodOk) return false;
    // Endpoint path (with :p wildcards) → regex; test the concrete call path.
    const pattern = '^' + ep.path.split('/').map(seg => (seg === ':p' ? '[^/]+' : escapeRe(seg))).join('/') + '$';
    return new RegExp(pattern).test(callPath(call.path));
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the API graph and diff it. `missing` (frontend calls with no backend route) is computed ONLY
 * when the repo actually defines endpoints — otherwise every call would look "missing" against an
 * external backend (false positives). Pure.
 */
export function buildApiGraph(files: { path: string; content: string }[]): ApiGraphResult {
  const defined = dedupe(extractEndpoints(files), e => `${e.method} ${e.path}`);
  const called = dedupe(extractApiCalls(files), c => `${c.method} ${c.path} ${c.file}`);
  const missing = defined.length ? called.filter(c => !callMatches(c, defined)) : [];
  const unused = defined.filter(ep =>
    !called.some(c => callMatches({ ...c, method: 'ANY' }, [ep])),
  );
  return { defined, called, missing, unused };
}

/**
 * Advisory `evaluate` line for broken client↔server wiring: frontend calls with NO matching backend route.
 * Empty string when clean (or when there is nothing to compare). Only reports `missing` — the actionable,
 * likely-broken set — never the best-effort `unused` list (a dead route is not a bug). Pure. Frames findings
 * as "likely" because it reads call sites, not a running server, so it can only ADD a true signal here, never
 * block a build (evaluate treats this as advisory).
 */
export function apiWiringSummary(g: ApiGraphResult): string {
  if (!g || !g.missing || g.missing.length === 0) return '';
  const shown = g.missing.slice(0, 8).map((m) => `  ⚠️ ${m.method} ${m.path} — no backend route (${m.file})`);
  return `API wiring — ${g.missing.length} frontend call(s) with NO matching backend route (likely broken; add the route or fix the path/method):\n${shown.join('\n')}${g.missing.length > 8 ? `\n  …and ${g.missing.length - 8} more` : ''}`;
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}

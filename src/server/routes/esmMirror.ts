import type { Express, Request, Response } from 'express';
import { init as lexerInit, parse as lexerParse } from 'es-module-lexer';

/**
 * Same-origin dependency mirror for the in-browser preview (Bolt-parity slice 2, admin 2026-08-05:
 * "sab kuch high level chahiye — banao").
 *
 * THE ROOT CAUSE THIS KILLS: every preview open re-resolved its npm dependencies from a third-party
 * CDN (esm.sh). Thirty dependencies = thirty cold cross-origin fetches on a phone that has never seen
 * them, every time, forever — and a CDN hiccup became a broken preview. "Kitne bhi din baad kholo,
 * pehle jaisa chale" cannot be promised on someone else's uptime.
 *
 * THE MECHANISM: the preview's importmap now points at THIS route (`/api/esm/<pkg>@<ver>…`), which
 * mirrors esm.sh. Three layers make reopen instant and CDN-independent:
 *
 *  1. **The user's own browser cache.** Every module URL is version-pinned, so responses are served
 *     `Cache-Control: immutable, max-age=1y`. A reopened app loads its dependencies from DISK, with
 *     zero network — the Bolt-like reopen. This is the layer that actually delivers "kitne din baad".
 *  2. **The instance LRU.** A bounded in-memory cache means one user's fetch warms the module for
 *     every user on the instance, and esm.sh sees a fraction of the traffic.
 *  3. **esm.sh upstream**, contacted only on a genuine miss.
 *
 * IMPORT REWRITING: esm.sh module bodies reference their internal chunks by ABSOLUTE path
 * (`import "/v135/react@18.3.1/es2022/react.mjs"`). Those specifiers resolve against the MODULE's own
 * URL, so from a mirrored module they would escape back to… our origin root. They are rewritten to
 * stay inside `/api/esm/`. This uses es-module-lexer — exact specifier byte-ranges from a real
 * parser — because a regex cannot tell an import specifier from a string literal that happens to
 * contain a path, and corrupting one library string would be a blank preview with no obvious cause.
 *
 * FAILURE IS ALREADY HANDLED BY DESIGN: the preview loader's three-rung fallback tries this URL
 * first, then esm.run, then plain esm.sh. If this route 500s or the instance restarts mid-storm, the
 * loader walks to the direct CDNs exactly as before — the mirror can only ever ADD reliability.
 *
 * SECURITY BOUNDARIES: upstream host is PINNED to esm.sh (this is a mirror, not an open proxy); the
 * path is validated (no traversal, no protocol smuggling); responses carry `ACAO: *` because npm
 * package bytes are public content and the sandboxed preview iframe has an opaque origin; nothing
 * here ever touches auth or user data. Kill switch: `AGENTV3_PREVIEW_DEP_PROXY=off` (read at render
 * time in ReactPreview — the importmap simply goes back to direct esm.sh URLs).
 */

const UPSTREAM = 'https://esm.sh';
const UPSTREAM_TIMEOUT_MS = 20_000;
/** Per-entry cap — a module bigger than this streams through uncached (firebase chunks ~1 MB fit). */
export const MIRROR_MAX_ENTRY_BYTES = 3 * 1024 * 1024;
/** Total cache budget. Bounded so the mirror can never pressure the instance's real work. */
export const MIRROR_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

interface CacheEntry { body: Buffer; contentType: string; }

/** Insertion-ordered Map as LRU: get() re-inserts, set() evicts oldest until under budget. */
export class MirrorCache {
  private map = new Map<string, CacheEntry>();
  private total = 0;
  constructor(private maxTotal = MIRROR_MAX_TOTAL_BYTES, private maxEntry = MIRROR_MAX_ENTRY_BYTES) {}

  get(key: string): CacheEntry | undefined {
    const hit = this.map.get(key);
    if (hit) { this.map.delete(key); this.map.set(key, hit); } // refresh recency
    return hit;
  }

  set(key: string, entry: CacheEntry): void {
    if (entry.body.byteLength > this.maxEntry) return; // too big to cache — served, not stored
    const prev = this.map.get(key);
    if (prev) { this.total -= prev.body.byteLength; this.map.delete(key); }
    this.map.set(key, entry);
    this.total += entry.body.byteLength;
    while (this.total > this.maxTotal && this.map.size > 0) {
      const oldest = this.map.keys().next().value as string;
      const evicted = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.total -= evicted.body.byteLength;
    }
  }

  get totalBytes(): number { return this.total; }
  get size(): number { return this.map.size; }
}

/**
 * Rewrite absolute-path import specifiers ("/v135/…") to stay inside the mirror ("/api/esm/v135/…").
 *
 * Exported for tests. Uses es-module-lexer's exact ranges: static imports, re-exports and STATIC
 * dynamic imports are rewritten; a string literal that merely contains a path is untouched by
 * construction. Protocol-relative specifiers ("//host/x") are NOT rewritten — they name another host.
 * If the body does not parse as a module (worker glue, JSON modules), it is served unmodified: wrong
 * output would be worse than an unmirrored chunk, and the browser will still resolve the original.
 */
export async function rewriteAbsoluteImports(body: string): Promise<string> {
  await lexerInit;
  let imports;
  try { [imports] = lexerParse(body); } catch { return body; }
  let out = '';
  let last = 0;
  for (const imp of imports) {
    if (imp.d === -2) continue;                    // import.meta — no specifier
    // n = the decoded specifier when it is a static string (also set for import("literal")).
    const spec = imp.n;
    if (!spec || !spec.startsWith('/') || spec.startsWith('//')) continue;
    // Range convention differs by kind: a STATIC import's [s,e) sits INSIDE the quotes; a DYNAMIC
    // import("…")'s [s,e) spans the whole argument INCLUDING its quotes — so the dynamic form must
    // write its own quotes back or the emitted call is import(/path) — a syntax error.
    const replacement = imp.d >= 0 ? `"/api/esm${spec}"` : `/api/esm${spec}`;
    out += body.slice(last, imp.s) + replacement;
    last = imp.e;
  }
  if (last === 0) return body;
  return out + body.slice(last);
}

/** Path is a plausible esm.sh path: no traversal, no scheme, printable, bounded. */
export function isSafeMirrorPath(path: string): boolean {
  if (!path || path.length > 600) return false;
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;   // no smuggled scheme
  if (path.startsWith('/')) return false;                // route already stripped the leading slash
  return /^[\x21-\x7e]+$/.test(path);                    // printable ASCII, no spaces
}

type UpstreamFetch = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean; status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * The ONE cache the live route serves from. Module-level so the dep-graph warmup
 * (PreviewDepWarmup.ts) can fill the SAME store the user's preview reads — a warmup into a private
 * cache would warm nothing. Tests keep isolation by passing their own cache via opts.
 */
export const sharedMirrorCache = new MirrorCache();

export type MirroredFetchResult =
  | { ok: true; body: Buffer; contentType: string }
  | { ok: false; status: 400 | 404 | 502 };

/**
 * Fetch one module through the mirror pipeline — cache → esm.sh → import-rewrite → cache — WITHOUT
 * an HTTP request/response. Extracted from the route handler so the server itself (the warmup
 * crawler) can pull modules through the identical path a browser request takes: same key shape,
 * same rewrite, same cache — one implementation, and the route below calls this too. The failure
 * statuses stay honest (400 unsafe path, 404 upstream not-found, 502 anything else) so the route's
 * answers are byte-for-byte what they were before the extraction.
 */
export async function fetchMirroredModule(
  pathWithQuery: string,
  opts?: { fetchImpl?: UpstreamFetch; cache?: MirrorCache },
): Promise<MirroredFetchResult> {
  const cache = opts?.cache ?? sharedMirrorCache;
  const doFetch: UpstreamFetch = opts?.fetchImpl ?? (fetch as unknown as UpstreamFetch);
  const qi = pathWithQuery.indexOf('?');
  const path = qi >= 0 ? pathWithQuery.slice(0, qi) : pathWithQuery;
  const query = qi >= 0 ? pathWithQuery.slice(qi) : '';
  if (!isSafeMirrorPath(path)) return { ok: false, status: 400 };
  const key = path + query;
  const hit = cache.get(key);
  if (hit) return { ok: true, body: hit.body, contentType: hit.contentType };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await doFetch(`${UPSTREAM}/${path}${query}`, { signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (!upstream.ok) return { ok: false, status: upstream.status === 404 ? 404 : 502 };
    const contentType = upstream.headers.get('content-type') || 'application/javascript; charset=utf-8';
    const raw = Buffer.from(await upstream.arrayBuffer());
    let body = raw;
    if (/javascript|ecmascript/i.test(contentType)) {
      body = Buffer.from(await rewriteAbsoluteImports(raw.toString('utf8')), 'utf8');
    }
    cache.set(key, { body, contentType });
    return { ok: true, body, contentType };
  } catch {
    return { ok: false, status: 502 };
  }
}

export function registerEsmMirrorRoutes(
  app: Express,
  opts?: { fetchImpl?: UpstreamFetch; cache?: MirrorCache },
): void {
  // Default to the SHARED cache (not a fresh private one) so the warmup crawler and this route
  // read and write the same store — the whole point of warming.
  const cache = opts?.cache ?? sharedMirrorCache;
  const doFetch: UpstreamFetch = opts?.fetchImpl ?? (fetch as unknown as UpstreamFetch);

  app.get('/api/esm/*', (req: Request, res: Response) => {
    void (async () => {
      const path = String(req.params[0] ?? '');
      // Query participates in identity (?external=react,react-dom changes the produced module).
      const qi = req.originalUrl.indexOf('?');
      const query = qi >= 0 ? req.originalUrl.slice(qi) : '';
      const result = await fetchMirroredModule(path + query, { fetchImpl: doFetch, cache });
      if (!result.ok) {
        // A concise honest failure — the preview loader's next rung takes over from here.
        res.status(result.status).json({ error: result.status === 400 ? 'invalid module path' : `upstream ${result.status}` });
        return;
      }
      res.setHeader('Content-Type', result.contentType);
      // Version-pinned URLs never change content — let the BROWSER keep them for a year. This
      // header is the "reopen after weeks with zero network" layer.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // The preview iframe is sandboxed (opaque origin) and these are public npm bytes.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(result.body);
    })();
  });
}

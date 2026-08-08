/**
 * Preview dependency-graph warmup — the "Bolt feels instant" slice (admin 2026-08-08: "Bolt me
 * preview turant load ho jata hai, hamare me nahi — kya problem hai?").
 *
 * THE MEASURED PROBLEM (admin screenshot: "Loading preview… 7/10 packages · 13s" on LTE): the slow
 * part is not compiling (server-precompiled since #2138) and not serial fetching (the loader already
 * Promise.all's) — it is a TWO-LEVEL WATERFALL the client cannot avoid on its own:
 *   1. The browser can only discover a package's INTERNAL chunk imports after the entry module has
 *      arrived and parsed — so every package costs a chain of dependent round trips, each ~100-300ms
 *      on mobile RTT.
 *   2. The mirror's in-memory cache dies with the instance — i.e. on EVERY deploy — so each of those
 *      round trips could also pay mirror→esm.sh upstream latency on top.
 * Bolt never pays either cost because WebContainers keep node_modules on the device. We get the same
 * effect from the other side:
 *   • The SERVER crawls the dependency graph once (through the very same mirror pipeline a browser
 *     request takes — fetchMirroredModule), so every module is sitting warm in the shared mirror
 *     cache before the phone asks.
 *   • The crawl's discovery list — entries AND chunks — is handed to the preview page as
 *     `<link rel="modulepreload">` tags, so the browser fetches the WHOLE graph in one parallel
 *     burst instead of walking it. The waterfall collapses to a single round-trip depth.
 *
 * Bounded everywhere (module count, depth, body-scan size), memoized per entry-set, in-flight
 * deduped, and 100% best-effort: a warmup that fails changes nothing — the loader's existing rungs
 * still work exactly as before.
 */

import { fetchMirroredModule } from '../routes/esmMirror';

/** Hard caps — a pathological dependency graph must never turn the server into a crawler farm. */
export const WARMUP_MAX_MODULES = 96;
export const WARMUP_MAX_DEPTH = 5;
const WARMUP_SCAN_MAX_BYTES = 2 * 1024 * 1024;
const MEMO_TTL_MS = 60 * 60 * 1000; // deps change only when package.json changes; 1h is plenty

/**
 * Every mirror-relative import (`/api/esm/...`) referenced by a module body. After the mirror's
 * rewrite pass ALL internal imports have exactly this absolute-path shape, so a quoted-string scan
 * is precise here (this is our own rewritten output, not arbitrary JS). Pure, deduped, order kept.
 */
export function extractMirrorImports(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /["'](\/api\/esm\/[^"'\\\s]+)["']/g;
  const hay = body.length > WARMUP_SCAN_MAX_BYTES ? body.slice(0, WARMUP_SCAN_MAX_BYTES) : body;
  for (let m = re.exec(hay); m; m = re.exec(hay)) {
    const url = m[1];
    if (!seen.has(url)) { seen.add(url); out.push(url); }
  }
  return out;
}

type MirrorFetch = typeof fetchMirroredModule;
let _fetchModule: MirrorFetch = fetchMirroredModule;
/** Test seam — CI has no esm.sh and must not touch the real shared cache. */
export function _setWarmupFetchForTests(f: MirrorFetch | null): void {
  _fetchModule = f ?? fetchMirroredModule;
}

/**
 * Breadth-first crawl of the mirror-served dependency graph starting from the importmap's entry
 * URLs (host-relative `/api/esm/...`). Fetching IS the warming — every visited module lands in the
 * shared mirror cache. Returns every discovered URL, entries first, BFS order (the order preloads
 * should be emitted in: what the loader imports first preloads first).
 */
export async function crawlDepGraph(entryUrls: string[]): Promise<string[]> {
  const discovered: string[] = [];
  const seen = new Set<string>();
  let frontier = entryUrls.filter((u) => u.startsWith('/api/esm/'));
  for (const u of frontier) { seen.add(u); discovered.push(u); }
  for (let depth = 0; depth < WARMUP_MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    await Promise.all(frontier.map(async (url) => {
      const result = await _fetchModule(url.slice('/api/esm/'.length)).catch(() => null);
      if (!result || !result.ok) return;
      if (!/javascript|ecmascript/i.test(result.contentType)) return;
      for (const child of extractMirrorImports(result.body.toString('utf8'))) {
        if (seen.has(child) || seen.size >= WARMUP_MAX_MODULES) continue;
        seen.add(child);
        discovered.push(child);
        next.push(child);
      }
    }));
    frontier = next;
  }
  return discovered;
}

interface MemoEntry { urls: string[]; at: number }
const memo = new Map<string, MemoEntry>();
const inFlight = new Map<string, Promise<void>>();

/** Stable identity for one dependency set (order-independent). */
export function warmupKey(entryUrls: string[]): string {
  return [...entryUrls].sort().join('\n');
}

/**
 * Fire-and-forget: warm the graph for this entry set (memoized + in-flight-deduped, so a build's
 * many preview renders cost ONE crawl). Never throws, never blocks the caller.
 */
export function startDepWarmup(entryUrls: string[]): void {
  // Unit-test contract: never touch the real mirror/upstream from a test that didn't inject a
  // fetch. A test that DOES inject one (via _setWarmupFetchForTests) is testing the warmup itself.
  if (process.env.VITEST && _fetchModule === fetchMirroredModule) return;
  const mirrored = entryUrls.filter((u) => u.startsWith('/api/esm/'));
  if (mirrored.length === 0) return; // mirror off ⇒ nothing we can warm
  const key = warmupKey(mirrored);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return;
  if (inFlight.has(key)) return;
  const run = crawlDepGraph(mirrored)
    .then((urls) => { memo.set(key, { urls, at: Date.now() }); })
    .catch(() => { /* best-effort — the un-warmed path is exactly today's behavior */ })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, run);
}

/**
 * The full discovered URL list for this entry set, if a crawl has completed — null while cold or
 * in flight. Sync on purpose: buildReactPreview is synchronous, and "not ready yet" must cost
 * nothing (the page simply ships today's top-level preloads and the next render gets the full set).
 */
export function getWarmDepUrls(entryUrls: string[]): string[] | null {
  const mirrored = entryUrls.filter((u) => u.startsWith('/api/esm/'));
  if (mirrored.length === 0) return null;
  const hit = memo.get(warmupKey(mirrored));
  if (!hit || Date.now() - hit.at >= MEMO_TTL_MS) return null;
  return hit.urls;
}

/** Test seam — memo/in-flight are module state and must reset between tests. */
export function _clearWarmupForTests(): void {
  memo.clear();
  inFlight.clear();
}

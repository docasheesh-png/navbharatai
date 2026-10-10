import type { Express, Request, Response } from 'express';
import { rateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring } from '../lib/validate';
import { assertPublicHttpUrl, publicOnlyInit } from '../lib/ssrfGuard';
import { verifiedIdentity } from '../lib/identityPolicy';

/**
 * API Tester proxy — the REAL /api/devtools/proxy route (admin autopsy 2026-07-21).
 *
 * POST /api/devtools/proxy
 *   body: { url, method?, headers?, body? }
 *   → { status, statusText, headers, body, time }  (or 4xx/5xx with { error })
 *
 * The API Tester used a browser fetch, so every cross-origin request was blocked by CORS and looked
 * broken. This route performs the request SERVER-SIDE (no browser CORS) and returns the response. It
 * is SSRF-guarded (assertPublicHttpUrl blocks localhost / private / link-local / cloud-metadata
 * targets), rate-limited, size-capped, timed out, and does NOT auto-follow redirects (redirect-based
 * SSRF). No NavBharatAI credentials/cookies are attached — it's a plain outbound fetch.
 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB cap
const TIMEOUT_MS = 15_000;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const DEFAULT_DEVTOOLS_PORTS = [80, 443, 8080, 8443];
// Request headers we never let the caller set (hop-by-hop / identity spoofing).
const BLOCKED_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection', 'cookie']);

/** Ports the proxy may dial. `DEVTOOLS_PROXY_PORTS` (comma-separated) replaces the default four. */
function devtoolsProxyPorts(env: NodeJS.ProcessEnv = process.env): Set<number> {
  const raw = env.DEVTOOLS_PROXY_PORTS;
  if (raw == null || raw.trim() === '') return new Set(DEFAULT_DEVTOOLS_PORTS);
  const ports = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 65535) ports.add(n);
  }
  return ports;
}

/** Explicit port, or 80/443 when the URL omits one. Null when the URL is not http(s). */
function httpPort(raw: string): number | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.port) {
    const n = Number(u.port);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  }
  return u.protocol === 'https:' ? 443 : 80;
}

const schema = vobject({
  url: vstring({ max: 4_000 }),
  method: vstring({ optional: true, max: 10 }),
  body: vstring({ optional: true, max: 1_000_000 }),
});

// Its own tight bucket — an authenticated user can test APIs, but not turn us into an open relay.
const proxyLimiter = () => rateLimiter({ name: 'devtools-proxy', authed: 120, anon: 20, noun: 'proxied requests' });

export function registerDevtoolsProxyRoutes(app: Express): void {
  app.post('/api/devtools/proxy', proxyLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const v = await verifiedIdentity(req); if (!v) return res.status(401).json({ error: 'Sign in to use the API tester.' });
    const body = req.body as { url?: string; method?: string; headers?: unknown; body?: string };
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const method = (typeof body.method === 'string' ? body.method : 'GET').toUpperCase();
    if (!url) { res.status(400).json({ error: 'A "url" is required.' }); return; }
    if (!ALLOWED_METHODS.has(method)) { res.status(400).json({ error: `Method ${method} is not allowed.` }); return; }
    const port = httpPort(url);
    if (port != null && !devtoolsProxyPorts().has(port)) {
      res.status(400).json({ error: `Port ${port} is not allowed.` });
      return;
    }

    const guard = await assertPublicHttpUrl(url);
    if (!guard.ok) { res.status(400).json({ error: guard.reason || 'This URL is not allowed.' }); return; }

    // Only forward safe, caller-supplied headers.
    const headers: Record<string, string> = {};
    if (body.headers && typeof body.headers === 'object') {
      for (const [k, v] of Object.entries(body.headers as Record<string, unknown>)) {
        if (typeof k === 'string' && typeof v === 'string' && !BLOCKED_REQUEST_HEADERS.has(k.toLowerCase())) {
          headers[k] = v;
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = Date.now();
    try {
      const init: RequestInit = { method, headers, redirect: 'manual', signal: controller.signal };
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && typeof body.body === 'string' && body.body.length > 0) {
        init.body = body.body;
      }
      const upstream = await fetch(url, publicOnlyInit(init));
      // Read the body with a hard size cap so a huge/streaming response can't exhaust memory.
      const buf = await readCapped(upstream, MAX_RESPONSE_BYTES);
      const resHeaders: Record<string, string> = {};
      upstream.headers.forEach((val, key) => { resHeaders[key] = val; });
      res.json({
        status: upstream.status,
        statusText: upstream.statusText,
        headers: resHeaders,
        body: buf.text,
        truncated: buf.truncated,
        time: Date.now() - start,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const aborted = /abort/i.test(msg);
      res.status(502).json({ error: aborted ? `Request timed out after ${TIMEOUT_MS / 1000}s.` : `Request failed: ${msg}` });
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Read a fetch Response body up to `max` bytes, returning the decoded text + whether it was cut off. */
async function readCapped(resp: globalThis.Response, max: number): Promise<{ text: string; truncated: boolean }> {
  const reader = resp.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) { chunks.push(value.slice(0, value.byteLength - (total - max))); truncated = true; break; }
      chunks.push(value);
    }
  }
  try { await reader.cancel(); } catch { /* best effort */ }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), truncated };
}

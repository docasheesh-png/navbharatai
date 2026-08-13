/**
 * backendSubdomainRouter — serves `{subdomain}.{MANAGED_BACKEND_APPS_DOMAIN}` by reverse-proxying to
 * the app's Cloud Run URL. This is what makes a managed app feel hosted BY NavBharatAI: the user
 * shares `todo-3f9a21c7.apps.navbharatai.com`, never a run.app URL.
 *
 * PLACEMENT CONTRACT: mounted BEFORE every body parser and route in server.ts — the request stream
 * must reach the proxy untouched. With MANAGED_BACKEND_APPS_DOMAIN unset (the default) the
 * middleware is a pass-through no-op, so the existing app carries zero new risk until the admin
 * turns the domain on (kill-switch discipline).
 *
 * PLAN ENFORCEMENT lives here because this is the one chokepoint every request crosses: a lapsed
 * plan answers 402 with an honest page naming the fix; an unknown plan state (store outage) SERVES —
 * rule 1: our outage must never take a paying user's site down. Per-app rate limiting also bites
 * here, BEFORE Cloud Run ever bills an instance-second.
 *
 * Honest limitation (v1): plain HTTP only — WebSocket upgrades are not proxied. Recorded in
 * MANAGED_BACKEND_HOSTING.md, not hidden.
 */

import type { Request, Response, NextFunction } from 'express';
import { findManagedAppBySubdomain, type ManagedAppRecord } from './backendRegistry';
import { probeBackendPlanServes } from './backendHostingPlan';
import { limitsForPlan } from './backendLimits';

/** The wildcard apps domain (e.g. `apps.navbharatai.com`). Empty = feature off = middleware no-op. */
export function appsDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MANAGED_BACKEND_APPS_DOMAIN ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Extract the app subdomain from a Host header, or null when the request is not for the apps
 * domain. Exactly ONE label deep (`x.apps.domain` yes, `a.b.apps.domain` no) and the label must be
 * a legal slug — anything else is not ours. Pure + tested.
 */
export function subdomainFromHost(host: string | undefined, domain: string): string | null {
  if (!host || !domain) return null;
  const h = host.toLowerCase().split(':')[0].replace(/\.$/, '');
  if (!h.endsWith('.' + domain)) return null;
  const label = h.slice(0, h.length - domain.length - 1);
  if (!label || label.includes('.')) return null;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label) ? label : null;
}

/** Hop-by-hop headers that must never be forwarded either way (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

export function forwardableRequestHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key === 'accept-encoding') continue; // identity upstream: fetch would
    if (typeof v === 'string') out[key] = v;                        // decompress and desync lengths
    else if (Array.isArray(v)) out[key] = v.join(', ');
  }
  out['accept-encoding'] = 'identity';
  return out;
}

// ---------- tiny per-app request window (first gate, before Cloud Run bills) ----------

const windowCounts = new Map<string, { count: number; resetAt: number }>();

/** Pure-ish sliding window: true = over the per-minute cap. Exported for tests. */
export function overRequestCap(serviceId: string, capPerMinute: number, nowMs: number): boolean {
  const w = windowCounts.get(serviceId);
  if (!w || nowMs >= w.resetAt) {
    windowCounts.set(serviceId, { count: 1, resetAt: nowMs + 60_000 });
    return false;
  }
  w.count += 1;
  return w.count > capPerMinute;
}

export function _clearRequestWindowsForTests(): void {
  windowCounts.clear();
}

// ---------- registry lookup cache (the router runs per request; Firestore must not) ----------

const LOOKUP_TTL_MS = 60 * 1000;
const lookupCache = new Map<string, { record: ManagedAppRecord | null; at: number }>();

async function cachedLookup(subdomain: string): Promise<ManagedAppRecord | null> {
  const hit = lookupCache.get(subdomain);
  if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.record;
  const record = await findManagedAppBySubdomain(subdomain);
  lookupCache.set(subdomain, { record, at: Date.now() });
  return record;
}

export function _clearLookupCacheForTests(): void {
  lookupCache.clear();
}

function honestErrorPage(res: Response, status: number, title: string, detail: string): void {
  res.status(status).set('Content-Type', 'text/html; charset=utf-8').end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:system-ui;max-width:34rem;margin:15vh auto;padding:0 1rem;color:#222">` +
    `<h1 style="font-size:1.3rem">${title}</h1><p>${detail}</p>` +
    `<p style="color:#777;font-size:.85rem">Hosted on NavBharatAI Cloud</p></body>`,
  );
}

/**
 * The middleware. Non-apps-domain requests fall through untouched (`next()`); apps-domain requests
 * are terminal here — served, or answered with an honest error page.
 */
export function backendSubdomainRouter() {
  return async function backendSubdomainProxy(req: Request, res: Response, next: NextFunction): Promise<void> {
    const domain = appsDomain();
    if (!domain) { next(); return; }
    const sub = subdomainFromHost(req.headers.host, domain);
    if (!sub) { next(); return; }

    const app = await cachedLookup(sub);
    if (!app || app.state === 'deleted') {
      honestErrorPage(res, 404, 'App not found', `No app is published at <b>${sub}.${domain}</b>.`);
      return;
    }
    if (app.state === 'suspended') {
      honestErrorPage(res, 403, 'App suspended', 'This app was suspended by its owner.');
      return;
    }
    if (!app.url) {
      honestErrorPage(res, 503, 'App still deploying', 'The first deploy has not finished yet — try again in a minute.');
      return;
    }

    const caps = limitsForPlan('managed_backend');
    if (overRequestCap(app.serviceId, caps.requestsPerMinute, Date.now())) {
      honestErrorPage(res, 429, 'Too many requests', 'This app hit its per-minute request limit — try again shortly.');
      return;
    }

    // Lapsed plan = 402 with the exact fix. Unknown (store outage) = serve; rule 1.
    const plan = await probeBackendPlanServes(app.uid);
    if (plan.known && !plan.serving) {
      honestErrorPage(res, 402, 'Hosting plan expired',
        'The Managed Backend plan for this app has expired. The owner can renew it from NavBharatAI → Hosting to bring the app back.');
      return;
    }

    // ---- proxy ----
    const target = app.url.replace(/\/$/, '') + req.originalUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (caps.timeoutSeconds + 10) * 1000);
    try {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const upstream = await fetch(target, {
        method: req.method,
        headers: {
          ...forwardableRequestHeaders(req.headers),
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-proto': 'https',
        },
        body: hasBody ? (req as any) : undefined,
        // Node's fetch requires half-duplex for streamed request bodies.
        ...(hasBody ? { duplex: 'half' as const } : {}),
        signal: controller.signal,
        redirect: 'manual', // the app's redirects belong to the BROWSER, not to the proxy
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key) && key !== 'content-encoding') res.setHeader(key, value);
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) {
        honestErrorPage(res, 502, 'App unreachable',
          'The app did not answer. It may be crashing on boot — check its logs from NavBharatAI → Hosting.');
      } else {
        res.end();
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

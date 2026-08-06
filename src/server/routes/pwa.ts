import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules; `snap.exists` is a PROPERTY here) — see serverDb.ts.
import { doc, getDoc, setDoc, getServerDb } from '../lib/serverDb';
import { buildRateLimiter, verifyFirebaseToken, enforceNotBanned } from '../lib/authMiddleware';
import { injectBadge } from '../lib/madeWithBadge';
import { probeHostingPlan } from '../lib/hostingPlan';

// In-memory PWA cache entry (the durable copy lives in Firestore — see below).
export interface PwaEntry {
  html: string;
  name: string;
  createdAt: number;
  /** Owner uid — lets the serve path honor the owner's paid badge-removal plan. Absent on legacy entries. */
  userId?: string;
}

export type PwaStore = Map<string, PwaEntry>;

/**
 * NavBharat instant hosting ("NavBharat Hosting" in Cloudeploy) — save a generated app and serve it
 * as an installable PWA (manifest + service worker + HTML shell) at navbharatai.com/pwa/<id>.
 *
 * ROOT CAUSE FIX (admin 2026-08-02 — "hosting karwai, fail ho gaya"): the store was ONLY an in-memory
 * Map with a 24h TTL. On Cloud Run that made the green "Deployed successfully! Live URL" a lie in
 * three separate ways: (1) every deploy/restart of the service WIPED every hosted app (each merged PR
 * auto-deploys, so links died within hours); (2) with more than one instance, the save could land on
 * instance A and the visit on instance B → instant "App not found"; (3) 24 hours is not hosting.
 * A URL we hand out as "Live" must survive our own restarts — rule 2 (real features only).
 *
 * Now: the durable copy is written to Firestore (`pwa_apps/<id>`) at save time and served read-through
 * (memory cache → Firestore → honest 404). When Firestore is configured but the durable write FAILS,
 * the save returns an honest 503 instead of minting a URL that would die — never a fake "Deployed".
 * Without a server DB (local dev), it degrades to the old memory-only behavior.
 *
 * Saving requires a signed-in user (rate-limited): durable, anonymous, arbitrary-HTML hosting on our
 * domain would be a free phishing platform. Serving stays public (it is a published app).
 */

/** Durable TTL for hosted apps. Env-tunable (days); default 30 days. */
export function pwaTtlMs(): number {
  const days = Number(process.env.NAVBHARAT_PWA_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * 60 * 60 * 1000;
}

/** True when an entry is past its TTL (pure; injectable clock for tests). */
export function pwaEntryExpired(createdAt: number, now: number = Date.now()): boolean {
  return !Number.isFinite(createdAt) || createdAt + pwaTtlMs() < now;
}

/** Firestore doc hard cap is 1 MiB — refuse anything near it HONESTLY instead of failing the write. */
export const MAX_PWA_HTML_BYTES = 900 * 1024;

/** Ids are minted by us (8 random bytes, hex). Reject anything else before touching the DB. */
const PWA_ID_RE = /^[a-f0-9]{16}$/;

/** Read-through: memory cache → Firestore → null. Expired entries are treated as absent. */
async function loadEntry(pwaStore: PwaStore, id: string): Promise<PwaEntry | null> {
  const mem = pwaStore.get(id);
  if (mem) return pwaEntryExpired(mem.createdAt) ? null : mem;
  // The id format gates only the DB lookup (ids are minted by us) — junk never reaches Firestore.
  if (!PWA_ID_RE.test(id)) return null;
  const db = getServerDb() as any;
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, 'pwa_apps', id));
    if (!snap.exists) return null;
    const d = snap.data() as Partial<PwaEntry> | undefined;
    if (!d || typeof d.html !== 'string' || !d.html) return null;
    if (pwaEntryExpired(typeof d.createdAt === 'number' ? d.createdAt : 0)) return null;
    const entry: PwaEntry = {
      html: d.html,
      name: typeof d.name === 'string' && d.name ? d.name : 'My NavBharat App',
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
      ...(typeof (d as { userId?: unknown }).userId === 'string' ? { userId: (d as { userId: string }).userId } : {}),
    };
    pwaStore.set(id, entry); // hydrate the cache so the next hit is instant
    return entry;
  } catch {
    // A transient read failure must not permanently 404 a live app — but we cannot serve what we
    // cannot read either. Treat as absent for THIS request; the next request retries Firestore.
    return null;
  }
}

const EXPIRED_PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>App Not Found</title><style>body{font-family:system-ui;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:1rem;text-align:center;padding:2rem}</style></head><body><div style="font-size:3rem">⏳</div><h2>App Not Found</h2><p style="color:#8b949e">This app link has expired or does not exist.<br>Publish again from NavBharatAI to get a fresh link.</p></body></html>`;

export function registerPwaRoutes(app: Express, pwaStore: PwaStore): void {
  app.post('/api/pwa/save', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    // Durable hosting on our domain must belong to a real account (abuse/phishing control).
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Please sign in to host your app.' });
    const { html, name } = req.body ?? {};
    if (!html || typeof html !== 'string') return res.status(400).json({ error: 'HTML required' });
    if (Buffer.byteLength(html, 'utf8') > MAX_PWA_HTML_BYTES) {
      return res.status(413).json({ error: 'This app is too large for instant hosting (max 900 KB). Use the Git/Deploy panel to publish it to a full host instead.' });
    }
    const id = crypto.randomBytes(8).toString('hex');
    const entry: PwaEntry = { html, name: String(name || 'My NavBharat App').slice(0, 30), createdAt: Date.now(), userId };
    const db = getServerDb() as any;
    if (db) {
      try {
        await setDoc(doc(db, 'pwa_apps', id), { ...entry, userId });
      } catch {
        // HONEST failure: if the durable copy cannot be written, do NOT hand out a URL that only
        // lives in this instance's memory — it would die on the next restart (the exact bug).
        return res.status(503).json({ error: 'Hosting is temporarily unavailable — please try again in a moment.' });
      }
    }
    pwaStore.set(id, entry);
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return res.json({ id, url: `${proto}://${host}/pwa/${id}` });
  });

  app.get('/pwa/:id/manifest.json', async (req: Request, res: Response) => {
    const entry = await loadEntry(pwaStore, req.params.id);
    if (!entry) return res.status(404).json({ error: 'App not found or expired' });
    const id = req.params.id;
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#6366f1"/><text y="370" x="256" font-size="320" text-anchor="middle" fill="white">&#128187;</text></svg>`;
    const icon = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;
    res.json({
      name: entry.name,
      short_name: entry.name.slice(0, 14),
      description: `${entry.name} — Built with NavBharatAI`,
      start_url: `/pwa/${id}`,
      scope: `/pwa/${id}`,
      display: 'standalone',
      orientation: 'any',
      background_color: '#0d1117',
      theme_color: '#6366f1',
      icons: [
        { src: icon, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: icon, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
      ]
    });
  });

  app.get('/pwa/:id/sw.js', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', `/pwa/${req.params.id}`);
    res.send(`
const CACHE='nb-pwa-${req.params.id}';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>e.respondWith(
  caches.open(CACHE).then(c=>c.match(e.request).then(r=>r||(fetch(e.request).then(nr=>{c.put(e.request,nr.clone());return nr;}).catch(()=>r))))
));`);
  });

  app.get('/pwa/:id', async (req: Request, res: Response) => {
    const entry = await loadEntry(pwaStore, req.params.id);
    if (!entry) {
      return res.status(404).send(EXPIRED_PAGE);
    }
    const id = req.params.id;
    const pwaHead = `<link rel="manifest" href="/pwa/${id}/manifest.json">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${entry.name}">
<meta name="theme-color" content="#6366f1">
<script>if('serviceWorker'in navigator){navigator.serviceWorker.register('/pwa/${id}/sw.js',{scope:'/pwa/${id}'}).catch(()=>{})}<\/script>`;
    let html = entry.html;
    if (html.includes('</head>')) html = html.replace('</head>', `${pwaHead}</head>`);
    else if (html.includes('<head>')) html = html.replace('<head>', `<head>${pwaHead}`);
    else html = `<head>${pwaHead}</head>${html}`;
    // "Made with NavBharatAI" badge — stamped at SERVE time (even stronger than publish-time: the
    // stored HTML never contains it, so no edit anywhere can strip it). Idempotent via its marker.
    // The owner's paid plan removes it; the probe is cached (5 min) so per-view cost stays near zero,
    // and an unknown answer keeps the badge (safe direction).
    const plan = await probeHostingPlan(entry.userId);
    html = injectBadge(html, { paidRemoval: plan.known && plan.active });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
}

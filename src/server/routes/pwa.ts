import crypto from 'crypto';
import type { Express, Request, Response } from 'express';

// In-memory PWA store entry (24h TTL store owned by server bootstrap).
export interface PwaEntry {
  html: string;
  name: string;
  createdAt: number;
}

export type PwaStore = Map<string, PwaEntry>;

/**
 * Registers the PWA "App Store" routes: save a generated app and serve it as an
 * installable PWA (manifest + service worker + HTML shell).
 *
 * Extracted from the server.ts monolith (Phase 1). Behavior is unchanged — the
 * store is passed in so its lifecycle/TTL stays owned by the bootstrap.
 */
export function registerPwaRoutes(app: Express, pwaStore: PwaStore): void {
  app.post('/api/pwa/save', (req: Request, res: Response) => {
    const { html, name } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML required' });
    const id = crypto.randomBytes(8).toString('hex');
    pwaStore.set(id, { html, name: (name || 'My NavBharat App').slice(0, 30), createdAt: Date.now() });
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return res.json({ id, url: `${proto}://${host}/pwa/${id}` });
  });

  app.get('/pwa/:id/manifest.json', (req: Request, res: Response) => {
    const entry = pwaStore.get(req.params.id);
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

  app.get('/pwa/:id', (req: Request, res: Response) => {
    const entry = pwaStore.get(req.params.id);
    if (!entry) {
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Expired</title><style>body{font-family:system-ui;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:1rem;text-align:center;padding:2rem}</style></head><body><div style="font-size:3rem">⏳</div><h2>Link Expired</h2><p style="color:#8b949e">This link was valid for 24 hours.<br>Generate a new link in NavBharatAI.</p></body></html>`);
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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
}

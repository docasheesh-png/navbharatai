import type { Express, Request, Response } from 'express';
import { rateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring } from '../lib/validate';

/**
 * Figma proxy — the REAL /api/figma/proxy route (admin autopsy 2026-07-21).
 *
 * POST /api/figma/proxy  body: { fileKey, token }
 *   → { status, data }   (status = Figma's HTTP status so the client can map 403/404)
 *
 * The Figma Importer called api.figma.com directly from the browser, which CORS blocks — so it could
 * never load a file tree (its own error text even pointed at a "/api/figma-proxy" that didn't exist).
 * This route does the call SERVER-SIDE (no CORS) using the user's own Personal Access Token, and
 * returns the file JSON. Fixed upstream host (api.figma.com) → no SSRF surface. The token is used only
 * for this one request and never stored.
 */
const FIGMA_FILES_URL = 'https://api.figma.com/v1/files/';
const TIMEOUT_MS = 20_000;

const schema = vobject({
  fileKey: vstring({ max: 100 }),
  token: vstring({ max: 200 }),
});

const figmaLimiter = () => rateLimiter({ name: 'figma-proxy', authed: 60, anon: 15, noun: 'Figma imports' });

export function registerFigmaProxyRoutes(app: Express): void {
  app.post('/api/figma/proxy', figmaLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const body = req.body as { fileKey?: string; token?: string };
    const fileKey = typeof body.fileKey === 'string' ? body.fileKey.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    // Figma file keys are URL-safe alphanumerics — reject anything else so the path can't be abused.
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(fileKey)) { res.status(400).json({ error: 'Invalid Figma file key.' }); return; }
    if (!token) { res.status(400).json({ error: 'A Figma access token is required.' }); return; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const upstream = await fetch(`${FIGMA_FILES_URL}${encodeURIComponent(fileKey)}`, {
        headers: { 'X-Figma-Token': token },
        signal: controller.signal,
      });
      // Surface Figma's status so the client keeps its 403 (bad token) / 404 (no file) handling.
      const data = await upstream.json().catch(() => null);
      res.status(upstream.ok ? 200 : upstream.status).json(upstream.ok ? { status: upstream.status, data } : { status: upstream.status, error: (data && (data.err || data.message)) || `Figma API error: ${upstream.status}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: /abort/i.test(msg) ? 'Figma request timed out — please try again.' : `Could not reach Figma: ${msg}` });
    } finally {
      clearTimeout(timer);
    }
  });
}

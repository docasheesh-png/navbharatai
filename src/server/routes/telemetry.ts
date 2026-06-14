import type { Express, Request, Response } from 'express';

/**
 * Registers self-contained telemetry/analysis routes extracted from the
 * server.ts monolith (Phase 1). These have no closure dependencies — they only
 * use globals (fetch, process.env, console) — so behavior is unchanged.
 *
 * - GET  /api/analyze/pagespeed — proxy to Google PageSpeed Insights
 * - POST /api/logs/error        — frontend error ingestion
 * - POST /api/analytics/event   — user analytics event ingestion
 */
export function registerTelemetryRoutes(app: Express): void {
  // PageSpeed Analysis Proxy
  app.get('/api/analyze/pagespeed', async (req: Request, res: Response) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
    try {
      const apiKey = process.env.PAGESPEED_API_KEY || '';
      const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile${apiKey ? '&key=' + apiKey : ''}`;
      const r = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
      const data = await r.json() as any;
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'PageSpeed API error' });
      const cats = data.lighthouseResult?.categories || {};
      const audits = data.lighthouseResult?.audits || {};
      return res.json({
        performance: Math.round((cats.performance?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        bestPractices: Math.round((cats['best-practices']?.score || 0) * 100),
        fcp: audits['first-contentful-paint']?.displayValue,
        lcp: audits['largest-contentful-paint']?.displayValue,
        cls: audits['cumulative-layout-shift']?.displayValue,
        tbt: audits['total-blocking-time']?.displayValue,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to analyze' });
    }
  });

  // Frontend error ingestion endpoint
  app.post('/api/logs/error', (req: Request, res: Response) => {
    try {
      const { message, source, line, col, stack, url, ts, type } = req.body || {};
      const ip = (req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress || '').split(',')[0].trim();
      console.error('[CLIENT_ERROR]', JSON.stringify({ message, source, line, col, stack, url, ts, type, ip }));
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });

  // User analytics event ingestion endpoint
  app.post('/api/analytics/event', (req: Request, res: Response) => {
    try {
      const { event, props, userId, sessionId, ts } = req.body || {};
      if (!event) return res.status(400).json({ error: 'event required' });
      console.log('[ANALYTICS]', JSON.stringify({ event, props, userId: userId || 'anon', sessionId, ts: ts || Date.now() }));
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });
}

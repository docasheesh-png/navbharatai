import type { Express, Request, Response } from 'express';
import { errorTracker } from '../observability/ErrorTracker';
import { recordAnalyticsEvent, getFunnel } from '../lib/AnalyticsPipeline';
import { sendSafeError } from '../lib/httpError';

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
    // Wired into the Performance Analyzer tool (admin 2026-07-25) — a `strategy` toggle + extra vitals
    // (Speed Index, TTI) were added; every original flat field is unchanged (back-compatible). `key`
    // env alias GOOGLE_PAGESPEED_KEY kept alongside PAGESPEED_API_KEY.
    const strategy = req.query.strategy === 'desktop' ? 'desktop' : 'mobile';
    try {
      const apiKey = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_KEY || '';
      const cat = ['performance', 'accessibility', 'seo', 'best-practices'].map((c) => `&category=${c}`).join('');
      const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}${cat}${apiKey ? '&key=' + apiKey : ''}`;
      const r = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
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
        si: audits['speed-index']?.displayValue,
        tti: audits['interactive']?.displayValue,
        strategy,
        finalUrl: data.lighthouseResult?.finalUrl || url,
      });
    } catch (err: any) {
      return sendSafeError(res, 500, 'Failed to analyze. Please try again.', err, 'telemetry analyze');
    }
  });

  // Frontend error ingestion endpoint. P2.2 — also routed through the ErrorTracker so
  // client-side errors reach Cloud Error Reporting (grouped/alertable) + the admin view.
  app.post('/api/logs/error', (req: Request, res: Response) => {
    try {
      const { message, source, line, col, stack, url, ts, type } = req.body || {};
      const ip = (req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress || '').split(',')[0].trim();
      console.error('[CLIENT_ERROR]', JSON.stringify({ message, source, line, col, stack, url, ts, type, ip }));
      // Reconstruct an Error so the stack groups correctly in Cloud Error Reporting.
      const err = new Error(String(message || type || 'client error'));
      if (typeof stack === 'string' && stack) err.stack = stack;
      errorTracker.capture(err, { source: 'client', httpUrl: typeof url === 'string' ? url : undefined, meta: { line, col, source, type } });
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
      // P-MON.1 — server-side aggregation: fold into the daily rollup + activation funnel. Best-effort.
      recordAnalyticsEvent({ event, userId, sessionId, props, ts }).catch(() => {});
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });

  // P-MON.1 — activation funnel (signup → build → deploy → pay) over the last N days. Aggregate counts
  // only (no PII), so it is safe as a lightweight admin/analytics read. `?days=30` (1..365).
  app.get('/api/analytics/funnel', async (req: Request, res: Response) => {
    try {
      const days = Number(req.query.days);
      res.json(await getFunnel(Number.isFinite(days) && days > 0 ? days : 30));
    } catch {
      res.status(200).json({ stages: { signup: 0, build: 0, deploy: 0, pay: 0 }, conversion: { signup: 1, build: 0, deploy: 0, pay: 0 } });
    }
  });
}

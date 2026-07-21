// Roadmap breadth — self-hosted page-view counter starter (a packaged domain vertical).
//
// A privacy-friendly, self-hosted view/visit counter (no third party). The real feature is UNIQUE-VISITOR
// DEDUP: every hit increments the page's TOTAL views, but a given visitor only counts ONCE PER DAY toward the
// page's UNIQUE count — the visitor is identified by a SALTED HASH of their IP+userAgent (never the raw IP), so
// it is privacy-preserving and cannot be reversed. Plus a top-pages ranking. This emits a dependency-free
// PageViewService (node:crypto) + an Express router + a README. Real logic, not a stub — the total-vs-unique +
// per-day dedup rules are unit-tested against the emitted code. Pure builder → the caller writes the files.
// Distinct from generate_analytics (sends events to PostHog/Mixpanel — a 3rd party); this stores nothing external.

export const PAGEVIEWS_SERVICE_SOURCE = `import { createHash } from 'node:crypto';

// Self-hosted page-view counter domain logic. The core guarantees: (1) every recorded hit increments the page's
// TOTAL view count; (2) a visitor counts toward a page's UNIQUE count only ONCE PER DAY — identified by a
// SALTED HASH of IP+userAgent (the raw IP is never stored), so it is privacy-preserving; and (3) topPages()
// ranks pages by total views. In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface PageStats {
  path: string;
  totalViews: number;
  uniqueViews: number; // distinct (visitor, day) pairs
}

export class PageViewService {
  private totals = new Map<string, number>();          // path -> total hits
  // path -> set of "visitorHash:YYYY-MM-DD" seen (each pair counts one unique)
  private uniques = new Map<string, Set<string>>();
  private salt: string;

  // The salt makes the visitor hash non-reversible and unguessable. Provide a stable secret in production.
  constructor(salt = 'change-me-in-production') {
    this.salt = String(salt);
  }

  private visitorHash(ip: string, userAgent: string): string {
    return createHash('sha256').update(this.salt + '|' + String(ip ?? '') + '|' + String(userAgent ?? '')).digest('hex').slice(0, 16);
  }

  private dayKey(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  /**
   * Record a page view. Always bumps total. The visitor (hashed from ip+userAgent) counts as unique only the
   * first time it is seen for that page on that calendar day. Returns the page's stats after recording.
   */
  record(path: string, visitor: { ip?: string; userAgent?: string } = {}, now: Date = new Date()): PageStats {
    const p = String(path ?? '').trim();
    if (!p) throw new Error('path is required');
    this.totals.set(p, (this.totals.get(p) ?? 0) + 1);
    let set = this.uniques.get(p);
    if (!set) { set = new Set(); this.uniques.set(p, set); }
    const key = this.visitorHash(String(visitor.ip ?? ''), String(visitor.userAgent ?? '')) + ':' + this.dayKey(now);
    set.add(key); // Set dedups — same visitor same day is a no-op
    return this.stats(p);
  }

  /** Stats for one page. */
  stats(path: string): PageStats {
    const p = String(path ?? '').trim();
    return { path: p, totalViews: this.totals.get(p) ?? 0, uniqueViews: this.uniques.get(p)?.size ?? 0 };
  }

  /** The most-viewed pages, by total views, descending. */
  topPages(limit = 10): PageStats[] {
    const n = Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 10));
    return [...this.totals.keys()]
      .map((p) => this.stats(p))
      .sort((a, b) => b.totalViews - a.totalViews || a.path.localeCompare(b.path))
      .slice(0, n);
  }

  /** Sum of all page totals — the site-wide view count. */
  siteTotal(): number {
    let n = 0;
    for (const v of this.totals.values()) n += v;
    return n;
  }
}

// A ready-to-use singleton for the routes. Pass a real secret salt from your env in production.
export const pageViews = new PageViewService(process.env.PAGEVIEW_SALT || 'change-me-in-production');
`;

export const PAGEVIEWS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { pageViews } from './pageViewService';

// REST endpoints for the page-view counter. Mount with: app.use('/api/views', pageViewRouter).
export const pageViewRouter = Router();

// Record a view. { path }. The visitor is derived from the request IP + User-Agent (never stored raw).
pageViewRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { path?: unknown };
  try {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = String(req.headers['user-agent'] ?? '');
    return res.status(200).json(pageViews.record(String(body.path ?? ''), { ip, userAgent }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Stats for one page. ?path=/some/page.
pageViewRouter.get('/stats', (req: Request, res: Response) => {
  const path = String(req.query.path ?? '').trim();
  if (!path) return res.status(400).json({ error: 'path is required' });
  return res.status(200).json(pageViews.stats(path));
});

// Top pages by total views. ?limit=10.
pageViewRouter.get('/top', (req: Request, res: Response) => {
  const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
  return res.status(200).json({ siteTotal: pageViews.siteTotal(), pages: pageViews.topPages(limit) });
});
`;

const PAGEVIEWS_README = `# Page-view counter (self-hosted)

A real, privacy-friendly view/visit counter that stores nothing with any third party. The core guarantees:
every hit increments a page's **total** views, but a given visitor counts toward the page's **unique** count
only **once per day** — the visitor is identified by a **salted hash** of IP + User-Agent (the raw IP is never
stored), so it is privacy-preserving and non-reversible. Plus a **top-pages** ranking. Files:

- \`pageViewService.ts\` — the domain logic (\`PageViewService\` + a \`pageViews\` singleton). Uses \`node:crypto\`
  only. In-memory; swap the Maps for your DB. Pass a stable secret salt (\`PAGEVIEW_SALT\`) in production.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { pageViewRouter } from './server/pageviews/routes';
app.use('/api/views', pageViewRouter);
\`\`\`

Endpoints:
- \`POST /api/views\` \`{ path }\` → record a view (visitor derived from request IP + User-Agent, never stored raw).
- \`GET  /api/views/stats?path=/some/page\` → \`{ totalViews, uniqueViews }\`.
- \`GET  /api/views/top?limit=10\` → the most-viewed pages + the site-wide total.

Distinct from \`generate_analytics\` (sends events to a third party like PostHog/Mixpanel); this keeps all counts
on your own server.
`;

export interface PageViewsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Self-hosted page-view counter wired under server/pageviews/ (dependency-free domain logic using node:crypto + ' +
  'an Express router). The real guarantee is UNIQUE-VISITOR DEDUP: record(path, {ip,userAgent}) always bumps the ' +
  'page TOTAL, but a visitor counts toward the page UNIQUE count only ONCE PER DAY — the visitor is a SALTED ' +
  'HASH of ip+userAgent (raw IP never stored, non-reversible), so it is privacy-preserving; stats(path) returns ' +
  '{totalViews, uniqueViews}; topPages(limit) ranks by total; siteTotal() sums all pages. routes.ts exposes ' +
  'POST /api/views ({path} — visitor derived from request IP + User-Agent), GET /api/views/stats (?path=) and ' +
  'GET /api/views/top (?limit=). Mount at app.use("/api/views", pageViewRouter); set a stable PAGEVIEW_SALT in ' +
  'production. Distinct from generate_analytics (sends events to a 3rd-party like PostHog/Mixpanel) — this keeps ' +
  'all counts on your own server. In-memory by default — swap the Maps for your DB.';

export function generatePageViewsIntegration(): PageViewsConfig {
  return {
    files: {
      'server/pageviews/pageViewService.ts': PAGEVIEWS_SERVICE_SOURCE,
      'server/pageviews/routes.ts': PAGEVIEWS_ROUTES_SOURCE,
      'server/pageviews/README.md': PAGEVIEWS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

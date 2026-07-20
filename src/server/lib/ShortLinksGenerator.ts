// Roadmap breadth — URL shortener starter (a packaged domain vertical).
//
// A high-demand vertical for marketing links, sharing, QR targets and any "short URL" need. The real feature is
// LINK INTEGRITY: every short code is UNIQUE (auto-generated collision-free, or a custom alias rejected if
// taken), resolving a code returns its target and increments an EXACT click count, and an EXPIRED or disabled
// link stops resolving. This emits a dependency-free ShortLinkService (node:crypto) + an Express router + a
// README. Real logic, not a stub — the uniqueness + click-count + expiry rules are unit-tested against the
// emitted code. Pure builder → the caller writes the files.

export const SHORTLINKS_SERVICE_SOURCE = `import { randomBytes } from 'node:crypto';

// URL-shortener domain logic. The core guarantees: (1) every short code is UNIQUE — auto-generated codes retry
// on the astronomically-rare collision, and a custom alias is rejected if already taken, (2) resolve() returns
// the target and increments an EXACT click count, and (3) an EXPIRED or disabled link does NOT resolve.
// In-memory here; swap the Map for your database, keeping the same method contracts.

export interface ShortLink {
  code: string;
  url: string;
  clicks: number;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
}

// Unambiguous base-58-ish alphabet (no 0/O/I/l) for human-friendly codes.
const ALPHABET = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(len = 7): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export class ShortLinkService {
  private links = new Map<string, ShortLink>();

  /** Shorten a URL. Optional custom alias (rejected if taken) and expiry. Auto-generates a unique code otherwise. */
  shorten(url: string, opts: { alias?: string; expiresAt?: string | null } = {}, now: Date = new Date()): ShortLink {
    const target = String(url ?? '').trim();
    if (!isHttpUrl(target)) throw new Error('a valid http(s) URL is required');
    let code: string;
    const alias = String(opts.alias ?? '').trim();
    if (alias) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(alias)) throw new Error('alias may contain only letters, digits, - and _');
      if (this.links.has(alias)) throw new Error('alias already taken');
      code = alias;
    } else {
      code = randomCode();
      while (this.links.has(code)) code = randomCode(); // guarantee uniqueness
    }
    const link: ShortLink = {
      code,
      url: target,
      clicks: 0,
      active: true,
      createdAt: now.toISOString(),
      expiresAt: opts.expiresAt ? new Date(opts.expiresAt).toISOString() : null,
    };
    this.links.set(code, link);
    return link;
  }

  get(code: string): ShortLink | undefined {
    return this.links.get(String(code).trim());
  }

  /** Is a link currently resolvable (exists, active, not expired)? */
  private isLive(link: ShortLink | undefined, now: Date): link is ShortLink {
    if (!link || !link.active) return false;
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return false;
    return true;
  }

  /**
   * Resolve a code to its target URL and count the click. Returns the URL, or null if the code is unknown,
   * disabled or expired (so the caller can 404 instead of redirecting). Exact click counting.
   */
  resolve(code: string, now: Date = new Date()): string | null {
    const link = this.links.get(String(code).trim());
    if (!this.isLive(link, now)) return null;
    link.clicks += 1;
    return link.url;
  }

  /** Peek the target without counting a click (e.g. an admin preview). Null if not live. */
  peek(code: string, now: Date = new Date()): string | null {
    const link = this.links.get(String(code).trim());
    return this.isLive(link, now) ? link.url : null;
  }

  /** Enable/disable a link without deleting it. */
  setActive(code: string, active: boolean, now: Date = new Date()): ShortLink {
    const link = this.links.get(String(code).trim());
    if (!link) throw new Error('link not found');
    link.active = Boolean(active);
    void now;
    return link;
  }

  /** Delete a link. */
  remove(code: string): boolean {
    return this.links.delete(String(code).trim());
  }

  /** All links, newest first. */
  list(): ShortLink[] {
    return [...this.links.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const shortLinks = new ShortLinkService();
`;

export const SHORTLINKS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { shortLinks } from './shortLinkService';

// REST endpoints for the URL shortener. Mount with: app.use('/', shortLinkRouter).
// NOTE: the redirect route is mounted at the ROOT so short links look like https://yourdomain/:code.
export const shortLinkRouter = Router();

// Create a short link. { url, alias?, expiresAt? } — 409 if a custom alias is taken.
shortLinkRouter.post('/api/links', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { url?: unknown; alias?: unknown; expiresAt?: unknown };
  try {
    const link = shortLinks.shorten(String(body.url ?? ''), {
      alias: body.alias === undefined ? undefined : String(body.alias),
      expiresAt: body.expiresAt === undefined || body.expiresAt === null ? null : String(body.expiresAt),
    });
    return res.status(201).json(link);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'alias already taken' ? 409 : 400).json({ error: message });
  }
});

// Link stats (does NOT count a click).
shortLinkRouter.get('/api/links/:code', (req: Request, res: Response) => {
  const link = shortLinks.get(req.params.code);
  if (!link) return res.status(404).json({ error: 'link not found' });
  return res.status(200).json(link);
});

// Enable/disable a link. { active }.
shortLinkRouter.patch('/api/links/:code', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { active?: unknown };
  try {
    return res.status(200).json(shortLinks.setActive(req.params.code, Boolean(body.active)));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'link not found' });
  }
});

shortLinkRouter.delete('/api/links/:code', (req: Request, res: Response) => {
  if (!shortLinks.remove(req.params.code)) return res.status(404).json({ error: 'link not found' });
  return res.status(204).send();
});

// The public redirect. Counts the click; 404 if unknown / disabled / expired.
shortLinkRouter.get('/:code', (req: Request, res: Response) => {
  const url = shortLinks.resolve(req.params.code);
  if (!url) return res.status(404).json({ error: 'link not found or expired' });
  return res.redirect(302, url);
});
`;

const SHORTLINKS_README = `# URL shortener

A real link-shortener backend. The core guarantees: every short code is **unique** (auto-generated collision-free,
or a custom alias rejected if taken), resolving a code returns its target and increments an **exact click count**,
and an **expired or disabled** link stops resolving. Files:

- \`shortLinkService.ts\` — the domain logic (\`ShortLinkService\` + a \`shortLinks\` singleton). Uses \`node:crypto\`
  only (no deps). In-memory; swap the Map for your DB.
- \`routes.ts\` — REST + redirect endpoints. Mount at the **root** so links look like \`https://yourdomain/:code\`:

\`\`\`ts
import { shortLinkRouter } from './server/shortlinks/routes';
app.use('/', shortLinkRouter);
\`\`\`

Endpoints:
- \`POST /api/links\` \`{ url, alias?, expiresAt? }\` → shorten (**409** if a custom alias is taken; **400** on a bad URL).
- \`GET  /api/links/:code\` → stats (does NOT count a click).
- \`PATCH /api/links/:code\` \`{ active }\` → enable/disable.
- \`DELETE /api/links/:code\`.
- \`GET  /:code\` → **302** redirect (counts the click); **404** if unknown / disabled / expired.

Only \`http(s)\` URLs are accepted. Use with the QR recipe (\`generate_qr\`) to turn a short link into a QR code.
`;

export interface ShortLinksConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'URL shortener starter wired under server/shortlinks/ (dependency-free domain logic using node:crypto + an ' +
  'Express router). The real guarantee is LINK INTEGRITY: shorten() makes a UNIQUE code (auto-generated codes ' +
  'retry on collision; a custom alias is rejected if taken or malformed; only http(s) URLs accepted); resolve() ' +
  'returns the target and increments an EXACT click count but returns null for an unknown/disabled/EXPIRED code ' +
  '(so the route 404s instead of redirecting); peek() previews without counting. routes.ts exposes POST ' +
  '/api/links (409 on taken alias), GET /api/links/:code (stats, no click), PATCH /api/links/:code ({active}), ' +
  'DELETE /api/links/:code and the public GET /:code (302 redirect + click, 404 if not live). Mount at the ROOT ' +
  '(app.use("/", shortLinkRouter)) so links look like https://yourdomain/:code. Pairs with generate_qr. ' +
  'In-memory by default — swap the Map for your DB.';

export function generateShortLinksIntegration(): ShortLinksConfig {
  return {
    files: {
      'server/shortlinks/shortLinkService.ts': SHORTLINKS_SERVICE_SOURCE,
      'server/shortlinks/routes.ts': SHORTLINKS_ROUTES_SOURCE,
      'server/shortlinks/README.md': SHORTLINKS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

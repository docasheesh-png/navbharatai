// Roadmap breadth — marketplace listings starter (a packaged domain vertical).
//
// A high-demand vertical for classifieds, peer-to-peer marketplaces, second-hand stores and any buyer↔seller
// app. The real feature is SALE INTEGRITY: a listing follows a lifecycle (draft → active → sold / removed), it
// can be SOLD AT MOST ONCE (a second purchase on a sold/removed listing is rejected — no double-sale), a seller
// cannot buy their own listing, and only ACTIVE listings appear in the public search. This emits a
// dependency-free ListingService + an Express router + a README. Real logic, not a stub — the lifecycle +
// sell-once rules are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const LISTING_SERVICE_SOURCE = `// Marketplace-listings domain logic. The core guarantees: (1) a listing follows the lifecycle
// draft → active → sold / removed (invalid jumps rejected), (2) a listing can be SOLD AT MOST ONCE — a purchase
// on a non-active listing is rejected and the seller cannot buy their own listing, and (3) only ACTIVE listings
// are publicly searchable. In-memory here; swap the Maps for your database, keeping the same method contracts.

export type ListingStatus = 'draft' | 'active' | 'sold' | 'removed';

export interface Listing {
  id: string;
  seller: string;
  title: string;
  description: string;
  priceCents: number;
  status: ListingStatus;
  buyer: string | null;
  createdAt: string;
  updatedAt: string;
  soldAt: string | null;
}

// Allowed lifecycle transitions (selling is handled by buy(), not a raw status change).
const STATUS_FLOW: Record<ListingStatus, ListingStatus[]> = {
  draft: ['active', 'removed'],
  active: ['draft', 'removed'], // unpublish back to draft, or take it down
  sold: [], // terminal
  removed: ['draft'], // relist a removed listing as a draft
};

export class ListingService {
  private listings = new Map<string, Listing>();
  private seq = 0;

  /** Create a listing (starts as a draft). */
  create(input: { seller: string; title: string; description?: string; priceCents: number }, now: Date = new Date()): Listing {
    const seller = String(input?.seller ?? '').trim();
    const title = String(input?.title ?? '').trim();
    if (!seller) throw new Error('seller is required');
    if (!title) throw new Error('title is required');
    const priceCents = Math.floor(Number(input.priceCents));
    if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error('priceCents must be a non-negative number');
    const iso = now.toISOString();
    const listing: Listing = {
      id: String(++this.seq),
      seller,
      title,
      description: String(input?.description ?? ''),
      priceCents,
      status: 'draft',
      buyer: null,
      createdAt: iso,
      updatedAt: iso,
      soldAt: null,
    };
    this.listings.set(listing.id, listing);
    return listing;
  }

  get(id: string): Listing | undefined {
    return this.listings.get(id);
  }

  private require(id: string): Listing {
    const l = this.listings.get(id);
    if (!l) throw new Error('listing not found');
    return l;
  }

  /** Change lifecycle status (publish/unpublish/remove/relist). Selling goes through buy(), not here. */
  setStatus(id: string, to: ListingStatus, now: Date = new Date()): Listing {
    const l = this.require(id);
    if (to === 'sold') throw new Error('use buy() to sell a listing');
    if (l.status === to) return l;
    if (!STATUS_FLOW[l.status].includes(to)) {
      throw new Error('invalid status transition: ' + l.status + ' -> ' + to);
    }
    l.status = to;
    l.updatedAt = now.toISOString();
    return l;
  }

  publish(id: string, now: Date = new Date()): Listing {
    return this.setStatus(id, 'active', now);
  }

  /**
   * Buy an ACTIVE listing. Rejected if the listing is not active (already sold / draft / removed) or if the
   * buyer is the seller. This is the SELL-ONCE guarantee: a sold listing is terminal, so a second buy throws.
   */
  buy(id: string, buyer: string, now: Date = new Date()): Listing {
    const l = this.require(id);
    const who = String(buyer).trim();
    if (!who) throw new Error('buyer is required');
    if (l.status !== 'active') {
      throw new Error(l.status === 'sold' ? 'listing already sold' : 'listing is not available');
    }
    if (l.seller === who) throw new Error('seller cannot buy their own listing');
    l.status = 'sold';
    l.buyer = who;
    l.soldAt = now.toISOString();
    l.updatedAt = l.soldAt;
    return l;
  }

  /** Edit title/description/price. A sold listing is immutable. */
  update(id: string, patch: { title?: string; description?: string; priceCents?: number }, now: Date = new Date()): Listing {
    const l = this.require(id);
    if (l.status === 'sold') throw new Error('a sold listing cannot be edited');
    if (patch.title !== undefined) {
      const t = String(patch.title).trim();
      if (!t) throw new Error('title cannot be empty');
      l.title = t;
    }
    if (patch.description !== undefined) l.description = String(patch.description);
    if (patch.priceCents !== undefined) {
      const p = Math.floor(Number(patch.priceCents));
      if (!Number.isFinite(p) || p < 0) throw new Error('priceCents must be a non-negative number');
      l.priceCents = p;
    }
    l.updatedAt = now.toISOString();
    return l;
  }

  /** Public search — ACTIVE listings only, newest first. Optional case-insensitive title/description query. */
  search(query = ''): Listing[] {
    const q = String(query).trim().toLowerCase();
    return [...this.listings.values()]
      .filter((l) => l.status === 'active')
      .filter((l) => !q || l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** A seller's own listings (any status), newest first. */
  listBySeller(seller: string): Listing[] {
    const who = String(seller).trim();
    return [...this.listings.values()]
      .filter((l) => l.seller === who)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Listings a buyer has purchased. */
  purchasesBy(buyer: string): Listing[] {
    const who = String(buyer).trim();
    return [...this.listings.values()].filter((l) => l.status === 'sold' && l.buyer === who);
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const listings = new ListingService();
`;

export const LISTING_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { listings } from './listingService';

// REST endpoints for the listing service. Mount with: app.use('/api', listingRouter).
export const listingRouter = Router();

// Create a listing (draft). { seller, title, description?, priceCents }.
listingRouter.post('/listings', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { seller?: unknown; title?: unknown; description?: unknown; priceCents?: unknown };
  try {
    return res.status(201).json(listings.create({ seller: String(body.seller ?? ''), title: String(body.title ?? ''), description: String(body.description ?? ''), priceCents: Number(body.priceCents) }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Public search — active listings only (?q=).
listingRouter.get('/listings', (req: Request, res: Response) => {
  return res.status(200).json(listings.search(String((req.query as { q?: string }).q ?? '')));
});

listingRouter.get('/listings/:id', (req: Request, res: Response) => {
  const l = listings.get(req.params.id);
  if (!l) return res.status(404).json({ error: 'listing not found' });
  return res.status(200).json(l);
});

// Change lifecycle status (publish/unpublish/remove/relist). { status } — 409 on an invalid transition.
listingRouter.patch('/listings/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(listings.setStatus(req.params.id, String(body.status ?? '') as 'active'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    if (message === 'listing not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

// Buy a listing. { buyer } — 409 if already sold / unavailable / self-purchase.
listingRouter.post('/listings/:id/buy', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { buyer?: unknown };
  try {
    return res.status(200).json(listings.buy(req.params.id, String(body.buyer ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not buy';
    if (message === 'listing not found') return res.status(404).json({ error: message });
    if (message === 'buyer is required') return res.status(400).json({ error: message });
    return res.status(409).json({ error: message });
  }
});
`;

const LISTING_README = `# Marketplace listings

A real marketplace-listings backend. The core guarantees: a listing follows the **lifecycle**
\`draft → active → sold / removed\`, it can be **sold at most once** (a purchase on a non-active listing is
rejected, and a seller cannot buy their own listing), and only **active** listings are publicly searchable.
Files:

- \`listingService.ts\` — the domain logic (\`ListingService\` + a \`listings\` singleton). In-memory; swap the Maps
  for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { listingRouter } from './server/listings/routes';
app.use('/api', listingRouter);
\`\`\`

Endpoints:
- \`POST /api/listings\` \`{ seller, title, description?, priceCents }\` → creates a **draft**.
- \`GET  /api/listings\` (\`?q=\`) → public search (active only) / \`GET /api/listings/:id\`.
- \`PATCH /api/listings/:id/status\` \`{ status }\` → publish/unpublish/remove/relist (**409** on an invalid transition).
- \`POST /api/listings/:id/buy\` \`{ buyer }\` → **409** if already sold, unavailable, or a self-purchase.

Selling goes through \`buy()\` (not a raw status change) so the sell-once + self-purchase guards always apply.
Take \`seller\` / \`buyer\` from the auth session in production.
`;

export interface ListingsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Marketplace-listings starter wired under server/listings/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is SALE INTEGRITY: a listing follows the lifecycle draft→active→sold/removed ' +
  '(setStatus enforces it), buy() sells an ACTIVE listing AT MOST ONCE (a purchase on a sold/draft/removed ' +
  'listing throws, and a seller cannot buy their own), and search() returns only ACTIVE listings. A sold ' +
  'listing is immutable. routes.ts exposes POST /listings, GET /listings(?q=) + /listings/:id, PATCH ' +
  '/listings/:id/status (409 on invalid transition) and POST /listings/:id/buy (409 on already-sold / ' +
  'unavailable / self-purchase). Mount with app.use("/api", listingRouter). Take seller/buyer from the auth ' +
  'session in production. In-memory by default — swap the Maps for your DB.';

export function generateListingsIntegration(): ListingsConfig {
  return {
    files: {
      'server/listings/listingService.ts': LISTING_SERVICE_SOURCE,
      'server/listings/routes.ts': LISTING_ROUTES_SOURCE,
      'server/listings/README.md': LISTING_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

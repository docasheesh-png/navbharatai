// Real-estate / property-portal domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the established recipe pattern (Crm/Hospital/School/Courier/RestaurantPos). Distinct real
// guarantees (not overlapping the booking/CRM recipes):
//   1. LISTING STATE-MACHINE: a property moves draft → available → under_offer → sold|rented along allowed
//      transitions only; it can be withdrawn from available/under_offer; sold/rented/withdrawn are terminal.
//      An invalid jump is rejected (409).
//   2. APPEND-ONLY PRICE HISTORY: every price change records an immutable {from,to,at} entry, so a
//      listing's price trail is a complete, ordered audit.
//   3. INQUIRY CAPTURE: leads/inquiries are attached to a listing (only while it is still on the market).
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const REAL_ESTATE_SERVICE_SOURCE = `// Real-estate / property-portal domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A listing's status follows an allowed STATE-MACHINE (invalid jumps rejected).
//  2) Every price change is an append-only history entry.
//  3) Inquiries attach to a listing only while it is on the market.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export type ListingStatus = 'draft' | 'available' | 'under_offer' | 'sold' | 'rented' | 'withdrawn';
export type ListingKind = 'sale' | 'rent';

const TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['available', 'withdrawn'],
  available: ['under_offer', 'sold', 'rented', 'withdrawn'],
  under_offer: ['available', 'sold', 'rented', 'withdrawn'],
  sold: [],
  rented: [],
  withdrawn: [],
};

export function canTransition(from: ListingStatus, to: ListingStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface PriceChange { from: number; to: number; at: number; }

export interface Listing {
  id: string;
  title: string;
  kind: ListingKind;
  price: number;
  city: string;
  bedrooms?: number;
  areaSqft?: number;
  status: ListingStatus;
  priceHistory: PriceChange[];
  createdAt: number;
}

export interface Inquiry {
  id: string;
  listingId: string;
  name: string;
  phone: string;
  message?: string;
  at: number;
}

export class InvalidTransitionError extends Error {
  constructor(from: ListingStatus, to: ListingStatus) {
    super(\`Invalid listing transition \${from} → \${to}\`);
    this.name = 'InvalidTransitionError';
  }
}
export class ListingClosedError extends Error {
  constructor() { super('This listing is no longer on the market — it cannot take inquiries or price changes'); this.name = 'ListingClosedError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;
const isOnMarket = (s: ListingStatus): boolean => s === 'draft' || s === 'available' || s === 'under_offer';

export class RealEstateService {
  private listings = new Map<string, Listing>();
  private inquiries = new Map<string, Inquiry>();

  createListing(data: { title: string; kind: ListingKind; price: number; city: string; bedrooms?: number; areaSqft?: number }): Listing {
    if (!data.title?.trim()) throw new Error('Listing title is required');
    if (!(data.price >= 0)) throw new Error('Listing price must be >= 0');
    if (data.kind !== 'sale' && data.kind !== 'rent') throw new Error('kind must be "sale" or "rent"');
    const listing: Listing = {
      id: nextId('lst'), title: data.title.trim(), kind: data.kind, price: data.price, city: data.city,
      bedrooms: data.bedrooms, areaSqft: data.areaSqft, status: 'draft', priceHistory: [], createdAt: Date.now(),
    };
    this.listings.set(listing.id, listing);
    return listing;
  }

  setStatus(id: string, to: ListingStatus): Listing {
    const l = this.listings.get(id);
    if (!l) throw new Error(\`Unknown listing \${id}\`);
    if (!canTransition(l.status, to)) throw new InvalidTransitionError(l.status, to);
    l.status = to;
    return l;
  }

  changePrice(id: string, newPrice: number): Listing {
    const l = this.listings.get(id);
    if (!l) throw new Error(\`Unknown listing \${id}\`);
    if (!isOnMarket(l.status)) throw new ListingClosedError();
    if (!(newPrice >= 0)) throw new Error('Price must be >= 0');
    if (newPrice !== l.price) {
      l.priceHistory.push({ from: l.price, to: newPrice, at: Date.now() });
      l.price = newPrice;
    }
    return l;
  }

  addInquiry(listingId: string, data: { name: string; phone: string; message?: string }): Inquiry {
    const l = this.listings.get(listingId);
    if (!l) throw new Error(\`Unknown listing \${listingId}\`);
    if (!isOnMarket(l.status)) throw new ListingClosedError();
    if (!data.name?.trim() || !data.phone?.trim()) throw new Error('Inquiry name and phone are required');
    const inq: Inquiry = { id: nextId('inq'), listingId, name: data.name.trim(), phone: data.phone.trim(), message: data.message, at: Date.now() };
    this.inquiries.set(inq.id, inq);
    return inq;
  }

  inquiriesFor(listingId: string): Inquiry[] {
    return [...this.inquiries.values()].filter((i) => i.listingId === listingId).sort((a, b) => a.at - b.at);
  }

  get(id: string): Listing | undefined { return this.listings.get(id); }
  priceHistory(id: string): PriceChange[] { return [...(this.listings.get(id)?.priceHistory ?? [])]; }

  search(filter?: { city?: string; kind?: ListingKind; status?: ListingStatus; maxPrice?: number; minBedrooms?: number }): Listing[] {
    return [...this.listings.values()].filter((l) =>
      (!filter?.city || l.city.toLowerCase() === filter.city.toLowerCase()) &&
      (!filter?.kind || l.kind === filter.kind) &&
      (!filter?.status || l.status === filter.status) &&
      (filter?.maxPrice === undefined || l.price <= filter.maxPrice) &&
      (filter?.minBedrooms === undefined || (l.bedrooms ?? 0) >= filter.minBedrooms),
    ).sort((a, b) => a.createdAt - b.createdAt);
  }
}

export const realEstate = new RealEstateService();
`;

export const REAL_ESTATE_ROUTES_SOURCE = `import { Router } from 'express';
import { realEstate, InvalidTransitionError, ListingClosedError } from './realEstateService';

export const realEstateRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof InvalidTransitionError || e instanceof ListingClosedError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

realEstateRouter.get('/listings', (req, res) => handle(res, () => realEstate.search({
  city: req.query.city as string | undefined,
  kind: req.query.kind as never,
  status: req.query.status as never,
  maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
  minBedrooms: req.query.minBedrooms ? Number(req.query.minBedrooms) : undefined,
})));
realEstateRouter.post('/listings', (req, res) => handle(res, () => realEstate.createListing(req.body)));
realEstateRouter.get('/listings/:id', (req, res) => handle(res, () => realEstate.get(req.params.id)));
realEstateRouter.patch('/listings/:id/status', (req, res) => handle(res, () => realEstate.setStatus(req.params.id, req.body?.status))); // 409 on invalid
realEstateRouter.patch('/listings/:id/price', (req, res) => handle(res, () => realEstate.changePrice(req.params.id, Number(req.body?.price)))); // 409 if off-market
realEstateRouter.get('/listings/:id/price-history', (req, res) => handle(res, () => realEstate.priceHistory(req.params.id)));
realEstateRouter.post('/listings/:id/inquiries', (req, res) => handle(res, () => realEstate.addInquiry(req.params.id, req.body))); // 409 if off-market
realEstateRouter.get('/listings/:id/inquiries', (req, res) => handle(res, () => realEstate.inquiriesFor(req.params.id)));
`;

export const REAL_ESTATE_README = `# Real-estate / property-portal starter

A dependency-free real-estate backend under \`server/realestate/\`, wired for Express.

## Real guarantees (not a stub)
- **Listing state-machine** — status moves \`draft → available → under_offer → sold|rented\` along allowed
  transitions only; a listing can be \`withdrawn\` from the market; \`sold\`/\`rented\`/\`withdrawn\` are terminal.
  An invalid jump is rejected (**409**).
- **Append-only price history** — every price change records an immutable \`{from,to,at}\` entry.
- **Inquiry capture** — inquiries (and price changes) are accepted only while the listing is on the
  market (draft/available/under_offer); an off-market listing rejects them (**409**).

## Endpoints (mount with \`app.use("/api", realEstateRouter)\`)
- \`GET /listings\` (filter by city/kind/status/maxPrice/minBedrooms), \`POST /listings\`, \`GET /listings/:id\`
- \`PATCH /listings/:id/status\` (**409** on invalid), \`PATCH /listings/:id/price\` (**409** if off-market),
  \`GET /listings/:id/price-history\`
- \`POST /listings/:id/inquiries\` (**409** if off-market), \`GET /listings/:id/inquiries\`

In-memory by default; swap the Maps in \`realEstateService.ts\` for your DB. Pairs with the auth/notification/maps recipes.
`;

export interface RealEstateConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Real-estate / property-portal starter wired under server/realestate/ (dependency-free domain logic + an ' +
  'Express router). Three real guarantees: (1) LISTING STATE-MACHINE — draft → available → under_offer → ' +
  'sold|rented along allowed transitions only (withdraw from market; sold/rented/withdrawn terminal), invalid ' +
  'jumps rejected (409); (2) APPEND-ONLY price history — every price change logs {from,to,at}; (3) INQUIRY ' +
  'CAPTURE — inquiries + price changes accepted only while on-market (409 otherwise). Endpoints: GET/POST ' +
  '/listings, GET /listings/:id, PATCH /listings/:id/status, PATCH /listings/:id/price, GET ' +
  '/listings/:id/price-history, POST/GET /listings/:id/inquiries. Mount with app.use("/api", realEstateRouter). ' +
  'In-memory by default — swap the Maps for your DB, same contracts. Pairs with the auth/notification/maps recipes. No key.';

export function generateRealEstateIntegration(): RealEstateConfig {
  return {
    files: {
      'server/realestate/realEstateService.ts': REAL_ESTATE_SERVICE_SOURCE,
      'server/realestate/routes.ts': REAL_ESTATE_ROUTES_SOURCE,
      'server/realestate/README.md': REAL_ESTATE_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

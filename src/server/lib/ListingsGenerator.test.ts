import { describe, it, expect, afterAll } from 'vitest';

import { generateListingsIntegration, LISTING_SERVICE_SOURCE } from './ListingsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateListingsIntegration (wiring)', () => {
  it('emits the listing service, routes and README', () => {
    const out = generateListingsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/listings/listingService.ts');
    expect(paths).toContain('server/listings/routes.ts');
    expect(paths).toContain('server/listings/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/listings/routes.ts']).toContain('export const listingRouter');
    expect(out.files['server/listings/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the lifecycle + sell-once rules are real business rules,
// verified against the actual emitted code.
describe('emitted ListingService — lifecycle + sell-once (real logic)', () => {
  const emitted = emitModule('listing', LISTING_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Status = 'draft' | 'active' | 'sold' | 'removed';
  interface Listing { id: string; seller: string; status: Status; buyer: string | null; title: string; priceCents: number }
  interface Service {
    create(i: { seller: string; title: string; description?: string; priceCents: number }, now?: Date): Listing;
    get(id: string): Listing | undefined;
    setStatus(id: string, to: Status, now?: Date): Listing;
    publish(id: string, now?: Date): Listing;
    buy(id: string, buyer: string, now?: Date): Listing;
    update(id: string, patch: { title?: string; description?: string; priceCents?: number }, now?: Date): Listing;
    search(query?: string): Listing[];
    listBySeller(seller: string): Listing[];
    purchasesBy(buyer: string): Listing[];
  }
  interface Emitted { ListingService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('creates a draft; only ACTIVE listings are publicly searchable', async () => {
    const { ListingService } = await load();
    const svc = new ListingService();
    const l = svc.create({ seller: 'alice', title: 'Bike', priceCents: 5000 });
    expect(l.status).toBe('draft');
    expect(svc.search().length).toBe(0); // a draft is not public
    svc.publish(l.id);
    expect(svc.search().map((x) => x.id)).toEqual([l.id]);
    expect(svc.search('bike').length).toBe(1); // query matches title
    expect(svc.search('car').length).toBe(0);
  });

  it('sells an active listing AT MOST ONCE — a second buy is rejected', async () => {
    const { ListingService } = await load();
    const svc = new ListingService();
    const l = svc.create({ seller: 'alice', title: 'Bike', priceCents: 5000 });
    // cannot buy a draft
    expect(() => svc.buy(l.id, 'bob')).toThrow(/not available/);
    svc.publish(l.id);
    // seller cannot buy their own
    expect(() => svc.buy(l.id, 'alice')).toThrow(/seller cannot buy/);
    const sold = svc.buy(l.id, 'bob');
    expect(sold).toMatchObject({ status: 'sold', buyer: 'bob' });
    // a second purchase is rejected — no double-sale
    expect(() => svc.buy(l.id, 'carol')).toThrow(/already sold/);
    // and it drops out of public search + is recorded as bob's purchase
    expect(svc.search().length).toBe(0);
    expect(svc.purchasesBy('bob').map((x) => x.id)).toEqual([l.id]);
  });

  it('enforces the lifecycle state-machine; sold is terminal', async () => {
    const { ListingService } = await load();
    const svc = new ListingService();
    const l = svc.create({ seller: 'alice', title: 'X', priceCents: 100 });
    // cannot set status directly to sold
    expect(() => svc.setStatus(l.id, 'sold')).toThrow(/use buy/);
    svc.publish(l.id);
    svc.buy(l.id, 'bob'); // now sold (terminal)
    expect(() => svc.setStatus(l.id, 'active')).toThrow(/invalid status transition/);
    // a removed listing can be relisted as a draft
    const l2 = svc.create({ seller: 'alice', title: 'Y', priceCents: 100 });
    svc.setStatus(l2.id, 'removed');
    expect(svc.setStatus(l2.id, 'draft').status).toBe('draft');
  });

  it('a sold listing is immutable; validates input', async () => {
    const { ListingService } = await load();
    const svc = new ListingService();
    expect(() => svc.create({ seller: '', title: 'X', priceCents: 1 })).toThrow(/seller is required/);
    expect(() => svc.create({ seller: 'a', title: 'X', priceCents: -1 })).toThrow(/non-negative/);
    const l = svc.create({ seller: 'alice', title: 'X', priceCents: 100 });
    expect(svc.update(l.id, { priceCents: 200 }).priceCents).toBe(200);
    svc.publish(l.id);
    svc.buy(l.id, 'bob');
    expect(() => svc.update(l.id, { priceCents: 300 })).toThrow(/sold listing cannot be edited/);
  });

  it('listBySeller returns a seller\\u2019s own listings across every status', async () => {
    const { ListingService } = await load();
    const svc = new ListingService();
    svc.create({ seller: 'alice', title: 'A', priceCents: 100 });
    const b = svc.create({ seller: 'alice', title: 'B', priceCents: 200 });
    svc.create({ seller: 'bob', title: 'C', priceCents: 300 });
    svc.publish(b.id);
    expect(svc.listBySeller('alice').length).toBe(2); // both, regardless of status
    expect(svc.listBySeller('bob').length).toBe(1);
  });
});

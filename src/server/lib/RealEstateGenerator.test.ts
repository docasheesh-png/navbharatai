import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateRealEstateIntegration, REAL_ESTATE_SERVICE_SOURCE } from './RealEstateGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateRealEstateIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateRealEstateIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/realestate/realEstateService.ts');
    expect(paths).toContain('server/realestate/routes.ts');
    expect(paths).toContain('server/realestate/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/realestate/routes.ts']).toContain('409');
    expect(out.files['server/realestate/routes.ts']).toContain('export const realEstateRouter');
  });
});

describe('emitted RealEstateService — real domain invariants', () => {
  const artifact = join(here, `._realestate_emitted_${process.pid}.ts`);
  writeFileSync(artifact, REAL_ESTATE_SERVICE_SOURCE);
  afterAll(() => { try { unlinkSync(artifact); } catch { /* gone */ } });

  type Status = 'draft' | 'available' | 'under_offer' | 'sold' | 'rented' | 'withdrawn';
  interface Listing { id: string; status: Status; price: number; priceHistory: unknown[] }
  interface Service {
    createListing(d: { title: string; kind: string; price: number; city: string; bedrooms?: number }): Listing;
    setStatus(id: string, to: Status): Listing;
    changePrice(id: string, p: number): Listing;
    addInquiry(id: string, d: { name: string; phone: string }): { id: string };
    inquiriesFor(id: string): unknown[];
    priceHistory(id: string): Array<{ from: number; to: number }>;
    search(f?: { city?: string; maxPrice?: number }): Listing[];
  }
  interface Emitted { RealEstateService: new () => Service; canTransition(a: Status, b: Status): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }
  async function seed() {
    const { RealEstateService } = await load();
    const svc = new RealEstateService();
    const l = svc.createListing({ title: '2BHK Baner', kind: 'sale', price: 8000000, city: 'Pune', bedrooms: 2 });
    return { svc, l };
  }

  it('canTransition encodes the allowed state-machine (sold is terminal, no skipping to sold from draft is fine but draft→rented is not)', async () => {
    const { canTransition } = await load();
    expect(canTransition('draft', 'available')).toBe(true);
    expect(canTransition('available', 'under_offer')).toBe(true);
    expect(canTransition('under_offer', 'sold')).toBe(true);
    expect(canTransition('draft', 'under_offer')).toBe(false);
    expect(canTransition('sold', 'available')).toBe(false); // terminal
  });

  it('walks draft→available→under_offer→sold and REJECTS an invalid jump', async () => {
    const { svc, l } = await seed();
    expect(l.status).toBe('draft');
    expect(() => svc.setStatus(l.id, 'sold')).toThrow(/Invalid listing transition/); // draft can't go straight to sold
    svc.setStatus(l.id, 'available');
    svc.setStatus(l.id, 'under_offer');
    expect(svc.setStatus(l.id, 'sold').status).toBe('sold');
    expect(() => svc.setStatus(l.id, 'available')).toThrow(/Invalid listing transition/); // sold is terminal
  });

  it('price changes are APPEND-ONLY history; unchanged price adds nothing', async () => {
    const { svc, l } = await seed();
    svc.setStatus(l.id, 'available');
    svc.changePrice(l.id, 7500000);
    svc.changePrice(l.id, 7500000); // same → no new entry
    svc.changePrice(l.id, 7000000);
    const h = svc.priceHistory(l.id);
    expect(h.map((e) => e.to)).toEqual([7500000, 7000000]);
    expect(h[0].from).toBe(8000000);
  });

  it('an OFF-MARKET listing rejects inquiries and price changes (409-class)', async () => {
    const { svc, l } = await seed();
    svc.setStatus(l.id, 'available');
    svc.addInquiry(l.id, { name: 'Asha', phone: '9999999999' }); // ok while on-market
    svc.setStatus(l.id, 'sold');
    expect(() => svc.addInquiry(l.id, { name: 'Ravi', phone: '8888888888' })).toThrow(/no longer on the market/);
    expect(() => svc.changePrice(l.id, 100)).toThrow(/no longer on the market/);
  });

  it('search filters by city + maxPrice', async () => {
    const { svc } = await seed();
    svc.createListing({ title: '3BHK Wakad', kind: 'sale', price: 12000000, city: 'Pune' });
    svc.createListing({ title: '1BHK Andheri', kind: 'rent', price: 30000, city: 'Mumbai' });
    expect(svc.search({ city: 'Pune' }).length).toBe(2);
    expect(svc.search({ city: 'Pune', maxPrice: 9000000 }).length).toBe(1);
  });
});

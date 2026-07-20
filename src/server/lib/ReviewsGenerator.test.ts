import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateReviewsIntegration, REVIEW_SERVICE_SOURCE } from './ReviewsGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateReviewsIntegration (wiring)', () => {
  it('emits the review service, routes and README', () => {
    const out = generateReviewsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/reviews/reviewService.ts');
    expect(paths).toContain('server/reviews/routes.ts');
    expect(paths).toContain('server/reviews/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/reviews/routes.ts']).toContain('export const reviewRouter');
  });
});

// Materialize + execute the emitted domain logic — the rating bounds, one-per-user rule and exact aggregate
// are real business rules, verified against the actual emitted code.
describe('emitted ReviewService — rating integrity + exact aggregate (real logic)', () => {
  const artifact = join(here, `._review_emitted_${process.pid}.ts`);
  writeFileSync(artifact, REVIEW_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Review { id: string; itemId: string; userId: string; rating: number }
  interface Agg { itemId: string; count: number; average: number; distribution: Record<string, number> }
  interface Service {
    submit(i: { itemId: string; userId: string; rating: number; title?: string; body?: string }, now?: Date): Review;
    get(id: string): Review | undefined;
    getByUser(itemId: string, userId: string): Review | undefined;
    remove(id: string): boolean;
    listForItem(itemId: string): Review[];
    aggregate(itemId: string): Agg;
  }
  interface Emitted { ReviewService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('rejects a rating outside 1..5 (and non-integers)', async () => {
    const { ReviewService } = await load();
    const svc = new ReviewService();
    expect(() => svc.submit({ itemId: 'p1', userId: 'u1', rating: 0 })).toThrow(/1 to 5/);
    expect(() => svc.submit({ itemId: 'p1', userId: 'u1', rating: 6 })).toThrow(/1 to 5/);
    expect(() => svc.submit({ itemId: 'p1', userId: 'u1', rating: 3.5 })).toThrow(/1 to 5/);
    expect(svc.submit({ itemId: 'p1', userId: 'u1', rating: 5 }).rating).toBe(5);
  });

  it('enforces one review per (item, user) — a resubmit UPDATES, never double-counts', async () => {
    const { ReviewService } = await load();
    const svc = new ReviewService();
    const a = svc.submit({ itemId: 'p1', userId: 'u1', rating: 5, title: 'Great' });
    const b = svc.submit({ itemId: 'p1', userId: 'u1', rating: 2, title: 'Changed my mind' });
    expect(b.id).toBe(a.id); // same review updated
    expect(svc.listForItem('p1').length).toBe(1);
    expect(svc.getByUser('p1', 'u1')?.rating).toBe(2);
    // the average reflects only the latest score, count stays 1
    expect(svc.aggregate('p1')).toMatchObject({ count: 1, average: 2 });
  });

  it('computes the aggregate EXACTLY (average 2dp + star distribution)', async () => {
    const { ReviewService } = await load();
    const svc = new ReviewService();
    svc.submit({ itemId: 'p1', userId: 'u1', rating: 5 });
    svc.submit({ itemId: 'p1', userId: 'u2', rating: 4 });
    svc.submit({ itemId: 'p1', userId: 'u3', rating: 4 });
    svc.submit({ itemId: 'p1', userId: 'u4', rating: 1 });
    // a different item's review must not leak into p1's aggregate
    svc.submit({ itemId: 'p2', userId: 'u1', rating: 3 });
    const agg = svc.aggregate('p1');
    expect(agg.count).toBe(4);
    expect(agg.average).toBe(3.5); // (5+4+4+1)/4
    expect(agg.distribution).toEqual({ '1': 1, '2': 0, '3': 0, '4': 2, '5': 1 });
    // an item with no reviews → count 0, average 0
    expect(svc.aggregate('nope')).toMatchObject({ count: 0, average: 0 });
  });

  it('remove deletes the review and frees the (item,user) slot for a fresh review', async () => {
    const { ReviewService } = await load();
    const svc = new ReviewService();
    const r = svc.submit({ itemId: 'p1', userId: 'u1', rating: 5 });
    expect(svc.remove(r.id)).toBe(true);
    expect(svc.remove(r.id)).toBe(false); // already gone
    expect(svc.aggregate('p1').count).toBe(0);
    // after removal the user can submit a brand-new review (new id)
    const fresh = svc.submit({ itemId: 'p1', userId: 'u1', rating: 3 });
    expect(fresh.id).not.toBe(r.id);
  });

  it('validates required fields', async () => {
    const { ReviewService } = await load();
    const svc = new ReviewService();
    expect(() => svc.submit({ itemId: '', userId: 'u1', rating: 5 })).toThrow(/itemId is required/);
    expect(() => svc.submit({ itemId: 'p1', userId: '', rating: 5 })).toThrow(/userId is required/);
  });
});

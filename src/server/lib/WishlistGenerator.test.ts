import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateWishlistIntegration, WISHLIST_SERVICE_SOURCE } from './WishlistGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateWishlistIntegration (wiring)', () => {
  it('emits the favorites service, routes and README', () => {
    const out = generateWishlistIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/favorites/favoritesService.ts');
    expect(paths).toContain('server/favorites/routes.ts');
    expect(paths).toContain('server/favorites/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/favorites/routes.ts']).toContain('export const favoritesRouter');
  });
});

// Materialize + execute the emitted domain logic — the idempotency + exact-count rules are real business
// rules, verified against the actual emitted code.
describe('emitted FavoritesService — idempotent membership + exact count (real logic)', () => {
  const artifact = join(here, `._favorites_emitted_${process.pid}.ts`);
  writeFileSync(artifact, WISHLIST_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Favorite { user: string; item: string; collection: string }
  interface Service {
    add(user: string, item: string, collection?: string, now?: Date): { favorite: Favorite; added: boolean };
    remove(user: string, item: string, collection?: string): { removed: boolean };
    toggle(user: string, item: string, collection?: string, now?: Date): { favorited: boolean };
    has(user: string, item: string, collection?: string): boolean;
    listByUser(user: string, collection?: string): Favorite[];
    countForItem(item: string, collection?: string): number;
    usersForItem(item: string, collection?: string): string[];
  }
  interface Emitted { FavoritesService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('add is IDEMPOTENT — favoriting twice does not create a second entry', async () => {
    const { FavoritesService } = await load();
    const svc = new FavoritesService();
    expect(svc.add('alice', 'p1').added).toBe(true);
    expect(svc.add('alice', 'p1').added).toBe(false); // already favorited → no-op
    expect(svc.listByUser('alice').length).toBe(1);
    expect(svc.countForItem('p1')).toBe(1);
    expect(svc.has('alice', 'p1')).toBe(true);
  });

  it('remove is idempotent; the exact per-item count reflects distinct users', async () => {
    const { FavoritesService } = await load();
    const svc = new FavoritesService();
    svc.add('alice', 'p1');
    svc.add('bob', 'p1');
    svc.add('bob', 'p1'); // duplicate → still 1 for bob
    expect(svc.countForItem('p1')).toBe(2);
    expect(svc.usersForItem('p1').sort()).toEqual(['alice', 'bob']);
    expect(svc.remove('alice', 'p1').removed).toBe(true);
    expect(svc.remove('alice', 'p1').removed).toBe(false); // idempotent
    expect(svc.countForItem('p1')).toBe(1);
  });

  it('toggle flips the state deterministically', async () => {
    const { FavoritesService } = await load();
    const svc = new FavoritesService();
    expect(svc.toggle('alice', 'p1').favorited).toBe(true);
    expect(svc.has('alice', 'p1')).toBe(true);
    expect(svc.toggle('alice', 'p1').favorited).toBe(false);
    expect(svc.has('alice', 'p1')).toBe(false);
  });

  it('collections are independent namespaces (wishlist vs likes vs bookmarks)', async () => {
    const { FavoritesService } = await load();
    const svc = new FavoritesService();
    svc.add('alice', 'p1', 'wishlist');
    svc.add('alice', 'p1', 'likes');
    // same (user,item) in two collections → two independent entries
    expect(svc.has('alice', 'p1', 'wishlist')).toBe(true);
    expect(svc.has('alice', 'p1', 'likes')).toBe(true);
    expect(svc.countForItem('p1', 'wishlist')).toBe(1);
    expect(svc.countForItem('p1', 'likes')).toBe(1);
    expect(svc.listByUser('alice', 'wishlist').length).toBe(1);
    // default collection is 'wishlist'
    expect(svc.has('alice', 'p1')).toBe(true);
  });

  it('validates required input', async () => {
    const { FavoritesService } = await load();
    const svc = new FavoritesService();
    expect(() => svc.add('', 'p1')).toThrow(/user is required/);
    expect(() => svc.add('alice', '')).toThrow(/item is required/);
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCollectionsIntegration, COLLECTIONS_SERVICE_SOURCE } from './CollectionsGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateCollectionsIntegration (wiring)', () => {
  it('emits the collection service, routes and README', () => {
    const out = generateCollectionsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/collections/collectionService.ts');
    expect(paths).toContain('server/collections/routes.ts');
    expect(paths).toContain('server/collections/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/collections/routes.ts']).toContain('export const collectionRouter');
    expect(out.files['server/collections/routes.ts']).toContain('/items');
  });
});

// Materialize + execute the emitted domain logic — the multi-membership + idempotency rules are real business
// rules, verified against the actual emitted code.
describe('emitted CollectionService — multi-collection membership + idempotency (real logic)', () => {
  const artifact = join(here, `._collections_emitted_${process.pid}.ts`);
  writeFileSync(artifact, COLLECTIONS_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Collection { id: string; ownerId: string; name: string; createdAt: string }
  interface CollectionView extends Collection { itemCount: number; itemIds: string[] }
  interface Service {
    create(ownerId: string, name: string, now?: Date): Collection;
    rename(collectionId: string, name: string): Collection;
    remove(collectionId: string): boolean;
    saveItem(collectionId: string, itemId: string): boolean;
    removeItem(collectionId: string, itemId: string): boolean;
    contains(collectionId: string, itemId: string): boolean;
    collectionsForItem(ownerId: string, itemId: string): Collection[];
    view(collectionId: string): CollectionView;
    listForOwner(ownerId: string): CollectionView[];
  }
  interface Emitted { CollectionService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('saving the same item twice is idempotent (exact count, no duplicate)', async () => {
    const { CollectionService } = await load();
    const svc = new CollectionService();
    const c = svc.create('alice', 'Recipes');
    expect(svc.saveItem(c.id, 'item1')).toBe(true);  // newly added
    expect(svc.saveItem(c.id, 'item1')).toBe(false); // repeat — no-op
    expect(svc.saveItem(c.id, 'item2')).toBe(true);
    const view = svc.view(c.id);
    expect(view.itemCount).toBe(2);
    expect(view.itemIds).toEqual(['item2', 'item1']); // newest saved first, no dupes
  });

  it('THE INVARIANT: an item lives in MANY collections; removing from one leaves the others intact', async () => {
    const { CollectionService } = await load();
    const svc = new CollectionService();
    const a = svc.create('alice', 'Board A');
    const b = svc.create('alice', 'Board B');
    svc.saveItem(a.id, 'shared');
    svc.saveItem(b.id, 'shared');
    expect(svc.contains(a.id, 'shared')).toBe(true);
    expect(svc.contains(b.id, 'shared')).toBe(true);
    // the many-to-many lookup finds both
    expect(svc.collectionsForItem('alice', 'shared').map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    // remove from A only
    expect(svc.removeItem(a.id, 'shared')).toBe(true);
    expect(svc.contains(a.id, 'shared')).toBe(false);
    expect(svc.contains(b.id, 'shared')).toBe(true); // B untouched
    expect(svc.collectionsForItem('alice', 'shared').map((c) => c.id)).toEqual([b.id]);
  });

  it('collection names are unique per owner (but different owners may reuse a name)', async () => {
    const { CollectionService } = await load();
    const svc = new CollectionService();
    svc.create('alice', 'Favorites');
    expect(() => svc.create('alice', 'favorites')).toThrow(/already exists/); // case-insensitive clash
    expect(() => svc.create('bob', 'Favorites')).not.toThrow();               // different owner ok
  });

  it('deleting a collection does not affect the same item saved in another', async () => {
    const { CollectionService } = await load();
    const svc = new CollectionService();
    const a = svc.create('u', 'A');
    const b = svc.create('u', 'B');
    svc.saveItem(a.id, 'x');
    svc.saveItem(b.id, 'x');
    expect(svc.remove(a.id)).toBe(true);
    expect(() => svc.view(a.id)).toThrow(/collection not found/);
    expect(svc.contains(b.id, 'x')).toBe(true); // still in B
  });

  it('listForOwner returns the owner collections newest-first with exact counts; validates input', async () => {
    const { CollectionService } = await load();
    const svc = new CollectionService();
    const a = svc.create('alice', 'First', new Date('2026-01-01T00:00:00Z'));
    const b = svc.create('alice', 'Second', new Date('2026-02-01T00:00:00Z'));
    svc.create('bob', 'Other');
    svc.saveItem(a.id, 'i1');
    svc.saveItem(b.id, 'i1');
    svc.saveItem(b.id, 'i2');
    const list = svc.listForOwner('alice');
    expect(list.map((c) => c.id)).toEqual([b.id, a.id]); // newest first
    expect(list.find((c) => c.id === b.id)?.itemCount).toBe(2);
    expect(() => svc.create('', 'x')).toThrow(/ownerId is required/);
    expect(() => svc.saveItem('nope', 'x')).toThrow(/collection not found/);
  });
});

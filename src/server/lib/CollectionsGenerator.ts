// Roadmap breadth — saved collections / boards starter (a packaged domain vertical).
//
// Pinterest-style boards / "save to collection": a user organizes saved items into named collections. The real
// feature is MEMBERSHIP INTEGRITY: an item can belong to MANY collections at once, saving the same item to a
// collection twice is idempotent (no duplicate, exact itemCount), removing it from one collection never affects
// the others, and each collection's item list has no duplicates. This emits a dependency-free CollectionService
// (no crypto/deps) + an Express router + a README. Real logic, not a stub — the multi-membership + idempotency
// rules are unit-tested against the emitted code. Pure builder → the caller writes the files. Distinct from
// generate_wishlist (a single flat list per user) and generate_tags (labels on one entity).

export const COLLECTIONS_SERVICE_SOURCE = `// Saved-collections domain logic. The core guarantees: (1) an item can belong to MANY collections at once;
// (2) saving the same item to a collection twice is IDEMPOTENT (no duplicate, exact itemCount); (3) removing an
// item from one collection never affects the others; and (4) a collection's item list is always duplicate-free
// and ordered newest-saved-first. Collections are scoped per owner (userId). In-memory here; swap the Maps for
// your database, keeping the same method contracts.

export interface Collection {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

export interface CollectionView extends Collection {
  itemCount: number;
  itemIds: string[]; // newest-saved first
}

let counter = 0;
function nextId(now: Date): string {
  counter += 1;
  return 'col_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class CollectionService {
  private collections = new Map<string, Collection>();
  // collectionId -> ordered list of itemIds (kept duplicate-free; index 0 = most recently saved)
  private members = new Map<string, string[]>();

  /** Create a collection for an owner. Names are unique per owner (case-insensitive). */
  create(ownerId: string, name: string, now: Date = new Date()): Collection {
    const owner = String(ownerId ?? '').trim();
    if (!owner) throw new Error('ownerId is required');
    const label = String(name ?? '').trim();
    if (!label) throw new Error('name is required');
    for (const c of this.collections.values()) {
      if (c.ownerId === owner && c.name.toLowerCase() === label.toLowerCase()) {
        throw new Error('a collection with that name already exists');
      }
    }
    const col: Collection = { id: nextId(now), ownerId: owner, name: label, createdAt: now.toISOString() };
    this.collections.set(col.id, col);
    this.members.set(col.id, []);
    return { ...col };
  }

  rename(collectionId: string, name: string): Collection {
    const col = this.collections.get(String(collectionId ?? '').trim());
    if (!col) throw new Error('collection not found');
    const label = String(name ?? '').trim();
    if (!label) throw new Error('name cannot be empty');
    for (const c of this.collections.values()) {
      if (c.id !== col.id && c.ownerId === col.ownerId && c.name.toLowerCase() === label.toLowerCase()) {
        throw new Error('a collection with that name already exists');
      }
    }
    col.name = label;
    return { ...col };
  }

  /** Delete a collection (and its membership list). The items themselves are untouched elsewhere. */
  remove(collectionId: string): boolean {
    const id = String(collectionId ?? '').trim();
    this.members.delete(id);
    return this.collections.delete(id);
  }

  /** Save an item into a collection. Idempotent — a repeat save does not duplicate. Returns true if newly added. */
  saveItem(collectionId: string, itemId: string): boolean {
    const id = String(collectionId ?? '').trim();
    const list = this.members.get(id);
    if (!list) throw new Error('collection not found');
    const item = String(itemId ?? '').trim();
    if (!item) throw new Error('itemId is required');
    if (list.includes(item)) return false; // already saved — idempotent
    list.unshift(item);                     // newest first
    return true;
  }

  /** Remove an item from ONE collection. Does not affect the same item in other collections. */
  removeItem(collectionId: string, itemId: string): boolean {
    const list = this.members.get(String(collectionId ?? '').trim());
    if (!list) throw new Error('collection not found');
    const item = String(itemId ?? '').trim();
    const i = list.indexOf(item);
    if (i === -1) return false;
    list.splice(i, 1);
    return true;
  }

  /** Is an item in a given collection? */
  contains(collectionId: string, itemId: string): boolean {
    return this.members.get(String(collectionId ?? '').trim())?.includes(String(itemId ?? '').trim()) ?? false;
  }

  /** Every collection (of a given owner) that contains this item — the many-to-many lookup. */
  collectionsForItem(ownerId: string, itemId: string): Collection[] {
    const owner = String(ownerId ?? '').trim();
    const item = String(itemId ?? '').trim();
    const out: Collection[] = [];
    for (const col of this.collections.values()) {
      if (col.ownerId === owner && (this.members.get(col.id) ?? []).includes(item)) out.push({ ...col });
    }
    return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  view(collectionId: string): CollectionView {
    const col = this.collections.get(String(collectionId ?? '').trim());
    if (!col) throw new Error('collection not found');
    const itemIds = [...(this.members.get(col.id) ?? [])];
    return { ...col, itemCount: itemIds.length, itemIds };
  }

  /** An owner's collections, newest first, each with its item count. */
  listForOwner(ownerId: string): CollectionView[] {
    const owner = String(ownerId ?? '').trim();
    return [...this.collections.values()]
      .filter((c) => c.ownerId === owner)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((c) => ({ ...c, itemCount: (this.members.get(c.id) ?? []).length, itemIds: [...(this.members.get(c.id) ?? [])] }));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const collections = new CollectionService();
`;

export const COLLECTIONS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { collections } from './collectionService';

// REST endpoints for saved collections. Mount with: app.use('/api/collections', collectionRouter).
// In production take the ownerId from the auth session, not the URL/body.
export const collectionRouter = Router();

// An owner's collections. ?owner=<id>.
collectionRouter.get('/', (req: Request, res: Response) => {
  const owner = String(req.query.owner ?? '').trim();
  if (!owner) return res.status(400).json({ error: 'owner is required' });
  return res.status(200).json(collections.listForOwner(owner));
});

// Create a collection. { ownerId, name }.
collectionRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { ownerId?: unknown; name?: unknown };
  try {
    return res.status(201).json(collections.create(String(body.ownerId ?? ''), String(body.name ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message.includes('already exists') ? 409 : 400).json({ error: message });
  }
});

// One collection with its items.
collectionRouter.get('/:id', (req: Request, res: Response) => {
  try {
    return res.status(200).json(collections.view(req.params.id));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'collection not found' });
  }
});

// Rename. { name }.
collectionRouter.patch('/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown };
  try {
    return res.status(200).json(collections.rename(req.params.id, String(body.name ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'collection not found') return res.status(404).json({ error: message });
    return res.status(message.includes('already exists') ? 409 : 400).json({ error: message });
  }
});

collectionRouter.delete('/:id', (req: Request, res: Response) => {
  if (!collections.remove(req.params.id)) return res.status(404).json({ error: 'collection not found' });
  return res.status(204).send();
});

// Save an item into a collection. { itemId }.
collectionRouter.post('/:id/items', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { itemId?: unknown };
  try {
    collections.saveItem(req.params.id, String(body.itemId ?? ''));
    return res.status(200).json(collections.view(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'collection not found' ? 404 : 400).json({ error: message });
  }
});

// Remove an item from a collection.
collectionRouter.delete('/:id/items/:itemId', (req: Request, res: Response) => {
  try {
    collections.removeItem(req.params.id, req.params.itemId);
    return res.status(200).json(collections.view(req.params.id));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'collection not found' });
  }
});
`;

const COLLECTIONS_README = `# Saved collections / boards

A real "save to collection" backend (Pinterest-style boards, saved-item folders). The core guarantees: an item
can belong to **many collections** at once, saving the same item twice is **idempotent** (no duplicate, exact
count), removing an item from one collection **never affects** the others, and each collection's item list is
duplicate-free and newest-saved first. Files:

- \`collectionService.ts\` — the domain logic (\`CollectionService\` + a \`collections\` singleton).
  Dependency-free. In-memory; swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { collectionRouter } from './server/collections/routes';
app.use('/api/collections', collectionRouter);
\`\`\`

Endpoints (take the ownerId from the auth session in production):
- \`GET    /api/collections?owner=<id>\` → the owner's collections (each with an item count).
- \`POST   /api/collections\` \`{ ownerId, name }\` → create (**409** if the name is taken for that owner).
- \`GET    /api/collections/:id\` → one collection with its items.
- \`PATCH  /api/collections/:id\` \`{ name }\` → rename (**409** on a name clash).
- \`DELETE /api/collections/:id\` → delete the collection (items elsewhere untouched).
- \`POST   /api/collections/:id/items\` \`{ itemId }\` → save an item (idempotent).
- \`DELETE /api/collections/:id/items/:itemId\` → remove an item from this collection only.

Distinct from \`generate_wishlist\` (a single flat list per user) and \`generate_tags\` (labels on one entity).
`;

export interface CollectionsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Saved collections / boards starter wired under server/collections/ (dependency-free domain logic + an ' +
  'Express router). The real guarantee is MEMBERSHIP INTEGRITY: an item can belong to MANY collections at once; ' +
  'saveItem() is idempotent (a repeat save never duplicates — exact itemCount); removeItem() from one ' +
  'collection never affects the item in other collections; each list is duplicate-free, newest-saved first. ' +
  'create() names are unique per owner (409 on clash); collectionsForItem(owner, item) is the many-to-many ' +
  'lookup. routes.ts exposes GET /api/collections (?owner=), POST /api/collections ({ownerId,name}), GET/PATCH/' +
  'DELETE /api/collections/:id, POST /api/collections/:id/items ({itemId}) and DELETE ' +
  '/api/collections/:id/items/:itemId. Mount at app.use("/api/collections", collectionRouter); take ownerId ' +
  'from the auth session in production. Distinct from generate_wishlist (single flat list) and generate_tags ' +
  '(labels on one entity). In-memory by default — swap the Maps for your DB.';

export function generateCollectionsIntegration(): CollectionsConfig {
  return {
    files: {
      'server/collections/collectionService.ts': COLLECTIONS_SERVICE_SOURCE,
      'server/collections/routes.ts': COLLECTIONS_ROUTES_SOURCE,
      'server/collections/README.md': COLLECTIONS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

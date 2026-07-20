// Roadmap breadth — wishlist / favorites / likes starter (a packaged domain vertical).
//
// A near-universal vertical: ecommerce wishlists, content bookmarks, social likes/favorites. The real feature
// is IDEMPOTENT MEMBERSHIP: a (user, item) favorite exists at most once — favoriting twice is a no-op (not a
// double entry), unfavoriting is idempotent, the per-item favorite COUNT is always exact, and toggle flips the
// state deterministically. This emits a dependency-free FavoritesService + an Express router + a README. Real
// logic, not a stub — the idempotency + exact-count rules are unit-tested against the emitted code. Pure
// builder → the caller writes the files.

export const WISHLIST_SERVICE_SOURCE = `// Wishlist / favorites / likes domain logic. The core guarantees: (1) a (user, item) favorite exists AT MOST
// ONCE — add is idempotent (favoriting twice does not create a second entry) and remove is idempotent, and
// (2) the per-item favorite COUNT is always exact. Works for any "collection" via a namespace (e.g. 'wishlist',
// 'likes', 'bookmarks'). In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Favorite {
  user: string;
  item: string;
  collection: string;   // namespace: 'wishlist' | 'likes' | 'bookmarks' | ...
  createdAt: string;
}

export class FavoritesService {
  // key = collection + '\\u0000' + user + '\\u0000' + item  ->  Favorite
  private favorites = new Map<string, Favorite>();

  private key(collection: string, user: string, item: string): string {
    return String(collection).trim() + '\\u0000' + String(user).trim() + '\\u0000' + String(item).trim();
  }

  private norm(collection?: string): string {
    const c = String(collection ?? 'wishlist').trim();
    return c || 'wishlist';
  }

  /** Favorite an item. Idempotent — favoriting an already-favorited item returns { added: false }. */
  add(user: string, item: string, collection?: string, now: Date = new Date()): { favorite: Favorite; added: boolean } {
    const who = String(user).trim();
    const what = String(item).trim();
    if (!who) throw new Error('user is required');
    if (!what) throw new Error('item is required');
    const col = this.norm(collection);
    const key = this.key(col, who, what);
    const existing = this.favorites.get(key);
    if (existing) return { favorite: existing, added: false };
    const favorite: Favorite = { user: who, item: what, collection: col, createdAt: now.toISOString() };
    this.favorites.set(key, favorite);
    return { favorite, added: true };
  }

  /** Remove a favorite. Idempotent — returns { removed: false } if it was not favorited. */
  remove(user: string, item: string, collection?: string): { removed: boolean } {
    const key = this.key(this.norm(collection), user, item);
    return { removed: this.favorites.delete(key) };
  }

  /** Flip the favorite state. Returns the new state (true = now favorited). */
  toggle(user: string, item: string, collection?: string, now: Date = new Date()): { favorited: boolean } {
    if (this.has(user, item, collection)) {
      this.remove(user, item, collection);
      return { favorited: false };
    }
    this.add(user, item, collection, now);
    return { favorited: true };
  }

  /** Has this user favorited this item? */
  has(user: string, item: string, collection?: string): boolean {
    return this.favorites.has(this.key(this.norm(collection), user, item));
  }

  /** A user's favorites in a collection, newest first. */
  listByUser(user: string, collection?: string): Favorite[] {
    const who = String(user).trim();
    const col = this.norm(collection);
    return [...this.favorites.values()]
      .filter((f) => f.user === who && f.collection === col)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Exact number of users who have favorited an item (the "like count"). */
  countForItem(item: string, collection?: string): number {
    const what = String(item).trim();
    const col = this.norm(collection);
    let n = 0;
    for (const f of this.favorites.values()) {
      if (f.item === what && f.collection === col) n++;
    }
    return n;
  }

  /** The users who favorited an item. */
  usersForItem(item: string, collection?: string): string[] {
    const what = String(item).trim();
    const col = this.norm(collection);
    const out: string[] = [];
    for (const f of this.favorites.values()) {
      if (f.item === what && f.collection === col) out.push(f.user);
    }
    return out;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const favorites = new FavoritesService();
`;

export const WISHLIST_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { favorites } from './favoritesService';

// REST endpoints for favorites/wishlist/likes. Mount with: app.use('/api', favoritesRouter).
export const favoritesRouter = Router();

// Favorite an item (idempotent). { user, item, collection? }. In production, take user from the auth session.
favoritesRouter.post('/favorites', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown; item?: unknown; collection?: unknown };
  try {
    const result = favorites.add(String(body.user ?? ''), String(body.item ?? ''), body.collection === undefined ? undefined : String(body.collection));
    return res.status(result.added ? 201 : 200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Toggle a favorite. { user, item, collection? } → { favorited }.
favoritesRouter.post('/favorites/toggle', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown; item?: unknown; collection?: unknown };
  try {
    return res.status(200).json(favorites.toggle(String(body.user ?? ''), String(body.item ?? ''), body.collection === undefined ? undefined : String(body.collection)));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Remove a favorite (idempotent).
favoritesRouter.delete('/favorites', (req: Request, res: Response) => {
  const q = req.query as { user?: string; item?: string; collection?: string };
  return res.status(200).json(favorites.remove(String(q.user ?? ''), String(q.item ?? ''), q.collection));
});

// A user's favorites in a collection (?collection=).
favoritesRouter.get('/favorites/:user', (req: Request, res: Response) => {
  const q = req.query as { collection?: string };
  return res.status(200).json(favorites.listByUser(req.params.user, q.collection));
});

// An item's favorite count + whether a given user favorited it (?collection=&user=).
favoritesRouter.get('/items/:item/favorites', (req: Request, res: Response) => {
  const q = req.query as { collection?: string; user?: string };
  return res.status(200).json({
    item: req.params.item,
    count: favorites.countForItem(req.params.item, q.collection),
    favorited: q.user ? favorites.has(q.user, req.params.item, q.collection) : undefined,
  });
});
`;

const WISHLIST_README = `# Wishlist / favorites / likes

A real favorites backend. The core guarantees: a \`(user, item)\` favorite exists **at most once** — \`add\` is
idempotent (favoriting twice does not create a second entry), \`remove\` is idempotent, and the per-item
favorite **count** is always exact. One service covers wishlists, likes and bookmarks via a \`collection\`
namespace. Files:

- \`favoritesService.ts\` — the domain logic (\`FavoritesService\` + a \`favorites\` singleton). In-memory; swap the
  Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { favoritesRouter } from './server/favorites/routes';
app.use('/api', favoritesRouter);
\`\`\`

Endpoints:
- \`POST /api/favorites\` \`{ user, item, collection? }\` → favorite (idempotent; 201 if newly added, 200 if already).
- \`POST /api/favorites/toggle\` \`{ user, item, collection? }\` → \`{ favorited }\`.
- \`DELETE /api/favorites\` (\`?user=&item=&collection=\`) → remove (idempotent).
- \`GET  /api/favorites/:user\` (\`?collection=\`) → the user's list.
- \`GET  /api/items/:item/favorites\` (\`?collection=&user=\`) → \`{ count, favorited }\`.

Use \`collection\` to run several kinds at once (\`'wishlist'\`, \`'likes'\`, \`'bookmarks'\`). Take \`user\` from the
auth session in production.
`;

export interface WishlistConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Wishlist / favorites / likes starter wired under server/favorites/ (dependency-free domain logic + an ' +
  'Express router). The real guarantee is IDEMPOTENT MEMBERSHIP: a (user, item) favorite exists AT MOST ONCE — ' +
  'add() favoriting twice is a no-op ({ added:false }), remove() is idempotent, toggle() flips the state, and ' +
  'countForItem() is always exact. One service covers wishlists/likes/bookmarks via a collection namespace. ' +
  'routes.ts exposes POST /favorites (201 new / 200 existing), POST /favorites/toggle, DELETE /favorites, GET ' +
  '/favorites/:user and GET /items/:item/favorites ({ count, favorited }). Mount with app.use("/api", ' +
  'favoritesRouter). Take user from the auth session in production. In-memory by default — swap the Maps for ' +
  'your DB.';

export function generateWishlistIntegration(): WishlistConfig {
  return {
    files: {
      'server/favorites/favoritesService.ts': WISHLIST_SERVICE_SOURCE,
      'server/favorites/routes.ts': WISHLIST_ROUTES_SOURCE,
      'server/favorites/README.md': WISHLIST_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

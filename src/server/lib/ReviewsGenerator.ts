// Roadmap breadth — reviews / ratings starter (a packaged domain vertical).
//
// A high-demand vertical for marketplaces, ecommerce, app stores, courses and any product-feedback surface.
// The real features are RATING INTEGRITY — a rating is bounded 1..5 (out-of-range rejected), each user may
// review a given item at most once (a repeat review UPDATES the existing one instead of double-counting), and
// the aggregate (average + count + star distribution) is always computed EXACTLY from the live reviews. This
// emits a dependency-free ReviewService + an Express router + a README. Real logic, not a stub — the integrity
// + aggregate rules are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const REVIEW_SERVICE_SOURCE = `// Reviews / ratings domain logic. The core guarantees: (1) a rating is an integer 1..5 (out-of-range
// rejected), (2) one review per (item, user) — a second submission UPDATES the first, never double-counts, and
// (3) the aggregate (average, count, per-star distribution) is computed EXACTLY from the current reviews.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Review {
  id: string;
  itemId: string;
  userId: string;
  rating: number; // integer 1..5
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Aggregate {
  itemId: string;
  count: number;
  average: number; // 0 when there are no reviews; rounded to 2 decimals
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

function assertRating(rating: unknown): number {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new Error('rating must be an integer from 1 to 5');
  return r;
}

export class ReviewService {
  private reviews = new Map<string, Review>();
  // Fast lookup of the one review a user has left on an item: key = itemId + '\\u0000' + userId.
  private byItemUser = new Map<string, string>();
  private seq = 0;

  private key(itemId: string, userId: string): string {
    return itemId + '\\u0000' + userId;
  }

  /** Create OR update the caller's review of an item. One review per (item, user) — a repeat call edits it. */
  submit(input: { itemId: string; userId: string; rating: number; title?: string; body?: string }, now: Date = new Date()): Review {
    const itemId = String(input?.itemId ?? '').trim();
    const userId = String(input?.userId ?? '').trim();
    if (!itemId) throw new Error('itemId is required');
    if (!userId) throw new Error('userId is required');
    const rating = assertRating(input?.rating);
    const iso = now.toISOString();
    const existingId = this.byItemUser.get(this.key(itemId, userId));
    if (existingId) {
      const r = this.reviews.get(existingId) as Review;
      r.rating = rating;
      r.title = String(input?.title ?? r.title);
      r.body = String(input?.body ?? r.body);
      r.updatedAt = iso;
      return r;
    }
    const review: Review = {
      id: String(++this.seq),
      itemId,
      userId,
      rating,
      title: String(input?.title ?? ''),
      body: String(input?.body ?? ''),
      createdAt: iso,
      updatedAt: iso,
    };
    this.reviews.set(review.id, review);
    this.byItemUser.set(this.key(itemId, userId), review.id);
    return review;
  }

  get(id: string): Review | undefined {
    return this.reviews.get(id);
  }

  /** The single review a user has left on an item, if any. */
  getByUser(itemId: string, userId: string): Review | undefined {
    const id = this.byItemUser.get(this.key(String(itemId).trim(), String(userId).trim()));
    return id ? this.reviews.get(id) : undefined;
  }

  /** Remove a review (e.g. the author deletes it). Returns true if one was removed. */
  remove(id: string): boolean {
    const r = this.reviews.get(id);
    if (!r) return false;
    this.reviews.delete(id);
    this.byItemUser.delete(this.key(r.itemId, r.userId));
    return true;
  }

  /** All reviews for an item, newest first. */
  listForItem(itemId: string): Review[] {
    const wanted = String(itemId).trim();
    return [...this.reviews.values()]
      .filter((r) => r.itemId === wanted)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Exact aggregate for an item: count, average (2dp), and the 1..5 star distribution. */
  aggregate(itemId: string): Aggregate {
    const wanted = String(itemId).trim();
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as Aggregate['distribution'];
    let sum = 0;
    let count = 0;
    for (const r of this.reviews.values()) {
      if (r.itemId !== wanted) continue;
      distribution[String(r.rating) as '1'] += 1;
      sum += r.rating;
      count += 1;
    }
    const average = count === 0 ? 0 : Math.round((sum / count) * 100) / 100;
    return { itemId: wanted, count, average, distribution };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const reviews = new ReviewService();
`;

export const REVIEW_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { reviews } from './reviewService';

// REST endpoints for the review service. Mount with: app.use('/api', reviewRouter).
export const reviewRouter = Router();

// Submit (create or update) the caller's review of an item. { itemId, userId, rating, title?, body? }.
// In production, take userId from the authenticated session rather than the body.
reviewRouter.post('/reviews', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { itemId?: unknown; userId?: unknown; rating?: unknown; title?: unknown; body?: unknown };
  try {
    const review = reviews.submit({
      itemId: String(body.itemId ?? ''),
      userId: String(body.userId ?? ''),
      rating: Number(body.rating),
      title: body.title === undefined ? undefined : String(body.title),
      body: body.body === undefined ? undefined : String(body.body),
    });
    return res.status(201).json(review);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// All reviews for an item.
reviewRouter.get('/items/:itemId/reviews', (req: Request, res: Response) => {
  return res.status(200).json(reviews.listForItem(req.params.itemId));
});

// Exact aggregate (average + count + star distribution) for an item.
reviewRouter.get('/items/:itemId/rating', (req: Request, res: Response) => {
  return res.status(200).json(reviews.aggregate(req.params.itemId));
});

// A single review by id.
reviewRouter.get('/reviews/:id', (req: Request, res: Response) => {
  const r = reviews.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'review not found' });
  return res.status(200).json(r);
});

// Delete a review.
reviewRouter.delete('/reviews/:id', (req: Request, res: Response) => {
  const ok = reviews.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'review not found' });
  return res.status(204).send();
});
`;

const REVIEW_README = `# Reviews / ratings

A real reviews backend. The core guarantees: a rating is an integer **1..5** (out-of-range rejected), each
user may review a given item **at most once** (a repeat submission **updates** the existing review instead of
double-counting), and the **aggregate** (average + count + per-star distribution) is computed **exactly** from
the current reviews. Files:

- \`reviewService.ts\` — the domain logic (\`ReviewService\` + a \`reviews\` singleton). In-memory; swap the Maps
  for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { reviewRouter } from './server/reviews/routes';
app.use('/api', reviewRouter);
\`\`\`

Endpoints:
- \`POST /api/reviews\` \`{ itemId, userId, rating, title?, body? }\` → creates OR updates the user's review
  (**400** if the rating isn't 1..5). Take \`userId\` from the auth session in production.
- \`GET  /api/items/:itemId/reviews\` — all reviews for an item.
- \`GET  /api/items/:itemId/rating\` — exact aggregate: \`{ count, average, distribution }\`.
- \`GET  /api/reviews/:id\` / \`DELETE /api/reviews/:id\`.

The one-review-per-user rule means the average can never be gamed by one user submitting many ratings — a
resubmission replaces their previous score.
`;

export interface ReviewsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Reviews / ratings starter wired under server/reviews/ (dependency-free domain logic + an Express router). ' +
  'The real guarantees are RATING INTEGRITY: a rating is an integer 1..5 (out-of-range rejected by submit()), ' +
  'one review per (item, user) — a repeat submit() UPDATES the existing review instead of double-counting — and ' +
  'aggregate() computes the average + count + per-star distribution EXACTLY from the live reviews. routes.ts ' +
  'exposes POST /reviews (create-or-update, 400 on a bad rating), GET /items/:itemId/reviews, GET ' +
  '/items/:itemId/rating (the aggregate), GET /reviews/:id and DELETE /reviews/:id. Mount with ' +
  'app.use("/api", reviewRouter). Take userId from the authenticated session in production, not the request ' +
  'body. In-memory by default — swap the Maps for your DB.';

export function generateReviewsIntegration(): ReviewsConfig {
  return {
    files: {
      'server/reviews/reviewService.ts': REVIEW_SERVICE_SOURCE,
      'server/reviews/routes.ts': REVIEW_ROUTES_SOURCE,
      'server/reviews/README.md': REVIEW_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

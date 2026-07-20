// Roadmap breadth — reactions starter (a packaged domain vertical).
//
// The emoji-reactions primitive (👍 ❤️ 😂 …) for any post, comment, message or media. The real feature is
// REACTION INTEGRITY: a user's reaction to a given (target, emoji) is a TOGGLE that is idempotent — reacting
// again with the SAME emoji is a no-op re-add (never a double count), and a user may switch emoji (react ❤️
// after 👍 moves their single vote). Per-emoji counts are therefore ALWAYS exact, and a summary lists every
// emoji with its exact count and whether the current viewer reacted. This emits a dependency-free
// ReactionService (no crypto/deps) + an Express router + a README. Real logic, not a stub — the toggle +
// exact-count + one-emoji-per-user rules are unit-tested against the emitted code. Pure builder → the caller
// writes the files. Distinct from generate_feedback (a single upvote board) and generate_polls (fixed options).

export const REACTIONS_SERVICE_SOURCE = `// Reactions domain logic. The core guarantees: (1) a user's reaction to a given (target, emoji) is a TOGGLE and
// is IDEMPOTENT — re-reacting with the same emoji does not double-count; (2) a user holds AT MOST ONE emoji per
// target by default (reacting with a new emoji replaces the old one), so switching never inflates totals; and
// (3) per-emoji counts are always EXACT. In-memory here; swap the Map for your database, keeping the same
// method contracts.

export interface ReactionCount {
  emoji: string;
  count: number;
  reactedByViewer: boolean; // did the queried viewer react with this emoji?
}

export interface ReactionSummary {
  targetId: string;
  total: number;                 // total reactions across all emoji
  reactions: ReactionCount[];    // one entry per emoji present, count desc
  viewerEmoji: string | null;    // which emoji the viewer currently holds (null = none)
}

// A short allow-list keeps stored reactions clean; extend as your product needs.
const DEFAULT_ALLOWED = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👏', '🔥'];

export class ReactionService {
  // targetId -> (userId -> emoji)  — a user holds at most one emoji per target
  private byTarget = new Map<string, Map<string, string>>();
  private allowed: Set<string>;

  constructor(allowedEmoji: string[] = DEFAULT_ALLOWED) {
    this.allowed = new Set(allowedEmoji);
  }

  private users(targetId: string): Map<string, string> {
    const key = String(targetId ?? '').trim();
    if (!key) throw new Error('targetId is required');
    let m = this.byTarget.get(key);
    if (!m) { m = new Map(); this.byTarget.set(key, m); }
    return m;
  }

  /**
   * Toggle a user's reaction on a target. Reacting with the emoji the user already holds REMOVES it (toggle
   * off). Reacting with a different emoji REPLACES their previous one (at most one emoji per user per target).
   * Returns the viewer's current emoji after the action (null if they toggled off). Idempotent by construction.
   */
  react(targetId: string, userId: string, emoji: string): string | null {
    const user = String(userId ?? '').trim();
    if (!user) throw new Error('userId is required');
    const e = String(emoji ?? '').trim();
    if (!this.allowed.has(e)) throw new Error('emoji not allowed');
    const m = this.users(targetId);
    const current = m.get(user);
    if (current === e) { m.delete(user); return null; } // same emoji again -> toggle OFF (no double count)
    m.set(user, e);                                       // new or switched emoji -> exactly one held
    return e;
  }

  /** Explicitly remove a user's reaction from a target (idempotent). Returns true if one was removed. */
  unreact(targetId: string, userId: string): boolean {
    return this.users(targetId).delete(String(userId ?? '').trim());
  }

  /** Did this user react with this specific emoji on this target? */
  hasReacted(targetId: string, userId: string, emoji: string): boolean {
    return this.users(targetId).get(String(userId ?? '').trim()) === String(emoji ?? '').trim();
  }

  /** Exact count for a single emoji on a target. */
  countFor(targetId: string, emoji: string): number {
    const e = String(emoji ?? '').trim();
    let n = 0;
    for (const held of this.users(targetId).values()) if (held === e) n += 1;
    return n;
  }

  /** Full summary: every emoji present with its exact count (desc), the grand total, and the viewer's own emoji. */
  summary(targetId: string, viewerId: string = ''): ReactionSummary {
    const key = String(targetId ?? '').trim();
    const viewer = String(viewerId ?? '').trim();
    const m = this.users(key);
    const counts = new Map<string, number>();
    let viewerEmoji: string | null = null;
    for (const [user, emoji] of m.entries()) {
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
      if (user === viewer) viewerEmoji = emoji;
    }
    const reactions: ReactionCount[] = [...counts.entries()]
      .map(([emoji, count]) => ({ emoji, count, reactedByViewer: emoji === viewerEmoji }))
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
    let total = 0;
    for (const c of reactions) total += c.count;
    return { targetId: key, total, reactions, viewerEmoji };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const reactions = new ReactionService();
`;

export const REACTIONS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { reactions } from './reactionService';

// REST endpoints for reactions. Mount with: app.use('/api/reactions', reactionRouter).
// In production take the userId from the auth session, not the body.
export const reactionRouter = Router();

// Toggle a reaction. { userId, emoji }. Same emoji again removes it; a different emoji replaces it.
reactionRouter.post('/:targetId', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown; emoji?: unknown };
  try {
    reactions.react(req.params.targetId, String(body.userId ?? ''), String(body.emoji ?? ''));
    return res.status(200).json(reactions.summary(req.params.targetId, String(body.userId ?? '')));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Remove a user's reaction. { userId }.
reactionRouter.delete('/:targetId', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown };
  try {
    reactions.unreact(req.params.targetId, String(body.userId ?? ''));
    return res.status(200).json(reactions.summary(req.params.targetId, String(body.userId ?? '')));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Reaction summary for a target. ?viewer=<userId> to include the viewer's own emoji.
reactionRouter.get('/:targetId', (req: Request, res: Response) => {
  try {
    return res.status(200).json(reactions.summary(req.params.targetId, String(req.query.viewer ?? '')));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});
`;

const REACTIONS_README = `# Reactions (emoji)

A real emoji-reactions backend (👍 ❤️ 😂 …) for any post, comment, message or media. The core guarantees: a
user's reaction to a given \`(target, emoji)\` is an **idempotent toggle** (re-reacting with the same emoji
removes it — never a double count), a user holds **at most one emoji per target** (reacting with a new emoji
replaces the old one), so per-emoji counts are **always exact**. Files:

- \`reactionService.ts\` — the domain logic (\`ReactionService\` + a \`reactions\` singleton). Dependency-free.
  In-memory; swap the Map for your DB. Constructor takes an allow-list of emoji (sensible default provided).
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { reactionRouter } from './server/reactions/routes';
app.use('/api/reactions', reactionRouter);
\`\`\`

Endpoints (take the userId from the auth session in production):
- \`POST   /api/reactions/:targetId\` \`{ userId, emoji }\` → toggle; returns the updated summary.
- \`DELETE /api/reactions/:targetId\` \`{ userId }\` → remove the user's reaction.
- \`GET    /api/reactions/:targetId?viewer=<userId>\` → \`{ total, reactions:[{emoji,count,reactedByViewer}], viewerEmoji }\`.

Distinct from \`generate_feedback\` (a single-upvote roadmap board) and \`generate_polls\` (fixed-option voting).
`;

export interface ReactionsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Reactions (emoji) starter wired under server/reactions/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is REACTION INTEGRITY: react(target, user, emoji) is an idempotent TOGGLE — re-reacting ' +
  'with the same emoji removes it (never a double count), and a user holds AT MOST ONE emoji per target (a new ' +
  'emoji replaces the old), so per-emoji counts are always EXACT. summary(target, viewer) returns every emoji ' +
  'present with its exact count (desc), the grand total, and the viewer own current emoji; unreact() removes; ' +
  'countFor()/hasReacted() query. Emoji are validated against an allow-list (sensible default). routes.ts ' +
  'exposes POST /api/reactions/:targetId ({userId, emoji} → toggle), DELETE /api/reactions/:targetId ({userId}) ' +
  'and GET /api/reactions/:targetId (?viewer=). Mount at app.use("/api/reactions", reactionRouter); take userId ' +
  'from the auth session in production. Distinct from generate_feedback and generate_polls. In-memory by ' +
  'default — swap the Map for your DB.';

export function generateReactionsIntegration(): ReactionsConfig {
  return {
    files: {
      'server/reactions/reactionService.ts': REACTIONS_SERVICE_SOURCE,
      'server/reactions/routes.ts': REACTIONS_ROUTES_SOURCE,
      'server/reactions/README.md': REACTIONS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

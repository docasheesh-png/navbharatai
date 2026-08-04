// Roadmap breadth — leaderboard / rankings starter (a packaged domain vertical).
//
// A high-demand vertical for games, gamification, sales contests, quizzes and any ranked score. The real
// feature is RANK INTEGRITY: a player's BEST score is kept (a lower resubmit never downgrades them), players
// are ranked by score DESC with a deterministic tie-break (whoever reached that score EARLIER ranks higher),
// so ranks are exact, 1-based and stable. Supports multiple boards via a namespace. This emits a
// dependency-free LeaderboardService + an Express router + a README. Real logic, not a stub — the best-kept +
// deterministic-rank rules are unit-tested against the emitted code. Pure builder → the caller writes files.

export const LEADERBOARD_SERVICE_SOURCE = `// Leaderboard domain logic. The core guarantees: (1) a player's BEST score is kept — submitting a lower score
// never downgrades them, (2) ranking is score DESC with a deterministic tie-break (earlier achiever ranks
// higher), so rank() is exact, 1-based and stable, and (3) multiple boards are isolated by a board name.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Entry {
  board: string;
  player: string;
  score: number;
  // When the player's CURRENT best score was first achieved (ms). Tie-break: smaller = ranked higher.
  achievedAt: number;
  updatedAt: string;
}

export interface RankedEntry extends Entry {
  rank: number; // 1-based
}

export class LeaderboardService {
  // key = board + '\\u0000' + player
  private entries = new Map<string, Entry>();

  private key(board: string, player: string): string {
    return String(board).trim() + '\\u0000' + String(player).trim();
  }

  private norm(board?: string): string {
    const b = String(board ?? 'default').trim();
    return b || 'default';
  }

  /**
   * Submit a score. Keeps the player's BEST: a higher score replaces it (and stamps a fresh achievedAt); a
   * score <= the current best is ignored (best-kept). Returns the player's current (possibly unchanged) entry.
   */
  submit(player: string, score: number, board?: string, now: Date = new Date()): Entry {
    const who = String(player).trim();
    if (!who) throw new Error('player is required');
    const s = Number(score);
    if (!Number.isFinite(s)) throw new Error('score must be a number');
    const b = this.norm(board);
    const key = this.key(b, who);
    const existing = this.entries.get(key);
    if (existing && s <= existing.score) {
      return existing; // best-kept: a lower/equal score does not downgrade or reset the tie-break time
    }
    const entry: Entry = { board: b, player: who, score: s, achievedAt: now.getTime(), updatedAt: now.toISOString() };
    this.entries.set(key, entry);
    return entry;
  }

  private boardEntries(board: string): Entry[] {
    const b = this.norm(board);
    // Score DESC, then earliest achiever first (deterministic, stable tie-break).
    return [...this.entries.values()]
      .filter((e) => e.board === b)
      .sort((a, z) => (z.score - a.score) || (a.achievedAt - z.achievedAt) || a.player.localeCompare(z.player));
  }

  /** The top N players, ranked 1..N. */
  top(n = 10, board?: string): RankedEntry[] {
    const limit = Math.max(0, Math.floor(Number(n) || 0));
    return this.boardEntries(board).slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
  }

  /** A player's 1-based rank, or 0 if they have no entry on the board. */
  rankOf(player: string, board?: string): number {
    const who = String(player).trim();
    const idx = this.boardEntries(board).findIndex((e) => e.player === who);
    return idx < 0 ? 0 : idx + 1;
  }

  /** A player's entry (with rank), or undefined. */
  entryOf(player: string, board?: string): RankedEntry | undefined {
    const rank = this.rankOf(player, board);
    if (!rank) return undefined;
    const e = this.entries.get(this.key(this.norm(board), player)) as Entry;
    return { ...e, rank };
  }

  /** The player plus the k neighbours above and below them (a "your standing" slice), ranked. */
  around(player: string, k = 2, board?: string): RankedEntry[] {
    const all = this.boardEntries(board);
    const who = String(player).trim();
    const idx = all.findIndex((e) => e.player === who);
    if (idx < 0) return [];
    const span = Math.max(0, Math.floor(Number(k) || 0));
    const start = Math.max(0, idx - span);
    const end = Math.min(all.length, idx + span + 1);
    return all.slice(start, end).map((e, i) => ({ ...e, rank: start + i + 1 }));
  }

  /** Total players on a board. */
  size(board?: string): number {
    return this.boardEntries(board).length;
  }

  /** Remove a player from a board. */
  remove(player: string, board?: string): boolean {
    return this.entries.delete(this.key(this.norm(board), player));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const leaderboard = new LeaderboardService();
`;

export const LEADERBOARD_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { leaderboard } from './leaderboardService';

// REST endpoints for the leaderboard service. Mount with: app.use('/api', leaderboardRouter).
export const leaderboardRouter = Router();

// Submit a score (keeps the player's best). { player, score, board? }. Take player from the auth session.
leaderboardRouter.post('/leaderboard/scores', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { player?: unknown; score?: unknown; board?: unknown };
  try {
    return res.status(201).json(leaderboard.submit(String(body.player ?? ''), Number(body.score), body.board === undefined ? undefined : String(body.board)));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Top N (?n=&board=).
leaderboardRouter.get('/leaderboard', (req: Request, res: Response) => {
  const q = req.query as { n?: string; board?: string };
  return res.status(200).json(leaderboard.top(q.n ? Number(q.n) : 10, q.board));
});

// A player's standing: their entry (with rank) + neighbours (?k=&board=).
leaderboardRouter.get('/leaderboard/:player', (req: Request, res: Response) => {
  const q = req.query as { k?: string; board?: string };
  const entry = leaderboard.entryOf(req.params.player, q.board);
  if (!entry) return res.status(404).json({ error: 'player not on this board' });
  return res.status(200).json({ entry, around: leaderboard.around(req.params.player, q.k ? Number(q.k) : 2, q.board) });
});

// Remove a player from a board (?board=).
leaderboardRouter.delete('/leaderboard/:player', (req: Request, res: Response) => {
  const q = req.query as { board?: string };
  if (!leaderboard.remove(req.params.player, q.board)) return res.status(404).json({ error: 'player not on this board' });
  return res.status(204).send();
});
`;

const LEADERBOARD_README = `# Leaderboard / rankings

A real leaderboard backend. The core guarantees: a player's **best** score is kept (a lower resubmit never
downgrades them), players are ranked by **score DESC** with a deterministic **tie-break** (whoever reached the
score **earlier** ranks higher), so ranks are exact, 1-based and stable. Multiple boards are isolated by a
\`board\` name. Files:

- \`leaderboardService.ts\` — the domain logic (\`LeaderboardService\` + a \`leaderboard\` singleton). In-memory;
  swap the Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { leaderboardRouter } from './server/leaderboard/routes';
app.use('/api', leaderboardRouter);
\`\`\`

Endpoints:
- \`POST /api/leaderboard/scores\` \`{ player, score, board? }\` → keeps the player's best.
- \`GET  /api/leaderboard\` (\`?n=&board=\`) → the top N, ranked.
- \`GET  /api/leaderboard/:player\` (\`?k=&board=\`) → \`{ entry (with rank), around }\` (**404** if not on the board).
- \`DELETE /api/leaderboard/:player\` (\`?board=\`).

Use \`board\` to run several leaderboards at once (\`'weekly'\`, \`'all-time'\`, per-level). Take \`player\` from the
auth session in production. Pairs with the loyalty / gamification recipes.
`;

export interface LeaderboardConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Leaderboard / rankings starter wired under server/leaderboard/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is RANK INTEGRITY: submit() keeps each player BEST score (a score <= their ' +
  'current best is ignored, and does not reset the tie-break time); ranking is score DESC with a deterministic ' +
  'tie-break (earlier achiever ranks higher), so top()/rankOf()/around() are exact, 1-based and stable. Boards ' +
  'are isolated by a board name. routes.ts exposes POST /leaderboard/scores, GET /leaderboard (?n=&board=), GET ' +
  '/leaderboard/:player (?k=&board= → entry+rank+neighbours, 404 if not ranked) and DELETE /leaderboard/:player. ' +
  'Mount with app.use("/api", leaderboardRouter). Take player from the auth session in production. In-memory by ' +
  'default — swap the Maps for your DB.';

export function generateLeaderboardIntegration(): LeaderboardConfig {
  return {
    files: {
      'server/leaderboard/leaderboardService.ts': LEADERBOARD_SERVICE_SOURCE,
      'server/leaderboard/routes.ts': LEADERBOARD_ROUTES_SOURCE,
      'server/leaderboard/README.md': LEADERBOARD_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

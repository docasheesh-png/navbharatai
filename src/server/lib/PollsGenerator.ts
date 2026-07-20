// Roadmap breadth — polls / surveys starter (a packaged domain vertical).
//
// A high-demand feature for communities, events and product teams. The real feature is VOTE INTEGRITY: each
// voter can vote at most once per poll (a second vote is rejected, or optionally moves their vote), a closed
// poll accepts no more votes, and the tally is always accurate. This emits a dependency-free PollService +
// an Express router + a README. Real logic, not a stub — the one-vote-per-voter rule + tally are unit-tested
// against the emitted code. Pure builder → the caller writes the files.

export const POLL_SERVICE_SOURCE = `// Polls domain logic. The core guarantee: VOTE INTEGRITY — one vote per voter per poll (double votes are
// rejected unless allowChange lets a voter move their vote), a closed poll takes no more votes, and the tally
// is exact. In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface PollOption {
  id: string;
  label: string;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  open: boolean;
  createdAt: string;
}

export interface PollResults {
  pollId: string;
  question: string;
  open: boolean;
  total: number;
  tally: Array<{ optionId: string; label: string; votes: number }>;
}

interface Vote {
  pollId: string;
  optionId: string;
  voter: string;
}

export class PollService {
  private polls = new Map<string, Poll>();
  private votes: Vote[] = [];
  private seq = 0;

  createPoll(question: string, options: string[], now: Date = new Date()): Poll {
    const q = String(question).trim();
    if (!q) throw new Error('question is required');
    const opts = (Array.isArray(options) ? options : [])
      .map((o) => String(o).trim())
      .filter(Boolean)
      .map((label, i) => ({ id: String(i + 1), label }));
    if (opts.length < 2) throw new Error('a poll needs at least 2 options');
    const poll: Poll = { id: String(++this.seq), question: q, options: opts, open: true, createdAt: now.toISOString() };
    this.polls.set(poll.id, poll);
    return poll;
  }

  getPoll(id: string): Poll | undefined {
    return this.polls.get(id);
  }

  private require(id: string): Poll {
    const p = this.polls.get(id);
    if (!p) throw new Error('poll not found');
    return p;
  }

  /** Has this voter already voted on this poll? */
  hasVoted(pollId: string, voter: string): boolean {
    const who = String(voter).trim();
    return this.votes.some((v) => v.pollId === pollId && v.voter === who);
  }

  /** Cast a vote. One vote per voter per poll — a repeat vote is rejected unless allowChange moves it.
   *  A closed poll and an unknown option are rejected. */
  vote(pollId: string, optionId: string, voter: string, opts: { allowChange?: boolean } = {}): PollResults {
    const poll = this.require(pollId);
    if (!poll.open) throw new Error('poll is closed');
    const who = String(voter).trim();
    if (!who) throw new Error('voter is required');
    const opt = poll.options.find((o) => o.id === String(optionId).trim());
    if (!opt) throw new Error('unknown option');
    const existing = this.votes.find((v) => v.pollId === pollId && v.voter === who);
    if (existing) {
      if (!opts.allowChange) throw new Error('already voted');
      existing.optionId = opt.id; // move the vote
    } else {
      this.votes.push({ pollId, optionId: opt.id, voter: who });
    }
    return this.results(pollId);
  }

  /** Close a poll so it accepts no more votes. */
  closePoll(id: string): Poll {
    const p = this.require(id);
    p.open = false;
    return p;
  }

  /** The exact tally: votes per option + the total. */
  results(pollId: string): PollResults {
    const poll = this.require(pollId);
    const counts = new Map<string, number>();
    for (const o of poll.options) counts.set(o.id, 0);
    let total = 0;
    for (const v of this.votes) {
      if (v.pollId !== pollId) continue;
      counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
      total++;
    }
    return {
      pollId,
      question: poll.question,
      open: poll.open,
      total,
      tally: poll.options.map((o) => ({ optionId: o.id, label: o.label, votes: counts.get(o.id) ?? 0 })),
    };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const polls = new PollService();
`;

export const POLL_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { polls } from './pollService';

// REST endpoints for the polls service. Mount with: app.use('/api', pollRouter).
export const pollRouter = Router();

// Create a poll. { question, options: string[] }
pollRouter.post('/polls', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { question?: unknown; options?: unknown };
  try {
    const options = Array.isArray(body.options) ? body.options.map((o) => String(o)) : [];
    return res.status(201).json(polls.createPoll(String(body.question ?? ''), options));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

pollRouter.get('/polls/:id', (req: Request, res: Response) => {
  const p = polls.getPoll(req.params.id);
  if (!p) return res.status(404).json({ error: 'poll not found' });
  return res.status(200).json(p);
});

// Live results / tally.
pollRouter.get('/polls/:id/results', (req: Request, res: Response) => {
  try {
    return res.status(200).json(polls.results(req.params.id));
  } catch {
    return res.status(404).json({ error: 'poll not found' });
  }
});

// Cast a vote. { optionId, voter, allowChange? } — 409 on a duplicate vote or a closed poll.
pollRouter.post('/polls/:id/vote', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { optionId?: unknown; voter?: unknown; allowChange?: unknown };
  try {
    const out = polls.vote(req.params.id, String(body.optionId ?? ''), String(body.voter ?? ''), { allowChange: body.allowChange === true });
    return res.status(200).json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not vote';
    if (message === 'poll not found') return res.status(404).json({ error: message });
    if (message === 'already voted' || message === 'poll is closed') return res.status(409).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

// Close a poll (no more votes).
pollRouter.post('/polls/:id/close', (req: Request, res: Response) => {
  try {
    return res.status(200).json(polls.closePoll(req.params.id));
  } catch {
    return res.status(404).json({ error: 'poll not found' });
  }
});
`;

const POLL_README = `# Polls / surveys

A real poll/voting backend. The core guarantee: **vote integrity** — each voter can vote at most once per poll
(a repeat vote is rejected, or moved if you pass \`allowChange\`), a **closed** poll accepts no more votes, and
the tally is always exact. Files:

- \`pollService.ts\` — the domain logic (\`PollService\` + a \`polls\` singleton). In-memory; swap the Maps for your
  database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { pollRouter } from './server/polls/routes';
app.use('/api', pollRouter);
\`\`\`

Endpoints:
- \`POST /api/polls\` \`{ question, options: string[] }\` (needs ≥ 2 options).
- \`GET  /api/polls/:id\` / \`GET /api/polls/:id/results\` (live tally).
- \`POST /api/polls/:id/vote\` \`{ optionId, voter, allowChange? }\` → **409** on a duplicate vote or a closed poll.
- \`POST /api/polls/:id/close\`.

Identify the voter with your auth user id (or a device/session id for anonymous polls). Pairs with the auth
and realtime recipes for live results.
`;

export interface PollsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Polls / surveys starter wired under server/polls/ (dependency-free domain logic + an Express router). The ' +
  'real guarantee is VOTE INTEGRITY: pollService.ts allows one vote per voter per poll (a repeat vote is ' +
  'rejected unless allowChange moves it), a closed poll takes no more votes, and results() returns an exact ' +
  'tally. routes.ts exposes POST /polls, GET /polls/:id(/results), POST /polls/:id/vote (409 on duplicate/closed) ' +
  'and POST /polls/:id/close. Mount with app.use("/api", pollRouter). Identify the voter with your auth user id ' +
  '(or a device/session id for anonymous polls). In-memory by default — swap the Maps for your DB, same ' +
  'contracts. Pairs with the auth/realtime recipes. No API key.';

export function generatePollsIntegration(): PollsConfig {
  return {
    files: {
      'server/polls/pollService.ts': POLL_SERVICE_SOURCE,
      'server/polls/routes.ts': POLL_ROUTES_SOURCE,
      'server/polls/README.md': POLL_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

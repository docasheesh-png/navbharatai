// Roadmap breadth — feedback / feature-request board starter (a packaged domain vertical).
//
// A high-demand vertical for public product roadmaps (Canny / Featurebase style): users submit ideas, upvote
// the ones they want, and the team moves each along a status pipeline. The real feature is VOTE + STATUS
// INTEGRITY: a user can upvote a given post AT MOST ONCE (a repeat upvote is a no-op, un-vote is idempotent),
// vote counts are always exact, and a post's status follows a lifecycle (open → planned → in_progress →
// done / declined) with allowed transitions only. This emits a dependency-free FeedbackService + an Express
// router + a README. Real logic, not a stub — the vote-once + status-machine rules are unit-tested against the
// emitted code. Pure builder → the caller writes the files.

export const FEEDBACK_SERVICE_SOURCE = `// Feedback / feature-request domain logic. The core guarantees: (1) a user can upvote a given post AT MOST
// ONCE (upvote is idempotent; unvote is idempotent), so vote counts are always exact, and (2) a post's status
// follows the lifecycle open → planned → in_progress → done / declined along allowed transitions only.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export type PostStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'declined';

export interface Post {
  id: string;
  title: string;
  body: string;
  author: string;
  status: PostStatus;
  votes: number;
  createdAt: string;
  updatedAt: string;
}

// Allowed status transitions. done/declined are terminal but can be reopened to 'open'.
const STATUS_FLOW: Record<PostStatus, PostStatus[]> = {
  open: ['planned', 'in_progress', 'declined'],
  planned: ['in_progress', 'open', 'declined'],
  in_progress: ['done', 'planned', 'declined'],
  done: ['open'],
  declined: ['open'],
};

export class FeedbackService {
  private posts = new Map<string, Post>();
  // postId -> set of userIds who upvoted
  private voters = new Map<string, Set<string>>();
  private seq = 0;

  /** Submit a feature request / idea. The author's own vote is counted automatically. */
  submit(input: { title: string; body?: string; author: string }, now: Date = new Date()): Post {
    const title = String(input?.title ?? '').trim();
    const author = String(input?.author ?? '').trim();
    if (!title) throw new Error('title is required');
    if (!author) throw new Error('author is required');
    const iso = now.toISOString();
    const post: Post = {
      id: 'f' + String(++this.seq),
      title,
      body: String(input?.body ?? ''),
      author,
      status: 'open',
      votes: 1, // the author implicitly upvotes their own post
      createdAt: iso,
      updatedAt: iso,
    };
    this.posts.set(post.id, post);
    this.voters.set(post.id, new Set([author]));
    return post;
  }

  get(id: string): Post | undefined {
    return this.posts.get(id);
  }

  private require(id: string): Post {
    const p = this.posts.get(id);
    if (!p) throw new Error('post not found');
    return p;
  }

  /** Upvote a post. Idempotent per user — a repeat upvote does not double-count. Returns { voted, votes }. */
  upvote(id: string, user: string): { voted: boolean; votes: number } {
    const post = this.require(id);
    const who = String(user).trim();
    if (!who) throw new Error('user is required');
    const set = this.voters.get(id) ?? new Set<string>();
    const already = set.has(who);
    if (!already) { set.add(who); post.votes = set.size; this.voters.set(id, set); }
    return { voted: !already, votes: post.votes };
  }

  /** Remove a user's upvote. Idempotent. Returns { removed, votes }. */
  unvote(id: string, user: string): { removed: boolean; votes: number } {
    const post = this.require(id);
    const who = String(user).trim();
    const set = this.voters.get(id);
    const removed = set ? set.delete(who) : false;
    if (removed) post.votes = set!.size;
    return { removed, votes: post.votes };
  }

  /** Has this user upvoted this post? */
  hasVoted(id: string, user: string): boolean {
    return this.voters.get(id)?.has(String(user).trim()) ?? false;
  }

  /** Move a post along the status lifecycle, enforcing allowed transitions. */
  setStatus(id: string, to: PostStatus, now: Date = new Date()): Post {
    const post = this.require(id);
    if (post.status === to) return post;
    if (!STATUS_FLOW[post.status].includes(to)) {
      throw new Error('invalid status transition: ' + post.status + ' -> ' + to);
    }
    post.status = to;
    post.updatedAt = now.toISOString();
    return post;
  }

  /** The board: posts sorted by votes desc (then newest), optionally filtered by status. */
  list(filter: { status?: PostStatus } = {}): Post[] {
    let out = [...this.posts.values()];
    if (filter.status) out = out.filter((p) => p.status === filter.status);
    return out.sort((a, b) => (b.votes - a.votes) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const feedback = new FeedbackService();
`;

export const FEEDBACK_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { feedback } from './feedbackService';

// REST endpoints for the feedback board. Mount with: app.use('/api', feedbackRouter).
export const feedbackRouter = Router();

// Submit an idea. { title, body?, author }.
feedbackRouter.post('/feedback', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; body?: unknown; author?: unknown };
  try {
    return res.status(201).json(feedback.submit({ title: String(body.title ?? ''), body: String(body.body ?? ''), author: String(body.author ?? '') }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// The board (?status=). Sorted by votes.
feedbackRouter.get('/feedback', (req: Request, res: Response) => {
  const q = req.query as { status?: string };
  const valid = ['open', 'planned', 'in_progress', 'done', 'declined'];
  const status = valid.includes(String(q.status)) ? (q.status as 'open') : undefined;
  return res.status(200).json(feedback.list({ status }));
});

feedbackRouter.get('/feedback/:id', (req: Request, res: Response) => {
  const p = feedback.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'post not found' });
  return res.status(200).json({ ...p, votedByYou: feedback.hasVoted(req.params.id, String((req.query as { user?: string }).user ?? '')) });
});

// Upvote / un-vote. { user } — idempotent.
feedbackRouter.post('/feedback/:id/upvote', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown };
  try {
    return res.status(200).json(feedback.upvote(req.params.id, String(body.user ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not vote';
    return res.status(message === 'post not found' ? 404 : 400).json({ error: message });
  }
});

feedbackRouter.delete('/feedback/:id/upvote', (req: Request, res: Response) => {
  const q = req.query as { user?: string };
  try {
    return res.status(200).json(feedback.unvote(req.params.id, String(q.user ?? '')));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'post not found' });
  }
});

// Change status (admin). { status } — 409 on an invalid transition.
feedbackRouter.patch('/feedback/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(feedback.setStatus(req.params.id, String(body.status ?? '') as 'planned'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    if (message === 'post not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});
`;

const FEEDBACK_README = `# Feedback / feature-request board

A real product-feedback backend (a public roadmap, Canny/Featurebase style). The core guarantees: a user can
upvote a given post **at most once** (upvote/un-vote are idempotent, so vote counts are always **exact**), and a
post's status follows the lifecycle \`open → planned → in_progress → done / declined\` along allowed transitions
only. Files:

- \`feedbackService.ts\` — the domain logic (\`FeedbackService\` + a \`feedback\` singleton). In-memory; swap the Maps
  for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { feedbackRouter } from './server/feedback/routes';
app.use('/api', feedbackRouter);
\`\`\`

Endpoints:
- \`POST /api/feedback\` \`{ title, body?, author }\` → submit (the author's own vote counts).
- \`GET  /api/feedback\` (\`?status=\`) → the board, sorted by votes.
- \`GET  /api/feedback/:id\` (\`?user=\`) → a post (+ \`votedByYou\`).
- \`POST /api/feedback/:id/upvote\` \`{ user }\` / \`DELETE /api/feedback/:id/upvote\` (\`?user=\`) → vote (idempotent).
- \`PATCH /api/feedback/:id/status\` \`{ status }\` → move the pipeline (**409** on an invalid transition).

Take \`author\` / \`user\` from the auth session in production. Distinct from polls (fixed-option voting) and the
kanban board (a private task board).
`;

export interface FeedbackConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Feedback / feature-request board starter wired under server/feedback/ (dependency-free domain logic + an ' +
  'Express router). The real guarantee is VOTE + STATUS INTEGRITY: upvote() is idempotent per user (a repeat ' +
  'upvote does not double-count; unvote() is idempotent), so votes are always exact; setStatus() enforces the ' +
  'lifecycle open→planned→in_progress→done/declined (done/declined reopen to open). submit() counts the ' +
  "author's own vote. list() sorts the board by votes desc. routes.ts exposes POST /feedback, GET /feedback " +
  '(?status=), GET /feedback/:id (?user= → votedByYou), POST/DELETE /feedback/:id/upvote and PATCH ' +
  '/feedback/:id/status (409 on invalid transition). Mount with app.use("/api", feedbackRouter). Distinct from ' +
  'generate_polls (fixed-option voting) and generate_kanban (private task board). In-memory by default — swap ' +
  'the Maps for your DB.';

export function generateFeedbackIntegration(): FeedbackConfig {
  return {
    files: {
      'server/feedback/feedbackService.ts': FEEDBACK_SERVICE_SOURCE,
      'server/feedback/routes.ts': FEEDBACK_ROUTES_SOURCE,
      'server/feedback/README.md': FEEDBACK_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

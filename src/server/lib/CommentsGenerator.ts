// Roadmap breadth — threaded comments / discussion starter (a packaged domain vertical).
//
// A high-demand vertical for blogs, forums, docs, social feeds and any content that invites discussion. The
// real feature is THREAD INTEGRITY: a reply MUST reference an existing parent comment (an orphan reply is
// rejected), each comment's depth is computed from its parent chain, a comment belongs to exactly one thread
// (identified by a subject/target id), and a SOFT-DELETE preserves the tree — the deleted node is tombstoned
// ("[deleted]") but its child replies survive and stay correctly nested. This emits a dependency-free
// CommentService + an Express router + a README. Real logic, not a stub — the parent/depth/soft-delete rules
// are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const COMMENT_SERVICE_SOURCE = `// Threaded-comments domain logic. The core guarantees: (1) a reply must reference an EXISTING parent in the
// same thread (orphan replies rejected), (2) a comment's depth is computed from its parent chain, and (3) a
// soft-delete tombstones the node ("[deleted]") but KEEPS its children so the thread structure survives.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Comment {
  id: string;
  threadId: string;      // the subject the discussion hangs off (post id, issue id, etc.)
  parentId: string | null;
  author: string;
  body: string;
  depth: number;         // 0 for a top-level comment; parent.depth + 1 otherwise
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadNode extends Comment {
  replies: ThreadNode[];
}

export class CommentService {
  private comments = new Map<string, Comment>();
  private seq = 0;

  /**
   * Post a comment. A top-level comment passes parentId = null; a reply passes an existing parent's id (the
   * reply inherits that parent's threadId). Throws if the parent does not exist.
   */
  post(input: { threadId?: string; parentId?: string | null; author: string; body: string }, now: Date = new Date()): Comment {
    const author = String(input?.author ?? '').trim();
    const body = String(input?.body ?? '').trim();
    if (!author) throw new Error('author is required');
    if (!body) throw new Error('body is required');

    let threadId: string;
    let depth: number;
    const parentId = input?.parentId ? String(input.parentId) : null;
    if (parentId) {
      const parent = this.comments.get(parentId);
      if (!parent) throw new Error('parent comment not found');
      threadId = parent.threadId; // a reply always lives in its parent's thread
      depth = parent.depth + 1;
    } else {
      threadId = String(input?.threadId ?? '').trim();
      if (!threadId) throw new Error('threadId is required for a top-level comment');
      depth = 0;
    }

    const iso = now.toISOString();
    const comment: Comment = {
      id: String(++this.seq),
      threadId,
      parentId,
      author,
      body,
      depth,
      deleted: false,
      createdAt: iso,
      updatedAt: iso,
    };
    this.comments.set(comment.id, comment);
    return comment;
  }

  get(id: string): Comment | undefined {
    return this.comments.get(id);
  }

  private require(id: string): Comment {
    const c = this.comments.get(id);
    if (!c) throw new Error('comment not found');
    return c;
  }

  /** Edit a comment's body (author-only in production). A tombstoned comment cannot be edited. */
  edit(id: string, body: string, now: Date = new Date()): Comment {
    const c = this.require(id);
    if (c.deleted) throw new Error('cannot edit a deleted comment');
    const text = String(body).trim();
    if (!text) throw new Error('body is required');
    c.body = text;
    c.updatedAt = now.toISOString();
    return c;
  }

  /**
   * Soft-delete: tombstone the node ("[deleted]") but KEEP it and its children so replies stay nested. A
   * comment with no replies is hard-removed (there is nothing to keep the structure for). Returns the outcome.
   */
  remove(id: string, now: Date = new Date()): { id: string; tombstoned: boolean } {
    const c = this.require(id);
    const hasChildren = [...this.comments.values()].some((x) => x.parentId === id);
    if (hasChildren) {
      c.deleted = true;
      c.body = '[deleted]';
      c.author = '[deleted]';
      c.updatedAt = now.toISOString();
      return { id, tombstoned: true };
    }
    this.comments.delete(id);
    return { id, tombstoned: false };
  }

  /** Flat list of a thread's comments, oldest first. */
  listThread(threadId: string): Comment[] {
    const wanted = String(threadId).trim();
    return [...this.comments.values()]
      .filter((c) => c.threadId === wanted)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || Number(a.id) - Number(b.id));
  }

  /** The thread as a nested tree (top-level comments, each with its replies), oldest first at every level. */
  tree(threadId: string): ThreadNode[] {
    const flat = this.listThread(threadId);
    const byId = new Map<string, ThreadNode>();
    for (const c of flat) byId.set(c.id, { ...c, replies: [] });
    const roots: ThreadNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.replies.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** Count of live (non-deleted) comments in a thread. */
  count(threadId: string): number {
    return this.listThread(threadId).filter((c) => !c.deleted).length;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const comments = new CommentService();
`;

export const COMMENT_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { comments } from './commentService';

// REST endpoints for the comment service. Mount with: app.use('/api', commentRouter).
export const commentRouter = Router();

// Post a comment or reply. { threadId?, parentId?, author, body } — 404 if the parent doesn't exist.
commentRouter.post('/comments', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { threadId?: unknown; parentId?: unknown; author?: unknown; body?: unknown };
  try {
    const created = comments.post({
      threadId: body.threadId === undefined ? undefined : String(body.threadId),
      parentId: body.parentId === undefined || body.parentId === null ? null : String(body.parentId),
      author: String(body.author ?? ''),
      body: String(body.body ?? ''),
    });
    return res.status(201).json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'parent comment not found' ? 404 : 400).json({ error: message });
  }
});

// The thread as a nested tree.
commentRouter.get('/threads/:threadId/comments', (req: Request, res: Response) => {
  return res.status(200).json(comments.tree(req.params.threadId));
});

// Live comment count for a thread.
commentRouter.get('/threads/:threadId/count', (req: Request, res: Response) => {
  return res.status(200).json({ threadId: req.params.threadId, count: comments.count(req.params.threadId) });
});

// Edit a comment's body.
commentRouter.patch('/comments/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { body?: unknown };
  try {
    return res.status(200).json(comments.edit(req.params.id, String(body.body ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not edit';
    return res.status(message === 'comment not found' ? 404 : 400).json({ error: message });
  }
});

// Soft-delete (tombstone if it has replies, else hard-remove).
commentRouter.delete('/comments/:id', (req: Request, res: Response) => {
  try {
    return res.status(200).json(comments.remove(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not delete';
    return res.status(message === 'comment not found' ? 404 : 400).json({ error: message });
  }
});
`;

const COMMENT_README = `# Threaded comments / discussion

A real threaded-comments backend. The core guarantees: a reply **must reference an existing parent** (orphan
replies rejected), each comment's **depth** is computed from its parent chain, and a **soft-delete** tombstones
the node (\`[deleted]\`) but **keeps its child replies** so the thread structure survives. Files:

- \`commentService.ts\` — the domain logic (\`CommentService\` + a \`comments\` singleton). In-memory; swap the Maps
  for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { commentRouter } from './server/comments/routes';
app.use('/api', commentRouter);
\`\`\`

Endpoints:
- \`POST /api/comments\` \`{ threadId?, parentId?, author, body }\` → a top-level comment (with \`threadId\`) or a
  reply (with \`parentId\`; **404** if the parent doesn't exist). A reply inherits its parent's thread.
- \`GET  /api/threads/:threadId/comments\` → the thread as a nested tree.
- \`GET  /api/threads/:threadId/count\` → live (non-deleted) comment count.
- \`PATCH /api/comments/:id\` \`{ body }\` → edit.
- \`DELETE /api/comments/:id\` → soft-delete (tombstone if it has replies, else hard-remove).

Identify \`threadId\` with whatever the discussion hangs off (a blog post id, an issue id, …) and take \`author\`
from the auth session in production.
`;

export interface CommentsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Threaded-comments starter wired under server/comments/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is THREAD INTEGRITY: post() rejects a reply to a non-existent parent (orphan), a reply ' +
  'inherits its parent thread and gets depth = parent.depth + 1, and remove() SOFT-DELETES (tombstones the ' +
  'node as "[deleted]" but keeps its children so the tree survives) — a childless comment is hard-removed. ' +
  'tree() returns the nested thread; count() the live comment count. routes.ts exposes POST /comments (404 if ' +
  'the parent is missing), GET /threads/:threadId/comments (nested tree), GET /threads/:threadId/count, PATCH ' +
  '/comments/:id and DELETE /comments/:id. Mount with app.use("/api", commentRouter). Take author from the ' +
  'auth session in production. In-memory by default — swap the Maps for your DB.';

export function generateCommentsIntegration(): CommentsConfig {
  return {
    files: {
      'server/comments/commentService.ts': COMMENT_SERVICE_SOURCE,
      'server/comments/routes.ts': COMMENT_ROUTES_SOURCE,
      'server/comments/README.md': COMMENT_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

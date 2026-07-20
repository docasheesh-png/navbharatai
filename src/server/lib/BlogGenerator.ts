// Roadmap breadth — blog / CMS starter (a packaged domain vertical).
//
// A high-demand vertical for content sites, marketing pages, docs and any publish-workflow app. The real
// features are a correct PUBLISH STATE-MACHINE (draft ↔ published ↔ archived) and deterministic UNIQUE-SLUG
// generation (a human-readable slug derived from the title, de-duplicated so two posts never collide). The
// public listing shows PUBLISHED posts only; drafts and archived posts stay out of the public feed. This
// emits a dependency-free BlogService + an Express router + a README. Real logic, not a stub — the
// state-machine + slug rules are unit-tested against the emitted code. Pure builder → the caller writes files.

export const BLOG_SERVICE_SOURCE = `// Blog / CMS domain logic. The core guarantees: (1) a post's status follows an allowed lifecycle
// (draft ↔ published ↔ archived — invalid jumps rejected), (2) every post gets a UNIQUE, human-readable slug
// derived from its title, and (3) the public list returns PUBLISHED posts only. In-memory here; swap the Maps
// for your database, keeping the same method contracts.

export type PostStatus = 'draft' | 'published' | 'archived';

export interface Post {
  id: string;
  title: string;
  slug: string;
  body: string;
  author: string;
  status: PostStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

// Allowed lifecycle transitions.
const STATUS_FLOW: Record<PostStatus, PostStatus[]> = {
  draft: ['published', 'archived'],
  published: ['draft', 'archived'], // unpublish back to draft, or archive
  archived: ['draft'], // restore an archived post as a draft
};

/** Turn a title into a url-safe slug: lowercase, ascii words joined by '-', no leading/trailing dashes. */
export function slugify(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

export class BlogService {
  private posts = new Map<string, Post>();
  private slugs = new Set<string>();
  private seq = 0;

  /** De-duplicate a base slug: 'hello' -> 'hello', then 'hello-2', 'hello-3', ... */
  private uniqueSlug(base: string): string {
    let slug = base;
    let n = 2;
    while (this.slugs.has(slug)) {
      slug = base + '-' + n++;
    }
    return slug;
  }

  /** Create a post. Starts as a 'draft' with a unique slug derived from the title. */
  createPost(input: { title: string; body?: string; author: string }, now: Date = new Date()): Post {
    const title = String(input?.title ?? '').trim();
    const author = String(input?.author ?? '').trim();
    if (!title) throw new Error('title is required');
    if (!author) throw new Error('author is required');
    const slug = this.uniqueSlug(slugify(title));
    const iso = now.toISOString();
    const post: Post = {
      id: String(++this.seq),
      title,
      slug,
      body: String(input?.body ?? ''),
      author,
      status: 'draft',
      createdAt: iso,
      updatedAt: iso,
      publishedAt: null,
    };
    this.posts.set(post.id, post);
    this.slugs.add(slug);
    return post;
  }

  get(id: string): Post | undefined {
    return this.posts.get(id);
  }

  /** Public lookup by slug — returns a PUBLISHED post only (drafts/archived stay private). */
  getBySlug(slug: string): Post | undefined {
    const wanted = String(slug ?? '').trim();
    for (const p of this.posts.values()) {
      if (p.slug === wanted && p.status === 'published') return p;
    }
    return undefined;
  }

  private require(id: string): Post {
    const p = this.posts.get(id);
    if (!p) throw new Error('post not found');
    return p;
  }

  /** Edit title/body. Editing the title does NOT change the slug (permalinks stay stable). */
  update(id: string, patch: { title?: string; body?: string }, now: Date = new Date()): Post {
    const p = this.require(id);
    if (patch.title !== undefined) {
      const t = String(patch.title).trim();
      if (!t) throw new Error('title cannot be empty');
      p.title = t;
    }
    if (patch.body !== undefined) p.body = String(patch.body);
    p.updatedAt = now.toISOString();
    return p;
  }

  /** Change status, enforcing the allowed lifecycle. Sets publishedAt the first time it goes live. */
  setStatus(id: string, to: PostStatus, now: Date = new Date()): Post {
    const p = this.require(id);
    if (p.status === to) return p;
    if (!STATUS_FLOW[p.status].includes(to)) {
      throw new Error('invalid status transition: ' + p.status + ' -> ' + to);
    }
    p.status = to;
    if (to === 'published' && !p.publishedAt) p.publishedAt = now.toISOString();
    p.updatedAt = now.toISOString();
    return p;
  }

  publish(id: string, now: Date = new Date()): Post {
    return this.setStatus(id, 'published', now);
  }

  unpublish(id: string, now: Date = new Date()): Post {
    return this.setStatus(id, 'draft', now);
  }

  archive(id: string, now: Date = new Date()): Post {
    return this.setStatus(id, 'archived', now);
  }

  /** Public feed — PUBLISHED posts only, newest first. */
  listPublished(): Post[] {
    return [...this.posts.values()]
      .filter((p) => p.status === 'published')
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  }

  /** Admin listing — every post, optionally filtered by status/author. */
  listAll(filter: { status?: PostStatus; author?: string } = {}): Post[] {
    let out = [...this.posts.values()];
    if (filter.status) out = out.filter((p) => p.status === filter.status);
    if (filter.author) out = out.filter((p) => p.author === String(filter.author).trim());
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const blog = new BlogService();
`;

export const BLOG_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { blog } from './blogService';

// REST endpoints for the blog service. Mount with: app.use('/api', blogRouter).
export const blogRouter = Router();

// Create a draft post. { title, body?, author }.
blogRouter.post('/posts', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; body?: unknown; author?: unknown };
  try {
    return res.status(201).json(blog.createPost({ title: String(body.title ?? ''), body: String(body.body ?? ''), author: String(body.author ?? '') }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Admin listing — every post (?status=&author=).
blogRouter.get('/posts', (req: Request, res: Response) => {
  const q = req.query as { status?: string; author?: string };
  const status = ['draft', 'published', 'archived'].includes(String(q.status)) ? (q.status as 'draft') : undefined;
  return res.status(200).json(blog.listAll({ status, author: q.author }));
});

// Public feed — PUBLISHED posts only.
blogRouter.get('/posts/published', (_req: Request, res: Response) => {
  return res.status(200).json(blog.listPublished());
});

// Public read by slug — 404 unless the post is published.
blogRouter.get('/posts/slug/:slug', (req: Request, res: Response) => {
  const p = blog.getBySlug(req.params.slug);
  if (!p) return res.status(404).json({ error: 'post not found' });
  return res.status(200).json(p);
});

// Admin read by id (any status).
blogRouter.get('/posts/:id', (req: Request, res: Response) => {
  const p = blog.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'post not found' });
  return res.status(200).json(p);
});

// Edit title/body (the slug never changes).
blogRouter.patch('/posts/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; body?: unknown };
  const patch: { title?: string; body?: string } = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.body !== undefined) patch.body = String(body.body);
  try {
    return res.status(200).json(blog.update(req.params.id, patch));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    return res.status(message === 'post not found' ? 404 : 400).json({ error: message });
  }
});

// Change status. { status } — 409 on an invalid lifecycle transition, 404 if unknown.
blogRouter.patch('/posts/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(blog.setStatus(req.params.id, String(body.status ?? '') as 'draft'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    if (message === 'post not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});
`;

const BLOG_README = `# Blog / CMS

A real content backend. The core guarantees: a post's status follows an allowed **lifecycle state-machine**
(\`draft ↔ published ↔ archived\`), every post gets a **unique, human-readable slug** derived from its title,
and the public feed returns **published posts only**. Files:

- \`blogService.ts\` — the domain logic (\`BlogService\` + a \`blog\` singleton, plus a \`slugify\` helper). In-memory;
  swap the Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { blogRouter } from './server/blog/routes';
app.use('/api', blogRouter);
\`\`\`

Endpoints:
- \`POST /api/posts\` \`{ title, body?, author }\` → creates a **draft** with a unique slug.
- \`GET  /api/posts\` (\`?status=&author=\`) — admin listing (every post).
- \`GET  /api/posts/published\` — public feed (published only).
- \`GET  /api/posts/slug/:slug\` — public read (**404** unless published).
- \`GET  /api/posts/:id\` — admin read by id (any status).
- \`PATCH /api/posts/:id\` \`{ title?, body? }\` — edit (the slug stays stable).
- \`PATCH /api/posts/:id/status\` \`{ status }\` → **409** on an invalid transition.

Editing a title never rewrites the slug, so permalinks stay stable. Identify the author by your auth user id.
`;

export interface BlogConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Blog / CMS starter wired under server/blog/ (dependency-free domain logic + an Express router). The real ' +
  'guarantees are a publish STATE-MACHINE (draft↔published↔archived) enforced by setStatus(), UNIQUE-slug ' +
  'generation from the title (de-duplicated: hello, hello-2, hello-3), and a public feed that returns PUBLISHED ' +
  'posts only (drafts/archived stay private). routes.ts exposes POST /posts, GET /posts (admin), GET ' +
  '/posts/published (public feed), GET /posts/slug/:slug (404 unless published), GET /posts/:id, PATCH /posts/:id ' +
  'and PATCH /posts/:id/status (409 on invalid transition). Mount with app.use("/api", blogRouter). Editing a ' +
  'title never changes the slug so permalinks stay stable. In-memory by default — swap the Maps for your DB.';

export function generateBlogIntegration(): BlogConfig {
  return {
    files: {
      'server/blog/blogService.ts': BLOG_SERVICE_SOURCE,
      'server/blog/routes.ts': BLOG_ROUTES_SOURCE,
      'server/blog/README.md': BLOG_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

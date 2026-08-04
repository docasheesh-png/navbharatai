// Roadmap breadth — tags / taxonomy starter (a packaged domain vertical).
//
// A cross-cutting vertical used by blogs, ecommerce, CRMs, task boards and any app that labels content. The
// real feature is TAG INTEGRITY: a (tag, entity) attachment exists AT MOST ONCE (idempotent tagging), a tag is
// canonicalized (trimmed, lower-cased, deduped by slug) so "React" and "react " are the same tag, renaming a
// tag CASCADES to every attachment (and merges into an existing tag if the new name collides), and per-tag
// usage counts are always exact. This emits a dependency-free TagService + an Express router + a README. Real
// logic, not a stub — the dedup + rename-cascade + count rules are unit-tested against the emitted code. Pure
// builder → the caller writes the files.

export const TAGS_SERVICE_SOURCE = `// Tags / taxonomy domain logic. The core guarantees: (1) tags are canonical (trimmed, lower-cased slug) so
// "React" and " react " are the same tag, (2) a (tag, entity) attachment exists AT MOST ONCE (tagging is
// idempotent), (3) renaming a tag CASCADES to every attachment and MERGES into an existing tag if the target
// slug already exists, and (4) usage counts are exact. In-memory here; swap the structures for your database,
// keeping the same method contracts.

export interface TagInfo {
  slug: string;   // canonical id (lower-case, spaces→hyphens)
  label: string;  // display label (last-set human form)
  count: number;  // number of entities tagged
}

export function slugifyTag(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class TagService {
  // slug -> display label
  private labels = new Map<string, string>();
  // slug -> set of entity ids
  private tagToEntities = new Map<string, Set<string>>();
  // entity id -> set of tag slugs
  private entityToTags = new Map<string, Set<string>>();

  /** Attach a tag to an entity. Idempotent — tagging twice is a no-op. Returns { added }. */
  tag(entity: string, tagLabel: string): { slug: string; added: boolean } {
    const e = String(entity).trim();
    if (!e) throw new Error('entity is required');
    const slug = slugifyTag(tagLabel);
    if (!slug) throw new Error('a non-empty tag is required');
    this.labels.set(slug, String(tagLabel).trim() || slug);
    const ents = this.tagToEntities.get(slug) ?? new Set<string>();
    const already = ents.has(e);
    ents.add(e);
    this.tagToEntities.set(slug, ents);
    const tags = this.entityToTags.get(e) ?? new Set<string>();
    tags.add(slug);
    this.entityToTags.set(e, tags);
    return { slug, added: !already };
  }

  /** Detach a tag from an entity. Idempotent — returns { removed }. */
  untag(entity: string, tagLabel: string): { removed: boolean } {
    const e = String(entity).trim();
    const slug = slugifyTag(tagLabel);
    const ents = this.tagToEntities.get(slug);
    const removed = ents ? ents.delete(e) : false;
    if (removed) {
      if (ents && ents.size === 0) { this.tagToEntities.delete(slug); this.labels.delete(slug); }
      const tags = this.entityToTags.get(e);
      if (tags) { tags.delete(slug); if (tags.size === 0) this.entityToTags.delete(e); }
    }
    return { removed };
  }

  /** The canonical tags on an entity (labels), sorted. */
  tagsOf(entity: string): string[] {
    const tags = this.entityToTags.get(String(entity).trim());
    if (!tags) return [];
    return [...tags].map((s) => this.labels.get(s) ?? s).sort();
  }

  /** The entity ids carrying a tag. */
  entitiesWith(tagLabel: string): string[] {
    const ents = this.tagToEntities.get(slugifyTag(tagLabel));
    return ents ? [...ents].sort() : [];
  }

  /**
   * Rename a tag. CASCADES to every attachment. If the new slug already exists, the two tags MERGE (entities
   * are unioned, counts combined). Returns the resulting canonical slug.
   */
  rename(fromLabel: string, toLabel: string): { slug: string; merged: boolean } {
    const from = slugifyTag(fromLabel);
    const to = slugifyTag(toLabel);
    if (!to) throw new Error('a non-empty new tag is required');
    if (from === to) { this.labels.set(to, String(toLabel).trim() || to); return { slug: to, merged: false }; }
    const fromEnts = this.tagToEntities.get(from);
    if (!fromEnts) throw new Error('unknown tag');
    const merged = this.tagToEntities.has(to);
    const toEnts = this.tagToEntities.get(to) ?? new Set<string>();
    for (const e of fromEnts) {
      toEnts.add(e);
      const tags = this.entityToTags.get(e);
      if (tags) { tags.delete(from); tags.add(to); }
    }
    this.tagToEntities.set(to, toEnts);
    this.labels.set(to, String(toLabel).trim() || to);
    this.tagToEntities.delete(from);
    this.labels.delete(from);
    return { slug: to, merged };
  }

  /** All tags with their exact usage counts, most-used first. */
  all(): TagInfo[] {
    return [...this.tagToEntities.entries()]
      .map(([slug, ents]) => ({ slug, label: this.labels.get(slug) ?? slug, count: ents.size }))
      .sort((a, b) => (b.count - a.count) || a.slug.localeCompare(b.slug));
  }

  /** Exact number of entities carrying a tag. */
  count(tagLabel: string): number {
    return this.tagToEntities.get(slugifyTag(tagLabel))?.size ?? 0;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const tags = new TagService();
`;

export const TAGS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { tags } from './tagService';

// REST endpoints for the tag service. Mount with: app.use('/api', tagRouter).
export const tagRouter = Router();

// Attach a tag to an entity (idempotent). { entity, tag }.
tagRouter.post('/tags', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { entity?: unknown; tag?: unknown };
  try {
    const result = tags.tag(String(body.entity ?? ''), String(body.tag ?? ''));
    return res.status(result.added ? 201 : 200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Detach a tag from an entity (idempotent).
tagRouter.delete('/tags', (req: Request, res: Response) => {
  const q = req.query as { entity?: string; tag?: string };
  return res.status(200).json(tags.untag(String(q.entity ?? ''), String(q.tag ?? '')));
});

// All tags with usage counts.
tagRouter.get('/tags', (_req: Request, res: Response) => {
  return res.status(200).json(tags.all());
});

// The entities carrying a tag.
tagRouter.get('/tags/:tag/entities', (req: Request, res: Response) => {
  return res.status(200).json({ tag: req.params.tag, entities: tags.entitiesWith(req.params.tag), count: tags.count(req.params.tag) });
});

// The tags on an entity.
tagRouter.get('/entities/:entity/tags', (req: Request, res: Response) => {
  return res.status(200).json({ entity: req.params.entity, tags: tags.tagsOf(req.params.entity) });
});

// Rename a tag (cascades; merges if the target exists). { from, to }.
tagRouter.post('/tags/rename', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
  try {
    return res.status(200).json(tags.rename(String(body.from ?? ''), String(body.to ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not rename';
    return res.status(message === 'unknown tag' ? 404 : 400).json({ error: message });
  }
});
`;

const TAGS_README = `# Tags / taxonomy

A real tagging backend. The core guarantees: tags are **canonical** (trimmed, lower-cased slug) so \`React\` and
\` react \` are the same tag, a \`(tag, entity)\` attachment exists **at most once** (idempotent), **renaming
cascades** to every attachment (and **merges** into an existing tag if the target already exists), and per-tag
usage counts are **exact**. Files:

- \`tagService.ts\` — the domain logic (\`TagService\` + a \`tags\` singleton, plus a \`slugifyTag\` helper). In-memory;
  swap the structures for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { tagRouter } from './server/tags/routes';
app.use('/api', tagRouter);
\`\`\`

Endpoints:
- \`POST /api/tags\` \`{ entity, tag }\` → attach (idempotent; 201 new / 200 existing).
- \`DELETE /api/tags\` (\`?entity=&tag=\`) → detach (idempotent).
- \`GET  /api/tags\` → all tags with usage counts (most-used first).
- \`GET  /api/tags/:tag/entities\` → the entities carrying a tag (+ count).
- \`GET  /api/entities/:entity/tags\` → the tags on an entity.
- \`POST /api/tags/rename\` \`{ from, to }\` → rename (cascades; **merges** if \`to\` already exists).

\`entity\` is any id you tag (a post id, a product id, a contact id). Use with the blog / listings / CRM recipes.
`;

export interface TagsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Tags / taxonomy starter wired under server/tags/ (dependency-free domain logic + an Express router). The ' +
  'real guarantee is TAG INTEGRITY: tags are canonicalized (trimmed, lower-cased slug) so "React" and " react " ' +
  'are one tag; tag()/untag() are idempotent (a (tag,entity) attachment exists at most once); rename() CASCADES ' +
  'to every attachment and MERGES into an existing tag if the target slug already exists; all()/count() report ' +
  'exact usage. routes.ts exposes POST /tags (201 new / 200 existing), DELETE /tags (?entity=&tag=), GET /tags ' +
  '(usage counts), GET /tags/:tag/entities, GET /entities/:entity/tags and POST /tags/rename ({from,to}, 404 on ' +
  'unknown tag). Mount with app.use("/api", tagRouter). entity is any id you tag (post/product/contact). ' +
  'In-memory by default — swap the structures for your DB. Pairs with generate_blog / generate_listings / generate_crm.';

export function generateTagsIntegration(): TagsConfig {
  return {
    files: {
      'server/tags/tagService.ts': TAGS_SERVICE_SOURCE,
      'server/tags/routes.ts': TAGS_ROUTES_SOURCE,
      'server/tags/README.md': TAGS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

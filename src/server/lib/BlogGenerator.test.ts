import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBlogIntegration, BLOG_SERVICE_SOURCE } from './BlogGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateBlogIntegration (wiring)', () => {
  it('emits the blog service, routes and README', () => {
    const out = generateBlogIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/blog/blogService.ts');
    expect(paths).toContain('server/blog/routes.ts');
    expect(paths).toContain('server/blog/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/blog/routes.ts']).toContain('export const blogRouter');
    expect(out.files['server/blog/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the publish state-machine + unique-slug generation are
// real business rules, verified against the actual emitted code.
describe('emitted BlogService — publish state-machine + unique slugs (real logic)', () => {
  const artifact = join(here, `._blog_emitted_${process.pid}.ts`);
  writeFileSync(artifact, BLOG_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  type Status = 'draft' | 'published' | 'archived';
  interface Post { id: string; slug: string; status: Status; title: string; publishedAt: string | null }
  interface Service {
    createPost(i: { title: string; body?: string; author: string }, now?: Date): Post;
    get(id: string): Post | undefined;
    getBySlug(slug: string): Post | undefined;
    update(id: string, patch: { title?: string; body?: string }, now?: Date): Post;
    setStatus(id: string, to: Status, now?: Date): Post;
    publish(id: string, now?: Date): Post;
    unpublish(id: string, now?: Date): Post;
    archive(id: string, now?: Date): Post;
    listPublished(): Post[];
    listAll(f?: { status?: Status; author?: string }): Post[];
  }
  interface Emitted { BlogService: new () => Service; slugify(s: string): string }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  const T0 = new Date('2026-01-01T00:00:00.000Z');

  it('createPost starts as a draft with a slug derived from the title', async () => {
    const { BlogService } = await load();
    const svc = new BlogService();
    const p = svc.createPost({ title: 'Hello World!', body: 'hi', author: 'asha' }, T0);
    expect(p.status).toBe('draft');
    expect(p.slug).toBe('hello-world');
    expect(p.publishedAt).toBeNull();
  });

  it('generates UNIQUE slugs when titles collide (hello, hello-2, hello-3)', async () => {
    const { BlogService, slugify } = await load();
    expect(slugify('  Rockets & Rovers  ')).toBe('rockets-rovers');
    const svc = new BlogService();
    const a = svc.createPost({ title: 'Hello', author: 'x' });
    const b = svc.createPost({ title: 'Hello', author: 'x' });
    const c = svc.createPost({ title: 'hello', author: 'x' });
    expect([a.slug, b.slug, c.slug]).toEqual(['hello', 'hello-2', 'hello-3']);
  });

  it('enforces the publish state-machine (draft↔published↔archived; invalid rejected)', async () => {
    const { BlogService } = await load();
    const svc = new BlogService();
    const p = svc.createPost({ title: 'Post', author: 'x' }, T0);
    // publish sets publishedAt once
    const pub = svc.publish(p.id, new Date('2026-02-01T00:00:00.000Z'));
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).toBe('2026-02-01T00:00:00.000Z');
    // republishing later keeps the FIRST publishedAt
    svc.unpublish(p.id);
    const again = svc.publish(p.id, new Date('2026-03-01T00:00:00.000Z'));
    expect(again.publishedAt).toBe('2026-02-01T00:00:00.000Z');
    // archived can't jump straight to published
    svc.archive(p.id);
    expect(() => svc.setStatus(p.id, 'published')).toThrow(/invalid status transition/);
    // but an archived post can be restored to draft
    expect(svc.setStatus(p.id, 'draft').status).toBe('draft');
  });

  it('public getBySlug + listPublished return PUBLISHED posts only', async () => {
    const { BlogService } = await load();
    const svc = new BlogService();
    const draft = svc.createPost({ title: 'Draft One', author: 'x' });
    const live = svc.createPost({ title: 'Live One', author: 'x' });
    svc.publish(live.id, new Date('2026-02-01T00:00:00.000Z'));
    // a draft is invisible to the public API
    expect(svc.getBySlug(draft.slug)).toBeUndefined();
    expect(svc.getBySlug(live.slug)?.id).toBe(live.id);
    const feed = svc.listPublished();
    expect(feed.map((p) => p.id)).toEqual([live.id]);
    // admin listing still sees everything
    expect(svc.listAll().length).toBe(2);
  });

  it('editing a title never rewrites the slug (permalinks stay stable)', async () => {
    const { BlogService } = await load();
    const svc = new BlogService();
    const p = svc.createPost({ title: 'Original Title', author: 'x' });
    const slug = p.slug;
    const updated = svc.update(p.id, { title: 'A Completely New Title' });
    expect(updated.title).toBe('A Completely New Title');
    expect(updated.slug).toBe(slug);
  });

  it('validates input and unknown post', async () => {
    const { BlogService } = await load();
    const svc = new BlogService();
    expect(() => svc.createPost({ title: '', author: 'x' })).toThrow(/title is required/);
    expect(() => svc.createPost({ title: 'x', author: '' })).toThrow(/author is required/);
    expect(() => svc.setStatus('nope', 'published')).toThrow(/post not found/);
    expect(() => svc.update('nope', { title: 'y' })).toThrow(/post not found/);
  });
});

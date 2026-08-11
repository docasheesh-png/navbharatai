import { describe, it, expect, afterAll } from 'vitest';

import { generateTagsIntegration, TAGS_SERVICE_SOURCE } from './TagsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateTagsIntegration (wiring)', () => {
  it('emits the tag service, routes and README', () => {
    const out = generateTagsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/tags/tagService.ts');
    expect(paths).toContain('server/tags/routes.ts');
    expect(paths).toContain('server/tags/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/tags/routes.ts']).toContain('export const tagRouter');
  });
});

// Materialize + execute the emitted domain logic — the dedup + rename-cascade + count rules are real business
// rules, verified against the actual emitted code.
describe('emitted TagService — canonical dedup + rename cascade + exact counts (real logic)', () => {
  const emitted = emitModule('tags', TAGS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface TagInfo { slug: string; label: string; count: number }
  interface Service {
    tag(entity: string, tagLabel: string): { slug: string; added: boolean };
    untag(entity: string, tagLabel: string): { removed: boolean };
    tagsOf(entity: string): string[];
    entitiesWith(tagLabel: string): string[];
    rename(fromLabel: string, toLabel: string): { slug: string; merged: boolean };
    all(): TagInfo[];
    count(tagLabel: string): number;
  }
  interface Emitted { TagService: new () => Service; slugifyTag(s: string): string }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('canonicalizes tags and dedups attachments (idempotent)', async () => {
    const { TagService, slugifyTag } = await load();
    expect(slugifyTag('  React JS! ')).toBe('react-js');
    const svc = new TagService();
    expect(svc.tag('post1', 'React').added).toBe(true);
    // same tag, different case/spacing → same slug, no double attach
    expect(svc.tag('post1', ' react ').added).toBe(false);
    expect(svc.count('react')).toBe(1);
    expect(svc.tagsOf('post1')).toEqual(['react']); // last-set label wins (the 2nd call set 'react')
  });

  it('tracks tags-of-entity and entities-with-tag with exact counts', async () => {
    const { TagService } = await load();
    const svc = new TagService();
    svc.tag('post1', 'react');
    svc.tag('post2', 'react');
    svc.tag('post1', 'typescript');
    expect(svc.entitiesWith('react').sort()).toEqual(['post1', 'post2']);
    expect(svc.tagsOf('post1').sort()).toEqual(['react', 'typescript']);
    expect(svc.count('react')).toBe(2);
    const all = svc.all();
    expect(all[0]).toMatchObject({ slug: 'react', count: 2 }); // most-used first
  });

  it('untag is idempotent and cleans up empty tags', async () => {
    const { TagService } = await load();
    const svc = new TagService();
    svc.tag('post1', 'react');
    expect(svc.untag('post1', 'react').removed).toBe(true);
    expect(svc.untag('post1', 'react').removed).toBe(false); // already gone
    expect(svc.count('react')).toBe(0);
    expect(svc.all().find((t) => t.slug === 'react')).toBeUndefined(); // empty tag removed
  });

  it('rename CASCADES to every attachment', async () => {
    const { TagService } = await load();
    const svc = new TagService();
    svc.tag('post1', 'js');
    svc.tag('post2', 'js');
    const r = svc.rename('js', 'JavaScript');
    expect(r).toMatchObject({ slug: 'javascript', merged: false });
    expect(svc.count('js')).toBe(0);
    expect(svc.count('javascript')).toBe(2);
    expect(svc.tagsOf('post1')).toEqual(['JavaScript']);
    expect(svc.entitiesWith('javascript').sort()).toEqual(['post1', 'post2']);
  });

  it('rename MERGES into an existing tag (union of entities); unknown tag rejected', async () => {
    const { TagService } = await load();
    const svc = new TagService();
    svc.tag('post1', 'js');
    svc.tag('post2', 'javascript');
    svc.tag('post1', 'javascript'); // post1 has both
    const r = svc.rename('js', 'javascript');
    expect(r.merged).toBe(true);
    expect(svc.count('js')).toBe(0);
    // union of {post1,post2}(js→) and {post1,post2}(javascript) → still 2 distinct entities
    expect(svc.count('javascript')).toBe(2);
    expect(svc.entitiesWith('javascript').sort()).toEqual(['post1', 'post2']);
    expect(() => svc.rename('nope', 'x')).toThrow(/unknown tag/);
    expect(() => svc.tag('', 'x')).toThrow(/entity is required/);
    expect(() => svc.tag('p', '  ')).toThrow(/non-empty tag/);
  });
});

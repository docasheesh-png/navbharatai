import { describe, it, expect } from 'vitest';
import { buildDocsModel, groupKeyFor, renderDocsHtml } from './KnowledgeDocs';
import { APP_KNOWLEDGE_BASE, type AppFeature } from '../AppContext/AppKnowledgeBase';

function feat(partial: Partial<AppFeature> & { id: string; name: string }): AppFeature {
  return {
    path: 'x', description: 'd', howToUse: 'h', relatedFeatures: [], keywords: [],
    ...partial,
  };
}

describe('groupKeyFor', () => {
  it('routes agentv3 ids to the builder group regardless of surface', () => {
    expect(groupKeyFor(feat({ id: 'agentv3_builder', name: 'V3' }))).toBe('agentv3');
  });
  it('keeps major surfaces distinct', () => {
    expect(groupKeyFor(feat({ id: 'x', name: 'x', aiSurface: 'pro_chat' }))).toBe('pro_chat');
    expect(groupKeyFor(feat({ id: 'y', name: 'y', aiSurface: 'engineer_ai' }))).toBe('engineer_ai');
  });
  it('funnels single professional AIs into one professionals group', () => {
    expect(groupKeyFor(feat({ id: 'a', name: 'a', aiSurface: 'lawyer_ai' }))).toBe('professionals');
    expect(groupKeyFor(feat({ id: 'b', name: 'b', aiSurface: 'chef_ai' }))).toBe('professionals');
  });
  it('routes surfaceless entries to the platform group', () => {
    expect(groupKeyFor(feat({ id: 'p', name: 'p' }))).toBe('platform');
  });
});

describe('buildDocsModel', () => {
  it('places every feature exactly once (no drops, no dupes)', () => {
    const model = buildDocsModel(APP_KNOWLEDGE_BASE);
    const count = model.groups.reduce((s, g) => s + g.features.length, 0);
    expect(count).toBe(APP_KNOWLEDGE_BASE.length);
    expect(model.totalFeatures).toBe(APP_KNOWLEDGE_BASE.length);
    const ids = model.groups.flatMap((g) => g.features.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits builder/chat sections before professionals and platform', () => {
    const model = buildDocsModel(APP_KNOWLEDGE_BASE);
    const keys = model.groups.map((g) => g.key);
    // professionals + platform should exist and come after the major surfaces
    expect(keys).toContain('professionals');
    expect(keys).toContain('platform');
    if (keys.includes('pro_chat') && keys.includes('professionals')) {
      expect(keys.indexOf('pro_chat')).toBeLessThan(keys.indexOf('professionals'));
    }
    expect(keys.indexOf('professionals')).toBeLessThan(keys.indexOf('platform'));
  });

  it('omits empty groups', () => {
    const model = buildDocsModel([feat({ id: 'p', name: 'Solo Platform Thing' })]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].key).toBe('platform');
  });

  it('sorts features alphabetically within a group', () => {
    const model = buildDocsModel([
      feat({ id: 'z', name: 'Zebra', aiSurface: 'lawyer_ai' }),
      feat({ id: 'a', name: 'Apple', aiSurface: 'chef_ai' }),
    ]);
    expect(model.groups[0].features.map((f) => f.name)).toEqual(['Apple', 'Zebra']);
  });
});

describe('renderDocsHtml', () => {
  const html = renderDocsHtml(buildDocsModel(APP_KNOWLEDGE_BASE));

  it('is a self-contained page with no external resource references', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:\/\//); // only in-page + same-origin links
    expect(html).toContain('/api/knowledge-base');
  });

  it('renders a searchable feature list including a known feature', () => {
    expect(html).toContain('id="q"'); // search box
    expect(html).toContain('data-search='); // client-side filter data
    expect(html).toContain('NavBharatAI Pro v5.0');
  });

  it('HTML-escapes content to prevent injection', () => {
    const model = buildDocsModel([feat({ id: 'x', name: '<script>alert(1)</script>' })]);
    const out = renderDocsHtml(model);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

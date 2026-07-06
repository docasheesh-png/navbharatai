import { describe, it, expect } from 'vitest';
import { buildLibraryItem, normalizeKind, MAX_LIBRARY_CONTENT } from './TeamLibraryStore';

describe('normalizeKind', () => {
  it('accepts known kinds and defaults unknown to prompt', () => {
    expect(normalizeKind('template')).toBe('template');
    expect(normalizeKind('COMPONENT')).toBe('component');
    expect(normalizeKind('prompt')).toBe('prompt');
    expect(normalizeKind('bogus')).toBe('prompt');
    expect(normalizeKind(undefined)).toBe('prompt');
  });
});

describe('buildLibraryItem', () => {
  const base = { id: 'i1', teamId: 't1', createdBy: 'u1', now: 1000 };

  it('builds a valid item and trims/caps fields', () => {
    const item = buildLibraryItem({ ...base, kind: 'template', title: '  My Template  ', content: 'body' });
    expect(item).not.toBeNull();
    expect(item!.title).toBe('My Template');
    expect(item!.kind).toBe('template');
    expect(item!.createdAt).toBe(1000);
    expect(item!.teamId).toBe('t1');
  });

  it('returns null when title or content is empty', () => {
    expect(buildLibraryItem({ ...base, kind: 'prompt', title: '   ', content: 'x' })).toBeNull();
    expect(buildLibraryItem({ ...base, kind: 'prompt', title: 'ok', content: '   ' })).toBeNull();
  });

  it('returns null without a team or id', () => {
    expect(buildLibraryItem({ ...base, teamId: '', kind: 'prompt', title: 'ok', content: 'x' })).toBeNull();
    expect(buildLibraryItem({ ...base, id: '', kind: 'prompt', title: 'ok', content: 'x' })).toBeNull();
  });

  it('caps content at the maximum size', () => {
    const big = 'a'.repeat(MAX_LIBRARY_CONTENT + 5000);
    const item = buildLibraryItem({ ...base, kind: 'component', title: 'Big', content: big });
    expect(item!.content.length).toBe(MAX_LIBRARY_CONTENT);
  });

  it('normalizes an unknown kind to prompt', () => {
    expect(buildLibraryItem({ ...base, kind: 'weird', title: 'ok', content: 'x' })!.kind).toBe('prompt');
  });
});

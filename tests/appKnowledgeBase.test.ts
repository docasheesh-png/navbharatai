import { describe, it, expect } from 'vitest';
import { APP_KNOWLEDGE_BASE, getFeatureById } from '../src/server/AppContext/AppKnowledgeBase';

describe('APP_KNOWLEDGE_BASE', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(APP_KNOWLEDGE_BASE)).toBe(true);
    expect(APP_KNOWLEDGE_BASE.length).toBeGreaterThan(0);
  });

  it('every entry has required fields', () => {
    for (const feature of APP_KNOWLEDGE_BASE) {
      expect(feature.id).toBeTruthy();
      expect(feature.name).toBeTruthy();
      expect(feature.path).toBeTruthy();
      expect(feature.description).toBeTruthy();
      expect(Array.isArray(feature.keywords)).toBe(true);
    }
  });

  it('contains "engineer_ai" entry', () => {
    const entry = APP_KNOWLEDGE_BASE.find(f => f.id === 'engineer_ai');
    expect(entry).toBeDefined();
  });

  it('all IDs are unique (no duplicates)', () => {
    const ids = APP_KNOWLEDGE_BASE.map(f => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('getFeatureById', () => {
  it('returns null for unknown id', () => {
    expect(getFeatureById('does-not-exist')).toBeNull();
  });

  it('returns the feature for a known id', () => {
    const feature = getFeatureById('engineer_ai');
    expect(feature).not.toBeNull();
    expect(feature?.id).toBe('engineer_ai');
  });
});

import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../src/server/AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

describe('AppContextInjector', () => {
  it('returns empty for an empty message', () => {
    expect(AppContextInjector.getRelevantContext('')).toBe('');
  });

  it('returns empty for an unrelated clinical question (Doctor AI safety)', () => {
    // A real clinical question must NOT trigger app-context injection — this is
    // what guarantees Doctor AI behavior is unchanged for medical turns.
    const out = AppContextInjector.getRelevantContext(
      '45 year old male with crushing chest pain radiating to the left arm, what are the differentials?',
      'sda_chat',
    );
    expect(out).toBe('');
  });

  it('returns empty for an unrelated coding request (Engineer AI safety)', () => {
    const out = AppContextInjector.getRelevantContext(
      'build me a todo app with localStorage persistence',
      'engineer_ai',
    );
    expect(out).toBe('');
  });

  it('injects the database entry when the user asks where the database settings are', () => {
    const out = AppContextInjector.getRelevantContext('where do I add my database credentials?');
    expect(out).toContain('Database');
    expect(out).toContain('Settings');
  });

  it('does NOT inject on a single ambiguous tech keyword (protects coding turns)', () => {
    // "supabase" alone is ambiguous — it could be part of a build instruction like
    // "build a supabase todo app". A single weak keyword must not inject.
    expect(AppContextInjector.getRelevantContext('supabase')).toBe('');
    expect(AppContextInjector.getRelevantContext('build a supabase todo app', 'engineer_ai')).toBe('');
  });

  it('injects on a strong multi-keyword app phrase without a question word', () => {
    const out = AppContextInjector.getRelevantContext('connect my supabase database');
    expect(out).toContain('Database');
  });

  it('returns a full summary for a whole-app question', () => {
    const out = AppContextInjector.getRelevantContext('what can this app do?');
    expect(out).toContain('Engineer AI');
    expect(out).toContain('Doctor AI');
    // Full summary lists many features.
    expect(out.length).toBeGreaterThan(500);
  });

  it('every knowledge-base entry has the required fields', () => {
    for (const f of APP_KNOWLEDGE_BASE) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.path).toBeTruthy();
      expect(Array.isArray(f.keywords)).toBe(true);
      expect(f.keywords.length).toBeGreaterThan(0);
    }
  });
});

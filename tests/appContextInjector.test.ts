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

  it('injects all surface features when asked "what can you do?" on a specific AI', () => {
    const out = AppContextInjector.getRelevantContext('what can you do?', 'engineer_ai');
    expect(out).toContain('Engineer AI');
    // Should return multiple engineer_ai entries
    expect(out.length).toBeGreaterThan(200);
  });

  it('injects surface capabilities for Hindi "kya kya kar sakte ho"', () => {
    const out = AppContextInjector.getRelevantContext('aap kya kya kar sakte ho?', 'engineer_ai');
    expect(out).toContain('Engineer AI');
  });

  it('getSurfaceFeatures returns only entries for that surface', () => {
    const engineerFeatures = AppContextInjector.getSurfaceFeatures('engineer_ai');
    expect(engineerFeatures.length).toBeGreaterThan(0);
    expect(engineerFeatures.every(f => f.aiSurface === 'engineer_ai')).toBe(true);
    // Doctor AI entries should not appear
    expect(engineerFeatures.some(f => f.id === 'doctor_ai')).toBe(false);
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

  it('knowledge base has grown beyond the original 17 entries', () => {
    // Expanded KB covers IDE panels, sub-features, navigation — must have more entries
    expect(APP_KNOWLEDGE_BASE.length).toBeGreaterThan(20);
  });

  it('doctor AI keywords contain no clinical content terms that could match patient conversations', () => {
    const doctorEntry = APP_KNOWLEDGE_BASE.find(f => f.id === 'doctor_ai')!;
    const forbiddenClinicalTerms = ['differentials', 'diagnosis', 'patient', 'clinical', 'medical', 'investigation', 'history taking', 'red flag'];
    for (const term of forbiddenClinicalTerms) {
      expect(doctorEntry.keywords).not.toContain(term);
    }
  });
});

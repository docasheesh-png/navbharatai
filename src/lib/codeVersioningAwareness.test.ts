import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../server/AppContext/AppKnowledgeBase';
import { searchFeatures, navFor } from './offlineAssistant';

// Admin 2026-07-24: make every AI aware of Code Versioning and, whenever a user expresses the INTENT to
// undo / go back / reverse a change (in ANY wording, not one literal phrase), guide them to restore an
// earlier version. These tests lock the intent-based awareness across Free / Pro / Offline.

const cv = APP_KNOWLEDGE_BASE.find(f => f.id === 'code_versioning');

describe('Code Versioning — intent-based undo awareness', () => {
  it('exists as a first-class KB feature with a current path + one-tap nav', () => {
    expect(cv).toBeTruthy();
    expect(cv!.path).toContain('Other AI → Developer Tools → Versioning');
    expect(navFor(cv!)).toEqual({ view: 'versioning' });
  });

  it('is framed around undo / restore, not just "versioning"', () => {
    const text = `${cv!.name} ${cv!.description} ${cv!.howToUse}`.toLowerCase();
    expect(text).toMatch(/undo/);
    expect(text).toMatch(/restore/);
    expect(text).toMatch(/go back|earlier version|previous/);
  });

  it('Free (nbi_chat) and Pro (pro_chat) chat surface it for varied undo INTENT phrasings', () => {
    const intents = [
      'how do I undo my last change',
      'go back to previous version',
      'app kharab ho gaya',
      'undo karo',
      'pehle jaisa kar do',
      'yeh change hata do',
      'this change broke my app',
    ];
    for (const surface of ['nbi_chat', 'pro_chat']) {
      for (const q of intents) {
        const ctx = AppContextInjector.getRelevantContext(q, surface);
        expect(ctx, `${surface} / "${q}"`).toContain('Code Versioning');
      }
    }
  });

  it('the OFFLINE AI finds it for undo/restore intent (same shared KB)', () => {
    for (const q of ['undo', 'restore previous version', 'go back', 'revert change', 'purana version wapas', 'app bigad gayi']) {
      const ids = searchFeatures(q).map(m => m.feature.id);
      expect(ids, `offline / "${q}"`).toContain('code_versioning');
    }
  });
});

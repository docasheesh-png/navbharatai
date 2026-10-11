import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../server/AppContext/AppKnowledgeBase';

// Admin 2026-07-24: make every AI aware of Code Versioning and, whenever a user expresses the INTENT to
// undo / go back / reverse a change (in ANY wording, not one literal phrase), guide them to restore an
// earlier version. These tests lock the intent-based awareness across Free / Pro (the Offline AI was deleted in #2948).

const cv = APP_KNOWLEDGE_BASE.find(f => f.id === 'code_versioning');

describe('Code Versioning — intent-based undo awareness', () => {
  it('exists as a first-class KB feature with a current path + one-tap nav', () => {
    expect(cv).toBeTruthy();
    expect(cv!.path).toContain('Other AI → AI Tools → Versioning');
    // The "one-tap nav" this test is named for — it lived in the Offline AI's map until that feature was
    // deleted (#2948) and the target moved into the KB entry; the assertion went with the module and the
    // name kept promising it (an empty-test sweep, 2026-10-11).
    expect(cv!.nav).toEqual({ view: 'versioning' });
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

});

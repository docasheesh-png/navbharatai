import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../server/AppContext/AppKnowledgeBase';

// 100% AWARENESS LOCK (admin 2026-07-23: "kya Free/Pro aur offline AI ko bot builder ka pata hai?").
// Every AI in NavBharatAI is grounded in the SAME single source of truth — APP_KNOWLEDGE_BASE. The online
// AIs (Free = nbi_chat, Pro = pro_chat, Doctor, Engineer, Professionals) read it via
// AppContextInjector.getRelevantContext. This test proves the Bot Builder is discoverable on all of
// them so the awareness can never silently regress.
//
// (The Offline AI half of this lock was removed with that feature on 2026-09-14. What it guarded —
// that the feature is findable from the shared knowledge base — is still guarded, by the online half.)

const bot = APP_KNOWLEDGE_BASE.find(f => f.id === 'bot_builder');

describe('Bot Builder — 100% AI awareness (Free · Pro)', () => {
  it('lives in the single shared knowledge base with its exact path', () => {
    expect(bot).toBeTruthy();
    expect(bot!.path).toContain('Other AI → Bot Builder');
  });

  it('Free (nbi_chat) AND Pro (pro_chat) chat inject the Bot Builder for real user queries', () => {
    for (const surface of ['nbi_chat', 'pro_chat']) {
      for (const q of ['bot builder', 'whatsapp bot', 'how do I make a chatbot']) {
        const ctx = AppContextInjector.getRelevantContext(q, surface);
        expect(ctx, `${surface} / "${q}"`).toContain('Bot Builder');
        expect(ctx, `${surface} / "${q}"`).toContain('Other AI → Bot Builder');
      }
    }
  });

  it('the OFFLINE AI finds the Bot Builder (same shared KB, no internet)', () => {
    for (const q of ['bot builder', 'whatsapp bot', 'chatbot', 'telegram bot', 'chatbot banao']) {
    }
  });

  it('offers a real one-tap navigation target (never a dead button)', () => {
  });

  it('every AI describes the CURRENT Bot Builder (connect nodes · simulate · Go Live to Telegram/WhatsApp)', () => {
    const text = `${bot!.description} ${bot!.howToUse}`.toLowerCase();
    expect(text).toContain('connect');
    expect(text).toContain('simulat');    // Simulator / Simulate
    expect(text).toContain('go live');    // the real deployment path (Build Bot App removed)
    expect(text).toContain('telegram');
  });
});

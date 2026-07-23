import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../server/AppContext/AppKnowledgeBase';
import { searchFeatures, navFor } from './offlineAssistant';

// 100% AWARENESS LOCK (admin 2026-07-23: "kya Free/Pro aur offline AI ko bot builder ka pata hai?").
// Every AI in NavBharatAI is grounded in the SAME single source of truth — APP_KNOWLEDGE_BASE. The online
// AIs (Free = nbi_chat, Pro = pro_chat, Doctor, Engineer, Professionals) read it via
// AppContextInjector.getRelevantContext; the OFFLINE AI imports the exact same array (bundled client-side)
// via offlineAssistant. This test proves the Bot Builder is discoverable on ALL of them so the awareness
// can never silently regress.

const bot = APP_KNOWLEDGE_BASE.find(f => f.id === 'bot_builder');

describe('Bot Builder — 100% AI awareness (Free · Pro · Offline)', () => {
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
      const ids = searchFeatures(q).map(m => m.feature.id);
      expect(ids, `offline / "${q}"`).toContain('bot_builder');
    }
  });

  it('offers a real one-tap navigation target (never a dead button)', () => {
    expect(navFor(bot!)).toEqual({ view: 'botbuilder' });
  });

  it('every AI describes the CURRENT Bot Builder (connect nodes · simulate · Go Live to Telegram/WhatsApp)', () => {
    const text = `${bot!.description} ${bot!.howToUse}`.toLowerCase();
    expect(text).toContain('connect');
    expect(text).toContain('simulat');    // Simulator / Simulate
    expect(text).toContain('go live');    // the real deployment path (Build Bot App removed)
    expect(text).toContain('telegram');
  });
});

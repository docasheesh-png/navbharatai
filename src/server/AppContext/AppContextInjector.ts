/**
 * App Self-Awareness: smart, token-efficient context injection.
 *
 * Rather than pasting the whole app map into every AI system prompt (wasteful),
 * this selects ONLY the AppKnowledgeBase entries relevant to the user's message
 * and returns an empty string when the message isn't about the app at all.
 *
 * The empty-string guarantee is the safety property: clinical questions to
 * Doctor AI and coding requests to Engineer AI get zero injected app-context
 * and therefore zero behavior change.
 */
import { APP_KNOWLEDGE_BASE, AppFeature, getFeatureById } from './AppKnowledgeBase';

// Signals that the user is asking about the app itself (navigation / features / how-to).
const APP_QUESTION_SIGNALS = [
  // English
  'where', 'how do i', 'how to', 'how can i', 'what can', 'what does', 'what is',
  'which', 'find', 'open', 'navigate', 'feature', 'setting', 'settings', 'button',
  'menu', 'tab', 'screen', 'page', 'option', 'i want to', 'show me',
  // Hindi / Hinglish (romanized)
  'kahan', 'kaha', 'kaise', 'kese', 'kya kar', 'kya kya', 'kya hai', 'kahaan',
  'milega', 'milta', 'kidhar', 'konsa', 'kaun sa', 'setting kahan', 'kahan hai',
  'kaha milega', 'kaise kare', 'kaise use', 'batao', 'dikha', 'kholo', 'jao',
];

// Patterns that mean "what can YOU (this specific AI) do?" — inject surface capabilities.
const SURFACE_CAPABILITY_PATTERNS = [
  /\bwhat can you do\b/i,
  /\bwhat (are your|your) (features?|capabilities|abilities)\b/i,
  /\bwhat do you (do|support|offer)\b/i,
  /\byou (se|ko) kya (kar sakt|ho|mil)\b/i,
  /\btum kya kar sakt/i,
  /\baap kya kar sakt/i,
  /\bfeatures? (kya|kya kya) hai/i,
  /\bkya kya (kar|bol|bata) sakt/i,
  /\bkya kya milega/i,
  /\bapni (features?|capabilities)/i,
  /\blist (your |all )?(features?|capabilities|abilities)/i,
  /\btell me what you can/i,
];

function normalize(text: string): string {
  return String(text || '').toLowerCase();
}

export class AppContextInjector {
  /**
   * Return a focused block of relevant AppKnowledgeBase entries for this message,
   * or an empty string when the message isn't about the app. `surface` biases
   * results toward the AI the user is currently talking to.
   */
  static getRelevantContext(userMessage: string, surface?: string): string {
    const msg = normalize(userMessage);
    if (!msg.trim()) return '';

    // Broad "what can this app do" questions → full summary.
    if (this.isWholeAppQuestion(msg)) {
      return this.formatBlock(APP_KNOWLEDGE_BASE);
    }

    // "What can YOU do?" directed at a specific AI surface → all entries for that surface.
    if (surface && SURFACE_CAPABILITY_PATTERNS.some(p => p.test(msg))) {
      const surfaceFeatures = APP_KNOWLEDGE_BASE.filter(f => f.aiSurface === surface);
      if (surfaceFeatures.length > 0) return this.formatBlock(surfaceFeatures);
    }

    // Only inject when the message looks like an app-navigation/feature question.
    const looksLikeAppQuestion = APP_QUESTION_SIGNALS.some(sig => msg.includes(sig));

    // Score every feature by keyword/name overlap with the message.
    const scored = APP_KNOWLEDGE_BASE
      .map(f => ({ feature: f, score: this.scoreFeature(f, msg, surface) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return '';

    // A strong direct keyword hit is enough even without a question signal.
    // A weak hit needs a question signal to inject.
    const topScore = scored[0].score;
    if (topScore < 3 && !looksLikeAppQuestion) return '';

    // Return top 5 matches (increased from 3 for better coverage).
    const top = scored.slice(0, 5).map(s => s.feature);
    return this.formatBlock(top);
  }

  /** Full app summary — used when the user explicitly asks about the whole app. */
  static getFullSummary(): string {
    return this.formatBlock(APP_KNOWLEDGE_BASE);
  }

  /** All features for a specific AI surface (e.g. all Engineer AI entries). */
  static getSurfaceFeatures(surface: string): AppFeature[] {
    return APP_KNOWLEDGE_BASE.filter(f => f.aiSurface === surface);
  }

  static getFeatureById(id: string): AppFeature | null {
    return getFeatureById(id);
  }

  private static isWholeAppQuestion(msg: string): boolean {
    return (
      /\bwhat (can|does) (this|the|navbharat).{0,20}(do|app)/.test(msg) ||
      /\b(app|navbharat).{0,15}(kya kya|features?|kya kar sakt)/.test(msg) ||
      /\b(list|show|tell me).{0,20}(all )?(features?|tools?|what.s available)/.test(msg) ||
      /\bkya kya (hai|kar sakta|features)/.test(msg) ||
      /\bsab (features?|options?|buttons?)/.test(msg) ||
      /\bpuri? (app|site) (me kya|kya kya)/.test(msg) ||
      /\bnavbharat(ai)?.{0,15}(kya|features|kya kya|overview)/.test(msg)
    );
  }

  private static scoreFeature(f: AppFeature, msg: string, surface?: string): number {
    let score = 0;
    for (const kw of f.keywords) {
      if (msg.includes(kw)) score += kw.includes(' ') ? 3 : 2;
    }
    // Exact feature-name token hit is a strong signal.
    if (msg.includes(f.name.toLowerCase())) score += 3;
    // Small bias toward the surface the user is currently on.
    if (surface && f.aiSurface === surface) score += 1;
    return score;
  }

  private static formatBlock(features: AppFeature[]): string {
    if (features.length === 0) return '';
    const lines = features.map(f =>
      `• ${f.name} — ${f.path}\n  ${f.description.split('\n')[0]}\n  How to use: ${f.howToUse}`,
    );
    return (
      `[ABOUT NAVBHARATAI — app navigation & features]\n` +
      `You are operating inside the NavBharatAI app. When the user asks where a feature is or ` +
      `how to do something in the app, answer with the exact path below. Never say "I don't know where that is".\n` +
      lines.join('\n')
    );
  }
}

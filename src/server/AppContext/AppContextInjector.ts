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

// The one NavBharatAI support address every AI points users to (single source of truth).
export const SUPPORT_EMAIL = 'info@navbharatai.com';

// CORE support signals — an explicit account / payment / help / complaint matter. These fire on EVERY
// AI surface (Doctor, Engineer, Professionals, Free, Pro), because they are never a domain question:
// no medical symptom or coding task looks like "refund" or "kisi se baat karni hai".
const SUPPORT_CORE_SIGNALS = [
  // English
  'support', 'contact us', 'contact support', 'customer care', 'customer support', 'help desk',
  'complaint', 'refund', 'charged', 'double charge', 'payment failed', 'payment not', 'not credited',
  'money deducted', 'account issue', 'account problem', 'cannot login', "can't login", 'login issue',
  'reset password', 'talk to someone', 'talk to a human', 'reach the team', 'contact the team',
  // Hindi / Hinglish (romanized)
  'shikayat', 'sampark', 'madad chahiye', 'sahayata', 'sahayta', 'help chahiye', 'refund chahiye',
  'paisa kat', 'paise kat', 'paisa cut', 'payment nahi hua', 'paise nahi aaye', 'account ki problem',
  'login nahi ho', 'log in nahi ho', 'otp nahi aa', 'password bhool', 'kisi se baat', 'team se baat',
  'humse sampark', 'sampark kare',
];

// TECH-FAILURE signals — the app/site itself misbehaving. These fire on the GENERAL chat surfaces
// (Free, Pro) but NOT on domain AIs (Doctor / Engineer / Professionals), where "kaam nahi kar raha"
// or "error" is usually the AI's own subject (a medicine that isn't working, a build error to fix).
const SUPPORT_TECH_SIGNALS = [
  'not working', "doesn't work", 'does not work', "won't open", 'wont open', 'not loading',
  'not opening', 'app crash', 'crashing', 'keeps crashing', 'blank screen', 'white screen',
  'stuck on', 'app is slow', 'app hangs', 'freezes', 'glitch', 'broken',
  'kaam nahi kar raha', 'kaam nahi kr raha', 'kaam ni kar raha', 'chal nahi raha', 'khul nahi raha',
  'load nahi ho', 'band ho gaya', 'band ho raha', 'hang ho', 'atak gaya', 'ruk gaya', 'error aa raha',
  'error a raha', 'app kharab',
];

// Surfaces whose whole job is the very words in SUPPORT_TECH_SIGNALS — they must only react to the
// unambiguous CORE signals, so a symptom ("dawai kaam nahi kar rahi") or a build error never triggers
// an off-topic support pitch. Preserves the injector's "no behavior change for domain questions" rule.
const DOMAIN_SURFACES = new Set(['engineer_ai', 'sda_chat', 'professional']);

// The instruction handed to the AI when a support-worthy problem is detected. It never hard-codes a
// reply — the AI writes a fresh, humble, situation-shaped offer every time (admin: "har baar alag").
const SUPPORT_OFFER_BLOCK =
  `[NAVBHARATAI SUPPORT — offer our help email, warmly and only when it truly helps]\n` +
  `The user seems to be facing a problem or asking for help. In your reply: FIRST genuinely help as far ` +
  `as you can. THEN, if the NavBharatAI team should step in (an app / account / payment issue, something ` +
  `you cannot fully resolve, or the user sounds stuck or frustrated), gently offer our support email — ` +
  `${SUPPORT_EMAIL} — and you may add that they can also tap Settings → Support & Help. Write this offer ` +
  `FRESH in your own words EVERY time, shaped to the user's exact situation, need and feelings — never a ` +
  `canned or copy-pasted sentence. Keep it humble, warm, brief and reassuring, in the user's own language. ` +
  `Do NOT force the email into an ordinary question you can already answer well.`;

export class AppContextInjector {
  /**
   * Return a focused block of relevant AppKnowledgeBase entries for this message,
   * or an empty string when the message isn't about the app. `surface` biases
   * results toward the AI the user is currently talking to.
   */
  static getRelevantContext(userMessage: string, surface?: string): string {
    const msg = normalize(userMessage);
    // Support offer is computed for EVERY message (independent of app-navigation matching) and appended
    // to whatever feature context we return, so every AI that calls this offers our help email when the
    // user is facing a problem — see getSupportOffer for the surface-aware trigger rules.
    const support = this.getSupportOffer(userMessage, surface);
    const withSupport = (features: string) => [features, support].filter(Boolean).join('\n\n');

    if (!msg.trim()) return withSupport('');

    // Broad "what can this app do" questions → full summary.
    if (this.isWholeAppQuestion(msg)) {
      return withSupport(this.formatBlock(APP_KNOWLEDGE_BASE));
    }

    // "What can YOU do?" directed at a specific AI surface → all entries for that surface.
    if (surface && SURFACE_CAPABILITY_PATTERNS.some(p => p.test(msg))) {
      const surfaceFeatures = APP_KNOWLEDGE_BASE.filter(f => f.aiSurface === surface);
      if (surfaceFeatures.length > 0) return withSupport(this.formatBlock(surfaceFeatures));
    }

    // Only inject when the message looks like an app-navigation/feature question.
    const looksLikeAppQuestion = APP_QUESTION_SIGNALS.some(sig => msg.includes(sig));

    // Score every feature by keyword/name overlap with the message.
    const scored = APP_KNOWLEDGE_BASE
      .map(f => ({ feature: f, score: this.scoreFeature(f, msg, surface) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return withSupport('');

    // A strong direct keyword hit is enough even without a question signal.
    // A weak hit needs a question signal to inject.
    const topScore = scored[0].score;
    if (topScore < 3 && !looksLikeAppQuestion) return withSupport('');

    // Return top 5 matches (increased from 3 for better coverage).
    const top = scored.slice(0, 5).map(s => s.feature);
    return withSupport(this.formatBlock(top));
  }

  /** Full app summary — used when the user explicitly asks about the whole app. */
  static getFullSummary(): string {
    return this.formatBlock(APP_KNOWLEDGE_BASE);
  }

  /**
   * When the user is facing a problem or asking for help, return an instruction telling the AI to warmly
   * offer NavBharatAI's support email (info@navbharatai.com) — phrased freshly by the AI every time. Empty
   * string when no support-worthy signal is present.
   *
   * Surface-aware so it never intrudes on a domain question: CORE signals (account / payment / help /
   * complaint) fire on EVERY surface, while TECH-failure signals ("not working", "error aa raha") fire
   * only on the general chats — on Doctor / Engineer / Professionals those words are usually the AI's own
   * subject (a medicine that isn't working, a build error to fix), so only the unambiguous CORE signals
   * apply there. This is exported and shared so every AI uses ONE trigger + ONE message (no drift).
   */
  static getSupportOffer(userMessage: string, surface?: string): string {
    const msg = normalize(userMessage);
    if (!msg.trim()) return '';
    const hitCore = SUPPORT_CORE_SIGNALS.some(s => msg.includes(s));
    const hitTech = !DOMAIN_SURFACES.has(surface || '') && SUPPORT_TECH_SIGNALS.some(s => msg.includes(s));
    return hitCore || hitTech ? SUPPORT_OFFER_BLOCK : '';
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
    // A MULTI-WORD keyword phrase is a strong, intentional signal → substring hit counts (+3). A SINGLE-WORD
    // keyword must match on a WORD BOUNDARY (a query token), never as a substring — otherwise a short keyword
    // like "ist" (IST timezone) falsely fires inside "min-IST-er", or "pr" inside "PRime", injecting a
    // misleading feature for an unrelated question.
    const msgTokens = new Set(msg.split(/[^a-z0-9]+/i).filter(Boolean));
    for (const kw of f.keywords) {
      if (!kw) continue;
      if (kw.includes(' ')) {
        if (msg.includes(kw)) score += 3;
      } else if (msgTokens.has(kw)) {
        score += 2;
      }
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

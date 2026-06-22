/**
 * Apnapan Engine — user personalization profile.
 * Extracted from App.tsx so the detection logic can be unit-tested independently.
 */

export interface ApnapanProfile {
  greetingFrequency: Record<string, number>;
  preferredGreeting: string | null;
  preferredLanguage: string;
  conversationStyle: 'formal' | 'friendly' | 'professional' | 'unknown';
  preferredTitle: string | null;
  topics: string[];
  projects: string[];
  interactionCount: number;
}

export const APNAPAN_GREETINGS: Array<{ key: string; patterns: RegExp }> = [
  { key: 'राम-राम',        patterns: /\b(ram[- ]?ram|राम[- ]?राम)\b/i },
  { key: 'राधे-राधे',      patterns: /\b(radhe[- ]?radhe|राधे[- ]?राधे)\b/i },
  { key: 'जय श्री राम',    patterns: /\b(jai\s+shri\s+ram|जय\s+श्री\s+राम)\b/i },
  { key: 'जय हिन्द',       patterns: /\b(jai\s+hind|जय\s+हिन्द|जय\s+हिंद)\b/i },
  { key: 'नमस्ते',          patterns: /\b(namaste|नमस्ते)\b/i },
  { key: 'नमस्कार',         patterns: /\b(namaskar|नमस्कार)\b/i },
  { key: 'प्रणाम',          patterns: /\b(pranam|प्रणाम)\b/i },
  { key: 'आदाब',            patterns: /\b(adaab|आदाब)\b/i },
  { key: 'अस्सलामुअलैकुम', patterns: /\b(assalam|salaam|salam|अस्सलाम)\b/i },
  { key: 'सत श्री अकाल',   patterns: /\b(sat\s+sri\s+akal|waheguru|सत\s+श्री\s+अकाल)\b/i },
  { key: 'जय भीम',          patterns: /\b(jai\s+bhi[me]m?|जय\s+भीम)\b/i },
  { key: 'केम छो',           patterns: /\b(kem\s+cho|केम\s+छो)\b/i },
  { key: 'வணக்கம்',          patterns: /வணக்கம்|vanakkam/i },
  { key: 'Hello',            patterns: /^\s*(hello|hi|hey)\b/i },
  { key: 'Good Morning',     patterns: /\bgood\s+morning\b/i },
  { key: 'Good Evening',     patterns: /\bgood\s+evening\b/i },
];

const FORMAL_MARKERS    = /\b(aap|आप|kripya|कृपया|dhanyawad|धन्यवाद|sir|madam|sahab)\b/i;
const FRIENDLY_MARKERS  = /\b(yaar|यार|bhai|भाई|dost|दोस्त|bro)\b/i;
const PROF_MARKERS      = /\b(doctor|dr\.|डॉक्टर|डॉ\.|professor|prof\.|advocate|eng\.)\b/i;
const TITLE_PATTERN     = /\b(doctor\s+sahab|dr\.\s*ji|डॉक्टर\s+साहब|डॉ\.\s*जी|sir|madam|mitra|bhai\s+sahab|भाई\s+साहब)\b/i;
const PROJECT_KEYWORDS  = /\b(navbharatai|navbharat|hospital|clinic|school|startup|app|website|project)\b/i;
const DEVANAGARI        = /[ऀ-ॿ]/;
const SOUTH_ASIAN_ALPHA = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿঀ-৿਀-੿]/;

export const APNAPAN_DEFAULT_PROFILE: ApnapanProfile = {
  greetingFrequency: {},
  preferredGreeting: null,
  preferredLanguage: 'Hinglish',
  conversationStyle: 'unknown',
  preferredTitle: null,
  topics: [],
  projects: [],
  interactionCount: 0,
};

export function loadApnapanProfile(): ApnapanProfile {
  try {
    const s = localStorage.getItem('navbharat_apnapan');
    if (s) return JSON.parse(s) as ApnapanProfile;
  } catch {}
  return { ...APNAPAN_DEFAULT_PROFILE };
}

export function saveApnapanProfile(p: ApnapanProfile): void {
  try { localStorage.setItem('navbharat_apnapan', JSON.stringify(p)); } catch {}
}

/** Pure function: update an ApnapanProfile by learning from one message. */
export function updateApnapanProfile(text: string, prev: ApnapanProfile): ApnapanProfile {
  const p: ApnapanProfile = {
    ...prev,
    greetingFrequency: { ...prev.greetingFrequency },
    topics: [...prev.topics],
    projects: [...prev.projects],
  };
  p.interactionCount++;

  // Greeting detection
  for (const g of APNAPAN_GREETINGS) {
    if (g.patterns.test(text)) {
      p.greetingFrequency[g.key] = (p.greetingFrequency[g.key] || 0) + 1;
      p.preferredGreeting = Object.entries(p.greetingFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      break;
    }
  }

  // Language detection
  if (DEVANAGARI.test(text)) {
    const latinWords = text.split(/\s+/).filter(w => /[a-z]/i.test(w)).length;
    const totalWords = text.split(/\s+/).length;
    p.preferredLanguage = latinWords / totalWords > 0.3 ? 'Hinglish' : 'Hindi';
  } else if (SOUTH_ASIAN_ALPHA.test(text)) {
    p.preferredLanguage = 'Regional Indian';
  } else {
    p.preferredLanguage = 'English';
  }

  // Conversation style
  if (PROF_MARKERS.test(text)) p.conversationStyle = 'professional';
  else if (FORMAL_MARKERS.test(text) && p.conversationStyle === 'unknown') p.conversationStyle = 'formal';
  else if (FRIENDLY_MARKERS.test(text)) p.conversationStyle = 'friendly';

  // Title detection
  const titleMatch = TITLE_PATTERN.exec(text);
  if (titleMatch) p.preferredTitle = titleMatch[0].trim();

  // Project keywords
  const projMatches = text.match(new RegExp(PROJECT_KEYWORDS.source, 'gi'));
  if (projMatches) {
    for (const m of projMatches) {
      const kw = m.toLowerCase();
      if (!p.projects.includes(kw)) p.projects = [kw, ...p.projects].slice(0, 8);
    }
  }

  return p;
}

// THE CLARITY GATE — one short question before a NEW app is built from a request that names no app
// (admin-approved 2026-10-17, after autopsy eb58abaf).
//
// The deterministic check (buildableInput.ts) catches the shapes a word list can enumerate — "app banao",
// "Mujhe ek app bnakar do". It cannot catch "ek accha sa app banao", "mere business ke liye app banao",
// "ek game banao", "kuch bhi bana do yaar": each carries a word that is not a placeholder ("accha",
// "business", "game") and still leaves the app's PURPOSE open. Adding those words to a list is the
// instance fix that came back three times; the class is "does this name ONE concrete app?", which is a
// judgement. So a cheap judge answers it — one non-thinking flash call, ~5 s cap — and the platform, not
// the model, writes the question and the chips, so the reply is short, exact and in the user's language.
//
// 🔒 THE RULES, each a refusal to make the product argue with its user:
//   • FAIL-OPEN. A judge that errors, times out or answers anything but a clear "vague" ⇒ build.
//   • NEW BUILDS ONLY — empty workspace (or our untouched starter), first request. Edits are never gated.
//   • MINOR DETAILS ARE NOT VAGUENESS. Colour, name, style, layout ⇒ build with sensible defaults.
//   • NEVER TWICE IN A ROW. If the reply to our question is still vague, build the best guess and say
//     what was assumed (`bestGuessPrompt`).
//   • NO CHARGE for the question: it is answered on the chat lane, billed 0.
// `AGENTV3_CLARITY_GATE=off` disables the judge with no deploy (the deterministic check stays).

import type { PlatformVoice } from './platformVoice';

export function clarityGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CLARITY_GATE ?? '').trim().toLowerCase() !== 'off';
}

export const CLARITY_JUDGE_MODEL = 'glm-4.7-flashx';
export const CLARITY_JUDGE_TIMEOUT_MS = 5_000;

export type ClarityCategory = 'business' | 'game' | 'education' | 'health' | 'personal' | 'website' | 'general';
const CATEGORIES: readonly ClarityCategory[] = ['business', 'game', 'education', 'health', 'personal', 'website', 'general'];

export const CLARITY_JUDGE_SYSTEM = [
  'You decide whether an app-building request names ONE concrete app whose purpose or core function is clear.',
  'CLEAR examples: "calculator banakar do", "todo app", "GST billing app for my shop", "snake game", "Panchang app with tithi and muhurat", any detailed spec.',
  'VAGUE examples: "ek app banao", "ek accha sa app banao", "mere business ke liye app banao" (which business task?), "ek game banao" (which game?), "kuch bhi bana do".',
  'Missing MINOR details (colour, name, style, layout, tech) do NOT make a request vague.',
  'Also give the closest category: business, game, education, health, personal, website, general.',
  'Reply with ONLY compact JSON: {"clear":true|false,"category":"..."}',
].join('\n');

export interface ClarityVerdict {
  /** 'vague' is the ONLY verdict that stops a build; 'unknown' (error/timeout/garbage) builds. */
  verdict: 'clear' | 'vague' | 'unknown';
  category: ClarityCategory;
  ms: number;
}

/** Parse the judge's reply. Anything not clearly `"clear": false` is NOT vague. PURE. */
export function parseClarityReply(text: string): { verdict: 'clear' | 'vague' | 'unknown'; category: ClarityCategory | null } {
  const t = String(text ?? '');
  const m = t.match(/\{[\s\S]*?\}/);
  if (!m) return { verdict: 'unknown', category: null };
  try {
    const o = JSON.parse(m[0]) as { clear?: unknown; category?: unknown };
    const cat = typeof o.category === 'string' && (CATEGORIES as readonly string[]).includes(o.category.trim().toLowerCase())
      ? (o.category.trim().toLowerCase() as ClarityCategory) : null;
    if (o.clear === false) return { verdict: 'vague', category: cat };
    if (o.clear === true) return { verdict: 'clear', category: cat };
  } catch { /* garbage ⇒ unknown */ }
  return { verdict: 'unknown', category: null };
}

/** The category from the user's own words — used when the judge gives none. PURE. */
export function categoryFromWords(prompt: string): ClarityCategory {
  const p = String(prompt ?? '').toLowerCase();
  if (/\b(game|games|khel|khelne)\b|गेम|खेल/.test(p)) return 'game';
  if (/\b(business|biz|dukaan|dukan|shop|store|vyapar|vyapaar|dhandha|company|startup|restaurant|kirana)\b|व्यापार|दुकान|बिज़नेस|बिजनेस/.test(p)) return 'business';
  if (/\b(school|study|padhai|students?|exam|coaching|college|tuition)\b|पढ़ाई|स्कूल/.test(p)) return 'education';
  if (/\b(health|doctor|clinic|hospital|fitness|gym|yoga|dawai)\b|डॉक्टर|स्वास्थ्य/.test(p)) return 'health';
  if (/\b(website|site|portfolio|blog|landing)\b|वेबसाइट/.test(p)) return 'website';
  return 'general';
}

/**
 * Ask the judge, bounded and fail-open. `ask` makes the ONE model call (system, user, abort signal) and
 * resolves to its text. A thrown error, a timeout or an unreadable answer is `unknown` — i.e. build.
 */
export async function judgeClarity(
  prompt: string,
  ask: (system: string, user: string, signal: AbortSignal) => Promise<string>,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<ClarityVerdict> {
  const now = opts.now ?? Date.now;
  const started = now();
  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? CLARITY_JUDGE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      ask(CLARITY_JUDGE_SYSTEM, String(prompt ?? '').slice(0, 2000), ctrl.signal),
      new Promise<never>((_, rej) => { timer = setTimeout(() => { ctrl.abort(); rej(new Error('clarity judge timed out')); }, timeoutMs); }),
    ]);
    const parsed = parseClarityReply(text);
    return { verdict: parsed.verdict, category: parsed.category ?? categoryFromWords(prompt), ms: Math.max(0, now() - started) };
  } catch {
    return { verdict: 'unknown', category: categoryFromWords(prompt), ms: Math.max(0, now() - started) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Should the judge run at all? Only for a NEW build in an empty workspace, on the first request, with
 * nothing attached or imported, and never right after we already asked once. PURE.
 */
export function shouldJudgeClarity(i: {
  enabled: boolean; newBuild: boolean; workspaceHoldsOnlyOurStarter: boolean; earlierBuildableRequest: boolean;
  importing: boolean; attachments: number; askedLastTurn: boolean; alreadyAsking: boolean;
  /** The request's own words — a long spec is clear by construction and skips the judge (no added latency). */
  prompt?: string;
  /** The request is one of our starter chips / golden templates — clear by construction. */
  isStarterPrompt?: boolean;
}): boolean {
  if (i.isStarterPrompt) return false;
  if (typeof i.prompt === 'string' && (i.prompt.match(/\S+/g) ?? []).length >= LONG_SPEC_WORDS) return false;
  return i.enabled && i.newBuild && i.workspaceHoldsOnlyOurStarter && !i.earlierBuildableRequest
    && !i.importing && i.attachments === 0 && !i.askedLastTurn && !i.alreadyAsking;
}

/** At or above this many words a request is a spec, not a vague order — the judge is not consulted. */
export const LONG_SPEC_WORDS = 15;

export interface QuickReply { label: string; send: string }

type Lines = { en: string; hinglish: string; hindi: string };
const QUESTION: Record<ClarityCategory, Lines> = {
  general: {
    en: 'Sure! Which app should I build? Tell me in one line what it is for — or pick one below.',
    hinglish: 'Zaroor! Kaunsa app banaun? Ek line mein bataiye ki app kis kaam ka hai — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! कौन-सा ऐप बनाऊँ? एक लाइन में बताइए कि ऐप किस काम का है — या नीचे से एक चुनिए।',
  },
  business: {
    en: 'Sure! What should the app do for your business? Tell me in one line — or pick one below.',
    hinglish: 'Zaroor! Aapke business ke liye app kya kaam kare? Ek line mein bataiye — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! आपके बिज़नेस के लिए ऐप क्या काम करे? एक लाइन में बताइए — या नीचे से एक चुनिए।',
  },
  game: {
    en: 'Sure! Which game should I make? Tell me in one line — or pick one below.',
    hinglish: 'Zaroor! Kaunsa game banaun? Ek line mein bataiye — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! कौन-सा गेम बनाऊँ? एक लाइन में बताइए — या नीचे से एक चुनिए।',
  },
  education: {
    en: 'Sure! What should the study app help with? Tell me in one line — or pick one below.',
    hinglish: 'Zaroor! Padhai ka app kis kaam mein madad kare? Ek line mein bataiye — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! पढ़ाई का ऐप किस काम में मदद करे? एक लाइन में बताइए — या नीचे से एक चुनिए।',
  },
  health: {
    en: 'Sure! What should the health app do? Tell me in one line — or pick one below.',
    hinglish: 'Zaroor! Health app kya kaam kare? Ek line mein bataiye — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! हेल्थ ऐप क्या काम करे? एक लाइन में बताइए — या नीचे से एक चुनिए।',
  },
  personal: {
    en: 'Sure! What should the app help you with? Tell me in one line — or pick one below.',
    hinglish: 'Zaroor! App aapki kis kaam mein madad kare? Ek line mein bataiye — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! ऐप आपकी किस काम में मदद करे? एक लाइन में बताइए — या नीचे से एक चुनिए।',
  },
  website: {
    en: 'Sure! What is the website for? Tell me in one line — or pick one below.',
    hinglish: 'Zaroor! Website kis cheez ke liye hai? Ek line mein bataiye — ya neeche se ek chuniye.',
    hindi: 'ज़रूर! वेबसाइट किस चीज़ के लिए है? एक लाइन में बताइए — या नीचे से एक चुनिए।',
  },
};

/** [English label, Hinglish send, Hindi label/send, English send]. */
const CHIPS: Record<ClarityCategory, Array<[string, string, string, string]>> = {
  general: [
    ['Shop billing', 'Dukaan ke liye GST billing app banao', 'दुकान के लिए GST बिलिंग ऐप बनाओ', 'Build a GST billing app for a shop'],
    ['To-do & reminders', 'Reminders ke saath todo app banao', 'रिमाइंडर के साथ टू-डू ऐप बनाओ', 'Build a to-do app with reminders'],
    ['Quiz game', 'Ek quiz game banao', 'एक क्विज़ गेम बनाओ', 'Build a quiz game'],
    ['Expense tracker', 'Kharche ka hisaab rakhne wala app banao', 'खर्च का हिसाब रखने वाला ऐप बनाओ', 'Build an expense tracker'],
  ],
  business: [
    ['Billing app', 'Mere business ke liye GST billing app banao', 'मेरे बिज़नेस के लिए GST बिलिंग ऐप बनाओ', 'Build a GST billing app for my business'],
    ['Inventory', 'Mere business ke liye stock / inventory app banao', 'मेरे बिज़नेस के लिए स्टॉक / इन्वेंटरी ऐप बनाओ', 'Build an inventory app for my business'],
    ['Booking', 'Mere business ke liye appointment booking app banao', 'मेरे बिज़नेस के लिए अपॉइंटमेंट बुकिंग ऐप बनाओ', 'Build an appointment booking app for my business'],
    ['Customer khata', 'Customers ka udhaar khata app banao', 'ग्राहकों का उधार खाता ऐप बनाओ', 'Build a customer credit ledger app'],
  ],
  game: [
    ['Racing', 'Ek car racing game banao', 'एक कार रेसिंग गेम बनाओ', 'Build a car racing game'],
    ['Quiz', 'Ek quiz game banao', 'एक क्विज़ गेम बनाओ', 'Build a quiz game'],
    ['Puzzle', 'Ek puzzle game banao', 'एक पज़ल गेम बनाओ', 'Build a puzzle game'],
    ['Snake', 'Snake game banao', 'स्नेक गेम बनाओ', 'Build a snake game'],
  ],
  education: [
    ['Quiz / test', 'Students ke liye quiz aur test app banao', 'छात्रों के लिए क्विज़ और टेस्ट ऐप बनाओ', 'Build a quiz and test app for students'],
    ['Flashcards', 'Padhai ke liye flashcards app banao', 'पढ़ाई के लिए फ़्लैशकार्ड ऐप बनाओ', 'Build a flashcards study app'],
    ['Attendance', 'Class attendance app banao', 'क्लास अटेंडेंस ऐप बनाओ', 'Build a class attendance app'],
  ],
  health: [
    ['Medicine reminder', 'Dawai reminder app banao', 'दवाई रिमाइंडर ऐप बनाओ', 'Build a medicine reminder app'],
    ['Fitness tracker', 'Workout aur fitness tracker app banao', 'वर्कआउट और फ़िटनेस ट्रैकर ऐप बनाओ', 'Build a workout and fitness tracker'],
    ['Clinic booking', 'Clinic appointment booking app banao', 'क्लिनिक अपॉइंटमेंट बुकिंग ऐप बनाओ', 'Build a clinic appointment booking app'],
  ],
  personal: [
    ['Expense tracker', 'Kharche ka hisaab rakhne wala app banao', 'खर्च का हिसाब रखने वाला ऐप बनाओ', 'Build an expense tracker'],
    ['To-do & reminders', 'Reminders ke saath todo app banao', 'रिमाइंडर के साथ टू-डू ऐप बनाओ', 'Build a to-do app with reminders'],
    ['Habit tracker', 'Daily habit tracker app banao', 'डेली हैबिट ट्रैकर ऐप बनाओ', 'Build a daily habit tracker'],
  ],
  website: [
    ['Business website', 'Mere business ke liye website banao', 'मेरे बिज़नेस के लिए वेबसाइट बनाओ', 'Build a website for my business'],
    ['Portfolio', 'Meri portfolio website banao', 'मेरी पोर्टफ़ोलियो वेबसाइट बनाओ', 'Build my portfolio website'],
    ['Restaurant menu', 'Restaurant ki menu website banao', 'रेस्टोरेंट की मेन्यू वेबसाइट बनाओ', 'Build a restaurant menu website'],
  ],
};

/** The question and its 3–4 chips, in the user's voice. PURE. */
export function clarifyReply(category: ClarityCategory, voice: PlatformVoice): { text: string; chips: QuickReply[] } {
  const q = QUESTION[category] ?? QUESTION.general;
  const text = voice === 'hindi' ? q.hindi : voice === 'hinglish' ? q.hinglish : q.en;
  const chips = (CHIPS[category] ?? CHIPS.general).slice(0, 4).map(([en, hl, hi, enSend]) => (
    voice === 'hindi' ? { label: hi.replace(/ बनाओ$/, ''), send: hi }
      : voice === 'hinglish' ? { label: en, send: hl }
        : { label: en, send: enSend }
  ));
  return { text, chips };
}

/** The note on a build whose request stayed vague after our one question — build the best guess. PURE. */
export function bestGuessPrompt(firstRequest: string, reply: string): string {
  return `${String(firstRequest ?? '').trim()}\n${String(reply ?? '').trim()}\n\n`
    + '[PLATFORM NOTE] The user was already asked once what to build. Do not ask again: choose the single most likely concrete app '
    + 'from what they said, build it with sensible defaults, and begin your first message with ONE short line, in the user\'s language, '
    + 'saying what you assumed (e.g. "Maine ise ek billing app maan kar banaya hai").';
}

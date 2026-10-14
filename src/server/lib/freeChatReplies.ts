// FREE CHAT ANSWERS EVERY MESSAGE + STUDENT → TEACHER AI PROMO (2026-10-14). Both default OFF.
//
// 🔴 THE BUG (admin): "Best job ke bare me batao" got "best job app NavBharatAI me banti hai" instead
// of an answer. Nothing hard-codes that line — the free chat's model wrote it, because the free system
// prompt (routes/chat.ts → buildFreeSystemPrompt) carries an UNCONDITIONAL "APP BUILDING — LEAD WITH
// NavBharatAI Pro … This comes FIRST, always" block on EVERY turn, and AppContextInjector added ~7.6k
// characters of app-navigation entries (Resume & Job AI, Mentor, templates…) under "answer with the
// exact path" because "batao" is a navigation signal and "job" a feature keyword. A general question
// therefore read to the model like an app/navigation question, and it pitched an app.
//
// With FREE_CHAT_ANSWER_ALL=on the free chat:
//   • answers the question itself, every time (no app pitch on a non-app question);
//   • on a real "build me an app" request explains the idea (features, screens, data, how it works) —
//     still no code — and ends with ONE line, in the user's language, that it can be built in
//     NavBharatAI Pro. The line is appended by the server if the model left it out, so it is exactly one.
//   • only injects app-navigation context when the message is actually about NavBharatAI.
//
// PURE — no I/O.

export function freeChatAnswerAllEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.FREE_CHAT_ANSWER_ALL ?? '').trim().toLowerCase() === 'on';
}
export function studentTeacherPromoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.STUDENT_TEACHER_PROMO ?? '').trim().toLowerCase() === 'on';
}

export type ReplyLang = 'hi' | 'hinglish' | 'en' | 'other';

const HINGLISH_WORDS = /\b(hai|hain|ho|kya|kaise|kaisa|kab|kyu|kyun|mujhe|mera|meri|mere|hum|aap|tum|ek|ke|ki|ka|ko|me|mein|se|par|aur|bhi|nahi|nhi|karo|kar|kardo|karna|banao|bana|banado|banana|chahiye|batao|bataiye|bare|baare|wala|wali|liye|accha|acha|bhai|yaar|ji)\b/gi;

/** Hindi (Devanagari), Hinglish (romanised Hindi), English, or another script. */
export function detectReplyLanguage(message: string): ReplyLang {
  const m = String(message ?? '');
  const deva = (m.match(/[\u0900-\u097F]/g) ?? []).length;
  const otherIndic = (m.match(/[\u0980-\u0DFF\u0600-\u06FF]/g) ?? []).length; // Bengali…Sinhala, Arabic/Urdu
  const latin = (m.match(/[A-Za-z]/g) ?? []).length;
  if (deva > 0 && deva >= otherIndic && deva * 2 >= latin) return 'hi';
  if (otherIndic > 0 && otherIndic * 2 >= latin) return 'other';
  if (latin === 0) return deva > 0 ? 'hi' : 'en';
  const words = (m.match(/[A-Za-z]+/g) ?? []).length || 1;
  const hits = (m.match(HINGLISH_WORDS) ?? []).length;
  return hits >= 2 || hits / words >= 0.25 ? 'hinglish' : 'en';
}

const THING = '(?:app|apps|application|website|web\\s*site|webapp|software|portal|dashboard|tool|game|android\\s+app|ios\\s+app|ऐप|एप|एप्लिकेशन|वेबसाइट|सॉफ्टवेयर)';
const MAKE_EN = '(?:build|create|make|develop|code|design|generate)';
const MAKE_HI = '(?:bana|banao|banado|bana\\s*do|bana\\s*dijiye|banaiye|banana|banani|banaye|banaen|chahiye|बनाओ|बना\\s*दो|बनाइए|बनाना|बनानी|बनाएं|बनाये|चाहिए)';

/**
 * True only when the message asks for an app/website/software to be BUILT. A question that merely
 * mentions an app or a job ("best job ke bare me batao", "which app is best for UPI?") is not.
 */
export function isAppBuildRequest(message: string): boolean {
  const m = String(message ?? '').toLowerCase();
  if (!m.trim()) return false;
  const en = new RegExp(`\\b${MAKE_EN}\\b[^.?!\\n]{0,60}${THING}`, 'i');
  const enWant = new RegExp(`\\b(?:i\\s+(?:want|need)|need)\\b[^.?!\\n]{0,40}\\b(?:an?|my)\\s+(?:own\\s+)?[^.?!\\n]{0,40}${THING}`, 'i');
  const hiAfter = new RegExp(`${THING}[^.?!\\n]{0,40}${MAKE_HI}`, 'i');
  const hiBefore = new RegExp(`${MAKE_HI}[^.?!\\n]{0,20}${THING}`, 'i');
  if (/\b(kaise|how)\b.*\b(download|install|use|chalaye|chalate)\b/i.test(m)) return false;
  return en.test(m) || enWant.test(m) || hiAfter.test(m) || hiBefore.test(m);
}

/** The ONE closing line for an app request, in the user's language. */
export function proLine(lang: ReplyLang): string {
  if (lang === 'hi') return 'यह ऐप आप **NavBharatAI Pro** में बनवा सकते हैं।';
  if (lang === 'hinglish') return 'Yeh app aap **NavBharatAI Pro** me banwa sakte hain.';
  return 'You can get this app built in **NavBharatAI Pro**.';
}

/** Replaces the old "APP BUILDING — LEAD WITH NavBharatAI Pro" block in the free system prompt. */
export const FREE_ANSWER_ALL_RULES = `ANSWER EVERY MESSAGE (MANDATORY):
• Always answer what the user actually asked, fully and helpfully, in their language. A question about jobs, careers, health, money, studies, news or anything else gets a real answer about THAT topic.
• NEVER turn a question into an app pitch. Do not say that an app for it "can be built in NavBharatAI", and do not mention NavBharatAI Pro, unless the user asked you to build/make an app, website or software.
• Use the "ABOUT NAVBHARATAI" notes (if present) only when the user is asking about NavBharatAI itself.

WHEN THE USER ASKS YOU TO BUILD AN APP / WEBSITE / SOFTWARE:
• You do not build it in this free chat. Instead, help with the idea itself: what the app does, its key features, the main screens, the data it keeps, and how a user would use it — concrete to THEIR idea.
• No code, no HTML/CSS/JS.
• End with exactly ONE final line, in the user's language, saying it can be built in NavBharatAI Pro (Hindi: "यह ऐप आप **NavBharatAI Pro** में बनवा सकते हैं।", Hinglish: "Yeh app aap **NavBharatAI Pro** me banwa sakte hain.", English: "You can get this app built in **NavBharatAI Pro**."; other languages: the same sentence in that language). Nothing after it.
• Do NOT name or recommend rival app builders.`;

/** Per-turn directive, added only on an app-build request. */
export function appRequestDirective(lang: ReplyLang): string {
  return `THIS MESSAGE ASKS FOR AN APP TO BE BUILT. Explain the app idea helpfully (features, screens, data, flow) without code, then end with this one line${lang === 'other' ? ' translated into the user\'s language' : ''}: ${proLine(lang)}`;
}

/** Append the Pro line when the model left it out. Returns '' when nothing must be added. */
export function missingProLine(replyText: string, message: string): string {
  if (!isAppBuildRequest(message)) return '';
  if (/navbharat\s*ai\s*pro/i.test(String(replyText ?? ''))) return '';
  const lang = detectReplyLanguage(message);
  return `\n\n${proLine(lang === 'other' ? 'en' : lang)}`;
}

/** The app-navigation block is only for messages about NavBharatAI itself (under FREE_CHAT_ANSWER_ALL). */
export function isAboutNavBharatAI(message: string): boolean {
  return /navbharat|nav\s*bharat|नवभारत|\bmode\b|\bsetting|\bwallet\b|\bpro\b|\bhistory\b|\blogin\b|\bsign\s*in\b|\bbutton\b|\btab\b|\bscreen\b|\bmenu\b|\bpublish|\btemplate|\bthis app\b|is app|इस ऐप|\bfeature|\bplan\b|\bsubscription|\brecharge|\bpayment|\brefund|\bsupport\b|\bbug\b|\berror\b|kaam nahi|not working/i
    .test(String(message ?? ''));
}

// ── STUDENT → TEACHER AI ───────────────────────────────────────────────────────────────────────────

/** A study / exam / school app request (the build goes ahead; this only adds a note). */
export function isStudyAppRequest(message: string): boolean {
  const m = String(message ?? '');
  return /\b(study|studies|student|exam|exams|test\s*series|mock\s*test|quiz|revision|syllabus|homework|lesson|notes|flash\s*cards?|tuition|coaching|padhai|padhna|padhne|pariksha|neet|jee|upsc|ssc|cbse|icse|board\s*exam|class\s*\d{1,2})\b|पढ़ाई|पढ़ने|परीक्षा|एग्जाम|छात्र|विद्यार्थी|क्विज़|नोट्स|सिलेबस/i.test(m);
}

/** Teacher AI is a Mode entry of NavBharatAI FREE (professionalConfigs.ts `teacher_ai`, "Teacher AI"). */
export const TEACHER_AI_NAME = 'Teacher AI';

export function teacherPromoLine(lang: ReplyLang): string {
  if (lang === 'hi') return `🎓 छात्रों के लिए: NavBharatAI FREE में **Mode → ${TEACHER_AI_NAME}** चुनकर आप कुछ भी पढ़ सकते हैं और एग्जाम भी दे सकते हैं। आपका ऐप बनना जारी है।`;
  if (lang === 'hinglish') return `🎓 Students ke liye: NavBharatAI FREE me **Mode → ${TEACHER_AI_NAME}** chunkar aap kuch bhi padh sakte hain aur exam bhi de sakte hain. Aapka app ban raha hai, chalta rahega.`;
  return `🎓 For students: in NavBharatAI FREE, switch **Mode → ${TEACHER_AI_NAME}** to study anything and take exams. Your app build carries on.`;
}

/** The promo for a build prompt, or null. Never blocks anything — the caller just emits it. */
export function teacherPromoFor(prompt: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!studentTeacherPromoEnabled(env) || !isStudyAppRequest(prompt)) return null;
  const lang = detectReplyLanguage(prompt);
  return teacherPromoLine(lang === 'other' ? 'en' : lang);
}

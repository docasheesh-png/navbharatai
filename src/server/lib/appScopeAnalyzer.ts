// APP SCOPE ANALYZER — is this prompt an ordinary one-shot app, or a MEGA app that must be broken into a
// step-by-step roadmap? (admin 2026-08-14, the "PUBG / WhatsApp / Claude jaisa banao" problem.)
//
// THE DESIGN, stated honestly (admin asked whether a deterministic filter can be 100% accurate — it cannot,
// and this is built so it does not need to be):
//   • Accuracy comes from the LLM roadmap call downstream. THIS module is only a cheap COST pre-screen.
//   • The default is ALWAYS 'direct' — today's behaviour, no friction, no cost — for the ~95% of prompts
//     that are ordinary buildable apps (a menu, a blog, a portfolio, a simple game, a form, a dashboard).
//   • It escalates to 'analyze' (→ the LLM sizing + roadmap) ONLY when a STRONG mega-signal fires: a famous
//     AAA product to clone, a heavy-infra requirement (real-time between users, multiplayer, video calls,
//     a foundation-model "AI like Claude"), or a genuinely huge multi-feature spec.
//   • Error cost is therefore bounded and cheap: a mega app that slips through builds directly = exactly
//     today's behaviour (no worse); an ordinary app is almost never flagged because only STRONG signals
//     escalate. False friction on a small app — the one harm to avoid — is minimised by construction.
//
// PURE: no I/O, no clock, no model. Never throws. The exact thresholds are meant to be reviewed against
// real prompts (the admin will eye-ball the classifications) and tuned here.

import { countEnumeratedFeatures, notAFeatureLine, BIG_SOFTWARE_NOUN, sectionedSpecSize } from '../AgentV3/enumeratedFeatures';
import { withoutMachineText } from './machineText';
import { glossDevanagari, withEnglishReading } from './devanagariTechTerms';
import { MEDIA_PLAYER_APP } from './RequirementGapAnalyzer';

export type AppSize = 'small' | 'large';

export interface AppScope {
  /** 'direct' = build now, no LLM sizing call (the default). 'analyze' = hand to the LLM for a roadmap. */
  decision: 'direct' | 'analyze';
  size: AppSize;
  /** The famous product this prompt asks to clone, if recognised (for the honest reply + telemetry). */
  famousApp: string | null;
  /** Human-readable reasons the decision was made — shown in the build report for threshold tuning. */
  signals: string[];
  /** The prompt names a single-purpose, one-shot-buildable thing (CLEARLY_SMALL). Read by `scopeDispute`. */
  smallHint: boolean;
  /** The app ITSELF is that small thing — the small word is in the request's subject, not a feature (Q-398). */
  smallSubject: boolean;
}

/**
 * TWO CLASSIFIERS DISAGREED, AND THE DEARER ONE WON (autopsy Study-Racer, 2026-09-25).
 *
 * The scope analyzer said *"LARGE — clone of YouTube"* and the complexity router scored the same prompt
 * 15 ("simple") — and nothing compared the two. The planner call ran, the roadmap steered the build,
 * and the user's own core ask was cut to steps 2–3. The tool-mention fix closes that instance; this is
 * the class: when the ONLY mega-signal is a famous name, the complexity router calls the request
 * simple, AND the prompt names a clearly small thing (a quiz, a notes app, a calculator…), the famous
 * name is being used, not cloned. Return the reason to record; the caller then builds direct.
 *
 * ⚠️ PRECISION-FIRST IN THE NON-ESCALATING DIRECTION, and deliberately NARROW: a bare "PUBG banao"
 * (no small hint) still escalates, heavy infra still escalates, a ≥8-feature spec still escalates.
 * Only the three-way agreement of a used-not-cloned name, a simple score and a small noun stands
 * down — the exact shape of the reported build. Pure.
 */
export function scopeDispute(scope: AppScope, opts: { complex: boolean }): string | null {
  if (scope.decision !== 'analyze' || !scope.famousApp) return null;
  if (opts.complex) return null;
  const otherSignals = scope.signals.filter((s) => !s.startsWith('asks to clone '));
  if (otherSignals.length > 0) return null; // heavy infra or a huge feature list — a real mega app
  if (!scope.smallHint) return null;
  return `the only mega-signal was the name "${scope.famousApp}", the complexity router scored the request simple, and the prompt names a single-purpose app — the name is being used, not cloned. Built directly; the roadmap planner was not asked.`;
}

/**
 * Famous products whose FULL form cannot be one-shot (online multiplayer, billion-user infra, a trained
 * foundation model, real-time everything). A match always escalates to the LLM, which decides the honest
 * achievable core + roadmap. Boundary-anchored where a bare word would over-match ordinary English.
 */
const FAMOUS_APPS: Array<{ name: string; re: RegExp }> = [
  { name: 'PUBG', re: /\bpubg\b/i },
  { name: 'Free Fire', re: /\bfree\s?fire\b/i },
  { name: 'Fortnite', re: /\bfortnite\b/i },
  { name: 'Call of Duty', re: /\bcall of duty\b|\bcod\s?mobile\b/i },
  { name: 'GTA', re: /\bgta\b|grand theft auto/i },
  { name: 'Minecraft', re: /\bminecraft\b/i },
  { name: 'Clash of Clans', re: /clash of clans|\bcoc\b/i },
  { name: 'Among Us', re: /\bamong us\b/i },
  { name: 'Instagram', re: /\binstagram\b|\binsta\b/i },
  { name: 'WhatsApp', re: /\bwhatsapp\b/i },
  { name: 'Telegram', re: /\btelegram\b/i },
  { name: 'Snapchat', re: /\bsnapchat\b/i },
  { name: 'TikTok', re: /\btiktok\b/i },
  { name: 'Facebook', re: /\bfacebook\b/i },
  { name: 'Twitter / X', re: /\btwitter\b|\b(the )?x app\b/i },
  { name: 'YouTube', re: /\byoutube\b/i },
  { name: 'Netflix', re: /\bnetflix\b/i },
  { name: 'Spotify', re: /\bspotify\b/i },
  { name: 'Uber / Ola', re: /\buber\b|\bola\b(?!\s)/i },
  { name: 'Swiggy / Zomato', re: /\bswiggy\b|\bzomato\b/i },
  { name: 'Amazon / Flipkart', re: /\bamazon\b|\bflipkart\b/i },
  // "zoom" is a verb and a setting far more often than a product ("no page zoom problems", "pinch to
  // zoom", "zoom level"); build 681bd91b classed an AI chat app as a Zoom clone on the first of those.
  // A product reference names the product AS a product, or asks for a likeness of it.
  { name: 'Zoom / Meet', re: /\bzoom\s+(?:app|call|calls|meeting|meetings|clone|style|jaisa|jaise|like)\b|\b(?:like|clone\s+of|similar\s+to|inspired\s+by|jaisa|jaise)\s+zoom\b|google meet/i },
  // A "foundation-model AI like Claude/ChatGPT" — a trained model cannot be cloned; the LLM will honestly
  // reframe this to "an app that USES an AI via an API".
  { name: 'an AI like Claude/ChatGPT', re: /\b(like|jaisa|jaise|clone of)\s+(claude|chatgpt|gpt-?\d?|gemini|openai|an?\s+ai)\b|\bapna\s+chatgpt\b|\bchatgpt\s+(jaisa|banao)\b/i },
];

/**
 * 🔴 A PRODUCT NAMED AS A TOOL IS NOT A CLONE REQUEST (autopsy 0d297b25, 2026-09-23).
 *
 * "Download APK → Send APK to Phone 2 using WhatsApp/Drive/USB" classed a request to package an existing
 * app as *"LARGE — clone of WhatsApp"*, and the mega-app roadmap planner spent a model call building a
 * roadmap for a WhatsApp clone nobody asked for. The Zoom entry above had already learned this for ONE
 * product ("a product reference names the product AS a product, or asks for a likeness of it"); every
 * other entry matched the bare name. This is that rule, applied to the whole list: a mention is a TOOL
 * mention when a channel preposition sits right before it (using / via / through / on / with / to /
 * share on / login with …) or an integration noun right after it (API, login, share, notifications,
 * link …). The product counts only if at least ONE mention is not a tool mention — so "a WhatsApp clone
 * with WhatsApp login" still escalates, and "WhatsApp jaisa app" still does.
 *
 * ⚠️ PRECISION-FIRST in the NON-escalating direction on purpose: a missed clone falls back to today's
 * ordinary build (which the feature count may still escalate), while a false clone costs a planner call
 * and hands the build a roadmap for the wrong app.
 */
const TOOL_BEFORE = /\b(?:using|use|uses|via|through|thru|over|on|with|by|to|into|from|in|share|send|post|login|log\s+in|sign\s+in|signin|integrat\w*|connect\w*|link\w*|embed\w*|se|paste|copy|import|add|fetch|download\w*|convert\w*|unauthori[sz]ed|authori[sz]ed|open|opens|opening|launch\w*|play|plays|watch|search|go\s+to|visit)\s+(?:the\s+|my\s+|your\s+|our\s+|their\s+|a\s+|any\s+)?$/i;
// 🔴 CONTENT FROM A PRODUCT IS NOT THE PRODUCT (autopsy Study-Racer, 2026-09-25). "mai isme notes,
// youtube video ka link dalunga" — I will paste YouTube video links into it — was classed
// *"LARGE — clone of YouTube"* while the complexity router scored the same prompt 15 ("simple"). The
// planner then cut the user's own core ask (their notes, their YouTube links) into roadmap steps 2 and
// 3 and built a hard-coded math-quiz racer. A product name followed by a CONTENT noun (video, url,
// playlist, clip, thumbnail…) or by a Hinglish possessive before an integration noun ("youtube ka
// link", "instagram ki post") is the product being USED, exactly as a channel preposition before it is.
const TOOL_AFTER = /^[\s/]*(?:(?:ka|ki|ke|wala|wali|wale|se)\s+)?(?:api|apis|sdk|login|log\s*in|sign[\s-]?in|oauth|auth|share|sharing|button|buttons|integration|notifications?|messages?|link|links|otp|business|pay|s3|web\s+services|account|accounts|group|groups|number|alerts?|widget|embed|embeds|channel|bot|webhook|ads|videos?|urls?|playlists?|clips?|thumbnails?|posts?|reels?|stories|feed|page|pages|content|audio|music|songs?|mp3|data|downloads?|kholo|kholna|khol\s+do|chalao|chalana|app\s+(?:kholo|chalao|open))\b|^[\s-]*to[\s-]*(?:mp3|mp4|audio|video|wav|gif|text|pdf)\b/i;

// 🔴 A PRODUCT A COMMAND OPENS IS NOT THE PRODUCT (autopsy 042e472f + dfd24058, 2026-10-01). A voice
// assistant's command list — "Open YouTube", `"open YouTube"` — was classed "LARGE — clone of YouTube" in
// BOTH builds of that report, and the first one handed the mega-app planner a YouTube roadmap for a JARVIS
// app. A verb that LAUNCHES or USES the product (open, launch, play, watch, search, go to, visit; Hinglish
// "YouTube kholo / chalao") is the fifth shape of "the product being used", after channels, content,
// markdown and prohibitions — added to the same two lists, never a sixth special case.

// 🔴 A PRODUCT NAMED IN A PROHIBITION IS NOT A CLONE REQUEST (autopsy 6a4a799f, 2026-09-29). "Do NOT use
// copyrighted Spotify assets or branding" — written by someone asking for ORIGINAL branding — was classed
// "LARGE — clone of Spotify". Only the clause the name sits in is read (a comma, full stop, colon or line
// break ends it), so "I don't want a basic app, make a Spotify clone" still escalates.
const PROHIBITED_BEFORE = /\b(?:do\s+not|don'?t|dont|never|avoid|must\s+not)\b(?![^.,;:!?\n]*\b(?:like|jaisa|jaise|similar\s+to|inspired\s+by)\b)[^.,;:!?\n]{0,40}$/i;

// 🔴 A PRODUCT NAMED AS THE AUDIENCE OR THE EVENT IS NOT A CLONE REQUEST (Q-516, autopsy 39e982bd,
// 2026-10-04). "PrimeClash Esports" — a tournament app FOR Free Fire players — was recorded as
// *"LARGE — clone of Free Fire"*. The planner was still the right call (228 features escalate on their
// own), but the stated reason was false, and a false reason sends the next autopsy to the wrong place.
// The name was followed by who the app serves or what it hosts: players, a tournament, scrims, a room ID,
// diamonds. That is the sixth shape of "the product being used" (after channels, content, markdown,
// prohibitions and launch verbs). It is kept as its OWN list, guarded by a likeness word: "like PUBG
// players fighting" or "Free Fire jaisa game" still names the product to clone, because "like" before
// the name always wins. "for" before the name ("an app for Free Fire players") is the same audience shape.
const AUDIENCE_AFTER = /^[\s/]*(?:(?:ka|ki|ke|wala|wali|wale|se)\s+)?(?:tournaments?|turnaments?|players?|gamers?|fans?|lovers|community|communities|e-?sports|scrims?|squads?|guilds?|clans?|uids?|ids?|room\s+ids?|custom\s+rooms?|leaderboards?|diamonds?|top[\s-]?ups?|redeem\s+codes?|rank(?:s|ing|ings)?|tips|tricks|guides?|news|stats|wiki|creators?|influencers?|followers)\b/i;
const AUDIENCE_BEFORE = /\bfor\s+(?:the\s+|all\s+|our\s+|my\s+)?$/i;
const LIKENESS_AFTER = /^[^.,;:!?\n]{0,40}\b(?:jaisa|jaise|jaisi|clone|replica|copy\s+(?:of|bana\w*))\b/i;
const LIKENESS_BEFORE = /\b(?:like|jaisa|jaise|jaisi|clone\s+(?:of|like)|similar\s+to|inspired\s+by|copy\s+of|replica\s+of|version\s+of)\s+(?:the\s+|a\s+)?$/i;

export function namesAsProduct(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const at = m.index ?? 0;
    if (PROHIBITED_BEFORE.test(text.slice(Math.max(0, at - 48), at))) continue;
    // Markdown and quotes are not words (autopsy 4499741f): `YouTube ka **video/playlist URL**` and
    // `"Paste YouTube / Music URL"` hid their tool nouns behind `**` and `"`, and a music player that only
    // accepts YouTube links was planned as "LARGE — clone of YouTube".
    const noise = (t: string): string => t.replace(/[*_`"'“”‘’]+/g, '');
    const before = noise(text.slice(Math.max(0, at - 30), at));
    const after = noise(text.slice(at + m[0].length, at + m[0].length + 30));
    // A list of channels ("WhatsApp/Drive/USB") inherits the preposition before its first item.
    const listHead = before.replace(/(?:[\w.-]+\s*\/\s*)+$/, '');
    if (TOOL_BEFORE.test(before) || TOOL_BEFORE.test(listHead) || TOOL_AFTER.test(after)) continue;
    const after40 = noise(text.slice(at + m[0].length, at + m[0].length + 48));
    if (!LIKENESS_BEFORE.test(before) && !LIKENESS_AFTER.test(after40) && (AUDIENCE_AFTER.test(after) || AUDIENCE_BEFORE.test(before) || AUDIENCE_BEFORE.test(listHead))) continue;
    return true;
  }
  return false;
}

/** Heavy infrastructure a one-shot build genuinely cannot deliver — each is a strong escalate signal. */
const HEAVY_INFRA: Array<{ label: string; re: RegExp }> = [
  { label: 'real-time messaging between users', re: /\b(chat|message|messaging|messenger)\b[^.]{0,40}\b(between|with other|other user|each other|real.?time|do users|2 users|do log|ek dusre)\b|real.?time chat|live chat between/i },
  { label: 'multiplayer / online play', re: /multiplayer|online (game|match|battle|play)|battle royale|\b100 (players|log)\b|play with (friends|others) online/i },
  { label: 'audio / video calling', re: /video call|voice call|audio call|webrtc|live streaming|live stream\b/i },
  { label: 'live location / ride tracking', re: /live location|real.?time (location|tracking)|track (the )?(driver|rider|delivery) live/i },
  { label: 'a trained AI / ML model of our own', re: /\btrain (a|an|my|our)?\s?(ai|ml|model|llm|neural)\b|build (a|an|my|our)?\s?(llm|foundation model|language model)\b/i },
];

/** Single-purpose things that are almost always small, buildable one-shot — used only to KEEP the default. */
//
// 🔴 PLURALS (autopsy 2a7fa4b0, 2026-09-25): every word here matched only in the SINGULAR, so "app to
// add expenses" was not a small app while "app to add expense" was — and people name what an app
// holds in the plural. The plural only widens the hint, which only SUPPRESSES escalation, so it is
// held back wherever big software is named (`BIG_SOFTWARE_NOUN`): "an ERP with invoices and forms"
// is still an ERP.
const CLEARLY_SMALL = /\b(?:calculator|to-?do|todo|task list|timer|stopwatch|counter|quiz(?:zes)?|flash ?card|converter|unit convert|weather|clock|notepad|notes app|landing page|portfolio|resume|cv|one-?page|business card|invoice|form|survey|poll|tracker|habit|budget|expense|dictionar(?:y|ies)|recipe|menu card|qr code|password|pomodoro)s?\b/i;

/**
 * WHAT THE APP IS, not every word in the request (Q-398, autopsy Sur Taal; admin accepted). The hint
 * matched a small word ANYWHERE, so a nine-screen music player was "single-purpose" because one of its
 * features is a Sleep Timer — and a social network with a countdown timer would be too. The subject is
 * the first line of the request, cut at the first word that starts the feature list ("with", "—", ":",
 * "jisme", "के साथ"…). A small word there names the app; a small word after it names a feature. PURE.
 */
const FEATURE_LIST_START = /\s(?:with|having|including|featuring|that|which|where|jisme|jismein|jisme?n|jinme|wala|wali)\s|\s*[—–:;(]\s*|\s-\s|,|\s(?:के\s+साथ|जिसमें|जिसमे|जहाँ|जहां)\s/i;
export function requestSubject(raw: string): string {
  const text = withoutMachineText(String(raw ?? ''), { drop: true });
  const first = text.split('\n').map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? '';
  const cut = first.search(FEATURE_LIST_START);
  return (cut > 0 ? first.slice(0, cut) : first).trim();
}

/** Is the app ITSELF small and single-purpose? Read from the subject only. PURE. */
export function namesASmallApp(raw: string): boolean {
  // A Hindi subject ("एक कैलकुलेटर ऐप") is read in English too (Q-104, `devanagariTechTerms.ts`).
  const subject = glossDevanagari(requestSubject(raw));
  return (CLEARLY_SMALL.test(subject) || MEDIA_PLAYER_APP.test(subject)) && !BIG_SOFTWARE_NOUN.test(withEnglishReading(String(raw ?? '')));
}

/**
 * Count roughly how many DISTINCT features a prompt asks for — a huge multi-feature spec (often an
 * AI-written PRD) is a mega app dressed as a detailed prompt. Counts numbered/bulleted list items and
 * "and"/comma-joined feature verbs, capped. LENGTH alone is deliberately NOT used (a detailed prompt for a
 * small app is still small); this counts distinct asks, not words.
 *
 * 🔎 SIBLING FIXED 2026-09-18. This counter and `megaProjectSignals` (AgentV3/ProjectPlan.ts) are the
 * two live gates that decide a build is too big for one pass, and BOTH were measured blind to a comma:
 * bullet lines here, bullet lines there, plus loose verbs. "school ERP with students, teachers,
 * attendance, fees, exams, timetable, library, transport" scored ZERO — eight named modules, and the
 * only thing this function could see was the single word "with", halved away. Both now ask
 * `countEnumeratedFeatures`, which reads a bulleted spec AND the one-line comma list a real user types.
 *
 * ⚠️ It is a MAX, not a sum, deliberately: a bulleted PRD already counts once through `numbered`, and
 * adding the shared count on top would double it and push ordinary prompts over FEATURE_COUNT_MEGA.
 * This gate spends a real planner call (up to a minute, on every user's build, since
 * AGENTV3_MEGA_ROADMAP is on by default), so it may only ever become MORE right, never more eager.
 */
function featureCount(raw: string): number {
  // A pasted link is not a feature (autopsy 33812996). The famous-app check above still reads the
  // whole text on purpose: "a clone of https://zomato.com" names its product in the link.
  const text = withoutMachineText(raw, { drop: true });
  // A spec written as numbered sections is sized by its sections, as `megaProjectSignals` is (Q-391, Sur
  // Taal: 8 sections read as "~85 distinct features" here). Only ever a SMALLER count — never more eager.
  const sections = sectionedSpecSize(text);
  // A question or a setting on a bullet is not a feature either (autopsy 0311186f) — the same rule the
  // shared counter applies, so the two counts cannot disagree about one line.
  const numbered = (text.match(/^\s*(?:\d+[.)]|[-*•])\s+\S.*$/gm) || []).filter((l) => !notAFeatureLine(l)).length;
  const verbs = (text.match(/\b(add|build|create|include|with|support|allow|enable|manage|integrate)\b/gi) || []).length;
  // Numbered lists are the strongest signal; verbs are a softer one (halved).
  const legacy = numbered + Math.floor(verbs / 2);
  const counted = Math.max(legacy, countEnumeratedFeatures(text));
  return sections !== null ? Math.min(sections, counted) : counted;
}

const FEATURE_COUNT_MEGA = 8; // a spec asking for ~8+ distinct features is treated as large

/** Classify a build prompt's scope. Pure. */
export function analyzeAppScope(prompt: string): AppScope {
  const text = String(prompt || '');
  const signals: string[] = [];

  // Predicates read a Hindi request in English too (Q-104); the feature COUNT reads the request itself.
  const readable = withEnglishReading(text);
  const famous = FAMOUS_APPS.find((f) => namesAsProduct(readable, f.re));
  const heavy = HEAVY_INFRA.filter((h) => h.re.test(readable));
  const feats = featureCount(text);
  // The DECISION still reads any small word (unchanged: narrowing it would send 8 of 7,403 test prompts to
  // the roadmap planner — a behaviour change nobody decided). Only the REASON is read from the subject.
  const smallHint = CLEARLY_SMALL.test(readable) && !BIG_SOFTWARE_NOUN.test(readable);
  const smallSubject = namesASmallApp(text);

  if (famous) signals.push(`asks to clone ${famous.name}`);
  for (const h of heavy) signals.push(`needs ${h.label}`);
  if (feats >= FEATURE_COUNT_MEGA) signals.push(`~${feats} distinct features requested`);

  // ESCALATE only on a STRONG signal. A "clearly small" single-purpose app with NO heavy infra stays
  // direct even if it happens to mention many small features (a todo app with 8 tweaks is still a todo app).
  const strongMega = !!famous || heavy.length > 0 || (feats >= FEATURE_COUNT_MEGA && !smallHint);

  if (strongMega) {
    return { decision: 'analyze', size: 'large', famousApp: famous?.name ?? null, signals, smallHint, smallSubject };
  }
  if (smallSubject) signals.push('single-purpose app — buildable in one shot');
  else if (smallHint) {
    const word = (readable.match(CLEARLY_SMALL)?.[0] ?? '').trim();
    const subject = requestSubject(text).slice(0, 60);
    signals.push(`mentions a small feature ("${word}") but the app itself is "${subject || 'not named'}" — kept as one build (today's behaviour)`);
  } else signals.push('no mega-signal — treated as an ordinary one-shot app (today\'s behaviour)');
  return { decision: 'direct', size: 'small', famousApp: null, signals, smallHint, smallSubject };
}

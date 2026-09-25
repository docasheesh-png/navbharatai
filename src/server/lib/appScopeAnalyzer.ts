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

import { countEnumeratedFeatures } from '../AgentV3/enumeratedFeatures';

export type AppSize = 'small' | 'large';

export interface AppScope {
  /** 'direct' = build now, no LLM sizing call (the default). 'analyze' = hand to the LLM for a roadmap. */
  decision: 'direct' | 'analyze';
  size: AppSize;
  /** The famous product this prompt asks to clone, if recognised (for the honest reply + telemetry). */
  famousApp: string | null;
  /** Human-readable reasons the decision was made — shown in the build report for threshold tuning. */
  signals: string[];
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
const TOOL_BEFORE = /\b(?:using|use|uses|via|through|thru|over|on|with|by|to|into|from|in|share|send|post|login|log\s+in|sign\s+in|signin|integrat\w*|connect\w*|link\w*|embed\w*|se)\s+(?:the\s+|my\s+|your\s+|our\s+|their\s+|a\s+)?$/i;
// 🔴 CONTENT FROM A PRODUCT IS NOT THE PRODUCT (autopsy Study-Racer, 2026-09-25). "mai isme notes,
// youtube video ka link dalunga" — I will paste YouTube video links into it — was classed
// *"LARGE — clone of YouTube"* while the complexity router scored the same prompt 15 ("simple"). The
// planner then cut the user's own core ask (their notes, their YouTube links) into roadmap steps 2 and
// 3 and built a hard-coded math-quiz racer. A product name followed by a CONTENT noun (video, url,
// playlist, clip, thumbnail…) or by a Hinglish possessive before an integration noun ("youtube ka
// link", "instagram ki post") is the product being USED, exactly as a channel preposition before it is.
const TOOL_AFTER = /^[\s/]*(?:(?:ka|ki|ke|wala|wali|wale|se)\s+)?(?:api|apis|sdk|login|log\s*in|sign[\s-]?in|oauth|auth|share|sharing|button|buttons|integration|notifications?|messages?|link|links|otp|business|pay|s3|web\s+services|account|accounts|group|groups|number|alerts?|widget|embed|embeds|channel|bot|webhook|ads|videos?|urls?|playlists?|clips?|thumbnails?|posts?|reels?|stories|feed|page|pages)\b/i;

export function namesAsProduct(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 24), at);
    const after = text.slice(at + m[0].length, at + m[0].length + 24);
    // A list of channels ("WhatsApp/Drive/USB") inherits the preposition before its first item.
    const listHead = before.replace(/(?:[\w.-]+\s*\/\s*)+$/, '');
    if (TOOL_BEFORE.test(before) || TOOL_BEFORE.test(listHead) || TOOL_AFTER.test(after)) continue;
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
const CLEARLY_SMALL = /\b(calculator|to-?do|todo|task list|timer|stopwatch|counter|quiz|flash ?card|converter|unit convert|weather|clock|notepad|notes app|landing page|portfolio|resume|cv\b|one-?page|business card|invoice|form|survey|poll|tracker|habit|budget|expense|dictionary|recipe|menu card|qr code|password|pomodoro)\b/i;

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
function featureCount(text: string): number {
  const numbered = (text.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm) || []).length;
  const verbs = (text.match(/\b(add|build|create|include|with|support|allow|enable|manage|integrate)\b/gi) || []).length;
  // Numbered lists are the strongest signal; verbs are a softer one (halved).
  const legacy = numbered + Math.floor(verbs / 2);
  return Math.max(legacy, countEnumeratedFeatures(text));
}

const FEATURE_COUNT_MEGA = 8; // a spec asking for ~8+ distinct features is treated as large

/** Classify a build prompt's scope. Pure. */
export function analyzeAppScope(prompt: string): AppScope {
  const text = String(prompt || '');
  const signals: string[] = [];

  const famous = FAMOUS_APPS.find((f) => namesAsProduct(text, f.re));
  const heavy = HEAVY_INFRA.filter((h) => h.re.test(text));
  const feats = featureCount(text);
  const smallHint = CLEARLY_SMALL.test(text);

  if (famous) signals.push(`asks to clone ${famous.name}`);
  for (const h of heavy) signals.push(`needs ${h.label}`);
  if (feats >= FEATURE_COUNT_MEGA) signals.push(`~${feats} distinct features requested`);

  // ESCALATE only on a STRONG signal. A "clearly small" single-purpose app with NO heavy infra stays
  // direct even if it happens to mention many small features (a todo app with 8 tweaks is still a todo app).
  const strongMega = !!famous || heavy.length > 0 || (feats >= FEATURE_COUNT_MEGA && !smallHint);

  if (strongMega) {
    return { decision: 'analyze', size: 'large', famousApp: famous?.name ?? null, signals };
  }
  if (smallHint) signals.push('single-purpose app — buildable in one shot');
  else signals.push('no mega-signal — treated as an ordinary one-shot app (today\'s behaviour)');
  return { decision: 'direct', size: 'small', famousApp: null, signals };
}

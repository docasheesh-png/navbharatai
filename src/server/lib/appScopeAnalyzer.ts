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
  { name: 'Zoom / Meet', re: /\bzoom\b|google meet/i },
  // A "foundation-model AI like Claude/ChatGPT" — a trained model cannot be cloned; the LLM will honestly
  // reframe this to "an app that USES an AI via an API".
  { name: 'an AI like Claude/ChatGPT', re: /\b(like|jaisa|jaise|clone of)\s+(claude|chatgpt|gpt-?\d?|gemini|openai|an?\s+ai)\b|\bapna\s+chatgpt\b|\bchatgpt\s+(jaisa|banao)\b/i },
];

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
 */
function featureCount(text: string): number {
  const numbered = (text.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm) || []).length;
  const verbs = (text.match(/\b(add|build|create|include|with|support|allow|enable|manage|integrate)\b/gi) || []).length;
  // Numbered lists are the strongest signal; verbs are a softer one (halved).
  return numbered + Math.floor(verbs / 2);
}

const FEATURE_COUNT_MEGA = 8; // a spec asking for ~8+ distinct features is treated as large

/** Classify a build prompt's scope. Pure. */
export function analyzeAppScope(prompt: string): AppScope {
  const text = String(prompt || '');
  const signals: string[] = [];

  const famous = FAMOUS_APPS.find((f) => f.re.test(text));
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

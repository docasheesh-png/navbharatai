// OUR OWN NOTICE, SENT BACK AS THE USER'S REQUEST (autopsy 12511a9c, 2026-09-30).
//
// 🔴 WHAT HAPPENED. A free user asked for "Calculator". The first reply carried our weak-tier welcome
// notice ("🌱 You're building on the **free Weak engine** …"), and the NEXT build request's prompt was that
// notice, byte for byte — markdown asterisks included. No code path sends a narration line as a prompt
// (checked end to end: every send path, every composer pre-fill, the server's own history); the only way
// to get those exact bytes is a copy — every reply bubble has a Copy button, and a phone keyboard offers
// the clipboard as a one-tap paste. The build then ran on OUR words: the requirement analysis read a
// "social" domain into them, and the finished calculator shipped with our notice as its og:description.
//
// 🔑 THE CLASS, and it has happened before: platform-written text returned as a request. Autopsy fdd59ef8
// was our sign-in notice, pre-filled by a "Fix with AI" button. That fix closed one door (the button);
// the door every client shares — installed phone apps included — is this route. So the route recognises
// our own notices and answers instead of building: our words name nothing the user asked for.
//
// PRECISION: an exact match of a notice, or a long piece of one (a partial selection), after the markdown
// and the spacing are set aside. A request that merely MENTIONS the Weak engine is the user's own words
// and builds as before. `AGENTV3_NOTICE_ECHO=off` turns it off with no deploy.

import { weakTierWelcomeNotice, weakTierBuildFailedNotice } from './weakTierNotice';

/** Language codes the notices are written in; anything else gets the English text. */
const NOTICE_LANGUAGES = [null, 'hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar'] as const;

/** A piece this long, taken from inside a notice, is a copy of it and not the user's own sentence. */
export const MIN_ECHO_CHARS = 60;

export function noticeEchoGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_NOTICE_ECHO ?? '').trim().toLowerCase() !== 'off';
}

/** Case, markdown emphasis, emoji-adjacent spacing and runs of whitespace set aside. PURE. */
export function normaliseNoticeText(text: string): string {
  return String(text ?? '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

let cached: string[] | null = null;

/** Every notice text the platform writes into the conversation, normalised. */
export function platformNoticeTexts(): string[] {
  if (cached) return cached;
  const out = new Set<string>();
  for (const lang of NOTICE_LANGUAGES) {
    // The welcome notice rotates three phrasings by seed; every seed class is covered.
    for (let seed = 0; seed < 3; seed++) out.add(normaliseNoticeText(weakTierWelcomeNotice(lang, seed)));
    out.add(normaliseNoticeText(weakTierBuildFailedNotice(lang)));
  }
  cached = [...out].filter((t) => t.length > 0);
  return cached;
}

/** Is this prompt one of our notices, or a long piece of one? PURE apart from the env switch. */
export function isPlatformNoticeEcho(prompt: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!noticeEchoGuardEnabled(env)) return false;
  const said = normaliseNoticeText(prompt);
  if (!said) return false;
  return platformNoticeTexts().some((notice) => said === notice || (said.length >= MIN_ECHO_CHARS && notice.includes(said)));
}

/**
 * The answer, instead of a build. Names the user's earlier request when there is one, so the next step
 * is one message, not a retyped brief. White-label: our own words, no engine names. PURE.
 */
export function platformNoticeEchoReply(earlierRequest: string | null | undefined): string {
  const earlier = String(earlierRequest ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const base = "That message is NavBharatAI's own note about the free engine, so I did not build anything from it.";
  return earlier
    ? `${base} Your earlier request was "${earlier}" — send it again (or describe the app you want) and I will build it.`
    : `${base} Tell me what you would like to build, for example "a calculator" or "a shop billing app".`;
}

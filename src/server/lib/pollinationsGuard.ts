// The word scan every prompt passes BEFORE it is sent to the free image provider (Pollinations).
//
// 🔴 WHY THIS EXISTS — Google Play rejected the Android update on 2026-09-28 under the Sexual Content
// and Profanity + AI-Generated Content policies, and attached the evidence: a screenshot of "Image
// Generator AI FREE" in the "Photograph" style showing a realistic nude woman. Two gaps met there:
//
//   1. The platform's own triage (`triagePrompt` → `ADULT_CONTENT`) is written for APP-building
//      prompts. It waits for a pair — a porn noun AND "site / app / stream" — so a picture request has
//      no second half to match. Measured on the real function before this change: `nude woman`,
//      `naked girl on beach`, `topless woman` and even the bare word `porn` all returned ALLOW.
//      The CLAUDE.md line "missing a cleverly-worded request costs one model refusal, which already
//      works" is true of a chat model and FALSE of this image model: it does not refuse, it draws.
//   2. The provider's anonymous link has its own NSFW filter OFF unless `safe=true` is sent, and it
//      was not sent.
//
// So this module is the image-specific answer the admin asked for (2026-09-28, verbatim: "pollination
// ai ki api call se pahle ek scanning ki jaye! aur sensitive words par ban lagao! sirf pollination ai
// ke liye"). It is DELIBERATELY scoped to the Pollinations call: chat and build keep their own,
// precision-first triage, because a chat about sexual health or a build of a harassment-reporting
// tool must not be refused for naming what it is about. A PICTURE is different — the words describe
// what will be drawn, and "nude" in an image prompt has no innocent reading the drawing would respect.
//
// 🔒 THE CHOKE POINT IS THE URL BUILDER. `pollinationsImageUrl` calls `assertPollinationsPromptSafe`,
// so no code path — the image screen, the browser-fetch link, free chat's inline image, or one written
// next year — can build a link for a banned prompt. Callers ALSO scan first, so the user gets a clear
// refusal instead of an error; the assertion is the net under them, not the only line.
//
// ⚠️ A WORD LIST IS NOT A CLASSIFIER, and this one is not the only layer: `safe=true` on the link asks
// the provider to refuse NSFW output too. The list catches what the user ASKED for; the provider's
// filter catches what the model drew anyway. Neither is relied on alone.
//
// PURE module: no I/O, no model call, ₹0.

/** Why a prompt was refused. Admin-facing only; the user sees `POLLINATIONS_BLOCK_MESSAGE`. */
export type PollinationsBlockCategory = 'sexual' | 'profanity';

export type PollinationsScan =
  | { ok: true }
  | { ok: false; category: PollinationsBlockCategory; term: string };

/**
 * What the user is told. Branded (the White-Label Law: no provider name), names no word and no rule,
 * and says what to do next. English, per the language standard for NavBharatAI's own UI text.
 */
export const POLLINATIONS_BLOCK_MESSAGE =
  'NavBharatAI does not create nude, sexual or vulgar pictures. Please describe a different image.';

/** Thrown by the URL builder when a banned prompt reaches it — a bug in a caller, never a user path. */
export class PollinationsPromptBlockedError extends Error {
  readonly category: PollinationsBlockCategory;
  constructor(category: PollinationsBlockCategory) {
    super(`pollinations prompt blocked (${category})`);
    this.name = 'PollinationsPromptBlockedError';
    this.category = category;
  }
}

/**
 * Sexual content and nudity. Whole words only (`\b…\b`), so "class", "button", "Essex", "brand",
 * "sextant" and "Sussex" are untouched. Each entry is a regex SOURCE fragment.
 *
 * Deliberately ABSENT, each for a named innocent reading an image prompt really has: `breast`
 * (chicken breast, breast-cancer poster), `cock` (a rooster), `dick` (a name), `pussy` (a cat),
 * `strip` (comic strip, LED strip), `hot` alone (hot tea), `bath`/`shower` alone (a bathroom
 * showroom), `swimsuit` (a sports-shop banner), `lust…` (lustrous hair), `shit…` (shiitake, often
 * spelt "shitake"), `chod…` (Hinglish "chhod do", *leave it*, is often typed "chod do"). The phrases below catch the suggestive uses of those.
 */
const SEXUAL_TERMS: readonly string[] = [
  // Nudity
  'nude', 'nudes', 'nudity', 'nudist', 'naked', 'topless', 'bottomless', 'undress(?:ed|ing)?', 'unclothed',
  'disrobed?', 'bare[-\\s]?(?:breasts?|chested\\s+(?:woman|women|girl|girls|lady))',
  '(?:no|without|zero)\\s+(?:clothes|clothing|dress|dresses|kapde|kapda)',
  'wearing\\s+nothing', 'see[-\\s]?through', 'transparent\\s+(?:clothes|dress|top|shirt|saree|sari|bra)',
  // Explicit / pornographic
  'porn\\w*', 'xxx', 'nsfw', 'hentai', 'ecchi', 'rule\\s?34', 'onlyfans', 'erotic\\w*', 'sex', 'sexy', 'sexual\\w*',
  'sensual\\w*', 'seduc\\w*', 'provocative', 'lewd', 'lust', 'lustful', 'lusty', 'horny', 'orgasm\\w*', 'fetish\\w*', 'bdsm',
  'bondage', 'kinky', 'stripper\\w*', 'striptease', 'strip\\s+club', 'playboy', 'camgirl', 'escort\\s+girl',
  // Minimal clothing / underwear
  'lingerie', 'underwear', 'bra', 'bras', 'brassiere', 'panty', 'panties', 'thong', 'g[-\\s]?string', 'bikini\\w*',
  // Body parts named sexually
  'boob\\w*', 'tits', 'titt(?:y|ies)', 'nipples?', 'cleavage', 'buttocks', 'booty', 'genitals?', 'genitalia',
  'penis', 'vagina', 'vulva', 'crotch',
  // Suggestive phrasing that turns an ordinary word sexual
  'hot\\s+(?:girl|girls|woman|women|lady|ladies|babe|babes|chick)',
  '(?:girl|girls|woman|women|lady|ladies|man|men|boy|boys|couple)\\s+(?:in|taking|having)\\s+(?:a\\s+|the\\s+)?(?:shower|bath|bathtub)',
  '(?:girl|girls|woman|women|lady|ladies|couple)\\s+in\\s+(?:bed|bedroom)',
  // Hinglish (romanised Hindi)
  'nangi', 'nanga', 'nange', 'nagn', 'bina\\s+kapd\\w*', 'kapd\\w*\\s+ke\\s+bina', 'kapd\\w*\\s+utar\\w*',
  'chudai', 'chodai', 'chodna', 'randi', 'garam\\s+ladki', 'sexy\\s+ladki',
];

/** Profanity — Google's policy is "Sexual Content AND Profanity", and a picture can carry text. */
const PROFANITY_TERMS: readonly string[] = [
  'fuck\\w*', 'motherfuck\\w*', 'shit', 'shitty', 'bullshit', 'bitch\\w*', 'cunt\\w*', 'whore\\w*', 'slut\\w*', 'bastard\\w*',
  'madarchod\\w*', 'maderchod\\w*', 'behenchod\\w*', 'bhenchod\\w*', 'chutiy\\w*', 'chutia\\w*', 'gandu\\w*',
  'lund', 'lauda', 'loda', 'bhosd\\w*', 'bsdk',
];

/**
 * Devanagari forms. `\b` does not work on Devanagari (its letters are not `\w`), so these match as
 * substrings — every one is long and specific enough that no ordinary word contains it.
 */
const DEVANAGARI_SEXUAL = ['नंगी', 'नंगा', 'नंगे', 'नग्न', 'सेक्स', 'सेक्सी', 'अश्लील', 'चुदाई', 'चोद', 'रंडी', 'बिकिनी', 'कामुक'];
const DEVANAGARI_PROFANITY = ['मादरचोद', 'बहनचोद', 'भेनचोद', 'चूतिया', 'गांडू', 'भोसड़ी', 'लौड़ा'];

const SEXUAL_RE = new RegExp(`\\b(?:${SEXUAL_TERMS.join('|')})\\b`, 'i');
const PROFANITY_RE = new RegExp(`\\b(?:${PROFANITY_TERMS.join('|')})\\b`, 'i');

/** Look-alike digits and symbols a person types to slip a word past a filter: `nud3`, `p0rn`, `$exy`. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/**
 * The forms the scan reads. PURE and exported so the tests can pin each disguise it undoes.
 *
 * 1. NFKC + lowercase, with zero-width characters removed (they are invisible and split a word).
 * 2. Look-alike characters mapped back to letters — ONLY inside tokens that also contain a letter,
 *    so a size like "1024 x 768" or a price "₹499" is never rewritten into letters.
 * 3. Spaced-out letters joined: "n u d e", "n.u.d.e", "s-e-x" become one word. Only RUNS of
 *    single characters are joined, never ordinary words — "a big dog" stays three words.
 */
export function normalizeForScan(text: string): string {
  let t = String(text ?? '').normalize('NFKC').toLowerCase().replace(/[​-‍⁠﻿­]/g, '');
  t = t.replace(/[a-z0-9@$!]+/g, (tok) => (/[a-z]/.test(tok) ? tok.replace(/[013457@$!]/g, (c) => LEET[c] ?? c) : tok));
  // Runs of ≥3 single letters separated by spaces or punctuation: "n u d e" / "n.u.d.e" / "n-u-d-e".
  t = t.replace(/\b[a-z](?:[\s._\-*+]+[a-z]\b){2,}/g, (run) => run.replace(/[\s._\-*+]+/g, ''));
  return t;
}

/**
 * Scan a prompt that is about to be sent to Pollinations. PURE.
 *
 * Reads the text twice — as written and normalised — because normalising can also JOIN a word that
 * was legitimately apart, and reading both costs nothing. Any hit refuses.
 */
export function scanPollinationsPrompt(text: string | null | undefined): PollinationsScan {
  const raw = String(text ?? '');
  const forms = [raw.toLowerCase(), normalizeForScan(raw)];
  for (const f of forms) {
    const s = SEXUAL_RE.exec(f);
    if (s) return { ok: false, category: 'sexual', term: s[0] };
    const p = PROFANITY_RE.exec(f);
    if (p) return { ok: false, category: 'profanity', term: p[0] };
  }
  const nfkc = raw.normalize('NFKC');
  for (const w of DEVANAGARI_SEXUAL) if (nfkc.includes(w)) return { ok: false, category: 'sexual', term: w };
  for (const w of DEVANAGARI_PROFANITY) if (nfkc.includes(w)) return { ok: false, category: 'profanity', term: w };
  return { ok: true };
}

/** The net under every caller: throws for a banned prompt. Called by `pollinationsImageUrl`. */
export function assertPollinationsPromptSafe(text: string | null | undefined): void {
  const scan = scanPollinationsPrompt(text);
  if (!scan.ok) throw new PollinationsPromptBlockedError(scan.category);
}

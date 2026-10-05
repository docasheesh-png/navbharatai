// ONE IMAGE GENERATOR, ONE PRICE — AND A PRICE IS CHARGED ONLY TO A SCREEN THAT SHOWED IT (admin 2026-10-05).
//
// History, so nobody restores the old shape from an old comment:
//  - 2026-09-30 the screen had two modes, FREE (the free provider's anonymous door, no count, no charge)
//    and PAID (5 free pictures a day, then ₹1 each, `imageAllowance.ts`).
//  - 2026-10-05 the admin sent a screenshot of Free mode answering every request with "the free image
//    servers are too busy" over an admin diagnostic reading `HTTP 402 | anonymous access refused`. The
//    provider was not busy: it had started asking for payment from anyone without an account key, from
//    the user's browser and from our server alike, so Free mode could not make a single picture and told
//    every user a cause that was not true. Asked to choose, the admin removed Free mode
//    ("Free mode हटाएँ"). The screen now opens straight on the one generator: 5 free pictures a day,
//    then ₹1 each.
//
// 🔒 WHAT IS LEFT OF "TIER" IS CONSENT TO A PRICE. Every request runs the same engines and counts against
// the same 5 a day. Only a request whose screen SHOWED the price (`tier: 'paid'`, which the current
// screen always sends) may be charged. A request that names no tier comes from a client that never
// showed a price — every phone app installed before this change, and a browser tab still holding the
// old page — so it gets the same free pictures and, once those are used, a plain sentence instead of a
// charge it never agreed to.

import { detectLanguageHint } from '../AgentV3/LanguageDetect';

/** The code a client sees when its free pictures are used and it cannot be charged. */
export const FREE_USED_UPDATE_CODE = 'free_used_update';

/** True only when the request's own screen showed the price (`tier: 'paid'`). PURE. */
export function priceShownTo(body: unknown): boolean {
  const t = (body as { tier?: unknown } | null)?.tier;
  return typeof t === 'string' && t.trim().toLowerCase() === 'paid';
}

const EN = (n: number): string => `You have used your ${n} free images for today. To make more (₹1 each), update the NavBharatAI app or open navbharatai.com, or come back tomorrow for ${n} more free images.`;
const HINGLISH = (n: number): string => `Aaj ki ${n} free images ho gayi hain. Aur images (₹1 each) ke liye NavBharatAI app update kijiye ya navbharatai.com kholiye, ya kal ${n} nayi free images ke liye aaiye.`;
const HINDI = (n: number): string => `आज की ${n} फ़्री इमेज हो गई हैं। और इमेज (₹1 प्रति इमेज) के लिए NavBharatAI ऐप अपडेट कीजिए या navbharatai.com खोलिए, या कल ${n} नई फ़्री इमेज के लिए आइए।`;

// Roman-script Hindi ("ek sher ki photo banao") carries no Devanagari, so the script detector cannot
// see it. Two of these everyday words is enough to answer in the same Roman Hindi; one is not, because
// "photo" and "banner" are English too.
const HINGLISH_WORDS = /\b(banao|bana do|banado|banaiye|chahiye|chaiye|dikhao|wala|wali|wale|mera|meri|mere|hamara|hamari|kar do|karo|kijiye|ki|ka|ke|aur|mein|nahi|hai|hain|ek|jaisa|jaisi)\b/gi;

/** "Today's free images are used — update the app", in Hindi, Roman Hindi or English. PURE. */
export function freeUsedUpdateMessage(prompt: string, freePerDay: number): string {
  const said = String(prompt ?? '');
  if (detectLanguageHint(said)?.code === 'hi') return HINDI(freePerDay);
  const hits = new Set((said.toLowerCase().match(HINGLISH_WORDS) ?? []).map((w) => w.trim()));
  return hits.size >= 2 ? HINGLISH(freePerDay) : EN(freePerDay);
}

// THE REFERRAL CODE — minted by the server, read aloud by a human.
//
// This is the string one person sends another over WhatsApp and the other types into a phone,
// probably one-handed, possibly from a screenshot, possibly after hearing it spoken. Every decision
// below is about that moment rather than about cryptography:
//
// • NO 0/O, NO 1/I/L. The single largest source of "this code does not work" support messages is a
//   reader who cannot tell a zero from an O in whatever font the screenshot used. Removing the
//   ambiguous glyphs entirely costs 6 of 32 symbols and removes the whole class.
// • UPPERCASE, AND MATCHED CASE-INSENSITIVELY. A phone keyboard autocapitalises; a person typing
//   into a form does whatever they like. Refusing `nb4k7pq` when `NB4K7PQ` was meant is a support
//   ticket for nothing.
// • SIX CHARACTERS. 26^6 ≈ 309 million with this alphabet — far beyond any plausible user count,
//   while still short enough to say out loud.
//
// 🔒 IT IS AN IDENTIFIER, NOT A SECRET, and nothing here should ever pretend otherwise. Knowing
// somebody's code lets you credit them with a referral, which is a thing they actively want. All the
// money protection lives in `referralRewards.ts` (one device, one gift; nothing without a verified
// mobile; a ₹1,500 lifetime cap) — never in the code being hard to guess. A brute-forcer's reward
// for finding a valid code is that they have given a stranger ₹25.
//
// 🔴 WHICH IS WHY RANDOMNESS STILL MATTERS, for a reason that is NOT secrecy: a code derived from
// the user (their email, their uid, a counter) would leak who they are or how many users exist, and
// the version of this feature that was deleted on 2026-09-15 did exactly that — it printed
// `NAV-<mailbox>-REF`, publishing the mailbox of anyone who shared their code.
//
// PURE — the caller supplies the randomness and owns the uniqueness check.

/** No 0/O and no 1/I/L: 26 symbols that survive a screenshot, a phone call and a bad font. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ2345678 9'.replace(/\s/g, '');

export const CODE_LENGTH = 6;

/**
 * Mint one code from injected randomness.
 *
 * `randomBytes` is a parameter so a test can pin an exact output — a generator seeded from the
 * global RNG can only ever be tested for shape, and the shape is the part that was never wrong.
 */
export function mintReferralCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    // Modulo bias is real here and deliberately accepted: 256 % 26 leaves the first four symbols
    // very slightly more likely. That matters for a secret and not at all for an identifier whose
    // uniqueness is enforced by the store — and rejection sampling would make this function able to
    // consume an unbounded amount of randomness, which is a worse property for something on a
    // sign-up path.
    out += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Normalise what a user typed into the code it was meant to be, or null.
 *
 * Strips spaces and dashes because people insert both when reading a code aloud, and uppercases
 * because a phone keyboard has its own opinions. Anything left that is not in the alphabet is a
 * refusal rather than a guess: silently mapping `O` to `0` would hand someone else's code to a user
 * who mistyped, and crediting the wrong person is worse than asking them to check the spelling.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[\s\-_]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** The share text. Plain, no vendor names, and it says what the other person actually gets. */
export function referralShareMessage(code: string, appUrl = 'https://navbharatai.com'): string {
  return `Build your own app with NavBharatAI. Use my code ${code} when you sign up in the Android app and we both get free credit: ${appUrl}`;
}

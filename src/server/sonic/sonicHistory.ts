// Seeded-history normalizer for a voice session (admin real run 2026-07-14).
//
// ROOT CAUSE this fixes: Nova Sonic's conversation format REQUIRES the seeded prior turns to begin with
// a USER turn — it rejects a history whose first message is the assistant with
//   "First message in chat history should not be Assistant. Deserialization error…"
// Every professional chat (e.g. Doctor AI / SDA) opens with an ASSISTANT welcome message, so seeding the
// raw history to continue the conversation started on the assistant and failed the whole voice call.
//
// Fix (pure + tested, applied server-side so ALL callers are safe): cap to the last N turns, drop empty
// turns, then drop any LEADING assistant turns so the seeded window always starts with a user turn (or
// is empty, in which case the voice session simply starts fresh — never on an assistant turn).

export interface SonicTurn { role: 'user' | 'assistant'; content: string }

export function normalizeSeededHistory(turns: SonicTurn[] | undefined | null, cap = 12): SonicTurn[] {
  const clean = (Array.isArray(turns) ? turns : [])
    .filter((t): t is SonicTurn =>
      !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim().length > 0)
    .slice(-Math.max(0, cap));
  const firstUser = clean.findIndex((t) => t.role === 'user');
  return firstUser < 0 ? [] : clean.slice(firstUser);
}

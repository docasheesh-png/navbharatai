// Once-per-session greeting — a user is greeted (namaste / राम-राम / hello …) ONLY on the first message
// of a session, never on every reply (admin 2026-08-12: "ek user ko ek session me bas 1 baar namaste").
//
// The greeting is instructed by the free-chat system prompt, so the fix belongs there: on the first turn
// a single greeting is allowed; on every later turn the prompt states, firmly and unambiguously, that the
// user has already been greeted this session and must not be greeted again. Pure — no I/O, never throws.

/**
 * Is this the FIRST message of the chat session? True only when there is no prior conversation history.
 * A missing / non-array / empty history is the first turn; anything with a prior message is not.
 */
export function isFirstChatTurn(history: unknown): boolean {
  return !Array.isArray(history) || history.length === 0;
}

/**
 * The absolute once-per-session greeting rule injected into the free-chat system prompt. On the first turn
 * a single warm greeting is allowed; after that, greeting again (the "namaste in every message" bug) is
 * explicitly forbidden so the reply begins with the actual answer.
 */
export function sessionGreetingRule(isFirstTurn: boolean): string {
  const head = 'ONCE-PER-SESSION GREETING RULE (ABSOLUTE):';
  const line = isFirstTurn
    ? '• This is the FIRST message of the session — a single warm greeting is allowed here (only if the user greeted, per the map above).'
    : '• You have ALREADY greeted this user earlier in this session. Do NOT greet again — no नमस्ते / Namaste / राम-राम / Hello / Hi / प्रणाम / any opener at all. Begin your reply with the actual answer. Greeting again every message is the exact mistake to avoid.';
  return `${head}\n${line}`;
}

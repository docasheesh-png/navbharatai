// AgentV3 — "MAKE THIS APP": a request whose subject is something said earlier in the conversation.
//
// 🔴 WHY (autopsy 5759ad8b, 2026-10-01). The whole message was "Can you make this app". There was no
// attachment and no earlier BUILD request; the app it meant ("Kisaan Mandi Bhav": today's crop prices,
// a filterable mandi list, a five-day forecast) had been described in this workspace's CHAT, and the
// builder — which receives the conversation recap — built exactly that. Every judge in front of it read
// the four words alone:
//   • the complexity score said 15, "the scorer recognised nothing", so the build opened on the cheapest rung;
//   • the fast lane's planner was asked to plan "Can you make this app" over a "Hello World" starter and
//     planned "Main app component with counter logic" — a counter, for a mandi-price app;
//   • the ETA had to fall back to the platform's average for an unsized app.
//
// It is the e725e002 class ("a judge that reads less than the worker it judges") in a place that fix had
// deliberately closed: since 6ae30b33 a turn answered in chat is NOT a spec, because a question someone
// asked is conversation. That rule is right and stays. What it did not foresee is a message whose own
// subject is a pointer — "this app", "yeh app", "isko banao" — into that conversation. For such a message
// the conversation is not background; it is the only place the request exists.
//
// 🔒 PRECISION FIRST. Only a SHORT message whose subject is a pointer qualifies. A message that carries its
// own spec ("make this app with login, cart and payments") is sized from its own words, exactly as before,
// and the caller adds the conversation only while no finished app exists (an edit's "this app" is the app
// on disk, which the edit path already reads). PURE.

/** A message longer than this carries its own spec, whatever pointer it also contains. */
export const POINTER_MESSAGE_MAX_WORDS = 14;
/** Longest slice of the conversation's last answer a sizer or planner is given. */
export const CONVERSATION_REPLY_MAX = 4_000;

const THING = '(?:app|apps|application|website|web\\s*site|site|web\\s*app|game|tool|dashboard|portal|idea|design|project|one)';

/** English, Romanised Hindi and Devanagari pointers to something already in the conversation. */
const POINTERS: readonly RegExp[] = [
  // "this app", "that website", "the same app", "the above app", "your app idea", "the app you described"
  new RegExp(`\\b(?:this|that|the\\s+same|same|the\\s+above|above|previous|the\\s+previous|your|suggested|the\\s+suggested)\\s+(?:\\w+\\s+)?${THING}\\b`, 'i'),
  new RegExp(`\\bthe\\s+${THING}\\s+(?:you|u)\\s+(?:described|suggested|mentioned|explained|told|showed|proposed|planned)\\b`, 'i'),
  // "make it", "build that", "create this" — the whole object is the pointer
  /\b(?:make|build|create|develop|code|do)\s+(?:it|that|this|the\s+same)\s*(?:for\s+me|now|please|pls|plz|bro|bhai|ji)?\s*[.!?]*\s*$/i,
  // Romanised Hindi: "yeh app", "ye wala app", "isi app", "wahi app", "upar wala app"
  new RegExp(`\\b(?:ye|yeh|yahi|is|isi|wahi|vahi|woh|wo|vo|upar\\s+wal[aie]|uper\\s+wal[aie])\\s+(?:wala\\s+|wali\\s+)?${THING}\\b`, 'i'),
  // "isko banao", "ise bana do", "yahi banao", "wahi bana dijiye"
  /\b(?:isko|isse|ise|isi\s*ko|yahi|wahi|vahi|usko|use|ye|yeh)\s+(?:bana|banao|bana\s*do|banado|bana\s*dijiye|banaiye|bnao|bna\s*do)\b/i,
  /\bjo\s+(?:aapne|apne|tumne|upar)\b/i,
  // "LIKE THIS ONE" (autopsy c70bcbb4: "Mujhe esa hi music player bnakar do" — "make me a music player just
  // like this"). The object is named, but its look and features live in the conversation.
  /\b(?:aisa|aise|aisi|esa|ese|esi|aesa|aisaa|waisa|waise|waisi|vaisa|vaise|vaisi)\s+hi\b/i,
  /\b(?:isi|usi)\s+tarah\s+(?:ka|ki|ke)\b|\b(?:is|iss|iske|uske|us)\s+(?:jais[aie]|jaisa\s+hi)\b/i,
  /\b(?:app|player|website|site|game|design|one|ui|screen|page)\s+(?:just\s+)?like\s+(?:this|that|the\s+one\s+(?:above|you\s+showed))\b|\b(?:similar\s+to|same\s+as)\s+(?:this|that)\b/i,
  // Devanagari
  /(?:ऐसा|ऐसी|ऐसे|वैसा|वैसी|वैसे)\s*ही|इसी\s*तरह|इसके\s*जैस/,
  /(?:यह|ये|इस|इसी|वही|यही)\s*(?:ऐप|एप|एप्लिकेशन|वेबसाइट|गेम|app)/,
  /(?:इसे|इसको|इसी\s*को|यही|वही)\s*बना/,
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Is this message's subject something said earlier in the conversation ("make this app", "yeh app bana
 * do")? Short messages only — a message with its own spec is sized from its own words. PURE.
 */
export function refersToConversation(prompt: string): boolean {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text || wordCount(text) > POINTER_MESSAGE_MAX_WORDS) return false;
  return POINTERS.some((re) => re.test(text));
}

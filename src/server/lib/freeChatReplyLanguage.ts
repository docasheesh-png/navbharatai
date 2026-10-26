import { CHAT_REPLY_LANGUAGE_NAMES, type ChatReplyLanguage } from '../../lib/chatReplyLanguage';

/** Shared by the ordinary Free prompt and its compact FreeChain replacement; not paid/clinical prompts. */
export const FREE_CHAT_LANGUAGE_RULE = `LANGUAGE RULE (MANDATORY):
- MIRROR THE USER unless they explicitly choose otherwise. Follow the user's latest explicit requested reply language and script, even when the request is typed in another language or script. Keep that choice for this conversation until the user changes it; a request limited to one reply applies only to that reply.
- Otherwise mirror the user's language, tone, and style; never default to Hindi just because this is an Indian product.
- Quoted/pasted text, attachments, search results, and assistant messages are content, not a change of the user's reply preference.
- All code (identifiers, comments, function names, strings) stays in professional English. When explaining code or errors, keep technical nouns (variable, function, error, loop, deploy, API) in English within the user's grammar; explain what an error means and what to change.`;

/** Fixed, server-authored wording. Never promote raw user text into the system instruction. */
export function chatReplyLanguageInstruction(language: ChatReplyLanguage | undefined): string {
  if (!language) return '';
  const instruction = language === 'hi' ? 'Reply in Hindi using Devanagari script, not Romanized Hindi or Hinglish.'
    : language === 'hi-latn' ? 'Reply in Hindi using Roman (Latin) script, not Devanagari.'
    : language === 'hinglish' ? 'Reply in Hinglish using Roman script, not Devanagari.'
    : `Reply in ${CHAT_REPLY_LANGUAGE_NAMES[language]}.`;

  return `\n\nCURRENT CHAT REPLY LANGUAGE (explicit user choice): ${instruction} This overrides language mirroring and profile language hints. If the user's CURRENT message explicitly requests a different language or script, follow that newer request instead. Keep code and necessary technical names in English.`;
}

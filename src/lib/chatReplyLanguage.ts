/** Explicit reply preferences belong to a conversation, not the account or device. Pure; no storage. */
export const CHAT_REPLY_LANGUAGE_NAMES = {
  hi: 'Hindi', 'hi-latn': 'Romanized Hindi', hinglish: 'Hinglish', en: 'English', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
  mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', ur: 'Urdu',
  ne: 'Nepali', or: 'Odia', sa: 'Sanskrit', fr: 'French', es: 'Spanish', de: 'German',
  ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', ru: 'Russian',
} as const;
export type ChatReplyLanguage = keyof typeof CHAT_REPLY_LANGUAGE_NAMES;

/** Existing provider capability buckets; choosing Tamil must never select the Hindi bucket. */
export function chatReplyLanguageCategory(language: ChatReplyLanguage): 'hi' | 'hinglish' | 'en' | 'other' {
  if (language === 'hi-latn') return 'hinglish';
  return language === 'hi' || language === 'hinglish' || language === 'en' ? language : 'other';
}

const LANGUAGE = '(?:' + Object.values(CHAT_REPLY_LANGUAGE_NAMES).join('|') + '|dev(?:a|aa)?n(?:a|aa)g(?:a|aa)?ri|hindi|hinglish|english|\\u0926\\u0947\\u0935\\u0928\\u093e\\u0917\\u0930\\u0940|\\u0939\\u093f\\u0902?\\u0926\\u0940|\\u0939\\u093f\\u0928\\u094d\\u0926\\u0940|\\u0905\\u0902\\u0917\\u094d\\u0930\\u0947\\u091c\\u093c?\\u0940)';
const PREFIX = '(?:(?:please|pls|kindly|now|actually|instead|no|always|from now on|for this chat|ab|aage se|mujhe|sirf|only)[,\\s]+)*';
const VERB = '(?:reply|respond|answer|explain|speak|write|bataa?o|bataiye|samjhaa?o|likho|bolo|jawab\\s+(?:do|dena)|answer\\s+(?:do|dena)|\\u092c\\u0924\\u093e\\u0913|\\u092c\\u0924\\u093e\\u0907\\u090f|\\u0938\\u092e\\u091d\\u093e\\u0913|\\u0932\\u093f\\u0916\\u094b|\\u091c\\u0935\\u093e\\u092c\\s+(?:\\u0926\\u094b|\\u0926\\u0947\\u0928\\u093e)|\\u0909\\u0924\\u094d\\u0924\\u0930\\s+\\u0926\\u094b)';
const IN = '(?:in|me|mein|\\u092e\\u0947\\u0902)';
const COMMANDS = [
  new RegExp(`^${PREFIX}${VERB}\\s+(?:to me\\s+)?(?:only\\s+)?${IN}\\s+(${LANGUAGE})(?=$|[\\s,])`, 'iu'),
  new RegExp(`^${PREFIX}(${LANGUAGE})\\s+(?:script\\s+)?${IN}\\s+${PREFIX}${VERB}(?=$|[\\s,])`, 'iu'),
  new RegExp(`^${PREFIX}(?:use|switch to)\\s+(${LANGUAGE})(?:\\s+(?:script|for (?:your )?(?:answers|replies)))?$`, 'iu'),
  new RegExp(`^(${LANGUAGE})\\s+please$`, 'iu'),
];

function declaredLanguage(text: string): ChatReplyLanguage {
  const named = Object.entries(CHAT_REPLY_LANGUAGE_NAMES).find(([, name]) => name.toLowerCase() === text.toLowerCase());
  if (named) return named[0] as ChatReplyLanguage;
  if (/\u0905\u0902\u0917\u094d\u0930\u0947\u091c/i.test(text)) return 'en';
  return 'hi';
}

/** Only direct reply instructions, never language mentions, quotations, code, or pasted passages. */
function explicitInstruction(value: unknown, persistentOnly = false): { language: ChatReplyLanguage; temporary: boolean } | undefined {
  if (typeof value !== 'string') return undefined;
  const prose = value
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`]*`|"[^"]*"|'[^'\n]*'|“[^”]*”|‘[^’]*’/g, ' ')
    .replace(/^\s*>.*$/gm, '');
  // An introduced document is data, including unquoted lines that look like instructions.
  const introduction = /\b(?:summarize|translate|review|read|analyze|analyse|following|quote|quoted|excerpt|pasted|document|transcript|article|text|message|email|passage)\b[^:\n]*:\s*(?:\n|$)/i.exec(prose);
  const ownWords = introduction ? prose.slice(0, introduction.index) : prose;
  let found: ReturnType<typeof explicitInstruction>;
  for (let clause of ownWords.split(/[.!?;\n\u0964]+/)) {
    clause = clause.trim();
    const temporary = /\b(?:for (?:this|the next) (?:answer|reply|turn)(?: only)?|just (?:this|the next) (?:answer|reply|turn))\b/i.test(clause);
    clause = clause.replace(/^(?:for (?:this|the next) (?:answer|reply|turn)(?: only)?|just (?:this|the next) (?:answer|reply|turn))\s*,?\s*/i, '');
    if (persistentOnly && temporary) continue;
    for (const command of COMMANDS) {
      const match = command.exec(clause);
      if (match && !/^\s*(?:nahi|nhi|mat|\u0928\u0939\u0940\u0902|\u092e\u0924)(?:\s|$)/iu.test(clause.slice(match[0].length))) {
        let language = declaredLanguage(match[1]);
        if (language === 'hi' && /^\s*,?\s*(?:(?:using|in|with)\s+(?:roman|latin)(?:\s+(?:script|letters))?|(?:using|in|with)\s+english\s+letters|(?:roman|latin|english)\s+(?:script|letters)\s+(?:me|mein))\b/i.test(clause.slice(match[0].length))) language = 'hi-latn';
        found = { language, temporary }; break;
      }
    }
  }
  return found;
}

/** Current explicit choice wins; otherwise the last user choice wins, even when history is trimmed later. */
export function resolveChatReplyLanguage(message: unknown, history: unknown = [], carried?: unknown): ChatReplyLanguage | undefined {
  const current = explicitInstruction(message);
  if (current) return current.language;
  // A carried preference was resolved from the complete client transcript. Its text may already
  // have been truncated in history, so only a CURRENT explicit request may override this enum.
  if (typeof carried === 'string' && Object.hasOwn(CHAT_REPLY_LANGUAGE_NAMES, carried)) return carried as ChatReplyLanguage;
  const turns = Array.isArray(history) ? history : [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn || typeof turn !== 'object' || (turn.sender ?? turn.role) !== 'user') continue;
    const instruction = explicitInstruction(turn.text ?? turn.content, true);
    if (instruction && !instruction.temporary) return instruction.language;
  }
  return undefined;
}

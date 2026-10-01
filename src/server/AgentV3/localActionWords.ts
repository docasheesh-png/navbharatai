// The Hindi / Hinglish words for "do not press this" — shared by the click explorer and the sign-in explorer
// (both drive a real browser through somebody's app), in their own module so neither imports the other.

/**
 * 🔴 HINDI AND HINGLISH TOO (autopsy de3bb2bb, 2026-10-01). The list below was English only, and NavBharatAI
 * builds apps in the user's language: the explorer pressed "Itihaas saaf karein" (clear history) on a chat
 * app because nothing in it read "saaf karein" as "clear". Romanised Hindi needs the verb's ending, so each
 * stem is followed by its common imperative forms; Devanagari has no `\b` in a JavaScript regex, so those
 * words match as substrings. Only verbs that DESTROY, PAY or SEND — the same three things the English list
 * names — never a word that only shows something.
 */
export const DESTRUCTIVE_LOCAL_WORDS = '(?:hata|mita)(?:o|en|ein|yen|yein|ayen|ayein|aen|aye|ye|iye|na|dein|do)'
  + '|(?:saa?f|khali|radd)\\s*kar(?:o|e|en|ein|iye|na|dein|do)'
  + '|log\\s*out\\s*kar\\w*|delete\\s*kar\\w*';
export const SPENDING_LOCAL_WORDS = '(?:kharid|bhej)(?:o|e|en|ein|iye|na|dein|do)|bhugtan|bhugtaan';
export const DEVANAGARI_NEVER_WORDS = 'हटा|मिटा|साफ़? ?कर|साफ कर|खाली कर|रद्द|लॉग ?आउट|डिलीट|भुगतान|खरीद|भेज';


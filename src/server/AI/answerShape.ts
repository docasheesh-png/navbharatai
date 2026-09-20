// THE NEWSPAPER SHAPE — headline, then the gist, then the whole story (admin 2026-09-20).
//
// THE ASK, verbatim: *"jab koi question/query puche to response me ek sath line me pura response na
// aye. 3 part me aya! 1. headline (1 ya maximum 2 line) me pure reply ka main point aa jaye! 2. uske
// niche summary 1 to 10 line me … 3. last me pura answer ho. matlab jaise newspaper me koi news hote
// hai."* And the limit, in the same breath: *"agar user bole short answer do, ya ai ka answer already
// short hi hai, to yeh system lagane ki jaruri nahi hai!!"*
//
// 🔑 WHY THIS IS A PROMPT RULE AND NOT A PARSER. The obvious build is to let the model answer as it
// does today and then split the text into three parts on the client. That cannot work and would be
// worse than nothing: a splitter can only CUT an answer that was written as one argument, so the
// "headline" would be its first sentence — which is usually a preamble, not the conclusion — and the
// "summary" would be a prefix of the body rather than something that stands on its own. The three
// parts have to be WRITTEN as three parts. Asking for them costs one paragraph of prompt; a parser
// would cost a second model call to do properly, which the free tier cannot spend.
//
// 🔒 AND THE OUTPUT IS ORDINARY MARKDOWN, so nothing can half-render. A bold line, a paragraph, then
// the body: if the model ignores the whole directive the user gets exactly today's answer, and if it
// follows it only partly the reply is still valid prose. There is no marker to leak, no parse to
// fail, and no state the client has to hold while the answer streams.
//
// 💸 COST: zero extra calls, and the block is injected ONLY when it can apply — the same discipline
// `songcraftFor` already uses. A song, a short-answer request or a code request pays nothing.
//
// PURE — no I/O, no clock, no env. Never throws.

import { tokens, isSongRequest } from './songcraft';

/**
 * The user asking for a SHORT answer, in the words people actually type. Whole tokens only, so
 * "shortcut", "shorts" and "shortage" do not match.
 *
 * ⚠️ THE ASYMMETRY IS WHY THIS LIST MAY BE GENEROUS. A false positive here costs the user exactly
 * TODAY's behaviour — a long answer with no headline, which is what they have always had. A false
 * negative costs a headline on an answer that did not need one, and the directive's own "skip it when
 * your answer is short" rule is the second net under that. So when in doubt, skip the shape.
 */
const SHORT_WORDS = [
  // English
  'short', 'shortly', 'brief', 'briefly', 'concise', 'concisely', 'tldr', 'tl;dr', 'summarise',
  'summarize', 'summary', 'crisp', 'oneline', 'one-line',
  // Hindi — Devanagari. Only words that can ONLY mean brevity.
  'संक्षेप', 'संक्षिप्त', 'सारांश',
  // Romanized Hindi / Hinglish
  'sankshep', 'sankshipt', 'saransh',
];

/**
 * 🔴 THE WORDS THAT ARE DELIBERATELY NOT ABOVE, and the test that caught me putting them there.
 *
 * The first draft listed `chhota/chhote/chhoti`, `छोटा`, `kam`, `जल्दी` and `thode` as bare tokens,
 * with a comment arguing that in a question they "almost always qualify the ANSWER". The very first
 * precision case disproved it: **"GST kya hota hai aur CHHOTE dukandar ko kaise register karna
 * chahiye?"** — a long, genuine question about SMALL SHOPKEEPERS — was read as a request for a short
 * answer. `kam` ("kam kharche me"), `jaldi` ("jaldi kaise seekhein") and `thode` ("thode paise me")
 * are the same trap, and they are among the commonest words in Hindi.
 *
 * They still work — but only inside a PHRASE that can mean nothing else ("chhote me", "kam shabdon
 * me", "thode shabdon me"), which is how people actually ask for brevity. The asymmetry that makes
 * over-matching cheap does not make it free: skipping the shape on every question containing "chhota"
 * would quietly switch the feature off for a large share of real Indian questions.
 */

/** Multi-word ways of asking for brevity that a single token cannot catch. */
const SHORT_PHRASES = [
  'in one line', 'in a line', 'one line me', 'ek line', 'ek lain', 'ek hi line',
  'in short', 'short me', 'chhote me', 'chote me', 'chhota answer', 'chota answer',
  'thode me', 'thode shabdon', 'thode shabdo', 'jaldi batao', 'jaldi bata',
  'kam shabdon', 'kam shabdo', 'in a sentence', 'in two lines', 'do line',
  'एक लाइन', 'एक पंक्ति', 'कम शब्दों', 'थोड़े शब्दों', 'संक्षेप में', 'छोटे में', 'छोटा जवाब',
  'few words', 'keep it short', 'make it short', 'bullet points only',
];

/** Did the user ask for a SHORT answer? PURE. */
export function wantsShortAnswer(text: string): boolean {
  const raw = String(text ?? '').toLowerCase();
  if (SHORT_PHRASES.some((p) => raw.includes(p))) return true;
  const set = new Set(tokens(raw));
  return SHORT_WORDS.some((w) => set.has(w));
}

/**
 * Words that mean "produce this thing for me" — where the ANSWER IS the artefact and a news report
 * about it would be absurd. A poem does not want a headline; a translation does not want a summary.
 *
 * Songs are covered by `isSongRequest`, which is stricter (it wants a writing verb too) and is reused
 * rather than re-listed, so the two can never disagree about what a song is.
 */
const VERBATIM_WORDS = [
  // English
  'poem', 'poetry', 'rhyme', 'story', 'essay', 'letter', 'email', 'caption', 'slogan', 'joke',
  'translate', 'translation', 'code', 'script', 'sql', 'regex', 'json', 'recipe', 'speech',
  // Hindi — Devanagari
  'कविता', 'शायरी', 'कहानी', 'निबंध', 'पत्र', 'चिट्ठी', 'अनुवाद', 'नारा', 'भाषण', 'चुटकुला',
  // Romanized
  'kavita', 'shayari', 'kahani', 'nibandh', 'patra', 'chitthi', 'anuvad', 'anuvaad',
  'naara', 'nara', 'bhashan', 'chutkula', 'speech',
];

/** Is the user asking us to WRITE A THING rather than to answer a question? PURE. */
export function wantsVerbatimArtefact(text: string): boolean {
  if (isSongRequest(text)) return true;
  const set = new Set(tokens(text));
  return VERBATIM_WORDS.some((w) => set.has(w));
}

/**
 * The directive. Written as rules a model can actually check itself against — "one line", "1–10
 * lines", "a reader who stops here has a complete answer" — rather than "structure it nicely".
 *
 * ⚠️ IT CARRIES ITS OWN OFF-SWITCH, and that is not redundancy with the caller's checks. The caller
 * knows what the user ASKED; only the model knows how long its answer turned out to be, which is the
 * admin's second condition ("ya ai ka answer already short hi hai"). Neither half can be dropped.
 */
export const ANSWER_SHAPE_DIRECTIVE = `ANSWER SHAPE (how to lay out a long answer — like a newspaper story):

When your answer runs longer than about eight lines, write it in three parts, in this order, with a
blank line between them:

1. HEADLINE — ONE line (never more than two), written as **bold text** on its own line. It states the
   single most important point of your whole answer. Someone who reads ONLY this line must already
   know what you concluded. It is never a title for the topic ("About diabetes"), never an
   announcement ("Here is your answer"), and never a question.
2. THE GIST — one short paragraph, between one and ten lines, that answers the question on its own.
   Someone who stops reading here must still have a complete, usable answer. Put the numbers, the
   names and the recommendation in it — not a promise that they are coming below.
3. THE FULL ANSWER — everything else: the detail, the steps, the reasons, the exceptions, the
   examples. Use headings, lists or a table here if they genuinely help.

Write all three in the user's own language and script, exactly as you would the rest of the reply.

DO NOT use this shape — just answer normally — when:
• Your answer is naturally short (about eight lines or fewer). A headline over three lines of text is
  noise, and this is the commonest case: most questions deserve a direct, plain answer.
• The user asked for something short, brief, in one line, or a quick answer.
• What they asked for IS a piece of writing: a song, poem, story, letter, message, caption, essay,
  translation, recipe or code. Give them the thing itself, never a news report about it.
• The reply is a greeting, small talk, a yes/no, a single fact, or a clarifying question.
• You are continuing or correcting something in the same breath ("haan, bilkul — …").

NEVER label the parts. Do not write "Headline:", "Summary:", "In short:", "Overview:" or draw a line
between them — the bold line and the blank lines are the whole structure. Do not repeat the gist
word-for-word at the top of the full answer, and do not add a summary at the END as well.`;

/**
 * The block to append for THIS message — `''` whenever the shape must not apply, so an ordinary
 * short question's prompt (and its cost) stays byte-identical to before this existed. PURE.
 */
export function answerShapeFor(message: string): string {
  const text = String(message ?? '');
  if (!text.trim()) return '';
  if (wantsShortAnswer(text)) return '';
  if (wantsVerbatimArtefact(text)) return '';
  return `\n\n${ANSWER_SHAPE_DIRECTIVE}`;
}

/**
 * A MODEL'S NOTES TO ITSELF ARE NOT PART OF ITS ANSWER (autopsy 3f959fde, 2026-10-01).
 *
 * 🔴 WHY. The build's last reply began, word for word:
 *
 *     Now final summary. No more tools.
 *
 *     Make it concise. In Telugu/English mix.
 *     …
 *     Mention where to add full dataset. Also warn about xlsx advisory? Maybe not in final. …
 *
 *     Proceed.
 *
 *
 *
 *     🎟️ **Kerala Lottery Analyzer ready.**
 *
 * The user read the model planning its own reply before the reply. That text was not in the
 * reasoning channel (`reasoning_content`, which `openAiStream.ts` already keeps separate and
 * `thinkingStream.ts` keeps off the screen). The model wrote it into its ANSWER, then put several
 * blank lines between the plan and the answer. So no channel filter can catch it, and the runner
 * showed the whole text as the build's final message.
 *
 * 🔒 PRECISION FIRST. Hiding a real answer is worse than showing a plan. So the text is cut only
 * when ALL of these hold:
 *  - a run of at least three line breaks (blank lines included) separates the two parts. A real
 *    answer uses single blank lines between paragraphs; a plan-then-answer has a visible gap;
 *  - the part before it is short (at most `MAX_PREAMBLE_CHARS`) and carries no markdown structure
 *    (no heading, list, table or code fence), which a real answer's opening would carry;
 *  - the part before it uses at least TWO distinct self-instruction phrases ("final summary",
 *    "no more tools", "make it concise", "I'll mention", a bare "Proceed.");
 *  - the part after it is a real answer (at least `MIN_ANSWER_CHARS`).
 * Anything else is returned exactly as it came.
 *
 * PURE. No I/O, no clock, no env.
 */

/** A plan longer than this is not a preamble; leave the text alone. */
export const MAX_PREAMBLE_CHARS = 1500;
/** The answer that remains must be at least this long, or nothing is cut. */
export const MIN_ANSWER_CHARS = 20;

/** Three or more line breaks, with any spaces or tabs between them. */
const GAP = /\n[ \t]*\n[ \t]*\n[ \t\n]*/g;

/** A reply's own structure. A plan the model wrote to itself does not use it. */
const ANSWER_STRUCTURE = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||```|>)/m;

/**
 * Phrases a model uses when instructing ITSELF about the reply it is about to write. Each is a
 * separate signal; two distinct ones are required.
 */
const SELF_INSTRUCTION: readonly RegExp[] = [
  /\bfinal (?:summary|answer|message|reply|response)\b/i,
  /\bno more tool(?:s| calls?)\b/i,
  /^\s*proceed\.?\s*$/im,
  /\b(?:make|keep) it (?:concise|short|brief|simple)\b/i,
  /\bI(?:'ll| will) (?:mention|say|answer|write|reply|summari[sz]e|note|include|keep)\b/i,
  /\b(?:should|shall) I (?:mention|include|say|add|warn)\b/i,
  /\bmaybe not\b/i,
  /\b(?:need|needs|have) to (?:mention|include|say|answer|summari[sz]e|reply)\b/i,
  /\bin (?:the )?user'?s language\b/i,
  /\b(?:English|Hindi|Telugu|Tamil|Hinglish)\/(?:English|Hindi|Telugu|Tamil|Hinglish) mix\b/i,
  /^\s*(?:mention|answer|summari[sz]e|include|warn)\b/im,
];

function selfInstructionCount(text: string): number {
  let n = 0;
  for (const re of SELF_INSTRUCTION) if (re.test(text)) n++;
  return n;
}

/** Is this text a model's instructions to itself rather than something written for the user? PURE. */
export function looksLikeSelfInstruction(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || t.length > MAX_PREAMBLE_CHARS) return false;
  if (ANSWER_STRUCTURE.test(t)) return false;
  return selfInstructionCount(t) >= 2;
}

/**
 * The answer, without a planning preamble the model wrote ahead of it. Returns the input
 * unchanged unless every condition in the module comment holds. PURE.
 */
export function answerAfterPlanning(text: string): string {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.includes('\n')) return raw;
  GAP.lastIndex = 0;
  for (let m = GAP.exec(raw); m; m = GAP.exec(raw)) {
    const before = raw.slice(0, m.index);
    // Past the longest preamble we accept, no later gap can qualify either.
    if (before.trim().length > MAX_PREAMBLE_CHARS) break;
    const after = raw.slice(m.index + m[0].length).trim();
    if (after.length < MIN_ANSWER_CHARS) continue;
    if (looksLikeSelfInstruction(before)) return after;
  }
  return raw;
}

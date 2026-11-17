// A reasoning-only reply that hit OUR output cap is not an empty reply.
//
// Report #2430 (2026-11-17): Router One spent the fast lane's 8,000-token ask on reasoning and
// returned no text and no tool call. The runner threw that away as a starved budget, so the file
// list inside the reasoning was never read and no continuation was asked for. The same class had
// been continued before WITHOUT the reasoning (report 58fe8254) and the model thought from scratch
// again. This module does the two things that report could not: use an answer that is already in
// the reasoning, or hand the tail of that reasoning to one continuation.

import { parseFileBlocks } from '../OneShotBuilder';
import { parseFileManifest } from '../SimpleBuilder';

/** The tail of a cut-off reasoning trace handed to the one continuation. The answer starts at the end. */
export const REASONING_TAIL_CHARS = 6_000;

export const REASONING_CONTINUATION_ASK =
  'The previous reply used the output limit before the answer began. Continue and output only the answer now: the file list or the file contents. Do not spend the limit on more reasoning.';

/**
 * The answer, when the model wrote it into the reasoning trace instead of the reply.
 * A file block is enough on its own. A manifest needs two files, so one path mentioned in
 * passing is not treated as the plan. PURE.
 */
export function answerCarriedInReasoning(reasoning: string): string | null {
  const text = String(reasoning ?? '');
  if (!text.trim()) return null;
  const files = parseFileBlocks(text);
  if (files.length > 0) {
    return files.map((file) => `<<<FILE ${file.path}>>>\n${file.content}\n<<<ENDFILE>>>`).join('\n');
  }
  const manifest = parseFileManifest(text);
  if (manifest.length >= 2) return manifest.map((file) => `${file.path} :: ${file.purpose}`).join('\n');
  return null;
}

/** One continuation transcript: the original messages, the reasoning tail, then the ask. PURE. */
export function reasoningContinuationMessages(messages: readonly unknown[], reasoning: string): unknown[] {
  const tail = String(reasoning ?? '').slice(-REASONING_TAIL_CHARS);
  return [
    ...messages,
    { role: 'assistant', content: tail },
    { role: 'user', content: REASONING_CONTINUATION_ASK },
  ];
}

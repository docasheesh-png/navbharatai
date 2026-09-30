// What a stored model-call record says about its PROMPT — and why it used to say the same thing forty
// times (autopsy a5b661c8, 2026-09-30).
//
// A prompt preview is `system head + SEPARATOR + last-message head`: what the build told the model
// once, then what it asked it this turn. Every caller builds it that way (AgentRunner, and the plan,
// blueprint and roadmap calls in routes/agentv3.ts).
//
// 🔴 TWO CAPS DESTROYED THE HALF THAT MATTERS.
//   1. The recorder capped the WHOLE string at 2,000 characters. The architect's system prompt is
//      tens of thousands of characters, so the cut always fell inside it: the separator and the last
//      message never reached the report at all.
//   2. The store then cut every preview to 800 characters, still inside the system prompt.
// So all forty stored calls of a build carried the identical first 800 characters of the system
// prompt, and not one said what the model was asked on that turn. The report spent ~32 KB saying one
// thing forty times, and that is also why only forty calls fitted in it. Its 12:16–12:20 gap and the
// unprovable origin of one import were both lost to this.
//
// 🔒 THE RULE NOW: each half is capped on its own, so the question asked on the turn always survives.
// When a call's system head equals the previous STORED call's, it is replaced by a marker that says
// exactly that, and nothing more. "Identical head" is the claim, because the head is all that was
// compared.
//
// Pure — no I/O.

/** The separator every prompt preview is built with. One definition, so a caller cannot drift. */
export const PROMPT_PREVIEW_SEPARATOR = '\n---\n';

/** Written in place of a system head that repeats the previous stored call's. */
export const SAME_SYSTEM_HEAD = '[system prompt head identical to the previous call]';

function capHead(s: string, cap: number): string {
  return s.length <= cap ? s : `${s.slice(0, cap)}…[${s.length - cap} chars truncated]`;
}

/** Split a preview into its system half and its message half. No separator ⇒ all of it is the head. */
export function splitPromptPreview(preview: string): { system: string; message: string | null } {
  const at = preview.indexOf(PROMPT_PREVIEW_SEPARATOR);
  if (at < 0) return { system: preview, message: null };
  return { system: preview.slice(0, at), message: preview.slice(at + PROMPT_PREVIEW_SEPARATOR.length) };
}

/**
 * Cap each half of a preview on its own, so the last message is never pushed out by the system prompt.
 * A preview with no separator is one text and gets both allowances.
 */
export function capPromptPreview(preview: string, systemCap: number, messageCap: number): string {
  const { system, message } = splitPromptPreview(preview);
  if (message === null) return capHead(system, systemCap + messageCap);
  return `${capHead(system, systemCap)}${PROMPT_PREVIEW_SEPARATOR}${capHead(message, messageCap)}`;
}

/**
 * Cap every preview in a chronological list, and replace a system head that repeats the previous
 * entry's with `SAME_SYSTEM_HEAD`.
 *
 * ⚠️ Run it on the list AS STORED, after any window is taken: the marker points at the entry just
 * above it, and an entry dropped from the middle must never be the one it points at.
 */
export function compactPromptPreviews<T extends { promptPreview?: string }>(
  calls: readonly T[],
  systemCap: number,
  messageCap: number,
): T[] {
  let previousSystem: string | null = null;
  return calls.map((c) => {
    if (typeof c.promptPreview !== 'string') { previousSystem = null; return c; }
    const { system, message } = splitPromptPreview(c.promptPreview);
    const head = capHead(system, message === null ? systemCap + messageCap : systemCap);
    const repeated = previousSystem !== null && head === previousSystem && head.length > SAME_SYSTEM_HEAD.length;
    previousSystem = head;
    const shownHead = repeated ? SAME_SYSTEM_HEAD : head;
    const promptPreview = message === null ? shownHead : `${shownHead}${PROMPT_PREVIEW_SEPARATOR}${capHead(message, messageCap)}`;
    return { ...c, promptPreview };
  });
}

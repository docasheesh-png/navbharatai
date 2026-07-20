// AgentV3 — deterministic repair of MALFORMED tool-call arguments (CrewHub autopsy 2026-07-20).
//
// ROOT CAUSE this closes: the weak-tier models (GLM/Kimi flash rungs) routinely emit a tool call with
// the right INTENT but a wrong ARGUMENT NAME — `{"file": "app/page.tsx"}` instead of `{"path": …}` —
// and the dispatcher's strict `reqStr` rejected it with a terse "Missing/invalid string argument: path".
// CrewHub burned NINE turns on exactly this: the model never learned what the right name was, retried
// blind, and failed again. Two-layer fix, cheapest first:
//   1) ALIAS AUTO-MAP — when the canonical key is absent, accept a well-known alias the models actually
//      emit. The call simply SUCCEEDS; a whole failure class disappears with zero LLM cost.
//   2) INSTRUCTIVE ERROR — when no alias matches either, the error now TEACHES the model: which keys it
//      sent, which key is required, and a concrete example — so the retry converges in ONE turn instead
//      of nine. Pure + dependency-free = fully unit-testable.

/** Canonical argument name → the wrong-but-unambiguous names models actually emit for it. An alias is
 *  consulted ONLY when the canonical key is absent/invalid, so a correct call is never reinterpreted. */
const ARG_ALIASES: Record<string, readonly string[]> = {
  path: ['file_path', 'filepath', 'filePath', 'file', 'filename', 'file_name', 'fileName', 'target_file', 'targetFile'],
  content: ['contents', 'text', 'body', 'file_content', 'fileContent', 'new_content', 'newContent', 'source', 'code'],
  command: ['cmd', 'shell', 'script', 'bash_command', 'bashCommand'],
  old_string: ['old', 'oldString', 'old_str', 'oldStr', 'search', 'find', 'target', 'original'],
  new_string: ['new', 'newString', 'new_str', 'newStr', 'replace', 'replacement', 'updated'],
  pattern: ['query', 'regex', 'search', 'term'],
};

/** Example value shown in the instructive error, per canonical key (a concrete shape beats prose). */
const ARG_EXAMPLES: Record<string, string> = {
  path: '"src/App.tsx"',
  content: '"...the full file text..."',
  command: '"npm run build"',
  old_string: '"...exact text currently in the file..."',
  new_string: '"...the replacement text..."',
  pattern: '"TODO"',
};

/**
 * Resolve a REQUIRED string argument: the canonical key first, then its known aliases. Returns the
 * value plus which key actually supplied it (for an optional audit trail). Null when nothing matched.
 * Pure.
 */
export function resolveStringArg(
  input: Record<string, unknown>,
  key: string,
): { value: string; via: string } | null {
  const direct = input[key];
  if (typeof direct === 'string') return { value: direct, via: key };
  for (const alias of ARG_ALIASES[key] ?? []) {
    const v = input[alias];
    if (typeof v === 'string' && v.trim() !== '') return { value: v, via: alias };
  }
  return null;
}

/**
 * The instructive missing-argument message: names the required key, shows the keys the model actually
 * sent, and gives a concrete retry example — so the model's next attempt converges immediately. Pure.
 */
export function missingArgMessage(input: Record<string, unknown>, key: string): string {
  const sent = Object.keys(input ?? {});
  const sentNote = sent.length > 0 ? `You sent argument(s): [${sent.join(', ')}].` : 'You sent NO arguments.';
  const example = ARG_EXAMPLES[key] ?? '"..."';
  return (
    `Missing/invalid string argument: ${key}. ${sentNote} ` +
    `Retry the SAME tool call with a "${key}" argument, e.g. {"${key}": ${example}, ...} — keep all other arguments unchanged.`
  );
}

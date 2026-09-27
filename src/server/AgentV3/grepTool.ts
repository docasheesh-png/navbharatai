// AgentV3 — the agent-facing `grep` tool: what the MODEL means by a pattern, and an honest answer.
//
// 🔴 WHY (build 15151196, 2026-09-27). The reviewer asked `grep` whether `src/index.css` defined
// `.badge`, `.alert`, `.muted` and `.primary`, got "(no matches)" twice, and filed two CRITICAL
// findings that the classes were missing. They were at lines 64, 107, 118 and 129. The architect then
// ran `grep -nE '\.badge|\.alert|\.muted|\.primary'` through `bash` and found all four at once.
//
// The tool ran plain `grep -rn` — a BASIC regex, where `|` is a literal bar, `+ ? ( ) { }` are
// literal too, and alternation is spelled `\|`. A model writes the EXTENDED form every other tool it
// has ever seen uses, so an alternation could never match. And the tool ended in `|| true` and mapped
// empty output to "(no matches)", so an invalid pattern (exit 2) read exactly like a clean miss.
// That false negative cost a repair pass on a working app and told the user it had fixed two bugs.
//
// So the tool now tries the pattern the way it was most likely meant, and says which:
//   • a pattern with regex characters is tried as an EXTENDED regex, then a BASIC one (for the model
//     that writes `\|`), then as LITERAL text (for `useState(` — an unbalanced group in any regex);
//   • a pattern with no regex characters is searched as literal text, which is exact and fastest;
//   • "(no matches)" is said only when grep itself answered "no match" (exit 1). A search that could
//     not run says so, with grep's own words — it is never reported as an absence.
// All tries run in ONE shell command, so a miss costs one sandbox round trip, not three.
//
// PURE: builds a command and reads its output. No I/O.

import { shellQuote } from '../lib/shellQuote';

/** The marker line the command prints first: `__NBAI_GREP:<mode>:<exit code>`. */
export const GREP_RESULT_MARK = '__NBAI_GREP:';

/** Characters that make a pattern a regex rather than plain text, in any grep dialect. */
const REGEX_META = /[\\^$.|?*+()[\]{}]/;

export function hasRegexMeta(pattern: string): boolean {
  return REGEX_META.test(pattern);
}

/**
 * The grep modes to try, in order. `E` extended regex, `G` basic regex, `F` literal text. A pattern
 * with no regex characters means the same thing in all three, so only the literal search runs.
 */
export function grepModes(pattern: string): Array<'E' | 'G' | 'F'> {
  return hasRegexMeta(pattern) ? ['E', 'G', 'F'] : ['F'];
}

/**
 * One shell command that tries each mode until one matches, then prints the marker line and the
 * matching lines (or, when none matched, the LAST try's exit code and output — grep's own error text
 * when it could not run). `excludeDirs` bounds an unqualified walk, as before.
 */
export function grepCommand(pattern: string, path: string, excludeDirs: readonly string[]): string {
  const excludes = excludeDirs.map((d) => `--exclude-dir=${shellQuote(d)}`).join(' ');
  const modes = grepModes(pattern).join(' ');
  const one = `grep -rn"$__m" ${excludes} -e ${shellQuote(pattern)} -- ${shellQuote(path)} 2>&1`;
  return [
    '__c=1; __o=""; __used="-"',
    `for __m in ${modes}; do __o=$(${one}); __c=$?; __used="$__m"; [ "$__c" -eq 0 ] && break; done`,
    `printf '%s\\n' "${GREP_RESULT_MARK}$__used:$__c"`,
    `printf '%s\\n' "$__o"`,
  ].join('; ');
}

export interface GrepReading {
  /** The text handed back to the model. */
  text: string;
  /** Which dialect produced the matches, or null when nothing matched. */
  matchedAs: 'extended regex' | 'basic regex' | 'literal text' | null;
  /** True when grep could not run the search at all (bad path, bad pattern in every dialect). */
  failed: boolean;
}

const MODE_NAME = { E: 'extended regex', G: 'basic regex', F: 'literal text' } as const;

/** Read the command's output into what the model is told. PURE. */
export function readGrepOutput(stdout: string, pattern: string): GrepReading {
  const raw = String(stdout ?? '');
  const lines = raw.split('\n');
  const markAt = lines.findIndex((l) => l.startsWith(GREP_RESULT_MARK));
  if (markAt < 0) {
    // Not our command's shape (an old actuator, a truncated stream). Treat what came back as-is,
    // but never invent an absence from an empty string we cannot interpret.
    const body = raw.trim();
    return body
      ? { text: body, matchedAs: null, failed: false }
      : { text: 'grep returned no output and no status — the search result is unknown, not empty.', matchedAs: null, failed: true };
  }
  const [, modeRaw = '-', codeRaw = ''] = lines[markAt].split(':');
  const code = Number.parseInt(codeRaw, 10);
  const body = lines.slice(markAt + 1).join('\n').trim();
  if (code === 0) {
    const mode = (modeRaw === 'E' || modeRaw === 'G' || modeRaw === 'F') ? modeRaw : null;
    const matchedAs = mode ? MODE_NAME[mode] : null;
    // Say so when a regex-looking pattern only matched as plain text, so the model knows what it got.
    const note = mode === 'F' && hasRegexMeta(pattern) ? '(no regex match — these lines contain the pattern as literal text)\n' : '';
    return { text: `${note}${body}`, matchedAs, failed: false };
  }
  if (code === 1) return { text: '(no matches)', matchedAs: null, failed: false };
  const why = body.split('\n').find((l) => l.trim()) ?? `exit code ${Number.isFinite(code) ? code : 'unknown'}`;
  return { text: `grep could not run this search, so this is NOT a "no matches" answer: ${why.slice(0, 300)}`, matchedAs: null, failed: true };
}

// A LABEL IN THE USER'S OWN LANGUAGE MUST NOT ARRIVE BROKEN.
//
// 🔴 ROOT CAUSE (autopsy 3ce8459b, 2026-09-19). A Bengali poem-to-video app shipped with
// `{ value: 'forest', label: 'জungle' }` — one Bengali letter followed by the Latin "ungle". The
// user-facing summary said `জঙ্গল` (correct) while the running app showed the broken token. NOTHING
// caught it: the design gate passed, accessibility scored 100/100, and the reviewer returned PASS at
// 90/100 — every one of them reads STRUCTURE, and none of them reads the TEXT.
//
// This is India-first by construction: the class only exists for an app whose UI is written in an
// Indic script, which is the case NavBharatAI is built for and the one no competitor checks.
//
// 🔒 IT IS DETERMINISTIC AND FREE. No model call, no browser, no sandbox — a clean build pays nothing.
// It is ADVISORY: it can never block, fail or heal a build.
//
// ⚠️ EVERY RULE BELOW CAME FROM A MEASURED FALSE RESULT, NOT FROM TASTE. The study ran against this
// repository's own 1,092 real Indic lines plus a hand-built corpus:
//
//  1. **Combining marks are `\p{M}`, not `\p{L}`.** The first tokenizer split `वीडियोdownload` into
//     `व`,`ड`,`य`,`download` at every matra and MISSED it. `জungle` was caught only because `জ`
//     happens to carry no matra — i.e. by luck. Marks are part of a word here.
//  2. **Source code is not text.** Scanning raw source flagged `\bस्क्रीनशॉट\b` (a regex word
//     boundary) and `[A-Za-zऀ-ॿ]` (a character-class range) — 6 of the 8 hits on the real corpus, and
//     not one of them a label. So only STRING LITERALS are read, and a literal that looks like a
//     pattern is skipped.
//  3. **Interpolation needs no special handling, and the first version's extra step for it was dead
//     code.** A reversion test proved it: removing the `${...}` cut changed no result, because `$`,
//     `{` and `}` are already non-word characters, so `` `${count}টি` `` tokenises to `count` and `টি`
//     regardless. It was deleted rather than kept "for safety" — a guard that cannot fail is worse
//     than none, and the comment justifying it was stating a reason that was not true.

/** The Indic blocks NavBharatAI actually serves. Latin is the only script a label mixes them with. */
const INDIC = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const LATIN = /[A-Za-z]/;

/** Word characters for an Indic script: letters, digits AND the combining marks that carry vowels. */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/u;

/**
 * Does this literal look like a REGEX or a character class rather than something a person reads?
 *
 * Measured, not guessed: without it, `String.raw`([A-Za-zऀ-ॿ]{3,})`` and every escape-carrying pattern
 * in this repository is reported as broken text. A real UI label essentially never contains these.
 */
function looksLikePattern(text: string): boolean {
  return /\\[bdswBDSW]|\[[^\]]*\]|\(\?|\{\d+,\d*\}|\\u\{?[0-9a-fA-F]{4}/.test(text);
}

/** Tokens inside ONE literal that mix an Indic script with Latin letters. Pure. */
export function mixedScriptTokens(literal: string): string[] {
  if (!literal || !INDIC.test(literal) || !LATIN.test(literal)) return [];
  if (looksLikePattern(literal)) return [];
  const out: string[] = [];
  for (const token of literal.split(NON_WORD)) {
    if (token && INDIC.test(token) && LATIN.test(token) && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Every quoted string in a source file.
 *
 * Deliberately a small scanner rather than a parser: it needs to be cheap, total, and never throw on
 * code it does not understand. A literal it mis-reads yields a token that fails the mixed-script test
 * anyway, so the failure mode is a miss, never a false alarm.
 */
export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const body = m[1] ?? m[2] ?? m[3];
    if (body) out.push(body);
  }
  return out;
}

export interface ScriptIntegrityFinding {
  file: string;
  /** The broken tokens, in the order they appear. */
  tokens: string[];
}

/** Files whose text a user actually reads. A config or a lockfile is not UI. */
const UI_FILE = /\.(tsx?|jsx?|vue|svelte|html?)$/i;

/**
 * Scan a project's UI files for text that mixes scripts inside one word. Pure.
 *
 * Bounded on purpose — a build report is not a linter's output: at most `maxFiles` files are read and
 * at most `maxTokens` tokens are reported per file.
 */
export function findMixedScriptText(
  files: Record<string, string>,
  opts: { maxFiles?: number; maxTokens?: number } = {},
): ScriptIntegrityFinding[] {
  const maxFiles = opts.maxFiles ?? 200;
  const maxTokens = opts.maxTokens ?? 5;
  const findings: ScriptIntegrityFinding[] = [];
  let seen = 0;
  for (const [file, source] of Object.entries(files)) {
    if (seen >= maxFiles) break;
    if (!UI_FILE.test(file) || typeof source !== 'string') continue;
    seen++;
    if (!INDIC.test(source)) continue;   // the common case: pays almost nothing
    const tokens: string[] = [];
    for (const literal of stringLiterals(source)) {
      for (const t of mixedScriptTokens(literal)) {
        if (!tokens.includes(t)) tokens.push(t);
        if (tokens.length >= maxTokens) break;
      }
      if (tokens.length >= maxTokens) break;
    }
    if (tokens.length > 0) findings.push({ file, tokens });
  }
  return findings;
}

/** The admin-and-user-facing line. Names the file and the exact broken word — never a vendor. */
export function scriptIntegritySummary(findings: readonly ScriptIntegrityFinding[]): string {
  if (findings.length === 0) return 'Text integrity: every label reads in one script.';
  const parts = findings.slice(0, 4).map((f) => `${f.file} (${f.tokens.map((t) => `"${t}"`).join(', ')})`);
  const more = findings.length > 4 ? `, and ${findings.length - 4} more file(s)` : '';
  return `Text integrity: ${findings.length} file(s) contain a word that mixes two scripts — `
    + `almost always a corrupted label rather than a choice: ${parts.join('; ')}${more}. `
    + 'Each one is shown to the user exactly as written.';
}

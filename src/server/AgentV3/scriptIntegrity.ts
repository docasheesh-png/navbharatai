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

/**
 * 🔎 THE SIBLING, HUNTED THE SAME DAY (rule 3, 2026-09-19). The root cause is the model falling OUT
 * of the target script part-way through a word. It fell into Latin in the reported case — but a
 * Bengali app can just as easily receive a Devanagari letter, and `জंगल` (one Bengali letter,
 * then Devanagari) was returning [] while `জungle` was caught. Same cause, same broken word on the
 * same screen, and only the Latin half was covered. Fixing the instance and not the class is what
 * this repository's a38c6fef entry exists to warn about.
 *
 * ⚠️ LETTERS ONLY, and that IS the precision rule. The danda `।` (U+0964) sits in the DEVANAGARI
 * block but ends a sentence in Bengali, Gurmukhi and the rest; Vedic tone marks and the Devanagari
 * digits are shared the same way. Judging by every character would make `বাংলা।` — correct
 * Bengali — read as Bengali mixed with Devanagari, and the first real Bengali app would be flagged.
 *
 * Blocks are 0x80 apart from U+0900, so the script is arithmetic rather than a table that can drift.
 * The range stops where `INDIC` above stops, so the two can never disagree about what is Indic.
 */
const INDIC_FIRST = 0x0900;
const INDIC_LAST = 0x0d7f;

export function spansTwoIndicScripts(token: string): boolean {
  let seen: number | null = null;
  for (const ch of token) {
    if (!/\p{L}/u.test(ch)) continue;
    const code = ch.codePointAt(0);
    if (code === undefined || code < INDIC_FIRST || code > INDIC_LAST) continue;
    const block = Math.floor((code - INDIC_FIRST) / 0x80);
    if (seen === null) seen = block;
    else if (seen !== block) return true;
  }
  return false;
}

/**
 * 🔴 AN ESCAPE IS NOT A LETTER — AND READING IT AS ONE MADE THIS CHECK ACCUSE CORRECT CODE
 * (autopsy `21b431e1`, 2026-09-22).
 *
 * `stringLiterals` returns the literal's BODY exactly as it is written in source, so `"\nमैं"` — a
 * newline followed by Devanagari, which is right — arrives here as the characters `\`, `n`, `म`… The
 * backslash is a non-word character, so it splits away and leaves the token **`nमैं`**: a Latin
 * letter glued to Indic text, reported to the admin as *"a corrupted label … shown to the user
 * exactly as written"*. Measured before this fix:
 *
 *     "\nमैं"        -> ["nमैं"]      ← correct source, reported broken
 *     "पंक्ति\tदो"    -> ["tदो"]      ← correct source, reported broken
 *
 * **That is the exact token the report carried.** This is the third analyzer in three days caught
 * describing its own blind spot as a defect in the user's app (`AccessibilityAnalysis` 2026-09-20,
 * `FeaturePresence` 2026-09-21), and the class is the same one: a regex reading a dialect it was not
 * written for.
 *
 * ⚠️ `looksLikePattern` MUST RUN ON THE RAW BODY, BEFORE THIS. It recognises `\b`, `\d`, `\s` — the
 * very sequences decoding destroys — so decoding first would blind the guard that stops this check
 * reporting every regex in the project.
 *
 * `\n` / `\t` / `\r` and friends become a SPACE rather than their real control character, because
 * the only question here is "does this word continue?", and a separator answers it without inventing
 * a character. Pure, total, never throws.
 */
export function decodeLiteralEscapes(body: string): string {
  return String(body ?? '').replace(
    /\\(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_m, esc: string) => {
      const head = esc[0];
      if (head === 'u' || head === 'x') {
        const hex = esc.replace(/^u\{?|^x|\}$/g, '');
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
      }
      // A whitespace/control escape is a SEPARATOR; every other escape is the character itself.
      return 'ntrbfv0'.includes(head) ? ' ' : head;
    },
  );
}

/** Tokens inside ONE literal whose script changes part-way through the word. Pure. */
export function mixedScriptTokens(rawLiteral: string): string[] {
  if (!rawLiteral || !INDIC.test(rawLiteral)) return [];
  // The pattern guard reads the escapes themselves, so it goes first — see `decodeLiteralEscapes`.
  if (looksLikePattern(rawLiteral)) return [];
  const literal = decodeLiteralEscapes(rawLiteral);
  if (!INDIC.test(literal)) return [];
  if (!LATIN.test(literal) && !spansTwoIndicScripts(literal)) return [];
  const out: string[] = [];
  for (const token of literal.split(NON_WORD)) {
    if (!token || !INDIC.test(token)) continue;
    if (!LATIN.test(token) && !spansTwoIndicScripts(token)) continue;
    if (!out.includes(token)) out.push(token);
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

/**
 * THE ONE MIXED-SCRIPT SHAPE THAT CAN BE REPAIRED WITHOUT GUESSING: A LOST BACKSLASH.
 *
 * 🔴 AUTOPSY `21b431e1` (2026-09-22). `src/App.tsx` shipped `"nमैं"` — the letter `n` glued to the
 * front of Devanagari. It was DETECTED (`SCRIPT_INTEGRITY`, warning) and never repaired, so the user
 * read the corruption on their own screen. `scriptIntegrity.ts` could say what was wrong and had no
 * way to say what it should be.
 *
 * ⚠️ MOST OF THIS CLASS IS GENUINELY UNREPAIRABLE, AND PRETENDING OTHERWISE WOULD BE WORSE. The
 * founding case, `"জungle"`, needs the intended Bengali word — nothing in the file carries it, and a
 * guess would rewrite a user's label into something they never wrote. So this repairs ONE shape and
 * refuses every other: a single Latin `n` / `t` / `r` standing alone against Indic text is a `\n`,
 * `\t` or `\r` whose backslash was dropped while the model was generating the string.
 *
 * 🔒 WHY RESTORING THE BACKSLASH RATHER THAN DELETING THE LETTER, and the asymmetry decides it. Both
 * remove the visible defect. Deleting destroys a line break the model meant to be there, and if our
 * reading is wrong it has silently eaten a character out of somebody's label. Restoring turns a
 * VISIBLE wrong letter into INVISIBLE whitespace: right when we are right, harmless when we are
 * wrong. Nothing is ever deleted from a user's text.
 *
 * 🔒 QUOTED LITERALS ONLY. In JSX body text `\n` is two literal characters on screen, so a repair
 * there would trade one visible defect for another — `repairLostEscapes` walks the same literal
 * scanner `findMixedScriptText` uses, so the two can never disagree about what a literal is.
 *
 * Pure, deterministic, no model call. Returns the source unchanged when there is nothing to repair.
 */
const LOST_ESCAPE_LETTERS = 'ntr';

/** Every repair this pass would make in one literal body, as [before, after]. Pure. */
export function repairedLiteralBody(body: string): string {
  if (!body || !INDIC.test(body) || !LATIN.test(body)) return body;
  if (looksLikePattern(body)) return body;
  // A lone escape letter pressed against Indic text, at a word boundary on its free side so a real
  // Latin word ending in `n` ("green", "main") can never be touched. Both directions: a dropped
  // backslash can land in front of the text or behind it.
  const leading = new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}\\\\])([${LOST_ESCAPE_LETTERS}])(?=[\\u0900-\\u0d7f])`, 'gu');
  const trailing = new RegExp(`([\\u0900-\\u0d7f])([${LOST_ESCAPE_LETTERS}])(?=$|[^\\p{L}\\p{N}\\p{M}])`, 'gu');
  return body.replace(leading, (_m, before, letter) => `${before}\\${letter}`)
    .replace(trailing, (_m, indic, letter) => `${indic}\\${letter}`);
}

export interface ScriptRepair {
  file: string;
  /** The literal bodies that changed, as they were written. */
  before: string[];
}

/**
 * Repair every lost escape in a project's UI files. Returns ONLY the files that changed, so a caller
 * writes nothing on a clean build. Pure.
 */
export function repairLostEscapes(
  files: Record<string, string>,
  opts: { maxFiles?: number } = {},
): { files: Record<string, string>; repairs: ScriptRepair[] } {
  const maxFiles = opts.maxFiles ?? 200;
  const out: Record<string, string> = {};
  const repairs: ScriptRepair[] = [];
  let seen = 0;
  for (const [file, source] of Object.entries(files)) {
    if (seen >= maxFiles) break;
    if (!UI_FILE.test(file) || typeof source !== 'string') continue;
    seen++;
    if (!INDIC.test(source) || !LATIN.test(source)) continue;
    const before: string[] = [];
    // The SAME scanner `findMixedScriptText` reads, so a literal one of them sees is a literal the
    // other sees. Rewriting through the match keeps the quoting exactly as the model wrote it.
    const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    const next = source.replace(re, (whole, a: string | undefined, b: string | undefined, c: string | undefined) => {
      const body = a ?? b ?? c;
      if (!body) return whole;
      const fixed = repairedLiteralBody(body);
      if (fixed === body) return whole;
      before.push(body);
      const quote = whole[0];
      return `${quote}${fixed}${quote}`;
    });
    if (before.length > 0) { out[file] = next; repairs.push({ file, before }); }
  }
  return { files: out, repairs };
}

/** The admin-facing line for a repair that ran. Names the file and the word as it was. Pure. */
export function scriptRepairSummary(repairs: readonly ScriptRepair[]): string {
  const total = repairs.reduce((n, r) => n + r.before.length, 0);
  const parts = repairs.slice(0, 4).map((r) => `${r.file} (${r.before.slice(0, 3).map((b) => `"${b}"`).join(', ')})`);
  const more = repairs.length > 4 ? `, and ${repairs.length - 4} more file(s)` : '';
  return `Text integrity: repaired ${total} dropped escape(s) in ${repairs.length} file(s) — a lone `
    + `"n"/"t"/"r" against Indic text is a backslash the generator lost, and it was shown to the user `
    + `as a letter: ${parts.join('; ')}${more}.`;
}

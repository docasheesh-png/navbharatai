import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

/**
 * 🔴 THE BLUNDER (admin, 2026-09-14, from his own phone, with a screenshot of the voice-chat consent
 * popup rendered entirely in Devanagari):
 *   "maine apko bola tha, aur claude.md me bhi likha hai — ui me professional language (english only)
 *    honi chahiye. apne fir bhi devnagri likh di? SOUTH INDIA WALE KAISE PADHENGE ISKO?? batao"
 *
 * That last question is the whole argument, and it is not about style. NavBharatAI is a NATIONAL
 * product and Devanagari is not a national script: a Tamil, Telugu, Kannada or Malayalam speaker
 * cannot read a Hindi string at all. So "show it in the user's language" had quietly become "show it
 * in one region's language" — and the string it did that to was a PRICE the user was about to pay.
 *
 * 🔎 THE SHAPE OF THE BUG, because it is what makes a test the right fix rather than an edit. This
 * was never one careless string. Six modules had independently grown the same `lang === 'hi' ? … : …`
 * branch, each added by a different change, each believing it was serving Indian users, and three of
 * them quoted an admin instruction as justification (2026-07-20 "language wahi ho jo user likh raha
 * ho", 2026-08-05 "warning user ki language me aye", 2026-08-10 "user ki language me ek popup aaye").
 * A seventh had Hindi hard-coded straight into JSX. CLAUDE.md forbade all of it the entire time.
 *
 * A rule that lives only in a document is a rule every new session may miss. This suite is the half
 * that lasts: a new Devanagari UI string now fails CI instead of reaching a phone.
 *
 * SCOPE — the CLIENT, which is what a user reads. `src/server/**` is excluded on purpose: it holds
 * prompts written TO models and the admin's own verbatim Hindi quotes as evidence in comments, and
 * neither is UI. Comments are stripped everywhere before scanning, for the same reason — CLAUDE.md
 * asks for English in comments too, but rewriting the admin's own recorded words would destroy the
 * evidence trail those comments exist to keep.
 */

const root = resolve(__dirname, '..');
const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * The ONLY files allowed to contain Devanagari, each with the reason it is not a UI string.
 * A file is GUILTY UNTIL LISTED — the same discipline tests/whiteLabelClientSurfaces.test.ts uses,
 * and for the same reason: an allowlist somebody must deliberately edit is a decision, while a
 * pattern-based exemption is a hole that widens on its own.
 */
const ALLOWED: Record<string, string> = {
  // Matches what the USER TYPES so the assistant can mirror their greeting. The key is handed to a
  // model in a system prompt ("mirror this style"); it is never rendered as a label.
  'src/lib/apnapanEngine.ts': 'greeting DETECTION patterns + a key passed to the AI, never shown as UI',
  // A translation editor the user runs on THEIR OWN app. A language picker must print each language
  // in its own script — "Hindi" written in Latin is exactly what a Hindi reader cannot find.
  'src/components/ide/LocalizationManager.tsx': "a localisation tool for the USER's app; native language names must be in their own script",
  // The text of a build PROMPT describing an Indian job-board app to generate. It is the content of
  // the app being built, not NavBharatAI's own interface.
  'src/components/panels/TemplatesPanel.tsx': "build-prompt content for the USER's generated app",
  // Maps what a user types ('हिंदी') onto an internal key. Input parsing, not output.
  'src/hooks/useChatEngine.ts': 'input parsing of what the user typed',
  // A "WRONG: const userName = …" example inside an instruction to the model.
  'src/lib/appUtils.ts': 'a negative code example inside an AI prompt',
  // A character RANGE used to detect the script, and one letter MEASURED against the notdef box to
  // find out whether this device has a Hindi font at all. Neither is ever rendered: the range is a
  // regex, and the letter goes to `measureText`, whose only output is a number. The Devanagari a
  // user actually sees from this module is what they themselves typed into the caption box.
  'src/lib/textOverlay.ts': 'a script-range regex and a font-probe glyph fed to measureText, never rendered as UI',
  // Patterns matched against what the USER typed into their own prompt — "पता:" labelling an
  // address, "फ़ोन" before a number. Input parsing, exactly like `useChatEngine.ts` above: nothing
  // here is ever printed, and dropping the Hindi spellings would simply stop reading Hindi prompts.
  'src/lib/imageTextFromPrompt.ts': "input parsing of the user's own prompt, never rendered as UI",
  // Patterns matched against a message the USER typed beside an attached picture — "बदल दो" meaning
  // change it, "क्या" meaning they are asking about it. Input parsing, the same category as
  // `useChatEngine.ts`: nothing here is ever printed, and removing the Hindi spellings would simply
  // stop this recognising a Hindi request to change a picture.
  'src/lib/imageEdit.ts': "input parsing of the user's own message, never rendered as UI",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const rel = relative(root, p).split('\\').join('/');
    if (rel.startsWith('src/server')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\./.test(p)) out.push(rel);
  }
  return out;
}

/** Strip block and line comments — a Hindi quote in a comment is evidence, not a UI string. */
export function codeWithoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

/** Every line of real code in a client file that contains Devanagari. */
export function devanagariLines(src: string): string[] {
  return codeWithoutComments(src)
    .split('\n')
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter(({ l }) => DEVANAGARI.test(l))
    .map(({ l, n }) => `${n}: ${l.slice(0, 120)}`);
}

describe('🔒 UI text is English only (CLAUDE.md language standard)', () => {
  const files = walk(resolve(root, 'src'));

  it('scans a real number of client files — a scanner that finds nothing proves nothing', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('src/lib/voiceChatBilling.ts');
    expect(files.some((f) => f.startsWith('src/components/'))).toBe(true);
  });

  it('no client file outside the allowlist contains Devanagari in its code', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED[f]) continue;
      const lines = devanagariLines(readFileSync(resolve(root, f), 'utf8'));
      if (lines.length) offenders.push(`${f}\n    ${lines.join('\n    ')}`);
    }
    expect(
      offenders.join('\n  '),
      'Devanagari in user-facing code. UI text must be English (CLAUDE.md). If this is genuinely NOT a UI string — input parsing, a prompt to a model, or content for the user\'s own app — add the file to ALLOWED with the reason.',
    ).toBe('');
  });

  it('the allowlist is honest — every entry still exists and still needs to be there', () => {
    for (const [f, reason] of Object.entries(ALLOWED)) {
      expect(files, `${f} is allowlisted but is no longer scanned`).toContain(f);
      expect(reason.length, `${f} needs a real reason`).toBeGreaterThan(20);
      // An entry that no longer contains Devanagari is stale — remove it, so the list stays a list of
      // real exceptions rather than a place old names accumulate.
      expect(
        devanagariLines(readFileSync(resolve(root, f), 'utf8')).length,
        `${f} is allowlisted but has no Devanagari left — delete the entry`,
      ).toBeGreaterThan(0);
    }
  });

  it('🔒 the guard BITES — proven by injection, not by assumption', () => {
    // A sweep test that cannot fail is worse than none: it reports safety it never checked.
    expect(devanagariLines("const t = 'ठीक है, शुरू करें';")).toHaveLength(1);
    expect(devanagariLines('const t = <p>नमस्ते</p>;')).toHaveLength(1);
    // …and it does not fire on a comment, which is what keeps the admin's quotes intact.
    expect(devanagariLines('// admin: "ठीK है" — his own words, kept as evidence')).toHaveLength(0);
    expect(devanagariLines('/* admin said: नमस्ते */\nconst t = 1;')).toHaveLength(0);
  });
});

describe('🔴 the seven surfaces that were in Devanagari on 2026-09-14', () => {
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

  it('none of them carries a Hindi branch any more', () => {
    for (const f of [
      'src/lib/voiceChatBilling.ts',
      'src/lib/zipReplaceWarning.ts',
      'src/lib/updateNotice.ts',
      'src/lib/chatToolbar.ts',
      'src/lib/apkChargeNotice.ts',
      'src/lib/chatMessageActions.ts',
      'src/config/defaultContent.ts',
    ]) {
      const code = codeWithoutComments(read(f));
      expect(DEVANAGARI.test(code), `${f} still has Devanagari`).toBe(false);
      // The BRANCH goes too, not just its Hindi half: a live `lang === 'hi'` fork is the thing that
      // grew seven times, and leaving the fork in place leaves the habit in place.
      expect(code, `${f} still branches on a language`).not.toMatch(/lang === 'hi'/);
    }
  });

  it('the language TYPES are gone, so a caller cannot ask for Hindi at all', () => {
    // The 50/50 law: the root cause is fixed when the wrong branch is impossible, not merely unused.
    expect(codeWithoutComments(read('src/lib/voiceChatBilling.ts'))).not.toMatch(/VoiceLang\b/);
    expect(codeWithoutComments(read('src/lib/chatToolbar.ts'))).not.toMatch(/ChatToolbarLang\b/);
    expect(codeWithoutComments(read('src/lib/apkChargeNotice.ts'))).not.toMatch(/ChargeLang\b/);
    expect(codeWithoutComments(read('src/lib/zipReplaceWarning.ts'))).not.toMatch(/NoticeLang\b/);
  });
});

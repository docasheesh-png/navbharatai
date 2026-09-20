/**
 * `label: 'জungle'` SHIPPED TO A BENGALI USER (autopsy 3ce8459b, 2026-09-19).
 *
 * One Bengali letter followed by the Latin "ungle". The summary shown to the user said `জঙ্গল`
 * (correct) while the running app showed the broken token. Nothing caught it: the design gate passed,
 * accessibility scored 100/100, and the reviewer returned PASS at 90/100 — all three read STRUCTURE,
 * and none of them reads the TEXT.
 *
 * ⚠️ EVERY RULE HERE CAME FROM A MEASURED FALSE RESULT. The study ran against this repository's own
 * 1,092 real Indic lines plus a hand-built corpus, and it changed the design twice:
 *   1. the first tokenizer split `वीडियोdownload` at every matra and MISSED it — combining marks are
 *      `\p{M}`, not `\p{L}`, and `জungle` was caught only because `জ` happens to carry none;
 *   2. scanning raw SOURCE flagged `\bस्क्रीनशॉट\b` and `[A-Za-zऀ-ॿ]` — 6 of 8 hits on the real
 *      corpus, not one of them a label.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  mixedScriptTokens, stringLiterals, findMixedScriptText, scriptIntegritySummary, spansTwoIndicScripts,
} from '../src/server/AgentV3/scriptIntegrity';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('a label must not arrive broken', () => {
  it('catches the exact token that shipped', () => {
    expect(mixedScriptTokens("{ value: 'forest', label: 'জungle' }")).toContain('জungle');
    expect(mixedScriptTokens('জungle')).toEqual(['জungle']);
  });

  it('🔒 catches a word whose script is carried by combining marks', () => {
    // The first version returned [] here, because `[^\p{L}\p{N}]` treats every matra as a separator
    // and shredded the word before it could be compared. This is the reversion that matters most.
    expect(mixedScriptTokens('वीडियोdownload')).toEqual(['वीडियोdownload']);
    expect(mixedScriptTokens('ভিডিওdownload')).toEqual(['ভিডিওdownload']);
  });

  it('\ud83d\udd0e THE SIBLING — the word falls out of the script into ANOTHER INDIC script, not into Latin', () => {
    // Same root cause as the shipped `\u099Cungle`: the model leaves the target script part-way through a
    // word. Here it lands in Devanagari instead of Latin, and the user reads exactly the same broken
    // label. Before this, `mixedScriptTokens` returned [] for every one of these.
    expect(mixedScriptTokens('\u099C\u0902\u0917\u0932')).toEqual(['\u099C\u0902\u0917\u0932']);
    expect(mixedScriptTokens("{ label: '\u09AC\u09BE\u0982\u09B2\u09BE\u0915\u094B\u0936' }")).toContain('\u09AC\u09BE\u0982\u09B2\u09BE\u0915\u094B\u0936');
    expect(mixedScriptTokens('\u0B85\u0BAE\u0BCD\u092E\u093E')).toEqual(['\u0B85\u0BAE\u0BCD\u092E\u093E']);
  });

  it('\ud83d\udd12 judges the script by LETTERS ONLY — the danda and the shared digits are not evidence', () => {
    // The danda `\u0964` and `\u0965` live in the DEVANAGARI block and end a sentence in Bengali too, and the
    // Devanagari digits are shared the same way. Counting either as a letter would flag correct
    // Bengali — this is the reversion that matters: drop the `\p{L}` test and these turn true.
    expect(spansTwoIndicScripts('\u09AC\u09BE\u0982\u09B2\u09BE\u0964')).toBe(false);
    expect(spansTwoIndicScripts('\u09AC\u09BE\u0982\u09B2\u09BE\u0965')).toBe(false);
    expect(spansTwoIndicScripts('\u09AC\u09BE\u0982\u09B2\u09BE\u0968')).toBe(false);
    expect(spansTwoIndicScripts('\u09AC\u09BE\u0982\u09B2\u09BE')).toBe(false);
  });

  it('two Indic languages in the SAME string are fine — only inside one WORD is it broken', () => {
    for (const ok of ['\u09AC\u09BE\u0982\u09B2\u09BE \u0939\u093F\u0928\u094D\u0926\u0940', '\u09AC\u09BE\u0982\u09B2\u09BE\u0964 \u0939\u093F\u0928\u094D\u0926\u0940\u0964', '\u09AC\u09BE\u0982\u09B2\u09BE / \u0939\u093F\u0928\u094D\u0926\u0940', '\u09AC\u09BE\u0982\u09B2\u09BE-\u0939\u093F\u0928\u094D\u0926\u0940']) {
      expect(mixedScriptTokens(ok), ok).toEqual([]);
    }
  });

  it('leaves correct Indic text alone, including beside English words and digits', () => {
    for (const ok of [
      'জঙ্গল', 'সূর্যাস্ত', 'রাজকীয় বেগুনি', 'সরল সাদা-কালো',
      'MP3 ফাইল', 'MP3/WAV আবৃত্তি আপলোড করুন', '৫টি থিম', '১০০%',
      'Wi-Fi কানেকশন', 'PDF ডাউনলোড', 'API কী', 'फ़ाइल अपलोड करें',
      'ভিডিও তৈরি করুন', 'नमस्ते NavBharatAI',
    ]) {
      expect(mixedScriptTokens(ok), ok).toEqual([]);
    }
  });

  it('is safe around template interpolation — without needing a step for it', () => {
    // The first version cut `${...}` out first and the comment said that was necessary. A reversion
    // test proved it changed nothing: `$`, `{` and `}` are already non-word characters. The step was
    // deleted; these cases stay, because the BEHAVIOUR still has to hold however it is achieved.
    expect(mixedScriptTokens('${count}টি')).toEqual([]);
    expect(mixedScriptTokens('${name} এর ভিডিও')).toEqual([]);
    expect(mixedScriptTokens('ভিডিও: ${title}')).toEqual([]);
  });

  it('🔒 skips a literal that is a PATTERN, not text', () => {
    // Measured: these two shapes were 6 of the 8 hits on the real corpus and none was a label.
    expect(mixedScriptTokens(String.raw`\bस्क्रीनशॉट\b`)).toEqual([]);
    expect(mixedScriptTokens(String.raw`([A-Za-zऀ-ॿ]{3,}(?:\s+[A-Za-zऀ-ॿ]{2,})?)`)).toEqual([]);
  });

  it('reads string literals, not raw source', () => {
    const src = `const THEMES = [{ value: 'forest', label: 'জungle' }];\n// এটি একটি মন্তব্য\n`;
    expect(stringLiterals(src)).toContain('জungle');
    const found = findMixedScriptText({ 'src/App.tsx': src });
    expect(found).toHaveLength(1);
    expect(found[0].tokens).toEqual(['জungle']);
  });

  it('only looks at files whose text a user reads, and pays nothing on a clean project', () => {
    expect(findMixedScriptText({ 'package-lock.json': "'জungle'" })).toEqual([]);
    expect(findMixedScriptText({ 'src/App.tsx': "const a = 'Hello world';" })).toEqual([]);
  });

  it('says plainly what it found, and what it did not', () => {
    expect(scriptIntegritySummary([])).toContain('every label reads in one script');
    const msg = scriptIntegritySummary([{ file: 'src/App.tsx', tokens: ['জungle'] }]);
    expect(msg).toContain('src/App.tsx');
    expect(msg).toContain('"জungle"');
    // White-label law: never a vendor or model name on anything a user can see.
    expect(msg).not.toMatch(/kimi|glm|claude|gemini|grok|openai/i);
  });

  it('is wired into the build report, and records a clean pass too', () => {
    // A check only ever visible when it complains cannot be told apart from one that never ran —
    // the JOURNEY_NOT_RUN lesson, applied on the day this shipped.
    expect(route).toContain('const mixed = findMixedScriptText(integrityFiles);');
    expect(route).toContain("code: 'SCRIPT_INTEGRITY', ...obs(scriptIntegritySummary(mixed))");
    expect(route).toContain("code: 'SCRIPT_INTEGRITY', message: scriptIntegritySummary(mixed), autoResolved: true");
  });
});

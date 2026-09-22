/**
 * AUTOPSY `21b431e1` (2026-09-22) — THE TEXT CHECK ACCUSED CORRECT CODE, AND HAD NOTHING TO DO ABOUT
 * THE ONE CASE IT WAS RIGHT ABOUT.
 *
 * The report said `src/App.tsx` carried a corrupted label: a Latin `n` glued to Devanagari. Two
 * separate defects sat behind that one line.
 *
 * 1. 🔴 IT COULD NOT TELL A CORRECT STRING FROM A BROKEN ONE. `stringLiterals` returns the literal's
 *    BODY as written, so `"\nमैं"` — a newline before Devanagari, which is right — arrived as the
 *    characters `\`, `n`, `म`…; the backslash split away as punctuation and left the token `nमैं`.
 *    **That is the exact token the report carried**, so the finding may never have been a defect in
 *    the user's app at all. Third analyzer in three days caught describing its own blind spot as the
 *    user's bug (`AccessibilityAnalysis` 2026-09-20, `FeaturePresence` 2026-09-21).
 *
 * 2. 🔴 WHEN IT WAS RIGHT, NOTHING REPAIRED IT. The check was advisory by design, so a genuinely
 *    dropped backslash was reported and shipped, and the user read the corruption on their screen.
 *    Only ONE shape can be repaired without guessing — see `repairedLiteralBody`. The founding case
 *    `"জungle"` needs a word nobody wrote down, and is deliberately refused.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeLiteralEscapes, mixedScriptTokens, findMixedScriptText,
  repairedLiteralBody, repairLostEscapes, scriptRepairSummary,
} from '../src/server/AgentV3/scriptIntegrity';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('an escape is not a letter', () => {
  it('decodes the escapes a literal body carries, and never throws', () => {
    expect(decodeLiteralEscapes('\\nमैं')).toBe(' मैं');
    expect(decodeLiteralEscapes('पंक्ति\\tदो')).toBe('पंक्ति दो');
    expect(decodeLiteralEscapes('\\u0928मस्ते')).toBe('नमस्ते');
    expect(decodeLiteralEscapes('\\x41')).toBe('A');
    expect(decodeLiteralEscapes("यह \\'ठीक\\' है")).toBe("यह 'ठीक' है");
    expect(decodeLiteralEscapes('a\\\\b')).toBe('a\\b');
    expect(decodeLiteralEscapes('')).toBe('');
    expect(decodeLiteralEscapes('trailing \\')).toBe('trailing \\');
  });

  it('🔴 CORRECT source is no longer reported as a corrupted label', () => {
    // Every one of these was reported broken before the fix; the first is the report's own token.
    expect(findMixedScriptText({ 'a.tsx': 'const x = "\\nमैं";' })).toEqual([]);
    expect(findMixedScriptText({ 'b.tsx': 'const x = "पंक्ति\\tदो";' })).toEqual([]);
    expect(findMixedScriptText({ 'c.tsx': 'const x = "एक\\rदो";' })).toEqual([]);
    expect(mixedScriptTokens('\\nमैं')).toEqual([]);
  });

  it('…and a REAL defect is still caught, including both founding cases', () => {
    expect(findMixedScriptText({ 'a.tsx': 'const x = "nमैं";' })[0].tokens).toEqual(['nमैं']);
    expect(findMixedScriptText({ 'b.tsx': "const x = { label: 'জungle' };" })[0].tokens).toEqual(['জungle']);
    expect(findMixedScriptText({ 'c.tsx': 'const x = "জंगल";' })[0].tokens).toEqual(['জंगल']);
    expect(findMixedScriptText({ 'd.tsx': 'const x = "वीडियोdownload";' })[0].tokens).toEqual(['वीडियोdownload']);
  });

  it('the regex guard still runs on the RAW body — decoding first would blind it', () => {
    // `\b` and `\d` are exactly what decoding destroys, and they are what this guard reads.
    expect(mixedScriptTokens('\\bस्क्रीनशॉट\\b')).toEqual([]);
    expect(mixedScriptTokens('[A-Za-zऀ-ॿ]{3,}')).toEqual([]);
  });
});

describe('a dropped backslash is the one shape that can be repaired without guessing', () => {
  it('restores the escape, in both directions', () => {
    expect(repairedLiteralBody('nमैं')).toBe('\\nमैं');
    expect(repairedLiteralBody('मैंn')).toBe('मैं\\n');
    expect(repairedLiteralBody('tनाम')).toBe('\\tनाम');
    expect(repairedLiteralBody('संदेशn।')).toBe('संदेश\\n।');
  });

  it('🔒 NEVER deletes a character, and refuses everything it cannot be sure of', () => {
    // The founding case needs the intended word — a guess would rewrite somebody's label.
    expect(repairedLiteralBody('জungle')).toBe('জungle');
    // A real Latin word ending in `n` pressed against Indic text is not a lost escape.
    expect(repairedLiteralBody('greenमैं')).toBe('greenमैं');
    // Already correct — the backslash guard means a second pass is a no-op.
    expect(repairedLiteralBody('\\nमैं')).toBe('\\nमैं');
    expect(repairedLiteralBody(repairedLiteralBody('nमैं'))).toBe('\\nमैं');
    // Separated by a space: not glued, not a dropped escape.
    expect(repairedLiteralBody('n मैं')).toBe('n मैं');
    // Nothing Indic, or nothing Latin, or a pattern: untouched.
    expect(repairedLiteralBody('green')).toBe('green');
    expect(repairedLiteralBody('नमस्ते')).toBe('नमस्ते');
    expect(repairedLiteralBody('[A-Za-zऀ-ॿ]nमैं')).toBe('[A-Za-zऀ-ॿ]nमैं');
  });

  it('repairs a file through every quote style and returns ONLY what changed', () => {
    const r = repairLostEscapes({
      'src/App.tsx': 'const a = "nमैं"; const b = \'tनाम\'; const c = `मैंn`; const d = "green";',
      'src/Clean.tsx': 'const x = "नमस्ते";',
      'README.md': 'nमैं',              // not a UI file
      'src/Bin.png': 'nमैं',            // not a UI file
    });
    expect(Object.keys(r.files)).toEqual(['src/App.tsx']);
    expect(r.files['src/App.tsx']).toBe('const a = "\\nमैं"; const b = \'\\tनाम\'; const c = `मैं\\n`; const d = "green";');
    expect(r.repairs[0].before).toEqual(['nमैं', 'tनाम', 'मैंn']);
  });

  it('🔁 THE LOOP CLOSES: after the repair the check no longer complains', () => {
    const before = { 'src/App.tsx': 'const a = "nमैं";' };
    expect(findMixedScriptText(before)).toHaveLength(1);
    const after = repairLostEscapes(before).files;
    expect(findMixedScriptText(after)).toEqual([]);
  });

  it('a clean project costs nothing and says nothing', () => {
    const r = repairLostEscapes({ 'src/App.tsx': 'const x = "नमस्ते"; const y = "hello";' });
    expect(r.repairs).toEqual([]);
    expect(Object.keys(r.files)).toEqual([]);
  });

  it('the summary names the file and the word as it was, and no vendor', () => {
    const line = scriptRepairSummary([{ file: 'src/App.tsx', before: ['nमैं'] }]);
    expect(line).toContain('src/App.tsx');
    expect(line).toContain('nमैं');
    for (const v of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok']) expect(line).not.toContain(v);
  });

  it('REVERSION GUARD: the build really runs the repair, before it records the finding', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const repairAt = src.indexOf('repairLostEscapes(integrityFiles)');
    const recordAt = src.indexOf('const mixed = findMixedScriptText(integrityFiles)');
    expect(repairAt).toBeGreaterThan(0);
    expect(recordAt).toBeGreaterThan(0);
    // A repair recorded AFTER the finding would describe a defect we had already fixed.
    expect(repairAt).toBeLessThan(recordAt);
    expect(src).toContain('SCRIPT_INTEGRITY_REPAIRED');
  });

  it('REVERSION GUARD: our own housekeeping never counts against the user\u2019s app', () => {
    const diag = readFileSync(join(process.cwd(), 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    const sugg = readFileSync(join(process.cwd(), 'src/server/AgentV3/buildFindingSuggestions.ts'), 'utf8');
    for (const code of ['SCRIPT_INTEGRITY_REPAIRED', 'FAST_LANE_PHASES', 'PROVIDER_TIME_WASTED']) {
      expect(diag, code).toContain(`'${code}'`);
      expect(sugg, code).toContain(`'${code}'`);
    }
  });
});

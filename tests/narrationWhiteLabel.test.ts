/**
 * THE WHITE-LABEL LAW, enforced on the surface that was actually leaking.
 *
 * CLAUDE.md's standing rule: to the user it is ALWAYS NavBharatAI doing the work — they must never
 * encounter a vendor or model name. The rule also says "a regression test asserts that user-facing
 * streams contain none of the forbidden tokens". A test like that existed for billing payloads and
 * report bodies, but NOT for build NARRATION — the single most-read user-facing stream there is — and
 * two lines had been leaking through it:
 *
 *     'Escalating to Sonnet to fix the issues found in review…'
 *     '🔧 Review found issues — GLM/KIMI fixing them once…'
 *
 * Both were emitted on a normal build, to every user, on the escalation path — i.e. exactly when the
 * engine is working hardest and the user is watching most closely.
 *
 * This test closes that gap at the source: it walks every `type: 'narration'` emission in the server
 * and fails on a vendor name inside the LITERAL text.
 *
 * ⚠️ IT DELIBERATELY ONLY INSPECTS STRING LITERALS. A narration whose text comes from a variable can
 * legitimately carry admin-only content that is redacted later (`userFacingReport`,
 * `redactProviderError`), and flagging those would train the next author to silence this test rather
 * than fix a leak. What it catches is the class that actually shipped: a vendor name typed straight
 * into a user-facing sentence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const VENDOR = /\b(GLM|Z\.?ai|Kimi|Moonshot|Claude|Anthropic|Sonnet|Opus|Haiku|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|DeepSeek)\b/i;

const files = execSync(
  "find src/server -name '*.ts' | grep -v '\\.test\\.' | grep -v goldenScaffolds | grep -v 'generator/templates'",
  { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

/** Every literal string used as the `text:` of a narration event, with its location. */
function narrationLiterals(): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  for (const f of files) {
    if (/\/\._/.test(f)) continue; // sibling generator tests emit scratch files into src/server/lib
    let lines: string[];
    try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }
    lines.forEach((l, i) => {
      if (!/type: 'narration'/.test(l)) return;
      const block = lines.slice(i, i + 4).join(' ');
      const m = /text:\s*(.*?),\s*ts:/s.exec(block);
      if (!m) return;
      for (const s of m[1].match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g) || []) {
        out.push({ where: `${f}:${i + 1}`, text: s });
      }
    });
  }
  return out;
}

describe('build narration never names a vendor', () => {
  const literals = narrationLiterals();

  it('finds narration emissions to check (the scan itself must not silently pass on zero)', () => {
    // A regex that matched nothing would make every assertion below vacuously true — the quiet way a
    // guard like this rots into decoration.
    expect(literals.length).toBeGreaterThan(50);
  });

  it('🔒 no vendor or model name appears in any user-facing narration line', () => {
    const leaks = literals.filter((l) => VENDOR.test(l.text)).map((l) => `${l.where}: ${l.text.slice(0, 120)}`);
    expect(leaks).toEqual([]);
  });

  it('the two lines that were leaking now say NavBharatAI instead', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).not.toContain('Escalating to Sonnet');
    expect(route).not.toContain('GLM/KIMI fixing them once');
    // The source escapes the apostrophe inside a single-quoted string, so match the source form.
    expect(route).toContain("Bringing in NavBharatAI\\'s stronger engine");
    expect(route).toContain('NavBharatAI is fixing them');
  });

  it('still tells the user WHAT is happening — anonymising must not make it vague', () => {
    // The point is white-labelling, not withholding. An escalation the user cannot see would be a
    // worse product than one that names a vendor.
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('stronger engine to fix what the review found');
    expect(route).toContain('stronger engine to finish the build');
  });
});

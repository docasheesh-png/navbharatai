/**
 * The user has no lanes — autopsy `f152c1ab`, 2026-09-20.
 *
 * The last thing that build's user saw before pressing Stop, 2.5 seconds later, was:
 *
 *     "⏱️ The fast lane ran out of time — handing its 1 finished file(s) to the full builder
 *      to complete."
 *
 * Nothing had failed. A lane handoff is how the build CONTINUES, and the files were already saved.
 * But the sentence names our internal engines, reads as a failure, and reports a batch size as
 * though it were three and a half minutes of progress.
 *
 * 🔒 The White-Label Law forbids user-facing routing leakage — *"or any hint that more than one
 * vendor exists"*. The same argument covers our OWN internal engines: the user bought an app
 * builder, not a tour of its lanes. This suite is the ratchet: it reads the real source and fails if
 * internal vocabulary reappears in a line the user is shown.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts');

/**
 * Every string literal handed to `deps.log?.(…)` — the fast lane's user-facing narration channel.
 * Comments are stripped first, so the docblocks that QUOTE the old wording (deliberately, as
 * evidence) are not mistaken for live copy.
 */
function userFacingLines(src: string): string[] {
  const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.replace(/^[ \t]*\/\/.*$/gm, '');
  const out: string[] = [];
  const re = /deps\.log\?\.\(\s*(['"`])([\s\S]*?)\1/g;
  for (let m = re.exec(withoutLineComments); m; m = re.exec(withoutLineComments)) {
    // ⚠️ `${…}` is a VARIABLE NAME, not something the user reads — the first draft of this sweep
    // flagged "Building ${manifest.length} file(s)…", which shows the user a number and no word.
    // The rule is about what reaches a person's eyes, so the interpolations come out first.
    out.push(m[2].replace(/\$\{[^}]*\}/g, '#'));
  }
  return out;
}

/**
 * Words that describe OUR machinery rather than the user's app. `simple build` and `fast lane` are
 * the lane; `full builder` is the engine it hands to; `salvage` and `manifest` are our vocabulary
 * for saving files and planning them.
 */
const INTERNAL_VOCABULARY: readonly string[] = [
  'fast lane',
  'full builder',
  'simple build',
  'one-shot lane',
  'salvag', // salvage / salvaged / salvaging
  'manifest',
  'tier 0',
  'preamble',
];

describe('the fast lane never tells the user about lanes', () => {
  const lines = userFacingLines(readFileSync(SOURCE, 'utf8'));

  it('finds the narration at all — an empty sweep proves nothing', () => {
    expect(lines.length).toBeGreaterThan(3);
  });

  it('names no internal engine, lane or step', () => {
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const word of INTERNAL_VOCABULARY) {
        expect(lower.includes(word), `"${line}" contains internal vocabulary "${word}"`).toBe(false);
      }
    }
  });

  it('never tells the user that something of ours ran out of time', () => {
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain('ran out of time');
    }
  });

  /**
   * The specific sentence from the report. Kept as its own case so the regression is named, not
   * merely covered by the sweep above.
   */
  it('the exact line that preceded the abandonment is gone', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const live = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(live).not.toContain('The fast lane ran out of time');
    // …and the honest replacement is there, saying the two things that are true and do matter.
    const saved = userFacingLines(src).find((l) => l.includes('saved'));
    expect(saved, 'a line telling the user their work is kept').toBeTruthy();
    expect(saved!.toLowerCase()).toContain('still building');
  });
});

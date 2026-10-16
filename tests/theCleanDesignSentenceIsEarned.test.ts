// Q-1022 — THE CLEAN DESIGN SENTENCE IS EARNED, NOT READ OFF A LIST SOMEBODY SHORTENED.
//
// 🔴 THE DEFECT, in the words the model actually read. `modelDesignLine` hands `designLintSummary` a COPY
// of the lint with the platform-fixed violation types filtered out — right, because the model must not be
// told to fix something the spacing snap is about to fix itself (autopsy 536c8189: it spent three model
// calls writing regex scripts over the stylesheet and moved on-grid values OFF the grid). But when the
// ONLY finding was a platform-fixed one, the copy has no violations left, so the summary took its clean
// branch and said:
//
//     Design consistency 92/100 (A) across 7 file(s). Design consistency: ✓ A (92/100) — cohesive
//     palette, typography and spacing.
//       ✓ 4 off-grid spacing value(s): the platform snaps these to the grid when the build ends.
//
// One sentence denying what the next one states, from the same lint, in the same breath.
//
// 🔑 THE CLASS: A PREDICATE AND ITS EVIDENCE COMPUTED FROM TWO DIFFERENT INPUTS. The filtered copy is the
// right input for LISTING what is left and the wrong one for DECIDING whether anything was wrong. The
// caller now states how many it removed, and the honest sentence is said instead of the cohesive one.

import { describe, it, expect } from 'vitest';
import { lintBuiltApp, designLintSummary, CLEAN_AFTER_OUR_FIX } from '../src/server/AgentV3/buildQualityLint';
import { modelDesignLine } from '../src/server/AgentV3/writeTimeQualityCheck';
import { designSummary } from '../src/server/AppMakerLab/intelligence/DesignLinter';

const SNAP_ON = {} as NodeJS.ProcessEnv;
const SNAP_OFF = { AGENTV3_SPACING_SNAP: 'off' } as NodeJS.ProcessEnv;

/**
 * An app whose ONLY design fault is off-grid spacing — the exact shape that produced the contradiction.
 * One token module and one palette colour, so nothing else can trip a violation.
 */
const ONLY_OFF_GRID: Record<string, string> = {
  'src/index.css': [
    ':root { --accent: #3a7bd5; }',
    '.a { padding: 6px; }',
    '.b { margin: 10px; }',
    '.c { gap: 14px; }',
    '.d { row-gap: 18px; }',
    '.e { column-gap: 22px; }',
    '.f { padding: 26px; }',
  ].join('\n'),
};

describe('🔴 the contradiction', () => {
  const lint = lintBuiltApp(ONLY_OFF_GRID)!;

  it('the fixture really has off-grid spacing and nothing else', () => {
    expect(lint.design.violations.map((v) => v.type)).toEqual(['off-grid-spacing']);
  });

  it('🔒 the model is told the truth: nothing is left for IT to change, and what we fix is listed', () => {
    const line = modelDesignLine(lint, SNAP_ON);
    expect(line, 'the claim that contradicted the next line').not.toContain('cohesive palette, typography and spacing');
    expect(line).toContain(CLEAN_AFTER_OUR_FIX);
    expect(line, 'and what the platform fixes is still named').toContain('off-grid spacing value(s)');
    expect(line).toContain('the platform snaps these');
  });

  it('🔒 with the snap OFF the model owns them, so it is told as a real finding — not as "clean"', () => {
    const line = modelDesignLine(lint, SNAP_OFF);
    expect(line).not.toContain(CLEAN_AFTER_OUR_FIX);
    expect(line).not.toContain('cohesive palette');
    expect(line, "the linter's own wording, since the model owns the fix now").toMatch(/spacing values are off the \d+px grid/);
  });
});

describe('🔒 a genuinely cohesive app still gets the clean sentence — the fix must not take it away', () => {
  const CLEAN: Record<string, string> = {
    'src/index.css': ':root { --accent: #3a7bd5; }\n.a { padding: 8px; }\n.b { margin: 16px; }\n',
  };

  it('nothing was found and nothing was filtered ⇒ the cohesive sentence, unchanged', () => {
    const lint = lintBuiltApp(CLEAN)!;
    expect(lint.design.violations).toEqual([]);
    const line = modelDesignLine(lint, SNAP_ON);
    expect(line).toContain(designSummary(lint.design));
    expect(line).toContain('cohesive palette, typography and spacing');
    expect(line).not.toContain(CLEAN_AFTER_OUR_FIX);
  });
});

describe('designLintSummary — the two inputs are now distinguishable', () => {
  const lint = lintBuiltApp(ONLY_OFF_GRID)!;
  const emptied = { ...lint, design: { ...lint.design, violations: [] } };

  it('an empty list that was ALWAYS empty reads as cohesive', () => {
    expect(designLintSummary(emptied)).toContain('cohesive palette');
  });

  it('🔴 an empty list that the CALLER emptied does not — this is the whole bug', () => {
    expect(designLintSummary(emptied, 1)).toContain(CLEAN_AFTER_OUR_FIX);
    expect(designLintSummary(emptied, 1)).not.toContain('cohesive palette');
  });

  it('🔒 a non-empty list is unaffected either way — it still lists its findings', () => {
    expect(designLintSummary(lint, 0)).toMatch(/spacing values are off the \d+px grid/);
    expect(designLintSummary(lint, 1)).toMatch(/spacing values are off the \d+px grid/);
    expect(designLintSummary(lint, 1)).not.toContain(CLEAN_AFTER_OUR_FIX);
  });

  it('the score and the file count are on every form — a bare grade with no evidence is the older defect', () => {
    for (const line of [designLintSummary(emptied), designLintSummary(emptied, 1), designLintSummary(lint)]) {
      expect(line).toMatch(/Design consistency \d+\/100 \([A-F]\) across \d+ file\(s\)/);
    }
  });
});

describe('🔒 the caller that filters is the only one that passes a count', () => {
  it('modelDesignLine passes exactly how many it removed', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/server/AgentV3/writeTimeQualityCheck.ts'), 'utf8') as string;
    expect(src).toContain('designLintSummary(shown, handled.length)');
  });

  it('…and the unfiltered callers pass none, so their sentence is unchanged', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    for (const f of ['designAfterRepair.ts', 'buildQualityLint.ts']) {
      const src = readFileSync(join(__dirname, '../src/server/AgentV3', f), 'utf8') as string;
      for (const m of src.match(/designLintSummary\([^)]*\)/g) ?? []) {
        // Only the filtering caller may pass a second argument; anyone else doing so is this bug again.
        // The function's OWN declaration is a match for this regex; a type annotation is how it is told
        // apart from a call. (First version of this census failed on the signature it was written to guard.)
        if (/BuildQualityLint/.test(m)) continue;
        expect(m, `${f}: ${m}`).not.toMatch(/,/);
      }
    }
  });
});

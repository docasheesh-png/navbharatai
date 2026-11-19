// THE USER'S OWN FILES ARE LINTED FIRST (2026-11-19). `lintBuiltApp` stops reading at MAX_LINT_CHARS and used to read in
// workspace order, so a growing platform kit (byte-identical files we already reviewed) could push the USER's own
// stylesheet out of the design lint entirely. Found when the 2D world recipe (~40 KB) made br1954Prevention's "14 user
// colours" case read nothing from the user's app.css.
import { describe, it, expect } from 'vitest';
import { lintBuiltApp, MAX_LINT_CHARS } from '../src/server/AgentV3/buildQualityLint';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const kit = Object.fromEntries([...recipeFilePool()].map(([p, e]) => [p, e.content]));
const userCss = Array.from({ length: 14 }, (_, i) => `.c${i}{color:#${(0x112233 + i * 12345).toString(16).padStart(6, '0')}}`).join('\n');

describe('a kit that fills the lint budget never hides the user\'s own files', () => {
  it('the whole kit is bigger than the budget (the condition this guards)', () => {
    const total = Object.values(kit).reduce((n, c) => n + c.length, 0);
    expect(total).toBeGreaterThan(MAX_LINT_CHARS);
  });
  it('the user\'s stylesheet is judged even when it arrives AFTER every kit file', () => {
    const result = lintBuiltApp({ ...kit, 'src/app.css': userCss })!;
    expect(result.design.violations.some((v) => v.type === 'color-count')).toBe(true);
    expect(result.offenders['color-count']).toContainEqual({ path: 'src/app.css', count: 14 });
  });
  it('an EDITED kit file counts as the user\'s and is judged first too', () => {
    const path = Object.keys(kit).find((p) => /\.(tsx|css)$/.test(p))!;
    const edited = { ...kit, [path]: kit[path] + '\n/* edited by the user */\n', 'src/app.css': userCss };
    expect(lintBuiltApp(edited)!.offenders['color-count']).toContainEqual({ path: 'src/app.css', count: 14 });
  });
});

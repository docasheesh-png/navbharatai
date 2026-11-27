// A SCREEN WITH NO STYLES IS NOT A 100/A DESIGN (failedbr #2555, 2026-11-27). The same pass recorded "Design consistency
// 100/100 (A)" and CSS_CLASSES_UNDEFINED — "47 class name(s) used by the screens have no style rule in any stylesheet, so
// those screens render unstyled". The design score read only the stylesheet that existed. Now the screens' classes with no
// rule are a design violation, with its fix, so the score and the CSS check can never disagree again.
import { describe, it, expect } from 'vitest';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';
import { withUnstyledClasses, lintDesign } from '../src/server/AppMakerLab/intelligence/DesignLinter';
import { findUndefinedClasses } from '../src/server/AgentV3/CssConsistency';

/** The #2555 shape: a starter stylesheet, and a screen that names many classes no stylesheet defines. */
const names = Array.from({ length: 47 }, (_, i) => `panel-part-${i}`);
const project = {
  'src/index.css': ':root { --bg: #0b1020; }\n.app-shell { padding: 16px; }\n',
  'src/App.tsx': `export default function App() { return (<main className="app-shell">${names.map((n) => `<div className="${n}">x</div>`).join('')}</main>); }`,
};

describe('🎨 the design score sees unstyled screens', () => {
  it('🔴 the #2555 shape: 47 classes with no rule are no longer 100/A', () => {
    expect(findUndefinedClasses(project)).toHaveLength(47);
    const q = lintBuiltApp(project)!;
    expect(q.design.score).toBe(60);
    expect(q.design.grade).toBe('C');
    const v = q.design.violations.find((x) => x.type === 'unstyled-classes')!;
    expect(v.count).toBe(47);
    expect(v.examples[0]).toMatch(/^\.panel-part-/);
    expect(v.fix).toMatch(/must have a rule in the app's stylesheet/);
  });
  it('every class styled: nothing changes', () => {
    const styled = { ...project, 'src/index.css': project['src/index.css'] + names.map((n) => `.${n} { margin: 8px; }`).join('\n') };
    expect(findUndefinedClasses(styled)).toEqual([]);
    expect(lintBuiltApp(styled)!.design.violations.some((x) => x.type === 'unstyled-classes')).toBe(false);
  });
  it('the penalty grows with the count and is capped', () => {
    const base = lintDesign('.a{color:#111}');
    expect(withUnstyledClasses(base, ['x-a']).score).toBe(base.score - 11);
    expect(withUnstyledClasses(base, Array.from({ length: 200 }, (_, i) => `c-${i}`)).score).toBe(base.score - 40);
    expect(withUnstyledClasses(base, [])).toBe(base);
  });
});

// Autopsy 51ef24ad (2026-10-04): "Build app in this format" over a 54-file Android project. Three
// defects, each locked here: JSX in a `.ts` file was edited five times instead of renamed; a "UI-only"
// Cloud Sync toggle shipped beside a "Sync All Data Now" button that did nothing; and a nine-screen
// port was sized "simple" (score 15) because the scorer read only the five words of the prompt.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tscErrorCauses, sourceHasJsx } from '../src/server/AgentV3/tscErrorCause';
import { admittedInertControls } from '../src/server/AgentV3/claimAudit';
import { nearestEditRegion, missingCssSelectors } from '../src/server/AgentV3/ToolDispatcher';
import { workspaceSizedComplexity, PORT_OWN_FILES_LINE, type ComplexityDecision } from '../src/server/AgentV3/complexityRouting';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

const HOOK_WITH_JSX = `import { createContext, useState } from 'react';
export const Ctx = createContext(null);
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [s] = useState(0);
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}`;

describe('JSX in a .ts file is named as the extension, not the markup', () => {
  const err = (code: string, message: string, file = 'src/hooks/useAppState.ts') => ({ file, line: 5, col: 10, code, message });

  it('with the source in hand: the exact advice — move to .tsx, do not edit the JSX', () => {
    const c = tscErrorCauses([err('TS1005', "'>' expected."), err('TS1161', 'Unterminated regular expression literal.')], { 'src/hooks/useAppState.ts': HOOK_WITH_JSX });
    expect(c).toHaveLength(1);
    expect(c[0].id).toBe('jsx-in-ts');
    expect(c[0].advice).toMatch(/src\/hooks\/useAppState\.tsx/);
    expect(c[0].advice).toMatch(/Do NOT edit the JSX/);
  });

  it('without the source: only for JSX\'s own signature, said as a check', () => {
    expect(tscErrorCauses([err('TS1005', "'>' expected.")])[0]?.advice).toMatch(/^If `src\/hooks\/useAppState\.ts` contains JSX/);
    expect(tscErrorCauses([err('TS1005', "';' expected.")])).toEqual([]);
  });

  it('never fires on a .tsx file, a .d.ts, or a .ts file whose source has no JSX', () => {
    expect(tscErrorCauses([err('TS1005', "'>' expected.", 'src/App.tsx')], { 'src/App.tsx': HOOK_WITH_JSX })).toEqual([]);
    expect(tscErrorCauses([err('TS1005', "'>' expected.", 'src/types.d.ts')])).toEqual([]);
    expect(tscErrorCauses([err('TS1005', "'>' expected.")], { 'src/hooks/useAppState.ts': 'const a: Array<string> = [];\nconst b = f<number>(1);' })).toEqual([]);
  });

  it('sourceHasJsx tells markup from generics', () => {
    expect(sourceHasJsx(HOOK_WITH_JSX)).toBe(true);
    expect(sourceHasJsx('return <Button onClick={go} />;')).toBe(true);
    expect(sourceHasJsx('return <>{x}</>;')).toBe(true);
    expect(sourceHasJsx('const m = new Map<string, Array<number>>(); useState<Foo>(null);')).toBe(false);
    expect(sourceHasJsx('// <div>not code</div>\nconst s = "<b>x</b>";')).toBe(false);
  });
});

describe('a control the build admits does nothing becomes an app finding', () => {
  it('reads the report\'s own sentence', () => {
    const summary = 'Done!\n- Cloud Sync on the Settings page is a UI-only toggle for now; connecting a real backend would make it live.\n- Some classes are not fully styled.';
    const found = admittedInertControls(summary);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^Cloud Sync on the Settings page is a UI-only toggle/);
  });

  it('catches the other ways of saying it', () => {
    expect(admittedInertControls('The export button does not do anything yet.')).toHaveLength(1);
    expect(admittedInertControls('The sync switch is not wired to a backend.')).toHaveLength(1);
    expect(admittedInertControls('I added a placeholder button for payments.')).toHaveLength(1);
  });

  it('stays quiet on an honest, working summary', () => {
    expect(admittedInertControls('Added a dark-mode toggle that saves to localStorage. All buttons work.')).toEqual([]);
    expect(admittedInertControls('The layout is display-friendly on phones.')).toEqual([]);
    expect(admittedInertControls('')).toEqual([]);
  });

  it('the route records UI_ONLY_CONTROL for an app build, and the builder is told not to ship one', () => {
    expect(route).toMatch(/expectsArtifacts && !isImportTurn \? admittedInertControls\(result\.summary\) : \[\]/);
    expect(route).toContain("code: 'UI_ONLY_CONTROL'");
    const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(prompt).toContain('NO CONTROL THAT DOES NOTHING');
    expect(prompt).toContain('A file that contains JSX must be .tsx');
  });
});

describe('a build order over a big project is sized by the project', () => {
  const simple: ComplexityDecision = { verdict: 'simple', score: 15, source: 'deterministic', reason: 'x' };

  it('the report\'s case — 54 own files — opens as complex', () => {
    const d = workspaceSizedComplexity(simple, { ownFiles: 54 });
    expect(d).toMatchObject({ verdict: 'complex', score: 15, source: 'workspace' });
    expect(d.reason).toMatch(/54 of the user's own files/);
  });

  it('only upgrades, only past the line, never when routing is switched off', () => {
    expect(workspaceSizedComplexity(simple, { ownFiles: PORT_OWN_FILES_LINE - 1 })).toBe(simple);
    expect(workspaceSizedComplexity(simple, null)).toBe(simple);
    const complex: ComplexityDecision = { ...simple, verdict: 'complex', source: 'model' };
    expect(workspaceSizedComplexity(complex, { ownFiles: 99 })).toBe(complex);
    const off: ComplexityDecision = { ...simple, source: 'disabled' };
    expect(workspaceSizedComplexity(off, { ownFiles: 99 })).toBe(off);
  });

  it('the route applies it to the build-order-as-edit fact, before the verdict is read', () => {
    const i = route.indexOf('const complexityDecision = workspaceSizedComplexity(promptComplexityDecision, buildOrderReadAsEdit);');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(route.indexOf("const buildIsComplex = complexityDecision.verdict === 'complex';"));
  });
});

describe('an edit to a CSS rule that does not exist says so', () => {
  const kit = ':root {\n  --accent: #4f46e5;\n}\n.nb-btn {\n  padding: 8px;\n}\n.nb-card, .nb-panel {\n  border: 1px solid;\n}\n' + '/* filler */\n'.repeat(300);

  it("the report's two misses — `.btn-danger` and `.nb-main` — are named as absent, with the append route", () => {
    expect(missingCssSelectors(kit, '.btn-danger {\n  background: red;\n}')).toEqual(['.btn-danger']);
    const msg = nearestEditRegion(kit, '.nb-main {\n  margin: 0 auto;\n}');
    expect(msg).toMatch(/^The rule `\.nb-main` does not exist in this file/);
    expect(msg).toMatch(/EMPTY old_string/);
  });

  it('a rule that IS there (alone or in a group) is never called absent', () => {
    expect(missingCssSelectors(kit, '.nb-btn {\n  padding: 4px;\n}')).toEqual([]);
    expect(missingCssSelectors(kit, '.nb-panel {')).toEqual([]);
  });

  it('never fires on code, a bare element rule or an at-rule', () => {
    expect(missingCssSelectors(kit, 'const style = {\n  a: 1,\n};')).toEqual([]);
    expect(missingCssSelectors(kit, 'div {\n  margin: 0;\n}')).toEqual([]);
    expect(missingCssSelectors(kit, '@media (max-width: 600px) {')).toEqual([]);
    expect(nearestEditRegion('const a = 1;\n', 'const totallyMissing = 2;')).not.toMatch(/does not exist in this file/);
  });
});

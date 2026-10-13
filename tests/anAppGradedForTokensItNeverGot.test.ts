import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideStyleResume, styleResumeNote, noTokensInstruction, closingExample,
} from '../src/server/AgentV3/stylePolishResume';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';

/**
 * 🧬 THE APP WAS GRADED FOR A TOKEN SYSTEM NOBODY ASKED IT FOR — Q-914, autopsy `50378049`
 * (BlockWorld, a voxel game, 2026-10-12).
 *
 * The build shipped with `DESIGN_CONSISTENCY 60/100` — *"45 hardcoded colours and no CSS variables"* —
 * **unresolved**. Checked one layer at a time rather than assumed:
 *
 * | layer | verdict |
 * |---|---|
 * | is the rule in the prompt? | **yes**, unconditionally — *"Define CSS variables on :root for a real palette"*. Not a missing instruction. |
 * | is the scanner inflating it? | **no** — it matches `#rrggbb` only, so a three.js `0x…` material colour is never counted. |
 * | is the finding even true? | **yes** — it needs `> 8 colours` AND `!hasTokens`, and it fired, so the app had no token layer at all. |
 *
 * 🔑 So the engine MEASURED it, SCORED it, told the USER about it — and **never once asked the MODEL to
 * fix it.** `hardcoded-colors` is in `WHOLE_APP_VIOLATIONS`, correctly kept out of the per-file
 * write-time note because it is a judgement about the whole app — and then it reached no hand-back
 * either. **A finding with nowhere to go is a grade, not a fix.**
 *
 * 🔒 It belongs in the hand-back by that module's OWN rule: *"a hand-back is for what only a model can
 * JUDGE … never for arithmetic with one answer."* Which literals are the same semantic colour, and what
 * to call them, is exactly that — unlike `round(v / 4) * 4`, which is why spacing was moved OUT of the
 * hand-back into `spacingSnap.ts` (autopsy 536c8189).
 *
 * 🔒 And it is BOUNDED, which is what 536c8189 actually warns about: one edit to one stylesheet, fired
 * only when the app has NO tokens whatsoever.
 */

const base = {
  text: 'Built the game.',
  missing: [] as string[],
  sheet: 'src/index.css',
  pages: [],
  a11y: [],
  orphans: [],
  resumesUsed: 0,
  producedFiles: true,
  env: {} as NodeJS.ProcessEnv,
};

/** The reported app's shape: real CSS-literal colours in game UI panels, and no `var(--…)` anywhere. */
const BLOCKWORLD = (): Record<string, string> => {
  const panel = (name: string, colours: string[]) =>
    `export function ${name}() {\n  return <div style={{ ${colours.map((c, i) => `['a'+${i}]: '${c}'`).join(', ')} }} />;\n}\n`;
  const hues = ['#7ec850', '#5a3921', '#b0b0b0', '#2f6fb3', '#e0c068', '#d04040', '#404040', '#f0f0f0', '#101820'];
  return {
    'src/index.css': 'body { margin: 0; }\n.hud { position: fixed; }\n',
    'src/ui/Hud.tsx': panel('Hud', hues),
    'src/ui/InventoryPanel.tsx': panel('InventoryPanel', hues),
    'src/ui/CraftingPanel.tsx': panel('CraftingPanel', hues),
  };
};

describe('an app graded for tokens it never got (Q-914, autopsy 50378049)', () => {
  describe('the finding the engine already had in hand', () => {
    it('🔴 THE REPORTED SHAPE: many colour literals, hasTokens false, worst files named', () => {
      const lint = lintBuiltApp(BLOCKWORLD())!;
      expect(lint.design.stats.hasTokens).toBe(false);
      const v = lint.design.violations.find((x) => x.type === 'hardcoded-colors');
      expect(v).toBeTruthy();
      expect(v!.count).toBeGreaterThan(0);
      // The offender list is what lets the ask say WHERE the weight is.
      expect((lint.offenders['hardcoded-colors'] ?? []).length).toBeGreaterThan(0);
    });

    it('…and an app WITH a token layer produces no such finding, so the ask cannot fire on it', () => {
      const withTokens = {
        ...BLOCKWORLD(),
        'src/index.css': ':root { --brand: #2f6fb3; --ink: #101820; }\nbody { color: var(--ink); }\n',
        'src/ui/Hud.tsx': 'export function Hud() { return <div style={{ color: "var(--ink)" }} />; }\n',
        'src/ui/InventoryPanel.tsx': 'export function InventoryPanel() { return <div style={{ color: "var(--brand)" }} />; }\n',
        'src/ui/CraftingPanel.tsx': 'export function CraftingPanel() { return <div style={{ color: "var(--brand)" }} />; }\n',
      };
      expect(lintBuiltApp(withTokens)!.design.stats.hasTokens).toBe(true);
    });
  });

  describe('🔴 the hand-back now asks for it — once, and bounded', () => {
    it('a turn with nothing else wrong still gets handed back for it', () => {
      const d = decideStyleResume({ ...base, noTokens: { colours: 45, files: ['src/ui/CraftingPanel.tsx'] } });
      expect(d.resume).toBe(true);
      expect(d.message).toContain('45 colour literals and defines no CSS variables at all');
      expect(d.message).toContain('src/index.css');
    });

    it('…and before this it stood down with nothing to say — the report', () => {
      const d = decideStyleResume({ ...base });
      expect(d.resume).toBe(false);
      expect(d.standDown).toBe('nothing-missing');
    });

    it('🔒 it is ONE stylesheet edit, not a list of files to work through', () => {
      const text = noTokensInstruction({ colours: 45, files: ['a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'e.tsx'] }, 'src/index.css');
      expect(text).toContain('Add ONE `:root` block to src/index.css');
      // At most three files are named, and as WHERE THE WEIGHT IS, never as a worklist.
      expect(text).toContain('Most of them are in a.tsx, b.tsx, c.tsx');
      expect(text).not.toContain('d.tsx');
      // 536c8189's lesson: the ask must not invite a restyle.
      expect(text).toContain('do not change how the app looks');
    });

    it('a count of zero never fires it, so an app with tokens is never nagged', () => {
      expect(decideStyleResume({ ...base, noTokens: { colours: 0 } }).resume).toBe(false);
      expect(decideStyleResume({ ...base, noTokens: undefined }).resume).toBe(false);
    });

    it('it rides the SAME one message as the other four parts, never a second turn', () => {
      const d = decideStyleResume({
        ...base,
        missing: ['card'],
        orphans: ['src/ui/Unused.tsx'],
        noTokens: { colours: 12 },
      });
      expect(d.resume).toBe(true);
      // One message, three asks.
      expect(d.message).toContain('.card');
      expect(d.message).toContain('imported by nothing');
      expect(d.message).toContain('defines no CSS variables at all');
      expect(d.message.match(/You ended your turn/g)?.length).toBe(1);
    });

    it('the closing example is TRUE of this ask (autopsy db07e0af)', () => {
      expect(closingExample({ missing: [], pages: [], a11y: [], orphans: [], noTokens: true }))
        .toBe('The app now uses one colour palette throughout.');
      // …and an ask it is not about keeps its own example.
      expect(closingExample({ missing: ['card'], pages: [], a11y: [], orphans: [], noTokens: true }))
        .not.toBe('The app now uses one colour palette throughout.');
    });

    it('the admin note names it by what it is, never as a count of zero', () => {
      expect(styleResumeNote(0, 0, 0, 0, 45)).toContain('45 colour literal(s) stood with no CSS variables at all');
      expect(styleResumeNote(1, 0, 0, 0, 0)).not.toContain('colour literal');
    });
  });

  describe('🔒 the wiring — one lint, read twice, and never handed to a specialist', () => {
    const disp = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

    it('the a11y lint is reused rather than run a second time', () => {
      expect(disp).toContain('const lint = lintBuiltApp(project);');
      expect(disp).toContain('a11y = a11yHandBack(lint);');
      // The old shape ran it inline for a11y alone and discarded the rest.
      expect(disp).not.toContain('a11y = a11yHandBack(lintBuiltApp(project));');
    });

    it('it needs BOTH no-tokens and a real count', () => {
      expect(disp).toContain("lint.design.stats.hasTokens === false && colours > 0");
    });

    it('🔒 a sub-agent is never handed the whole app\'s palette', () => {
      // `onlyWritten` returns before this point — the same rule `orphans` follows (Q-066).
      const scoped = disp.indexOf('if (opts.onlyWritten) return scopeStyleHandBack(');
      const added = disp.indexOf('...(noTokens ? { noTokens } : {})');
      expect(scoped).toBeGreaterThan(0);
      expect(added).toBeGreaterThan(scoped);
    });

    it('the runner passes it through, and records it', () => {
      const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
      expect(runner).toContain('noTokens: style.noTokens');
      expect(runner).toContain('style.noTokens?.colours ?? 0');
    });
  });
});

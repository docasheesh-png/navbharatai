// The contract was written, but nobody told the model until it was too late (autopsy `31dc61fd`).
//
// 🔴 THE FINDING, AND WHY THE OBVIOUS FIX IS THE WRONG ONE. That report shipped an app with
// `ACCESSIBILITY 92/100 — 1 form field with no label` and `DESIGN_CONSISTENCY 80/100 — 38 spacing
// values off the 4px grid`. The reflex is to add both rules to the architect prompt. **They were
// already there** — `systemPrompt.ts:504` ("consistent 4/8/12/16/24px spacing") and `:518` (every
// `<input>`/`<textarea>` needs a real `name` and a `<label htmlFor=…>` or an `aria-label`).
//
// The prompt is read ONCE, before any code exists. By the twentieth file it is thousands of tokens
// behind. What was missing was never the rule — it was the rule arriving while the model still holds
// the file.
//
// 🔑 THIRD INSTANCE OF A PATTERN THIS REPO ALREADY TRUSTS: `writeTimeImportCheck` (a fixer that
// "already existed but ran at the END, by which time the agent's intent was elsewhere") and
// `writeTimeTypecheck` (autopsy e706e068 — 20 files written before the first `tsc`, then 21 errors
// ground for seven minutes, every one visible the moment its file was written).
//
// 🔒 AND IT IS THE SAFE HALF OF "PREVENT, DON'T HEAL". Auto-repairing afterwards means editing an app
// that has already been proven green — the thing Green Freeze forbids. This spends no model call,
// runs no shell, edits no file, and can only append a sentence to a tool result.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  qualityNote, writeQualityEnabled, PER_FILE_VIOLATIONS, MAX_NOTE_LINES,
} from '../src/server/AgentV3/writeTimeQualityCheck';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';

/** The two defects report 31dc61fd actually shipped. */
const UNLABELLED_FIELD = 'export default function Forum(){return (<form><input type="text" placeholder="Title" /><button type="submit">Post</button></form>);}';
const OFF_GRID_CSS = '.a{padding:7px;margin:13px}.b{padding:9px;gap:15px}.c{margin:21px;padding:3px}';

describe("🔴 the report's own two defects are now caught at write time", () => {
  it('the unlabelled form field — the exact ACCESSIBILITY finding', () => {
    const note = qualityNote('src/components/Forum.tsx', UNLABELLED_FIELD);
    expect(note).toContain('form field(s) with no label');
    expect(note).toContain('src/components/Forum.tsx');
  });

  it('the off-grid spacing — the exact DESIGN_CONSISTENCY finding', () => {
    expect(qualityNote('src/index.css', OFF_GRID_CSS)).toContain('off the 4px grid');
  });

  it('it says WHEN to fix it, because that is the entire point of the change', () => {
    expect(qualityNote('src/components/Forum.tsx', UNLABELLED_FIELD))
      .toContain('while you have the file open');
  });
});

describe('🔒 the controls — a correct file is never nagged', () => {
  it('a properly labelled form produces nothing', () => {
    const ok = 'export default function Ok(){return (<form><label htmlFor="t">Title</label><input id="t" name="t" /><button type="submit">Post</button></form>);}';
    expect(qualityNote('src/components/Ok.tsx', ok)).toBe('');
  });

  it('on-grid spacing produces nothing', () => {
    expect(qualityNote('src/ok.css', '.a{padding:8px;margin:16px}.b{padding:12px;gap:24px}')).toBe('');
  });

  it('a file the end-of-build lint would not judge is not judged here either', () => {
    // The selection rule is NOT restated in this module — `lintBuiltApp` returning null IS the
    // answer, so the two can never disagree about which files are lintable.
    expect(qualityNote('README.md', '<input type="text">')).toBe('');
    expect(qualityNote('src/x.test.tsx', UNLABELLED_FIELD)).toBe('');
  });

  it('empty, blank and non-string input are safe', () => {
    expect(qualityNote('src/x.tsx', '')).toBe('');
    expect(qualityNote('src/x.tsx', '   \n ')).toBe('');
    expect(qualityNote(undefined as unknown as string, UNLABELLED_FIELD)).toBe('');
    expect(qualityNote('src/x.tsx', null as unknown as string)).toBe('');
  });
});

describe('🔒 THE EXCLUSIONS ARE THE PRECISION — a whole-app judgement is not a per-file one', () => {
  it('a palette-heavy file is NOT nagged, though the linter does flag it', () => {
    // Proven load-bearing rather than assumed: the raw linter DOES report `hardcoded-colors` for
    // this file. If that leaked into the note, every generated stylesheet would carry one and the
    // model would learn to skip these notes — costing the real findings their credibility.
    const css = Array.from({ length: 20 }, (_, i) => `.c${i}{color:#${(i * 111111 + 100000).toString(16).slice(0, 6)};padding:8px}`).join('\n');
    const raw = lintBuiltApp({ 'src/theme.css': css });
    const rawTypes = [...(raw?.design.violations ?? []), ...(raw?.a11y.violations ?? [])].map((v) => v.type);
    expect(rawTypes.length).toBeGreaterThan(0);
    expect(rawTypes.some((t) => !PER_FILE_VIOLATIONS.has(t))).toBe(true);
    expect(qualityNote('src/theme.css', css)).toBe('');
  });

  it('the palette-wide types are excluded BY NAME', () => {
    for (const wholeApp of ['color-count', 'font-count', 'hardcoded-colors']) {
      expect(PER_FILE_VIOLATIONS.has(wholeApp)).toBe(false);
    }
  });

  it('and the per-file types are all present', () => {
    for (const perFile of ['input-label', 'img-alt', 'control-name', 'off-grid-spacing']) {
      expect(PER_FILE_VIOLATIONS.has(perFile)).toBe(true);
    }
  });
});

describe('🔒 it cannot become a wall of text, and it can be switched off', () => {
  it('capped at MAX_NOTE_LINES', () => {
    // ⚠️ THE FIXTURE MUST GENUINELY EXCEED THE CAP, or this test cannot fail. The first draft used a
    // file producing exactly 3 per-file violations — equal to the cap — so deleting the cap left it
    // green, which the reversion proof caught. This one produces FIVE (img-alt, input-label,
    // control-name, html-lang, positive-tabindex), measured, so the cap is what holds it to 3.
    const bad = '<html><body><img src="a.png"><img src="b.png"><input type="text"><input type="text">'
      + '<button></button><a href="#"></a><p tabindex="3">x</p></body></html>';
    const all = lintBuiltApp({ 'src/Bad.html': bad });
    const eligible = [...(all?.a11y.violations ?? []), ...(all?.design.violations ?? [])]
      .filter((v) => PER_FILE_VIOLATIONS.has(v.type) && v.count > 0);
    expect(eligible.length).toBeGreaterThan(MAX_NOTE_LINES);

    const lines = qualityNote('src/Bad.html', bad).split('\n').filter((l) => l.trim().startsWith('•'));
    expect(lines.length).toBe(MAX_NOTE_LINES);
  });

  it('AGENTV3_WRITE_QUALITY=off restores the old behaviour exactly', () => {
    expect(writeQualityEnabled({ AGENTV3_WRITE_QUALITY: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(qualityNote('src/components/Forum.tsx', UNLABELLED_FIELD, { AGENTV3_WRITE_QUALITY: 'off' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('default is ON — unset and empty both mean on', () => {
    expect(writeQualityEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(writeQualityEnabled({ AGENTV3_WRITE_QUALITY: '' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('🔒 it is actually wired — on BOTH write return paths', () => {
  const DISPATCHER = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('computed once and appended to both the create and the modify reply', () => {
    // A note computed and then dropped on one branch is the class this repo has hit five times
    // (onFileWrite, the framework id, onCommand, writeTypecheckStats, the reviewer's read ledger):
    // a measurement that never reaches a reader.
    const code = codeOnly(DISPATCHER);
    expect(code).toContain('const qualNote = qualityNote(path, content)');
    const appends = code.split('\n').filter((l) => l.includes('+ qualNote'));
    expect(appends.length).toBe(2);
  });

  it('it sits beside the other two write-time checks, not somewhere else', () => {
    const code = codeOnly(DISPATCHER);
    const typecheck = code.indexOf('const typecheckNote =');
    const quality = code.indexOf('const qualNote =');
    expect(typecheck).toBeGreaterThan(-1);
    expect(quality).toBeGreaterThan(typecheck);
    expect(quality - typecheck).toBeLessThan(400);
  });
});

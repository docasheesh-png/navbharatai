// THE ADVICE FITS THE POSITION IT IS ABOUT (Q-1028).
//
// 🔴 THE ROW'S OWN PLAN WAS WRONG, AND MEASURING IT IS WHAT SHOWED THAT. Q-1028 said to add `FC`,
// `FunctionComponent` and `ComponentType` to `COMPONENT_TAKING_TYPES`, the set that switches the rename heal
// OFF. Measured against the installed `@types/react` and a real `tsc` run of all five shapes:
//
//   position                      the renamed data type        `typeof Component`
//   ───────────────────────────── ──────────────────────────── ────────────────────────────────────────────
//   FC<…> / FunctionComponent<…>  ✅ compiles                   ✅ compiles — and means "props are a function"
//   ComponentType<…>              ✅ compiles                   ✅ compiles — same nonsense
//   ComponentProps<…>             ❌ TS2344                      ✅ the right fix
//   a plain annotation            ✅ compiles                   (only if you mean the component)
//
// So excluding them would have switched off a heal that produces CORRECT code, and `ComponentProps` — the one
// already excluded — is the only React position where `typeof` is right. The row had it backwards.
//
// 🧬 THE REAL DEFECT, which is worse than the row's: at a props position `typeof X` **compiles**, silently
// declaring the component's props to be the component's own function type. A wrong fix the compiler accepts
// costs more than one it rejects. And the advice offered it: measured, ONE sentence named lines 2, 3, 4, 5, 6
// together and gave both options for all of them, although at line 5 the data name is a compile error and at
// lines 2–4 `typeof` is the nonsense. Advice right for one of those is wrong for the other.
//
// THE CLASS: the heal knew the position from the AST; the advice knew nothing and guessed. One classifier
// (`typeUsePosition`) is now read by both, so they cannot disagree — the same shape as Q-1022 (a predicate
// and its evidence computed from two different inputs) and Q-1026/Q-1033 (one computation, one copy).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import {
  fixRecordedTypeRenames, typeRenameAdvice, suggestedTypeRenames, typeUsePosition,
} from '../src/server/AgentV3/contractRenames';
import { contractRenameHandoffLine } from '../src/server/AgentV3/handoffRule';

/** The file a model really writes after the platform renamed the shared data type (build 9c612cdb's shape). */
const APP = `import type { FC, FunctionComponent, ComponentType, ComponentProps } from 'react';
export const A: FC<VideoList> = () => null;
export const B: FunctionComponent<VideoList> = () => null;
export const C: ComponentType<VideoList> = () => null;
type D = ComponentProps<VideoList>;
export const E: VideoList = { items: [] };
export function VideoList() { return null; }
`;
/** tsc's REAL output for that file — captured from a compile, not paraphrased. All five are identical. */
const TS2749 = "'VideoList' refers to a value, but is being used as a type here. Did you mean 'typeof VideoList'?";
const at = (line: number, col: number) => ({ file: 'src/App.tsx', line, col, code: 'TS2749', message: TS2749 });
const ERRS = [at(2, 20), at(3, 35), at(4, 31), at(5, 25), at(6, 17)];
const RENAMES = [{ from: 'VideoList', to: 'VideoListData', component: 'src/App.tsx' }];
const CONTRACT = { path: 'src/types.ts', source: 'export interface VideoListData { items: string[] }\n' };
const SOURCES = { 'src/App.tsx': APP };
const advice = (errs = ERRS) => typeRenameAdvice(suggestedTypeRenames(errs as never, RENAMES), SOURCES);

describe('🔒 the position each name landed in, from ONE classifier', () => {
  it.each([
    [2, 20, 'props-arg', 'FC<…>'],
    [3, 35, 'props-arg', 'FunctionComponent<…>'],
    [4, 31, 'props-arg', 'ComponentType<…>'],
    [5, 25, 'component-arg', 'ComponentProps<…>'],
    [6, 17, 'plain', 'a plain annotation'],
  ])('line %i is %s (%s)', (line, col, expected) => {
    expect(typeUsePosition(APP, 'src/App.tsx', line as number, col as number, 'VideoList')).toBe(expected);
  });

  it('nothing is claimed where there is no source, or the token is not that name', () => {
    expect(typeUsePosition(undefined, 'src/App.tsx', 2, 20, 'VideoList')).toBe('not-a-type-use');
    expect(typeUsePosition(APP, 'src/App.tsx', 2, 20, 'SomethingElse')).toBe('not-a-type-use');
    expect(typeUsePosition(APP, 'src/App.tsx', 999, 1, 'VideoList')).toBe('not-a-type-use');
    expect(typeUsePosition('const x: VideoList<Inner> = 1;', 'a.ts', 1, 10, 'VideoList'), 'already has type args')
      .toBe('not-a-type-use');
  });
});

describe('🔴 the heal: Q-1028 would have switched it off where it is RIGHT', () => {
  const fix = fixRecordedTypeRenames(SOURCES, ERRS as never, RENAMES, CONTRACT);

  it('rewrites the props positions and the plain one — the four that compile', () => {
    expect(fix.fixed.map((f) => f.line)).toEqual([2, 3, 4, 6]);
    const out = fix.files['src/App.tsx'];
    expect(out).toContain('FC<VideoListData>');
    expect(out).toContain('FunctionComponent<VideoListData>');
    expect(out).toContain('ComponentType<VideoListData>');
    expect(out).toContain('export const E: VideoListData');
    expect(out).toContain("import type { VideoListData } from './types';");
  });

  it('…and leaves ComponentProps alone, where the renamed name is a TS2344', () => {
    expect(fix.files['src/App.tsx']).toContain('ComponentProps<VideoList>');
    expect(fix.fixed.map((f) => f.line)).not.toContain(5);
  });

  it('the component declaration itself is never touched', () => {
    expect(fix.files['src/App.tsx']).toContain('export function VideoList()');
  });
});

describe('🔴 the advice: one sentence per position, never two fixes for one line', () => {
  it('a props position is told the data name, and told NOT to write typeof', () => {
    const line = advice([at(2, 20)])[0];
    expect(line).toContain('PROPS type argument');
    expect(line).toContain('`VideoListData`');
    expect(line).toContain('Do NOT write `typeof VideoList`');
    expect(line, 'because it compiles — that is the whole danger').toContain('it compiles');
  });

  it('a component position is told typeof IS right, and that the data name would not compile', () => {
    const line = advice([at(5, 25)])[0];
    expect(line).toContain('write `typeof VideoList`');
    expect(line).toContain('would NOT compile');
    expect(line).not.toContain('Do NOT write `typeof');
  });

  it('a plain position keeps the conditional wording it always had', () => {
    const line = advice([at(6, 17)])[0];
    expect(line).toContain('if you mean the data, write `VideoListData`');
    expect(line).toContain('only if you mean the component’s own type'.replace('’', "'"));
  });

  it('🔒 THE MEASURED DEFECT: the five lines no longer share one sentence', () => {
    const lines = advice();
    // Three groups — one per position — not one line naming 2, 3, 4, 5, 6 together.
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => /lines 2, 3, 4\b/.test(l) && l.includes('PROPS type'))).toBe(true);
    expect(lines.some((l) => /line 5\b/.test(l) && l.includes('write `typeof VideoList`'))).toBe(true);
    expect(lines.some((l) => /line 6\b/.test(l) && l.includes('if you mean the data'))).toBe(true);
    // No single line may name a props position and a component position together.
    for (const l of lines) expect(/lines? .*\b5\b/.test(l) && /\b[234]\b/.test(l), l).toBe(false);
  });

  it('without the sources the wording stays conditional — honest, not a guess', () => {
    const blind = typeRenameAdvice(suggestedTypeRenames(ERRS as never, RENAMES));
    expect(blind).toHaveLength(1);
    expect(blind[0]).toContain('if you mean the data');
    expect(blind[0]).not.toContain('PROPS type argument');
  });

  it('every line still names the component and where it is', () => {
    for (const l of advice()) {
      expect(l).toContain('`VideoList` is the COMPONENT (src/App.tsx)');
      expect(l).toContain('src/App.tsx');
    }
  });
});

describe('🧭 the siblings: every message that offers the typeof escape', () => {
  it('the hand-off note carries the same caveat', () => {
    const line = contractRenameHandoffLine(RENAMES);
    expect(line).toContain('typeof');
    expect(line, 'the hand-off has no position to go on, so it names the positions instead')
      .toMatch(/FC<…>|FC<…>|FunctionComponent/);
    expect(line).toContain('PROPS type');
  });

  it('CLASS GUARD: the two sets are disjoint, and the classifier is the only reader of either', () => {
    // Comments stripped: this module's own Q-1028 note names both sets and the wrong plan, so a text guard
    // over the raw source would fail on its own documentation (the trap Q-1081, Q-1021 and Q-1016 each hit).
    const SRC = stripCodeComments(readFileSync(join(__dirname, '../src/server/AgentV3/contractRenames.ts'), 'utf8'));
    for (const set of ['COMPONENT_TAKING_TYPES', 'PROPS_TAKING_TYPES']) {
      expect([...SRC.matchAll(new RegExp(`${set}\\.has\\(`, 'g'))].length, `${set} is read in one place`).toBe(1);
    }
    expect([...SRC.matchAll(/positionOfIdentifier\(/g)].length, 'declared, read by the heal and by typeUsePosition').toBe(3);
    expect(SRC, 'the heal asks the classifier rather than walking the tree itself')
      .toMatch(/const at = positionOfIdentifier\(id\);/);
  });

  it('PRECISION: a props-taking name is NOT in the component-taking set', () => {
    // The literal shape of Q-1028's wrong plan. If someone adds FC to the exclusion set, the heal stops
    // rewriting line 2 — and this fails with the line it stopped fixing.
    const SRC = readFileSync(join(__dirname, '../src/server/AgentV3/contractRenames.ts'), 'utf8');
    const block = SRC.slice(SRC.indexOf('const COMPONENT_TAKING_TYPES'), SRC.indexOf('const PROPS_TAKING_TYPES'));
    for (const n of ['FC', 'FunctionComponent', 'ComponentType']) {
      expect(block, `${n} takes PROPS — adding it here switches off a heal that compiles`).not.toContain(`'${n}'`);
    }
  });
});

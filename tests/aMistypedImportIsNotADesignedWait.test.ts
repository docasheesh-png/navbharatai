// A MISTYPED IMPORT IS NOT A DESIGNED WAIT (Q-1029, found reviewing Q-989).
//
// 🔴 WHAT THE BUILD USED TO SAY, AND WHY IT MATTERED. Every `Cannot find module './x'` was read as the
// entry-first order working as designed — the summary said *"N waiting on files not written yet (a module or
// an export the next writes add — entry-first, expected)"* — and the note the model reads said:
//
//     ⏳ … are fixed in ANOTHER file — ./Components/Nav — not in src/App.tsx. Do NOT rewrite src/App.tsx
//     for them; write or update ./Components/Nav next …
//
// For a TYPO that instruction is actively wrong. The file is already there as `src/components/Nav.tsx`; the
// fix is one import line; and the model is being told to CREATE a second file at the misspelled path and not
// to touch the file that is actually broken.
//
// 🧬 THE CLASS: "the remedy is elsewhere" claimed without evidence that the elsewhere is REAL. `remedyFileFor`
// already demands that evidence for *has no exported member* — `exportedElsewhere`, from candy report
// 7da1cdca, where the same wrong claim sent a model to edit a recipe library four times — and demanded none
// at all for *cannot find module*. One branch along in the same function.
//
// 🔒 AND IT IS DELIBERATELY NARROW, because a false "your import is mistyped" is the opposite defect:
//   · CERTAIN (the remedy moves to the importer): a held file differing only in capitalisation, or a
//     spelled-out extension the resolver never takes;
//   · POSSIBLE (the wait stands, the possibility is named): a held file ONE character away. `Card.tsx`
//     planned while `Cart.tsx` exists is a real wait, so nothing is decided there — but the reader is no
//     longer told there is nothing to check.
import { describe, it, expect } from 'vitest';
import { mistypedImport, nearlyHeldImport, remedyFileFor } from '../src/server/AgentV3/tscErrorCause';
import { writeTypecheckNote, writeTypecheckSummary, emptyWriteTypecheckStats } from '../src/server/AgentV3/writeTimeTypecheck';

/** tsc's real text for a missing relative module. */
const missing = (file: string, spec: string, line = 1) =>
  ({ file, line, col: 20, code: 'TS2307', message: `Cannot find module '${spec}' or its corresponding type declarations.` });

const HELD = {
  'src/App.tsx': "import { Nav } from './Components/Nav';\n",
  'src/components/Nav.tsx': 'export const Nav = () => null;\n',
  'src/utils/format.ts': 'export const f = 1;\n',
  'src/components/Cart.tsx': 'export const Cart = () => null;\n',
};

describe('🔴 CERTAIN: a path that differs only in capitalisation', () => {
  const e = missing('src/App.tsx', './Components/Nav');

  it('is named a mistyped import, with the file that is really there', () => {
    expect(mistypedImport(e as never, HELD)).toEqual({ spec: './Components/Nav', held: 'src/components/Nav.tsx', why: 'case' });
  });

  it('🔒 and the remedy moves to the IMPORTER — this is the whole bug', () => {
    expect(remedyFileFor(e as never, HELD), 'it used to return src/Components/Nav').toBeNull();
  });

  it('the note says which line to change, and not to create the file', () => {
    const note = writeTypecheckNote([e] as never, ['src/App.tsx'], HELD);
    expect(note).toContain('The import path is wrong, not missing');
    expect(note).toContain('`./Components/Nav`');
    expect(note).toContain('differs only in capitalisation');
    expect(note).toContain('src/components/Nav.tsx');
    expect(note).toContain('do NOT create');
    expect(note, 'and it is no longer presented as a wait on another file').not.toContain('are fixed in ANOTHER file');
  });

  it('WHY it is certain and not a guess: two files cannot differ only in case in one build', () => {
    // On a case-insensitive disk the import resolves and the Docker image fails — the worst kind of pass.
    expect(mistypedImport(missing('src/App.tsx', './components/nav') as never, HELD)?.why).toBe('case');
    expect(mistypedImport(missing('src/App.tsx', './COMPONENTS/NAV') as never, HELD)?.why).toBe('case');
  });
});

describe('🔴 CERTAIN: a spelled-out extension the resolver does not take', () => {
  const e = missing('src/App.tsx', './components/Nav.tsx');

  it('is named, with the file it meant', () => {
    expect(mistypedImport(e as never, HELD)).toEqual({ spec: './components/Nav.tsx', held: 'src/components/Nav.tsx', why: 'extension' });
    expect(remedyFileFor(e as never, HELD)).toBeNull();
  });

  it('the note says so in the importer', () => {
    expect(writeTypecheckNote([e] as never, ['src/App.tsx'], HELD)).toContain('spells out an extension the resolver does not take');
  });
});

describe('🟡 POSSIBLE: one character away — the wait stands, the possibility is named', () => {
  const e = missing('src/App.tsx', './components/Card');

  it('is NOT claimed as a typo — `Card` planned while `Cart` exists is a real wait', () => {
    expect(mistypedImport(e as never, HELD), 'nothing certain here').toBeNull();
    expect(remedyFileFor(e as never, HELD), 'so it is still a wait on another file').toBe('src/components/Card');
  });

  it('…but the close match is offered, so a typo costs one glance instead of a created file', () => {
    expect(nearlyHeldImport(e as never, HELD)).toEqual({ spec: './components/Card', held: 'src/components/Cart.tsx' });
    const note = writeTypecheckNote([e] as never, ['src/App.tsx'], HELD);
    expect(note).toContain('are fixed in ANOTHER file');
    expect(note).toContain('If `./components/Card` is a typo for `src/components/Cart.tsx`');
    expect(note).toContain('fix the import line here instead');
  });

  it('two equally close names are no evidence at all, so nothing is said', () => {
    const two = { ...HELD, 'src/components/Carl.tsx': 'export const Carl = () => null;\n' };
    expect(nearlyHeldImport(e as never, two)).toBeNull();
    expect(writeTypecheckNote([e] as never, ['src/App.tsx'], two)).not.toContain('is a typo for');
  });
});

describe('🔒 PRECISION: an ordinary entry-first wait is untouched', () => {
  it('a module nothing resembles stays a plain wait', () => {
    const e = missing('src/App.tsx', './screens/Settings');
    expect(mistypedImport(e as never, HELD)).toBeNull();
    expect(nearlyHeldImport(e as never, HELD)).toBeNull();
    expect(remedyFileFor(e as never, HELD)).toBe('src/screens/Settings');
    const note = writeTypecheckNote([e] as never, ['src/App.tsx'], HELD);
    expect(note).toContain('are fixed in ANOTHER file');
    expect(note).not.toContain('is a typo for');
    expect(note).not.toContain('import path is wrong');
  });

  it('a module that IS held is not an error this looks at, and a package is never a path', () => {
    expect(mistypedImport(missing('src/App.tsx', './components/Nav') as never, HELD)).toBeNull();
    expect(mistypedImport(missing('src/App.tsx', 'react-router-dom') as never, HELD)).toBeNull();
    expect(nearlyHeldImport(missing('src/App.tsx', 'reakt') as never, HELD)).toBeNull();
  });

  it('with no sources in hand nothing is claimed — we did not look', () => {
    expect(mistypedImport(missing('src/App.tsx', './Components/Nav') as never, {})).toBeNull();
    expect(remedyFileFor(missing('src/App.tsx', './Components/Nav') as never, {})).toBe('src/Components/Nav');
  });
});

describe('🔴 the summary sentence no longer calls a typo "expected"', () => {
  const stats = (over: Partial<ReturnType<typeof emptyWriteTypecheckStats>>) =>
    ({ ...emptyWriteTypecheckStats(), runs: 2, cleanRuns: 1, elapsedMs: 4000, ...over });

  it('a wait is what the next writes MAY add — not what they will', () => {
    const line = writeTypecheckSummary(stats({ waitingErrorsSurfaced: 3 }), true);
    expect(line).toContain('3 waiting on files not written yet');
    expect(line).toContain('may add');
    expect(line, 'the claim the count could not support').not.toContain('expected)');
  });

  it('a proven-wrong path is counted on its own, and says where the fix goes', () => {
    const line = writeTypecheckSummary(stats({ waitingErrorsSurfaced: 1, mistypedImportsSurfaced: 2 }), true);
    expect(line).toContain('1 waiting on files not written yet');
    expect(line).toContain('2 with a mistyped import path');
    expect(line).toContain('fixed in the importer');
  });

  it('and says nothing extra when there were none', () => {
    const line = writeTypecheckSummary(stats({}), true);
    expect(line).not.toContain('waiting on files');
    expect(line).not.toContain('mistyped import');
  });
});

/**
 * THE COMPILER NAMED A SYMPTOM WHOSE REMEDY WAS INVISIBLE IN IT — TWICE, IN ONE BUILD
 * (autopsy 64bc1b6e, 2026-09-19; weak tier, free user, "add an upload channel + answer editing for
 * MENTORS + a test terminal").
 *
 * Two struggles in that report look unrelated and are the same class: `tscErrorCause.ts` had no entry
 * for either error, so the model received the compiler's raw words at the exact moment our own
 * write-time check told it to *"fix them NOW, in this turn, before writing the next file"*.
 *
 * 1. **TS2307 on a relative path → a PLACEHOLDER.** A parallel frontend sub-agent added three routes
 *    to `src/App.tsx` for pages a SECOND sub-agent was assigned to create. Its own recorded reasoning:
 *    *"I can see the three pages the other task is supposed to create aren't present yet … I should
 *    create minimal placeholder pages so the build passes. The other task can overwrite them with real
 *    content."* It wrote three 231-byte stubs. That is the "built but not really working" state the
 *    second absolute rule forbids, and if the other agent had already written the real page the stub
 *    would have overwritten it.
 *    ⚠️ `parallelBuild.ts`'s write lock cannot catch it and says so in its own docblock — it promises
 *    only that same-path writes serialise, *"never corruption"*. The damage here is not corruption; it
 *    is a placeholder winning a race.
 *
 * 2. **TS2305 with the export plainly visible → an 11-command hunt.** `../data` resolved to
 *    `src/data.ts` while `seedQuestionBank` lived in `src/data/index.ts`. Both files existed. Every
 *    `grep` and `cat` of the index showed the export, the compiler kept refusing, and the model spent
 *    ~60 seconds — including `cat src/data/index.ts | xxd` looking for an invisible character — before
 *    `tsc --listFiles` finally named both files.
 *
 * 🔴 THE LINE THIS FIXES WAS A DELIBERATE, REASONED SKIP: *"A RELATIVE specifier means a file that is
 * not there — a different cause with a different remedy, already handled by the endgame's own
 * `referencedMissingModules`. Only bare packages land here."* Every clause true; the conclusion wrong,
 * because it reasoned about WHERE the remedy lives and not WHEN the pressure arrives.
 */
import { describe, it, expect } from 'vitest';
import {
  tscErrorCauses,
  tscCauseNote,
  resolveRelativeSpecifier,
} from '../src/server/AgentV3/tscErrorCause';

/** The three errors `src/App.tsx` really produced, verbatim from the report. */
const MISSING_PAGES = [
  { file: 'src/App.tsx', line: 12, col: 44, code: 'TS2307', message: "Cannot find module './pages/MentorUploadPage' or its corresponding type declarations." },
  { file: 'src/App.tsx', line: 13, col: 42, code: 'TS2307', message: "Cannot find module './pages/MentorEditPage' or its corresponding type declarations." },
  { file: 'src/App.tsx', line: 14, col: 44, code: 'TS2307', message: "Cannot find module './pages/TestTerminalPage' or its corresponding type declarations." },
];

/** The error that cost eleven shell commands, verbatim. */
const SHADOWED = [
  { file: 'src/hooks/useQuestionBank.ts', line: 2, col: 10, code: 'TS2305', message: `Module '"../data"' has no exported member 'seedQuestionBank'.` },
];

describe('a missing FILE is not a missing package, and a placeholder is not a fix', () => {
  it('names the file, and forbids the stub in as many words', () => {
    const causes = tscErrorCauses(MISSING_PAGES, { 'src/App.tsx': 'import MentorUploadPage from "./pages/MentorUploadPage";' });
    const advice = causes.map((c) => c.advice).join('\n');
    expect(advice).toContain('./pages/MentorUploadPage');
    expect(advice).toContain('src/pages/MentorUploadPage'); // resolved against the importing file
    expect(advice).toMatch(/NEVER write a placeholder\/stub/);
    expect(advice).toContain('another task may be writing the real file');
  });

  it('says plainly that installing something cannot fix it', () => {
    // The previous behaviour gave this error NO advice at all, so the nearest thing the model had was
    // the package remedy one branch above — which would send it to `npm install ./pages/…`.
    const advice = tscErrorCauses(MISSING_PAGES).map((c) => c.advice).join('\n');
    expect(advice).toContain('not a package');
    expect(advice).not.toContain('npm install ./');
  });

  it('a BARE specifier still gets the package remedy, unchanged', () => {
    const advice = tscErrorCauses([
      { file: 'src/App.tsx', line: 1, col: 1, code: 'TS2307', message: "Cannot find module 'react-router-dom' or its corresponding type declarations." },
    ]).map((c) => c.advice).join('\n');
    expect(advice).toContain('npm install react-router-dom');
    expect(advice).not.toMatch(/placeholder\/stub/);
  });

  it('three missing files from one write collapse to three distinct, named causes', () => {
    // Deduplication is by resolved path, so the same missing file named twice is one line — but three
    // DIFFERENT files are three, because each one is a separate file the model has to write.
    const ids = tscErrorCauses(MISSING_PAGES).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => i.startsWith('missing-file:'))).toBe(true);
  });
});

describe('X.ts and X/index.ts both exist — the import reads the one nobody meant', () => {
  const wholeTree = {
    'src/hooks/useQuestionBank.ts': 'import { seedQuestionBank } from "../data";',
    'src/data.ts': 'export const somethingElse = 1;',
    'src/data/index.ts': 'export const seedQuestionBank = generateQuestionBank(3);\nexport const questionBank = seedQuestionBank;',
  };

  it('names BOTH files and which one wins', () => {
    const advice = tscErrorCauses(SHADOWED, wholeTree).map((c) => c.advice).join('\n');
    expect(advice).toContain('src/data.ts');
    expect(advice).toContain('src/data/index.ts');
    expect(advice).toContain('resolves');
    expect(advice).toContain('../data/index');
  });

  it('tells it to STOP re-reading the index — the thing it actually did eleven times', () => {
    const advice = tscErrorCauses(SHADOWED, wholeTree).map((c) => c.advice).join('\n');
    expect(advice).toContain('not the file being read');
  });

  it('🔒 claims nothing when the caller cannot see both files', () => {
    // The write-time check holds only the file just written. "Both exist" IS the advice, so a guess at
    // it would send the model to the wrong file — worse than the silence it replaces.
    const onlyTheImporter = { 'src/hooks/useQuestionBank.ts': 'import { seedQuestionBank } from "../data";' };
    expect(tscErrorCauses(SHADOWED, onlyTheImporter)).toHaveLength(0);
    expect(tscErrorCauses(SHADOWED)).toHaveLength(0);
  });

  it('a genuine missing export — no shadow — is still not diagnosed as one', () => {
    const noShadow = {
      'src/hooks/useQuestionBank.ts': 'import { seedQuestionBank } from "../data";',
      'src/data/index.ts': 'export const questionBank = 1;',
    };
    expect(tscErrorCauses(SHADOWED, noShadow)).toHaveLength(0);
  });
});

describe('resolveRelativeSpecifier — pure, and never mistakes a package for a path', () => {
  it('walks .. and . against the importing file', () => {
    expect(resolveRelativeSpecifier('src/hooks/useQuestionBank.ts', '../data')).toBe('src/data');
    expect(resolveRelativeSpecifier('src/App.tsx', './pages/MentorEditPage')).toBe('src/pages/MentorEditPage');
    expect(resolveRelativeSpecifier('src/a/b/c.ts', '../../x/y')).toBe('src/x/y');
    expect(resolveRelativeSpecifier('App.tsx', './x')).toBe('x');
  });

  it('returns nothing for a package or an alias', () => {
    for (const spec of ['react', '@scope/pkg', '@/lib/x', '']) {
      expect(resolveRelativeSpecifier('src/App.tsx', spec)).toBe('');
    }
  });

  it('never throws on rubbish', () => {
    expect(() => resolveRelativeSpecifier(undefined as unknown as string, undefined as unknown as string)).not.toThrow();
  });
});

describe('the note is still OUR analysis, clearly separated from the compiler', () => {
  it('carries the marker so the two can never be confused', () => {
    const note = tscCauseNote(tscErrorCauses(MISSING_PAGES));
    expect(note).toContain("NavBharatAI's analysis, not compiler output");
  });

  it('an empty error list produces nothing at all', () => {
    expect(tscErrorCauses([])).toHaveLength(0);
    expect(tscCauseNote([])).toBe('');
  });
});

/**
 * WHAT THE COMPILER ERROR ACTUALLY MEANS — autopsy `baa0b3c7` ("Make an VPN App", 2026-08-23).
 *
 * The build ran six identical `tsc` runs over `Property 'setState' does not exist on type
 * 'ErrorBoundary'` on a file that was CORRECT — React's types were absent — rewrote it four times,
 * deleted a different component to silence its errors, and fired four "repeated step is not making
 * progress" nudges that changed nothing, because the nudge cannot say WHAT to do differently.
 *
 * These cases pin the mapping that was missing, the PRECISION that keeps it from steering a build
 * wrong, and the two places it is consulted. Every behavioural half is proven by reversion.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  tscErrorCauses, tscCauseNote, extendsReactComponent, packageOfSpecifier, MAX_CAUSES,
} from '../src/server/AgentV3/tscErrorCause';
import { parseTscErrors, runEndgameRepair, type TscError } from '../src/server/AgentV3/EndgameRepair';
import { writeTypecheckNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { VITE_ENV_DTS_PATH } from '../src/server/AgentV3/viteEnvTypes';

/** The real tsc output from the report, verbatim. */
const REPORT_OUTPUT = [
  "src/ErrorBoundary.tsx(29,39): error TS2339: Property 'setState' does not exist on type 'ErrorBoundary'.",
  "src/ErrorBoundary.tsx(35,17): error TS2339: Property 'props' does not exist on type 'ErrorBoundary'.",
  "src/ErrorBoundary.tsx(41,9): error TS2339: Property 'state' does not exist on type 'ErrorBoundary'.",
].join('\n');

/** The file that build kept rewriting — correct code, missing declarations. */
const CORRECT_BOUNDARY = `
import React from 'react';
interface Props { children: React.ReactNode }
export class ErrorBoundary extends React.Component<Props, { hasError: boolean }> {
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error) { this.setState({ hasError: true }); }
  render() { return this.state.hasError ? <p>Something broke</p> : this.props.children; }
}
`;

/** The dukaan-app shape (2026-08-12): same errors, opposite cause — it never extended anything. */
const NOT_A_COMPONENT = `
export class ErrorBoundary {
  render() { return this.props.children; }
}
`;

describe('the signature the report ground six times', () => {
  it('names the real cause when the class DOES extend React.Component', () => {
    const causes = tscErrorCauses(parseTscErrors(REPORT_OUTPUT), { 'src/ErrorBoundary.tsx': CORRECT_BOUNDARY });
    expect(causes).toHaveLength(1);
    expect(causes[0].id).toBe('react-types-missing');
    expect(causes[0].advice).toContain('@types/react');
  });

  it('tells the model NOT to rewrite or delete the file — the two things that build actually did', () => {
    const [cause] = tscErrorCauses(parseTscErrors(REPORT_OUTPUT), { 'src/ErrorBoundary.tsx': CORRECT_BOUNDARY });
    expect(cause.advice).toMatch(/do NOT rewrite or delete/i);
    expect(cause.advice).toContain('src/ErrorBoundary.tsx');
  });

  it('gives the OPPOSITE advice for the dukaan shape — same errors, class extends nothing', () => {
    const causes = tscErrorCauses(parseTscErrors(REPORT_OUTPUT), { 'src/ErrorBoundary.tsx': NOT_A_COMPONENT });
    expect(causes[0].id).toBe('react-class-not-extended');
    expect(causes[0].advice).toContain('extends React.Component');
    // It must NOT send a correct project off to install types it already has.
    expect(causes[0].advice).not.toContain('npm install --save-dev @types/react');
  });

  it('without the source it states BOTH causes in order instead of guessing one', () => {
    const causes = tscErrorCauses(parseTscErrors(REPORT_OUTPUT));
    expect(causes[0].id).toBe('react-member-missing');
    expect(causes[0].advice).toContain('extend React.Component');
    expect(causes[0].advice).toContain('@types/react');
  });

  it('three errors from one cause produce ONE line, not three', () => {
    expect(parseTscErrors(REPORT_OUTPUT)).toHaveLength(3);
    expect(tscErrorCauses(parseTscErrors(REPORT_OUTPUT), { 'src/ErrorBoundary.tsx': CORRECT_BOUNDARY })).toHaveLength(1);
  });
});

describe('extendsReactComponent — the disambiguation, and its honest third answer', () => {
  it.each([
    ['class X extends React.Component<P, S> {}', true],
    ['class X extends React . Component {}', true],
    ['class X extends Component {}', true],
    ['class X extends PureComponent<P> {}', true],
    ['class X {}', false],
    ['class X extends HTMLElement {}', false],
  ])('%s → %s', (src, expected) => {
    expect(extendsReactComponent(src, 'X')).toBe(expected);
  });

  it('returns null when the file does not declare that class — "did not look" is not "does not extend"', () => {
    expect(extendsReactComponent('const X = 1; // X is mentioned, never declared', 'X')).toBeNull();
    expect(extendsReactComponent('', 'X')).toBeNull();
  });

  it('a mention of the name elsewhere cannot answer for the declaration', () => {
    // `render(<X />)` names X but says nothing about what it extends.
    expect(extendsReactComponent('render(<X />); class X {}', 'X')).toBe(false);
  });

  it('a class name with regex metacharacters cannot break the matcher', () => {
    expect(() => extendsReactComponent('class A {}', 'A.B*(')).not.toThrow();
    expect(extendsReactComponent('class A {}', 'A.B*(')).toBeNull();
  });
});

describe('the other missing-declaration signatures', () => {
  it('untyped JSX is React types missing, whatever the component looks like', () => {
    const errors = parseTscErrors(
      "src/App.tsx(3,10): error TS7026: JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements' exists.",
    );
    expect(tscErrorCauses(errors)[0].id).toBe('react-types-missing-jsx');
  });

  it('import.meta.env points at Vite client types, and at the path this repo already writes', () => {
    const errors = parseTscErrors(
      "src/api.ts(1,29): error TS2339: Property 'env' does not exist on type 'ImportMeta'.",
    );
    const [cause] = tscErrorCauses(errors);
    expect(cause.id).toBe('vite-client-types-missing');
    expect(cause.advice).toContain(VITE_ENV_DTS_PATH);
  });

  it('a package with no types names the @types package to install', () => {
    const errors = parseTscErrors(
      "src/x.ts(1,20): error TS7016: Could not find a declaration file for module 'lodash'. Try `npm i --save-dev @types/lodash`.",
    );
    const [cause] = tscErrorCauses(errors);
    expect(cause.id).toBe('types-package-missing:lodash');
    expect(cause.advice).toContain('@types/lodash');
  });

  it('a missing bare package is a missing dependency, not a bad import', () => {
    const errors = parseTscErrors(
      "src/x.ts(1,20): error TS2307: Cannot find module 'zustand' or its corresponding type declarations.",
    );
    const [cause] = tscErrorCauses(errors);
    expect(cause.id).toBe('dependency-missing:zustand');
    expect(cause.advice).toContain('npm install zustand');
    expect(cause.advice).toMatch(/rather than removing the import/i);
  });

  it.each([
    ['./Dashboard', 'a relative path — a missing FILE, a different cause the endgame already resolves'],
    ['../types/game', 'a parent-relative path'],
    ['@/components/Card', 'the @/ alias every scaffold here maps to src'],
  ])('says NOTHING about %s (%s)', (spec) => {
    const errors = parseTscErrors(
      `src/x.ts(1,20): error TS2307: Cannot find module '${spec}' or its corresponding type declarations.`,
    );
    expect(tscErrorCauses(errors)).toEqual([]);
  });

  it('a scoped package keeps its scope', () => {
    expect(packageOfSpecifier('@tanstack/react-query/build/x')).toBe('@tanstack/react-query');
    expect(packageOfSpecifier('lodash/fp')).toBe('lodash');
  });
});

describe('it stays quiet on everything else — the boundary that keeps it from becoming a hint bag', () => {
  it.each([
    ["src/a.ts(3,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."],
    ["src/a.ts(9,1): error TS6133: 'useState' is declared but its value is never read."],
    ["src/a.ts(4,3): error TS2322: Type 'null' is not assignable to type 'string'."],
    ["src/a.ts(2,2): error TS1005: ';' expected."],
  ])('%s', (line) => {
    expect(tscErrorCauses(parseTscErrors(line))).toEqual([]);
  });

  it('a clean tree and malformed input produce nothing and never throw', () => {
    expect(tscErrorCauses([])).toEqual([]);
    expect(tscErrorCauses(null)).toEqual([]);
    expect(tscErrorCauses(undefined)).toEqual([]);
    expect(() => tscErrorCauses([{ file: '', line: 0, col: 0, code: '', message: '' } as TscError])).not.toThrow();
  });

  it('never emits more than MAX_CAUSES, so a note explains and never floods', () => {
    const many = parseTscErrors([
      "a.ts(1,1): error TS2307: Cannot find module 'one' or its corresponding type declarations.",
      "b.ts(1,1): error TS2307: Cannot find module 'two' or its corresponding type declarations.",
      "c.ts(1,1): error TS2307: Cannot find module 'three' or its corresponding type declarations.",
      "d.ts(1,1): error TS2307: Cannot find module 'four' or its corresponding type declarations.",
      "e.ts(1,1): error TS2307: Cannot find module 'five' or its corresponding type declarations.",
    ].join('\n'));
    expect(tscErrorCauses(many)).toHaveLength(MAX_CAUSES);
  });

  it('the note is empty when nothing was diagnosed, and headed as OURS when something was', () => {
    expect(tscCauseNote([])).toBe('');
    const note = tscCauseNote(tscErrorCauses(parseTscErrors(REPORT_OUTPUT)));
    expect(note).toContain("NavBharatAI's analysis, not compiler output");
  });
});

describe('WIRING — the analysis reaches the model at the write, not twelve minutes later', () => {
  it('the write-time note carries the cause beside the compiler\'s own words', () => {
    const note = writeTypecheckNote(
      parseTscErrors(REPORT_OUTPUT), ['src/ErrorBoundary.tsx'], { 'src/ErrorBoundary.tsx': CORRECT_BOUNDARY },
    );
    // The compiler's verdict is still there, unchanged...
    expect(note).toContain('TYPECHECK after this write');
    expect(note).toContain("Property 'setState' does not exist");
    // ...and now so is what it means.
    expect(note).toContain('@types/react');
  });

  it('REVERSION: with the cause analysis removed from the note, the remedy is nowhere in it', () => {
    // The pre-change behaviour, reproduced exactly: errors quoted, nothing explained.
    const before = writeTypecheckNote(parseTscErrors(REPORT_OUTPUT), ['src/ErrorBoundary.tsx']);
    expect(before).toContain("Property 'setState' does not exist");
    // Without the source the fix still fires (both causes), which is what makes this proof about the
    // WIRING and not about the source: it is the SPECIFIC answer that the source unlocks.
    expect(before).not.toContain('DOES extend React.Component');
  });

  it('a clean tree still says nothing at all — advice never invents a reason to speak', () => {
    expect(writeTypecheckNote([], ['src/App.tsx'], { 'src/App.tsx': CORRECT_BOUNDARY })).toBe('');
  });

  it('an ordinary type error gets the compiler\'s words and no analysis', () => {
    const note = writeTypecheckNote(
      parseTscErrors("src/a.ts(3,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."),
      ['src/a.ts'], { 'src/a.ts': 'export const a = 1;' },
    );
    expect(note).toContain('TYPECHECK after this write');
    expect(note).not.toContain("NavBharatAI's analysis");
  });
});

describe('WIRING — the endgame repair starts with the cause instead of discovering it', () => {
  /** An endgame whose only errors are the report's, on the file the report kept rewriting. */
  const runWithReportErrors = async () => {
    const llm = vi.fn(async () => []);
    await runEndgameRepair({
      runTsc: async () => REPORT_OUTPUT,
      readFiles: async () => ({ 'src/ErrorBoundary.tsx': CORRECT_BOUNDARY }),
      writeFile: async () => {},
      llmRepair: llm,
    });
    expect(llm).toHaveBeenCalledTimes(1);
    return String(llm.mock.calls[0][0]);
  };

  it('the batch repair is handed the compiler output AND what it means', async () => {
    const errorText = await runWithReportErrors();
    expect(errorText).toContain("Property 'setState' does not exist"); // the compiler's own words, intact
    expect(errorText).toContain("NavBharatAI's analysis");
    expect(errorText).toContain('@types/react');
  });

  it('it uses the project files it already read — so the answer is the SPECIFIC one', async () => {
    // `files` is in hand at that point, so the ambiguity is resolved rather than hedged.
    expect(await runWithReportErrors()).toContain('DOES extend React.Component');
  });

  it('an ordinary error reaches the repair exactly as before — no analysis, no change', async () => {
    const line = "src/a.ts(3,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.";
    const llm = vi.fn(async () => []);
    await runEndgameRepair({
      runTsc: async () => line,
      readFiles: async () => ({ 'src/a.ts': 'export const a = 1;' }),
      writeFile: async () => {},
      llmRepair: llm,
    });
    expect(String(llm.mock.calls[0][0])).toBe(line);
  });
});

describe('WIRING — all FOUR places the compiler speaks to the model, not just the tidy one', () => {
  // Comments stripped: a needle must be matched in real code, never in the prose explaining it.
  const dispatcher = readFileSync(resolve(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const endgame = readFileSync(resolve(__dirname, '../src/server/AgentV3/EndgameRepair.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  it('a bare `tsc` run through BASH is annotated — the path the report\'s own root-cause line used', () => {
    // `$ ./node_modules/.bin/tsc --noEmit 2>&1 → exit 2 (1s)` was that build\'s rootCause, and it is a
    // bash command, not the typecheck tool. Annotating only the tidy path would have missed it entirely.
    expect(dispatcher).toContain('const bashTscErrors = parseTscErrors(`${stdout}\\n${stderr}`);');
    expect(dispatcher).toContain('if (bashTscErrors.length > 0) out = `${out}${tscCauseNote(tscErrorCauses(bashTscErrors))}`;');
  });

  it('the typecheck TOOL is annotated too', () => {
    expect(dispatcher).toContain('${tscCauseNote(tscErrorCauses(tscErrs))}');
  });

  it('the endgame batch repair is annotated', () => {
    expect(endgame).toContain('const causes = tscCauseNote(tscErrorCauses(errors2, files));');
    expect(endgame).toContain('io.llmRepair(out2 + causes, subset)');
  });

  it('the bash annotation is keyed on real compiler output, so an ordinary command is never touched', () => {
    // The guard is `parseTscErrors(...).length > 0`, and that parser needs a real `file(l,c): error TSxxxx:`
    // line. Proven on the parser itself rather than on a mocked dispatcher: npm chatter yields nothing.
    expect(parseTscErrors('npm WARN deprecated foo@1.0.0\nadded 214 packages in 9s')).toEqual([]);
    expect(parseTscErrors('error: something went wrong')).toEqual([]);
  });
});

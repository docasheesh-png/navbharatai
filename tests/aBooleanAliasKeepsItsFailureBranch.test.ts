import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOLEAN_DISCRIMINANT_RULE, repairBooleanDiscriminants } from '../src/server/AgentV3/booleanDiscriminant';
import { endgameDeterministicPass, type TscError } from '../src/server/AgentV3/EndgameRepair';
import { fileSystemPrompt, repairSystemPrompt, runSimpleBuild, salvageReadInstruction, repairCompilerFiles } from '../src/server/AgentV3/SimpleBuilder';
import { oneShotSystemPrompt } from '../src/server/AgentV3/OneShotBuilder';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { tscErrorCauses } from '../src/server/AgentV3/tscErrorCause';

const APP = readFileSync('tests/fixtures/calculator9fba77d7.tsx.txt', 'utf8');
const TYPES = 'export type CalcOutcome = { ok: true; value: number; display: string } | { ok: false; error: string };\nexport interface AppProps {}';
const REPORT_FILES = {
  'src/App.tsx': APP,
  'src/types.ts': TYPES,
  'src/calc.ts': 'import type { CalcOutcome } from "./types"; export declare function compute(expression: string): CalcOutcome;',
  'src/data.ts': 'export const MAX_EXPRESSION_LENGTH = 60;',
  'src/react-shim.d.ts': 'declare module "react" { export function useMemo<T>(fn: () => T, deps: unknown[]): T; export function useState<T>(initial: T): [T, (next: T | ((prior: T) => T)) => void]; }',
};

/** Real compiler diagnostics, including an alias exactly as production printed it. No transpile-only proof. */
function compile(files: Record<string, string>, strictNullChecks = false): TscError[] {
  const virtual = new Map(Object.entries(files).map(([path, text]) => [posix.resolve('/virtual', path), text]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
    strict: false, strictNullChecks, skipLibCheck: true, types: [], noEmit: true };
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = { ...base,
    fileExists: path => virtual.has(path) || base.fileExists(path),
    readFile: path => virtual.get(path) ?? base.readFile(path),
    directoryExists: path => path.startsWith('/virtual') || base.directoryExists?.(path) === true,
    getSourceFile: (path, target, onError) => virtual.has(path)
      ? ts.createSourceFile(path, virtual.get(path)!, target, true)
      : base.getSourceFile(path, target, onError),
  };
  const program = ts.createProgram([...virtual.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).map(diagnostic => {
    const point = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return { file: diagnostic.file?.fileName.replace(/^\/virtual\//, '') ?? '',
      line: (point?.line ?? 0) + 1, col: (point?.character ?? 0) + 1,
      code: `TS${diagnostic.code}`, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
  });
}
const compilerText = (files: Record<string, string>) => compile(files)
  .map(error => `${error.file}(${error.line},${error.col}): error ${error.code}: ${error.message}`).join('\n');
afterEach(() => vi.unstubAllEnvs());

describe('calculator 9fba77d7: an imported boolean union alias is repaired in place', () => {
  it('reproduces line 78, fixes only its guard, and compiles in both null-checking modes', () => {
    const errors = compile(REPORT_FILES);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'src/App.tsx', line: 78, code: 'TS2339' });
    expect(errors[0].message).toContain("Property 'error' does not exist on type 'CalcOutcome'");
    const result = repairBooleanDiscriminants(REPORT_FILES, errors);
    expect(result.fixed).toHaveLength(1);
    expect(result.files['src/App.tsx']).toBe(APP.replace('      if (outcome.ok) {', '      if (outcome.ok === true) {'));
    expect(result.files['src/types.ts']).toBe(TYPES);
    expect(REPORT_FILES['src/App.tsx']).toBe(APP);
    expect(compile(result.files)).toEqual([]);
    expect(compile(result.files, true)).toEqual([]);
    // The original source remains the negative control; a cast/optional field cannot satisfy this.
    expect(compile(REPORT_FILES)).toEqual(errors);
  });

  it('the shared deterministic pass reaches it before a paid repair', async () => {
    const result = await endgameDeterministicPass(REPORT_FILES, compile(REPORT_FILES));
    expect(result.changedPaths).toEqual(['src/App.tsx']);
    expect(result.fixes.some(fix => fix.includes('outcome.ok === true'))).toBe(true);
    expect(compile(result.files)).toEqual([]);
  });

  it('the one-shot/shared repair boundary does not spend a model repair allowance on this guard', async () => {
    const generate = vi.fn(async () => '');
    const beforeModel = vi.fn();
    const fixed = await repairCompilerFiles({ framework: 'vite-react', prompt: 'Build a calculator',
      errors: compilerText(REPORT_FILES), currentFiles: Object.entries(REPORT_FILES).map(([path, content]) => ({ path, content })),
      weakRepair: true, generate, beforeModel });
    expect(fixed.map(file => file.path)).toEqual(['src/App.tsx']);
    expect(compile({ ...REPORT_FILES, ...Object.fromEntries(fixed.map(file => [file.path, file.content])) })).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(beforeModel).not.toHaveBeenCalled();
  });

  it('the real fast-lane orchestration re-verifies and finishes without calling its model repair', async () => {
    vi.stubEnv('AGENTV3_ENDGAME_REPAIR', 'on');
    const workspace: Record<string, string> = {};
    const repair = vi.fn(async () => []);
    const result = await runSimpleBuild({
      prompt: 'Make a simple calculator app that I can upload on playstore', framework: 'vite-react',
      scaffoldPaths: ['index.html'], shareContract: false,
      generate: async (_system, user) => {
        if (user.includes('Plan the file list')) return Object.keys(REPORT_FILES).map(path => `${path} :: calculator source`).join('\n');
        const path = /write THIS file in full:\s*\n\s*([^\n]+)/.exec(user)?.[1]?.trim();
        if (!path || !(path in REPORT_FILES)) throw new Error('Unexpected generation request');
        return `<<<FILE ${path}>>>\n${REPORT_FILES[path as keyof typeof REPORT_FILES]}\n<<<ENDFILE>>>`;
      },
      writeFiles: async files => {
        for (const file of files) workspace[file.path] = file.content;
        return files.map(file => ({ path: file.path, ok: true }));
      },
      verify: async () => { const errors = compilerText(workspace); return { ok: !errors, errors, ran: true }; },
      repair,
    });
    expect(result.ok).toBe(true);
    expect(repair).not.toHaveBeenCalled();
    expect(compile(workspace)).toEqual([]);
    expect(workspace['src/App.tsx']).toContain('if (outcome.ok === true)');
    expect(workspace['src/App.tsx']).toContain('className="calc-result"');
  });
});

describe('the repair requires actual boolean discriminants and the same receiver symbol', () => {
  it.each([
    ['negated', 'if (!r.ok) { return r.error; } return r.value;', 'if (r.ok === false)'],
    ['parenthesized', 'if ((r.ok)) { return r.value; } else { return r.error; }', 'if (r.ok === true)'],
  ])('%s guards use the correct literal', (_name, body, expected) => {
    const files = { 'src/main.ts': `${TYPES}\nexport function show(r: CalcOutcome) { ${body.replaceAll('r.value', 'r.display')} }` };
    const errors = compile(files);
    expect(errors.length).toBeGreaterThan(0);
    const result = repairBooleanDiscriminants(files, errors);
    expect(result.files['src/main.ts']).toContain(expected);
    expect(compile(result.files)).toEqual([]);
  });

  it.each([
    `${TYPES}\nexport function show(r: CalcOutcome) { if (r.ok) return r.display; else return r.missing; }`,
    `type R = { ok: 'yes'; display: string } | { ok: ''; error: string }; export function show(r: R) { if (r.ok) return r.error; }`,
    `${TYPES}\nexport function show(r: CalcOutcome) { if (r.ok) return r.display; else { const r = { unrelated: true }; return r.error; } }`,
    `${TYPES}\nexport function show(r: CalcOutcome) { if (r.ok === true) return r.error; }`,
  ])('leaves a genuinely missing member, non-boolean flag, shadowed receiver or explicit guard alone', source => {
    const files = { 'src/main.ts': source };
    const errors = compile(files);
    expect(errors.length).toBeGreaterThan(0);
    expect(repairBooleanDiscriminants(files, errors)).toEqual({ files, fixed: [] });
  });

  it('does not mutate arbitrary code when there are no compiler errors', () => {
    expect(repairBooleanDiscriminants(REPORT_FILES, [])).toEqual({ files: REPORT_FILES, fixed: [] });
  });

  it('both positive and negative alias diagnostics receive actionable advice', () => {
    const error = compile(REPORT_FILES)[0];
    expect(tscErrorCauses([error], REPORT_FILES).find(cause => cause.id === 'union-not-narrowed-nonstrict')?.advice)
      .toContain('outcome.ok === true');
    expect(fileSystemPrompt('vite-react')).toContain(BOOLEAN_DISCRIMINANT_RULE);
    expect(repairSystemPrompt('vite-react')).toContain(BOOLEAN_DISCRIMINANT_RULE);
    expect(oneShotSystemPrompt('vite-react')).toContain(BOOLEAN_DISCRIMINANT_RULE);
    expect(architectSystemPrompt('vite-react')).toContain(BOOLEAN_DISCRIMINANT_RULE);
    expect(tscErrorCauses([error]).map(cause => cause.id)).not.toContain('union-not-narrowed-nonstrict');
    const brief = salvageReadInstruction(compilerText(REPORT_FILES), REPORT_FILES);
    expect(brief).toContain('src/App.tsx');
    expect(brief).toContain('outcome.ok === true');
    expect(brief).toContain('before surveying unchanged files');
    expect(salvageReadInstruction(undefined, REPORT_FILES)).toBe('READ these files first and');
  });
});

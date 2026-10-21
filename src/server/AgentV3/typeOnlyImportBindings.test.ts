import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { fixTypeOnlyValueImports } from './ImportExportReconcile';
import { createExportCapabilities } from './exportCapabilities';
import { analyzeImportExports, exportRegenTargets } from './ImportExportAnalysis';
import { analyzeJsxComponents } from './JsxComponentAnalysis';
import { endgameDeterministicPass, runEndgameRepair } from './EndgameRepair';

function compile(files: Record<string, string>): { codes: number[]; text: string } {
  const model = createExportCapabilities(files);
  const options: ts.CompilerOptions = { noLib: true, noEmit: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext };
  const host: ts.CompilerHost = { getSourceFile: p => p in files ? ts.createSourceFile(p, files[p], ts.ScriptTarget.Latest, true) : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: p => p in files, readFile: p => files[p], getCanonicalFileName: p => p, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, importer) => names.map(s => { const p = model.resolve(importer, s); return p ? { resolvedFileName: p } : undefined; }) };
  const all = ts.getPreEmitDiagnostics(ts.createProgram(Object.keys(files), options, host)).filter(d => d.code !== 2318);
  return { codes: all.map(d => d.code), text: all.map(d => {
    const at = d.file?.getLineAndCharacterOfPosition(d.start ?? 0);
    return `${d.file?.fileName ?? 'compiler'}(${(at?.line ?? 0) + 1},${(at?.character ?? 0) + 1}): error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  }).join('\n') };
}
function diagnostics(files: Record<string, string>): number[] {
  return compile(files).codes;
}
function execute(files: Record<string, string>) {
  const model = createExportCapabilities(files);
  const load = (path: string): Record<string, any> => {
    const output = ts.transpileModule(files[path], { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const context = { exports: {}, React: { createElement: (component: unknown) => component }, require: (s: string) => load(model.resolve(path, s)!) };
    runInNewContext(output, context);
    return context.exports;
  };
  return load('src/App.tsx').App();
}
const producer = 'export const Icon = () => null; export default Icon;';
const consumers = [
  ['default JSX', 'import type CalendarIcon from "./Icons"; export const App = () => <CalendarIcon/>;'],
  ['default call', 'import type CalendarIcon from "./Icons"; export const App = () => CalendarIcon();'],
  ['namespace JSX', 'import type * as Icons from "./Icons"; export const App = () => <Icons.Icon/>;'],
  ['namespace property call', 'import type * as Icons from "./Icons"; export const App = () => Icons.Icon();'],
  ['namespace literal key', 'import type * as Icons from "./Icons"; export const App = () => Icons["Icon"]();'],
] as const;
describe('type-only imports need runtime bindings for actual value uses', () => {
  it.each(consumers)('repairs %s only with real local export proof', async (_name, consumer) => {
    const files = { 'src/Icons.tsx': producer, 'src/App.tsx': consumer };
    expect(diagnostics(files)).toContain(1361);
    expect(() => execute(files)).toThrow(/not defined/);
    const result = await fixTypeOnlyValueImports(files);
    expect(result.fixes).toHaveLength(1);
    expect(diagnostics(result.files)).toEqual([]);
    expect(() => execute(result.files)).not.toThrow();
    expect((await fixTypeOnlyValueImports(result.files)).fixes).toEqual([]);
    expect((await analyzeJsxComponents(result.files)).ok).toBe(true);
    // An erased consumer is not a missing producer export; it must not trigger producer regeneration.
    expect(exportRegenTargets(await analyzeImportExports(files), new Set(Object.keys(files)))).toEqual([]);
  });
  it.each(consumers)('the shared endgame repairs %s after later writes too', async (_name, consumer) => {
    const files = { 'src/Icons.tsx': producer, 'src/App.tsx': consumer };
    const result = await endgameDeterministicPass(files, []);
    expect(result.changedPaths).toEqual(['src/App.tsx']);
    expect(diagnostics(result.files)).toEqual([]);
  });
  it.each([consumers[0], consumers[2]])('endgame I/O lands and verifies %s without a model call', async (_name, consumer) => {
    const files: Record<string, string> = { 'src/Icons.tsx': producer, 'src/App.tsx': consumer };
    const writes: string[] = [];
    const result = await runEndgameRepair({
      runTsc: async () => compile(files).text,
      readFiles: async () => ({ ...files }),
      writeFile: async (path, content) => { writes.push(path); files[path] = content; },
      llmRepair: async () => { throw new Error('A proven binding fix must not call a model'); },
    });
    expect(writes).toEqual(['src/App.tsx']);
    expect(result.clean).toBe(true);
    expect(result.deterministicFixes).toHaveLength(1);
    expect(() => execute(files)).not.toThrow();
  });
  it.each([consumers[0], consumers[2]])('endgame rolls %s back if its verification cannot run', async (_name, consumer) => {
    const files: Record<string, string> = { 'src/Icons.tsx': producer, 'src/App.tsx': consumer };
    const writes: string[] = [];
    let checks = 0;
    const result = await runEndgameRepair({
      runTsc: async () => { if (checks++ > 0) throw new Error('compiler unavailable'); return compile(files).text; },
      readFiles: async () => ({ ...files }),
      writeFile: async (path, content) => { writes.push(content); files[path] = content; },
    });
    expect(writes).toHaveLength(2);
    expect(writes[0]).not.toBe(consumer);
    expect(writes[1]).toBe(consumer);
    expect(files['src/App.tsx']).toBe(consumer);
    expect(result.clean).toBe(false);
    expect(result.tscUnverified).toBe(true);
  });
  it.each([
    'import type CalendarIcon from "./Icons"; export type T = typeof CalendarIcon;',
    'import type * as Icons from "./Icons"; export type T = typeof Icons.Icon;',
    'import type CalendarIcon from "./Icons"; export function App(CalendarIcon: any) { return <CalendarIcon/>; }',
    'import type * as Icons from "./Icons"; export function App(Icons: any) { return <Icons.Icon/>; }',
    'import CalendarIcon from "./Icons"; export const App = () => <CalendarIcon/>;',
    'import * as Icons from "./Icons"; export const App = () => <Icons.Icon/>;',
    'import type * as Icons from "./Icons"; export const App = (key: string) => Icons[key];',
    'import type * as Icons from "./Icons"; export const App = () => Icons;',
  ])('preserves type uses, shadows, ordinary imports and unproven dynamic access: %s', async consumer => {
    const files = { 'src/Icons.tsx': producer, 'src/App.tsx': consumer };
    expect(await fixTypeOnlyValueImports(files)).toEqual({ files, fixes: [] });
  });
  it.each([
    ['src/Icons.d.ts', 'export declare const Icon: () => null; export default Icon;'],
    ['src/Icons.ts', 'export interface Icon {} export default Icon;'],
    ['src/Icons.ts', 'export { Icon, Icon as default } from "external-icons";'],
    ['src/Icons.ts', 'export * from "external-icons";'],
    ['src/Icons.ts', 'export declare const Icon: () => null; export default Icon;'],
  ])('does not promote an unknown or erased producer: %s %s', async (path, content) => {
    for (const consumer of [consumers[0][1], consumers[2][1]]) {
      const files = { [path]: content, 'src/App.tsx': consumer };
      expect(await fixTypeOnlyValueImports(files)).toEqual({ files, fixes: [] });
    }
  });
  it.each([
    'import type Widget from "./types"; const Widget = () => null; export const App=()=> <Widget/>;',
    'import type { Widget } from "./types"; const Widget = () => null; export const App=()=> <Widget/>;',
  ])('does not promote a type import whose same-named local value owns the JSX use: %s', async consumer => {
    const files = { 'src/types.ts': 'export interface Widget {} export default Widget;', 'src/App.tsx': consumer };
    expect(diagnostics(files)).toEqual([]);
    expect(() => execute(files)).not.toThrow();
    expect((await analyzeJsxComponents(files)).ok).toBe(true);
    expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
  });
  it('does not let a real namespace member authorize a missing or type-only member', async () => {
    for (const member of ['Missing', 'OnlyType']) {
      const files = { 'src/Icons.ts': 'export const Icon = () => null; export interface OnlyType {}',
        'src/App.tsx': `import type * as Icons from './Icons'; export const App=()=> <><Icons.Icon/><Icons.${member}/></>;` };
      expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
    }
  });
  it('leaves a namespace member with ambiguous star providers unchanged', async () => {
    const files = { 'src/a.ts': 'export const Icon = () => null;', 'src/b.ts': 'export const Icon = () => null;',
      'src/Icons.ts': 'export * from "./a"; export * from "./b";', 'src/App.tsx': consumers[2][1] };
    expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
  });
  it('does not act on a parse-invalid producer', async () => {
    const files = { 'src/Icons.ts': 'export default function Icon( {', 'src/App.tsx': consumers[0][1] };
    expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
  });
  it('keeps namespace bindings out of named-export consumers unless requested', () => {
    const model = createExportCapabilities({ 'src/App.tsx': consumers[2][1], 'src/Icons.tsx': producer });
    expect(model.importsOf('src/App.tsx')).toEqual([]);
    expect(model.importsOf('src/App.tsx', true)[0]).toMatchObject({ namespace: true, readsValue: true, runtimeMembers: ['Icon'] });
  });
});

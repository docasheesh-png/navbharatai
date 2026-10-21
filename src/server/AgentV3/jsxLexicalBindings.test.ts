import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { analyzeJsxComponents } from './JsxComponentAnalysis';

function compile(src: string): { diagnostics: number[]; output: string } {
  const path = 'src/App.tsx';
  const options: ts.CompilerOptions = { noLib: true, noEmit: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext };
  const host: ts.CompilerHost = { getSourceFile: p => p === path ? ts.createSourceFile(p, src, ts.ScriptTarget.Latest, true) : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: p => p === path, readFile: p => p === path ? src : undefined,
    getCanonicalFileName: p => p, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' };
  return { diagnostics: ts.getPreEmitDiagnostics(ts.createProgram([path], options, host)).map(d => d.code).filter(c => c !== 2318),
    output: ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText };
}
function execute(src: string) {
  const context = { exports: {} as { App?: () => unknown }, React: { createElement: (component: unknown) => component } };
  runInNewContext(compile(src).output, context);
  return context.exports.App!();
}

const leakedBindings = [
  'function Other(CalendarIcon: any) {}',
  'function Other({ CalendarIcon }: any) {}',
  'function Other() { const CalendarIcon = () => null; }',
  'if (true) { const CalendarIcon = () => null; }',
  'try {} catch (CalendarIcon) {}',
  'for (const CalendarIcon of []) {}',
  'const other = { render(CalendarIcon: any) {} };',
];
describe('JSX names belong to their actual lexical scope', () => {
  it.each(leakedBindings)('does not let an unrelated declaration hide an undefined tag: %s', async declaration => {
    const src = `${declaration} export const App = () => <CalendarIcon/>;`;
    expect(compile(src).diagnostics).toContain(2304);
    expect(() => execute(src)).toThrow(/CalendarIcon is not defined/);
    expect((await analyzeJsxComponents({ 'src/App.tsx': src })).undefinedComponents.map(c => c.component)).toEqual(['CalendarIcon']);
  });
  it('checks the scope of a member-expression root too', async () => {
    const src = 'function Other(Icons: any) {} export const App = () => <Icons.CalendarIcon/>;';
    expect((await analyzeJsxComponents({ 'src/App.tsx': src })).undefinedComponents[0]?.component).toBe('Icons.CalendarIcon');
  });
  it('accepts a named function expression within its own body, not outside', async () => {
    const src = 'export const App = function Branch() { return <Branch/>; };';
    expect(compile(src).diagnostics).toEqual([]);
    expect(execute(src)).toBeTypeOf('function');
    expect((await analyzeJsxComponents({ 'src/App.tsx': src })).ok).toBe(true);
    expect((await analyzeJsxComponents({ 'src/App.tsx': `${src} export const Outside = () => <Branch/>;` })).undefinedComponents.map(c => c.component)).toEqual(['Branch']);
  });
  it.each([
    'const CalendarIcon = () => null; export const App = () => <CalendarIcon/>;',
    'export function App({ CalendarIcon }: any) { return <CalendarIcon/>; }',
    'export function App() { if (true) { const CalendarIcon = () => null; return <CalendarIcon/>; } return null; }',
    'export function App({ Icons }: any) { return <Icons.CalendarIcon/>; }',
    'export function App() { if (true) { var CalendarIcon = () => null; } return <CalendarIcon/>; }',
    'export const App = () => <calendar-icon/>;',
    'import { CalendarIcon as Icon } from "icons"; export const App = () => <Icon/>;',
    'import * as Icons from "icons"; export const App = () => <Icons.CalendarIcon/>;',
    'declare const ExternalWidget: any; export const App = () => <ExternalWidget/>;',
    'interface Widget {} const Widget = () => null; export const App = () => <Widget/>;',
  ])('preserves valid bindings, intrinsic tags and ambient declarations: %s', async src => {
    expect((await analyzeJsxComponents({ 'src/App.tsx': src })).ok).toBe(true);
  });
  it.each(['import type Icon from "icons";', 'import type { Icon } from "icons";', 'import { type Icon } from "icons";'])('type-only imports do not bind a runtime JSX value: %s', async declaration => {
    expect((await analyzeJsxComponents({ 'src/App.tsx': `${declaration} export const App=()=> <Icon/>;` })).undefinedComponents[0]?.component).toBe('Icon');
  });
  it('does not turn a type-only namespace into a runtime JSX binding', async () => {
    expect((await analyzeJsxComponents({ 'src/App.tsx': 'import type * as Icons from "icons"; export const App=()=> <Icons.Icon/>;' })).ok).toBe(false);
  });
  it('does not borrow a same-named global from a separately loaded script file', async () => {
    const result = await analyzeJsxComponents({
      'src/App.tsx': 'const App = () => <Widget/>;',
      'src/other.tsx': 'const Widget = () => <div/>;',
    });
    expect(result.undefinedComponents.map(c => [c.file, c.component])).toEqual([['src/App.tsx', 'Widget']]);
  });
  it('does not merge a local type-only namespace with a foreign runtime global', async () => {
    const result = await analyzeJsxComponents({
      'src/App.tsx': 'interface Widget {} const App = () => <Widget/>;',
      'src/other.tsx': 'const Widget = () => <div/>;',
    });
    expect(result.undefinedComponents.map(c => [c.file, c.component])).toEqual([['src/App.tsx', 'Widget']]);
  });
  it('keeps an explicit sibling import as a real binding', async () => {
    expect((await analyzeJsxComponents({
      'src/App.tsx': 'import { Widget } from "./other"; export const App = () => <Widget/>;',
      'src/other.tsx': 'export const Widget = () => <div/>;',
    })).ok).toBe(true);
  });
  it('leaves parse-invalid JSX to the syntax gate rather than inventing binding errors', async () => {
    expect((await analyzeJsxComponents({ 'src/App.tsx': 'export const App = () => <Mystery <<< />;' })).undefinedComponents).toEqual([]);
  });
  it.each([
    'namespace Icons { export const Icon = () => null; } export const App=()=> <Icons.Icon/>;',
    'import type { Widget } from "types"; const Widget = () => null; export const App=()=> <Widget/>;',
    'interface Widget {} function Widget() { return null; } export const App=()=> <Widget/>;',
    'type Widget = { id: string }; const Widget = () => null; export const App=()=> <Widget/>;',
  ])('respects separate type and value namespaces: %s', async src => {
    expect((await analyzeJsxComponents({ 'src/App.tsx': src })).ok).toBe(true);
  });
  it.each(['React', 'Fragment'])('preserves absent %s globals but not explicit erased bindings', async name => {
    const tag = name === 'React' ? 'React.Fragment' : name;
    expect((await analyzeJsxComponents({ 'src/App.tsx': `export const App = () => <${tag}/>;` })).ok).toBe(true);
    expect((await analyzeJsxComponents({ 'src/App.tsx': `import type ${name} from 'react'; export const App = () => <${tag}/>;` })).ok).toBe(false);
    expect((await analyzeJsxComponents({ 'src/App.tsx': `import type ${name} from 'react'; export function App(${name}: any) { return <${tag}/>; }` })).ok).toBe(true);
  });
  it('keeps an actual parameter shadow independent of a type-only import', async () => {
    expect((await analyzeJsxComponents({ 'src/App.tsx': 'import type Icon from "icons"; export function App(Icon: any) { return <Icon/>; }' })).ok).toBe(true);
  });
});

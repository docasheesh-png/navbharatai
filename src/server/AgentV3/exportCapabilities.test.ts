import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceCensusFiles } from '../../../tests/helpers/sourceCensus';
import { build } from 'esbuild';
import * as ts from 'typescript';
import { createExportCapabilities } from './exportCapabilities';
import { analyzeImportExports } from './ImportExportAnalysis';
import { contractDriftReport } from './ContractMap';
import { addMissingProjectImports, fixTypeOnlyValueImports, fixWrongSourceImports, reconcileImportExports } from './ImportExportReconcile';
import { generateMissingBarrels } from './BarrelGenerator';

// The production functions AND real compilers see the same synthetic source. No retained private
// report payload, provider, sandbox, network call or mocked compiler/export table is involved.
async function bundle(files: Record<string, string>, entry = 'src/app.ts') {
  const model = createExportCapabilities(files);
  return build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'in-memory-fixture', setup(b) {
      b.onResolve({ filter: /.*/ }, args => ({ path: args.kind === 'entry-point' ? args.path : model.resolve(args.importer, args.path) ?? args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: files[args.path], loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' }));
    } }],
  });
}
function diagnostics(files: Record<string, string>): number[] {
  const options: ts.CompilerOptions = { noLib: true, noEmit: true, strict: true, verbatimModuleSyntax: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext };
  const model = createExportCapabilities(files);
  const host: ts.CompilerHost = {
    getSourceFile: p => typeof files[p] === 'string' ? ts.createSourceFile(p, files[p], ts.ScriptTarget.Latest, true) : undefined,
    writeFile: () => {}, getDefaultLibFileName: () => '', getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: p => p in files, readFile: p => files[p], getCanonicalFileName: p => p, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, importer) => names.map(spec => {
      const path = model.resolve(importer, spec); return path ? { resolvedFileName: path } : undefined;
    }),
  };
  return ts.getPreEmitDiagnostics(ts.createProgram(Object.keys(files), options, host)).map(d => d.code).filter(c => c !== 2318);
}

const erasedProducers = [
  ['type alias', 'export type Thing = (x: number) => string;'],
  ['interface', 'export interface Thing { id: string }'],
  ['ambient function', 'export declare function Thing(x: number): string;'],
  ['ambient const', 'export declare const Thing: number;'],
  ['ambient class', 'export declare class Thing { id: string }'],
  ['ambient enum', 'export declare enum Thing { A }'],
  ['ambient namespace', 'export declare namespace Thing { const A: number }'],
  ['empty type namespace', 'export namespace Thing { export interface A {} }'],
  ['nested type namespace', 'export namespace Thing { export namespace Inner { export interface A {} } }'],
] as const;

describe('the retained offline failure shapes', () => {
  it.each([
    'export type formatDate = (date: Date) => string;',
    'export declare function formatDate(date: Date): string;',
  ])('formatDate must be a runtime function, not just a declared export: %s', async producer => {
    const files = { 'src/types.ts': producer,
      'src/app.ts': "import { formatDate } from './types'; export const result = formatDate(new Date());" };
    expect((await analyzeImportExports(files)).mismatches[0]?.detail).toContain('emits no value');
    expect(contractDriftReport(files)).toContain('formatDate');
    await expect(bundle(files)).rejects.toThrow(/No matching export/);
  });
  it('console.log(User) cannot make an exported interface a runtime-import candidate', async () => {
    const result = await addMissingProjectImports({ 'src/types.ts': 'export interface User { name: string }',
      'src/app.ts': 'console.log(User);' });
    expect(result.added).toEqual([]);
  });
});

describe('erased declarations are not emitted runtime exports', () => {
  it.each(erasedProducers)('%s is rejected by both contract checks and real esbuild', async (_kind, producer) => {
    const files = { 'src/producer.ts': producer, 'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    expect((await analyzeImportExports(files)).mismatches).toHaveLength(1);
    expect(contractDriftReport(files)).toContain('runtime value is type-only or ambient');
    await expect(bundle(files)).rejects.toThrow(/No matching export/);
  });
  it.each(erasedProducers)('%s is never invented as a forgotten runtime import', async (_kind, producer) => {
    const files = { 'src/producer.ts': producer, 'src/app.ts': 'export const value = Thing;' };
    expect(await addMissingProjectImports(files)).toEqual({ files, added: [] });
  });
  it.each(erasedProducers)('%s is never upgraded from import type to a runtime import', async (_kind, producer) => {
    const files = { 'src/producer.ts': producer, 'src/app.ts': "import type { Thing } from './producer'; export const value = Thing;" };
    expect(await fixTypeOnlyValueImports(files)).toEqual({ files, fixes: [] });
  });
});

describe('aliases, re-exports and real value declarations keep their capabilities', () => {
  it.each([
    "export type { Thing } from './leaf';",
    "export { type Thing } from './leaf';",
    "export type * from './leaf';",
    "import type { Thing } from './leaf'; export { Thing };",
  ])('does not bypass an erased export edge: %s', async producer => {
    const files = { 'src/leaf.ts': 'export class Thing {}', 'src/producer.ts': producer,
      'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    expect((await analyzeImportExports(files)).ok).toBe(false);
    await expect(bundle(files)).rejects.toThrow(/No matching export/);
    const repaired = await fixTypeOnlyValueImports({ ...files, 'src/app.ts': "import type { Thing } from './producer'; export const value = Thing;" });
    expect(repaired.fixes).toEqual([]);
  });
  it.each([
    'export class Thing { static value = 1 }',
    'export enum Thing { A }',
    'export const enum Thing { A }',
    'export const Thing = { A: 1 }; export type Thing = number;',
    'export interface Thing { id: string }; export const Thing = { id: "ok" };',
    'export function Thing(x: number): number; export function Thing(x: number) { return x; }',
    'export namespace Thing { export const A = 1; }',
    'export const { Thing } = { Thing: 1 };',
  ])('accepts actual emitted values including merged declarations: %s', async producer => {
    const files = { 'src/producer.ts': producer, 'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    expect((await analyzeImportExports(files)).ok).toBe(true);
    expect(contractDriftReport(files)).toBeNull();
    await expect(bundle(files)).resolves.toBeTruthy();
    expect((await addMissingProjectImports({ ...files, 'src/app.ts': 'export const value = Thing;' })).added).toHaveLength(1);
  });
  it('follows named aliases, local import forwarding and resolved star forwarding', async () => {
    const files = { 'src/leaf.ts': 'export class Original {}',
      'src/first.ts': "export { Original as Thing } from './leaf';",
      'src/second.ts': "import { Thing as Local } from './first'; export { Local as Thing };",
      'src/producer.ts': "export * from './second';",
      'src/app.ts': "import { Thing as Renamed } from './producer'; export const value = new Renamed();" };
    expect((await analyzeImportExports(files)).ok).toBe(true);
    expect(contractDriftReport(files)).toBeNull();
    await expect(bundle(files)).resolves.toBeTruthy();
  });
  it('does not erase a value merely because a type-only star also forwards its name', async () => {
    const files = { 'src/leaf.ts': 'export class Thing {}',
      'src/producer.ts': "export { Thing } from './leaf'; export type * from './leaf';",
      'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    expect((await analyzeImportExports(files)).ok).toBe(true);
    await expect(bundle(files)).resolves.toBeTruthy();
  });
  it.each([
    "export * from './leaf'; export type * from './leaf';",
    "export type * from './leaf'; export * from './leaf';",
  ])('a type-only star cannot erase a sibling runtime star: %s', async producer => {
    const files = { 'src/leaf.ts': 'export class Thing {}', 'src/producer.ts': producer,
      'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    expect((await analyzeImportExports(files)).ok).toBe(true);
    expect(createExportCapabilities(files).exportsOf('src/producer.ts').exports.get('Thing')?.runtime).toBe('value');
    await expect(bundle(files)).resolves.toBeTruthy();
  });
  it('ambiguous runtime star providers never become an automatic import', async () => {
    const files = { 'src/a.ts': 'export class Thing {}', 'src/b.ts': 'export const Thing = 2;',
      'src/producer.ts': "export * from './a'; export * from './b';",
      'src/app.ts': "import type { Thing } from './producer'; export const value = Thing;" };
    expect(createExportCapabilities(files).exportsOf('src/producer.ts').exports.get('Thing')?.runtime).toBe('unknown');
    expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
  });
  it('keeps external and declaration-file implementations unknown instead of guessing a heal', async () => {
    const files = { 'src/producer.d.ts': 'export declare function Thing(): number;',
      'src/app.ts': "import type { Thing } from './producer'; export const value = Thing;" };
    expect(createExportCapabilities(files).exportsOf('src/producer.d.ts').exports.get('Thing')?.runtime).toBe('unknown');
    expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
    expect((await analyzeImportExports(files)).ok).toBe(true);
    const external = { 'src/producer.ts': "export { Thing } from 'some-library';", 'src/app.ts': 'export const value = Thing;' };
    expect((await addMissingProjectImports(external)).added).toEqual([]);
  });
});

describe('consumer capability follows AST binding and erased type positions', () => {
  it.each([
    'export const value: Thing = { id: "ok" };',
    'export type Value = { nested: Thing };',
    'export type Value = Thing["id"];',
    'export class Value implements Thing { id = "ok"; }',
    'function f(Thing: number) { return Thing; } export const value = f(1);',
    'export type Value = { [P in keyof Thing]: Thing[P] };',
  ])('an ordinary import used only as a type is not a runtime mismatch: %s', async use => {
    const files = { 'src/producer.ts': 'export interface Thing { id: string }',
      'src/app.ts': `import { Thing } from './producer'; ${use}` };
    expect((await analyzeImportExports(files)).ok).toBe(true);
    expect(contractDriftReport(files)).toBeNull();
    await expect(bundle(files)).resolves.toBeTruthy();
  });
  it.each(['export const value = Thing;', 'export const value = { Thing };', 'export class Value extends Thing {}', 'export { Thing };'])('finds real runtime reads: %s', async use => {
    const files = { 'src/producer.ts': 'export declare class Thing {}', 'src/app.ts': `import { Thing } from './producer'; ${use}` };
    expect((await analyzeImportExports(files)).ok).toBe(false);
  });
  it('JSX components need runtime values but intrinsic tags do not', async () => {
    const producer = 'export interface Thing {} export interface thing {}';
    const broken = { 'src/producer.ts': producer,
      'src/app.tsx': "import { Thing } from './producer'; export const value = <Thing />;" };
    expect((await analyzeImportExports(broken)).ok).toBe(false);
    const intrinsic = { ...broken, 'src/app.tsx': "import { thing } from './producer'; export type Model = thing; export const value = <thing />;" };
    expect((await analyzeImportExports(intrinsic)).ok).toBe(true);
  });
  it('labels and destructuring property names are not reads of an imported type', async () => {
    const files = { 'src/producer.ts': 'export interface Thing {}',
      'src/app.ts': "import { Thing } from './producer'; Thing: for (;;) { break Thing; } export const { Thing: other } = { Thing: 1 };" };
    expect((await analyzeImportExports(files)).ok).toBe(true);
  });
  it('does not upgrade an imported class just because a parameter shadows it', async () => {
    const files = { 'src/producer.ts': 'export class Thing {}',
      'src/app.ts': "import type { Thing } from './producer'; function f(Thing: number) { return Thing; } export const n = f(1);" };
    expect((await fixTypeOnlyValueImports(files)).fixes).toEqual([]);
  });
  it('upgrades aliases and class extends, but keeps other specifier modifiers', async () => {
    const files = { 'src/producer.ts': 'export class Thing {} export interface User { id: string }',
      'src/app.ts': "import type { Thing as Base, User } from './producer'; export class Value extends Base { user?: User }" };
    const result = await fixTypeOnlyValueImports(files);
    expect(result.fixes).toHaveLength(1);
    expect(result.files['src/app.ts']).toMatch(/Thing as Base, type User/);
    expect(diagnostics(result.files)).toEqual([]);
    await expect(bundle(result.files)).resolves.toBeTruthy();
  });
  it('never adds imports for typeof/type queries, computed interface keys or nested type arguments', async () => {
    const files = { 'src/producer.ts': 'export const Thing = 1;',
      'src/app.ts': 'export type Value = typeof Thing; export type Nested = { field: typeof Thing };' };
    expect((await addMissingProjectImports(files)).added).toEqual([]);
  });
});

describe('repair siblings preserve type syntax and only choose capable providers', () => {
  it('wrong-source repair keeps whole import type and aliases (TS1484 regression)', async () => {
    const files = { 'src/wrong.ts': 'export const other = 1;', 'src/types.ts': 'export interface User { name: string }',
      'src/app.ts': "import type { User as Person } from './wrong'; export const user: Person = { name: 'ok' };" };
    const result = await fixWrongSourceImports(files);
    expect(result.fixes).toHaveLength(1);
    expect(result.files['src/app.ts']).toMatch(/import type \{ User as Person \}/);
    expect(diagnostics(result.files)).toEqual([]);
    expect(diagnostics({ ...result.files, 'src/app.ts': result.files['src/app.ts'].replace('import type', 'import') })).toContain(1484);
  });
  it('wrong-source repair groups type and value specifiers without dropping unrelated side-effect imports', async () => {
    const files = { 'src/wrong.ts': 'export const other = 1;',
      'src/owner.ts': 'export interface User { id: string } export const count = 1;',
      'src/setup.ts': 'export const setup = 1;',
      'src/app.ts': "import './setup'; import { type User as Person, count } from './wrong'; export const value: Person = { id: `${count}` };" };
    const result = await fixWrongSourceImports(files);
    expect(result.fixes).toHaveLength(2);
    expect(result.files['src/app.ts']).toContain("import './setup'");
    expect(result.files['src/app.ts']).toMatch(/type User as Person, count/);
    expect(diagnostics(result.files)).toEqual([]);
    await expect(bundle(result.files)).resolves.toBeTruthy();
  });
  it('wrong-source runtime repair ignores a same-name interface and selects the unique runtime owner', async () => {
    const files = { 'src/types.ts': 'export interface Thing {}', 'src/owner.ts': 'export const Thing = 1;',
      'src/app.ts': "import { Thing } from './types'; export const value = Thing;" };
    const result = await fixWrongSourceImports(files);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].to).toBe('./owner');
    await expect(bundle(result.files)).resolves.toBeTruthy();
  });
  it('does not move a runtime import to an interface or ambient owner', async () => {
    for (const declaration of ['export interface Thing {}', 'export declare const Thing: number;']) {
      const files = { 'src/wrong.ts': 'export const other = 1;', 'src/owner.ts': declaration,
        'src/app.ts': "import { Thing } from './wrong'; export const value = Thing;" };
      expect((await fixWrongSourceImports(files)).fixes).toEqual([]);
    }
  });
  it('named/default reconciliation cannot turn a default interface into a runtime import', async () => {
    const files = { 'src/producer.ts': 'export default interface Thing {}',
      'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    expect((await reconcileImportExports(files)).fixes).toEqual([]);
  });
  it('named/default reconciliation retains per-specifier type modifiers', async () => {
    const files = { 'src/producer.ts': 'export default class Thing {} export interface User {}',
      'src/app.ts': "import { Thing, type User } from './producer'; export const value = new Thing(); export type Person = User;" };
    const result = await reconcileImportExports(files);
    expect(result.fixes).toHaveLength(1);
    expect(result.files['src/app.ts']).toMatch(/Thing, \{ type User \}/);
    expect(diagnostics(result.files)).toEqual([]);
  });
  it('barrel generation uses export type for interfaces and compiles with verbatimModuleSyntax', async () => {
    const files = { 'src/types/User.ts': 'export interface User { id: string }',
      'src/app.ts': "import type { User } from './types'; export const value: User = { id: 'ok' };" };
    const stubs = await generateMissingBarrels(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].content).toContain("export type { User } from './User'");
    expect(diagnostics({ ...files, [stubs[0].path]: stubs[0].content })).toEqual([]);
  });
  it('barrel generation never invents runtime exports from interfaces, even after a type-only consumer', async () => {
    const files = { 'src/types/User.ts': 'export interface User {}',
      'src/first.ts': "import type { User } from './types'; export type Person = User;",
      'src/app.ts': "import { User } from './types'; export const value = User;" };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });
  it('barrel generation combines all consumers and keeps real class values available', async () => {
    const files = { 'src/models/User.ts': 'export class User {}', 'src/models/count.ts': 'export const count = 1;',
      'src/first.ts': "import type { User } from './models'; export type Person = User;",
      'src/app.ts': "import { User, count } from './models'; export const value = { user: new User(), count };" };
    const stubs = await generateMissingBarrels(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].exports).toEqual(['User', 'count']);
    await expect(bundle({ ...files, [stubs[0].path]: stubs[0].content })).resolves.toBeTruthy();
  });
  it.each(['mts', 'cts', 'mjs', 'cjs'])('does not shadow an existing index.%s with a new index.ts', async extension => {
    const files = { [`src/models/index.${extension}`]: 'export const User = 1;',
      'src/models/User.ts': 'export const User = 2;',
      'src/app.ts': "import { User } from './models'; export const value = User;" };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });
  it.each(['mts', 'cts', 'mjs', 'cjs'])('a generated barrel retains resolvable %s module filenames', async extension => {
    const files = { [`src/models/User.${extension}`]: 'export default class User {}',
      'src/app.ts': "import { User } from './models'; export const value = new User();" };
    const stubs = await generateMissingBarrels(files);
    expect(stubs).toHaveLength(1);
    const outputExtension = extension === 'mts' ? 'mjs' : extension === 'cts' ? 'cjs' : extension;
    expect(stubs[0].content).toContain(`from './User.${outputExtension}'`);
    // Use esbuild's real filesystem resolver, not the capability graph's resolver plugin.
    const root = await mkdtemp(join(tmpdir(), 'export-barrel-'));
    try {
      for (const [path, content] of Object.entries({ ...files, [stubs[0].path]: stubs[0].content })) {
        const destination = join(root, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }
      await expect(build({ entryPoints: [join(root, 'src/app.ts')], bundle: true, write: false,
        format: 'esm', logLevel: 'silent' })).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// This is a class guard, not just a list of the five reproductions: a new name-only export-table
// consumer must explicitly join the shared model. ASTAnalyzer is descriptive symbol metadata, not
// an emitted-value check or code writer. The remaining ts-morph table only supplies default local names.
describe('every export-driven checker and writer shares the capability contract', () => {
  it('has no unreviewed semantic export-table consumer in production source', () => {
    const users = sourceCensusFiles('src', p => /\.[cm]?[jt]sx?$/.test(p) && !/\.test\.[jt]sx?$/.test(p))
      .filter(p => readFileSync(p, 'utf8').includes('getExportedDeclarations(') || readFileSync(p, 'utf8').includes('getExportedDeclarations?.('));
    expect(users.sort()).toEqual(['src/server/AgentV3/ASTAnalyzer.ts', 'src/server/AgentV3/ImportExportReconcile.ts']);
    for (const file of ['ImportExportAnalysis', 'ImportExportReconcile', 'ContractMap', 'BarrelGenerator']) {
      const source = readFileSync(`src/server/AgentV3/${file}.ts`, 'utf8');
      expect(source, file).toContain('createExportCapabilities(');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as ts from 'typescript';
import { build } from 'esbuild';
import { createExportCapabilities } from './exportCapabilities';
import { analyzeImportExports } from './ImportExportAnalysis';
import { addMissingProjectImports, fixTypeOnlyValueImports, fixWrongSourceImports, reconcileImportExports } from './ImportExportReconcile';
import { generateMissingBarrels } from './BarrelGenerator';

// Use TypeScript's actual module resolver. Returning only resolvedFileName from a custom
// resolveModuleNames hook omits resolvedUsingTsExtension and silently suppresses TS5097.
function resolvedDiagnostics(files: Record<string, string>): number[] {
  const normalize = (path: string) => path.replace(/^\//, '');
  const options: ts.CompilerOptions = {
    noLib: true, noEmit: true, allowJs: true, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const directories = new Set(['', ...Object.keys(files).flatMap(path => {
    const parts = path.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  })]);
  const host: ts.CompilerHost = {
    getSourceFile: path => typeof files[normalize(path)] === 'string'
      ? ts.createSourceFile(path, files[normalize(path)], ts.ScriptTarget.Latest, true) : undefined,
    writeFile: () => {}, getDefaultLibFileName: () => '', getCurrentDirectory: () => '/',
    getDirectories: () => [], directoryExists: path => directories.has(normalize(path)),
    fileExists: path => normalize(path) in files, readFile: path => files[normalize(path)],
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  return ts.getPreEmitDiagnostics(ts.createProgram(Object.keys(files), options, host))
    .map(diagnostic => diagnostic.code).filter(code => code !== 2318);
}

async function bundleOnDisk(files: Record<string, string>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'export-module-formats-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    await build({ entryPoints: [join(root, 'src/app.ts')], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe('every import writer uses emitted module-format suffixes', () => {
  it.each(['mts', 'cts'])('the compiler probe actually rejects a raw .%s source import', extension => {
    expect(resolvedDiagnostics({
      [`src/owner.${extension}`]: 'export const Thing = 1;',
      'src/app.ts': `import { Thing } from './owner.${extension}'; export const value = Thing;`,
    })).toContain(5097);
  });

  it.each(['mts', 'cts', 'mjs', 'cjs'])('missing and wrong-source repairs generate resolvable .%s imports', async extension => {
    const owner = `src/owner.${extension}`;
    const output = extension === 'mts' ? 'mjs' : extension === 'cts' ? 'cjs' : extension;
    const files = { [owner]: 'export const Thing = 1;', 'src/wrong.ts': 'export const other = 1;',
      'src/app.ts': 'export const value = Thing;' };
    const added = await addMissingProjectImports(files);
    const moved = await fixWrongSourceImports({ ...files,
      'src/app.ts': "import { Thing } from './wrong'; export const value = Thing;" });
    expect(added.added).toHaveLength(1);
    expect(moved.fixes).toHaveLength(1);
    for (const repaired of [added.files, moved.files]) {
      expect(repaired['src/app.ts']).toContain(`"./owner.${output}"`);
      expect(resolvedDiagnostics(repaired)).toEqual([]);
      await bundleOnDisk(repaired);
    }
  });

  it.each(['mts', 'cts'])('type-only wrong-source repair also avoids a .%s source import', async extension => {
    const files = { [`src/owner.${extension}`]: 'export interface Thing { value: number }',
      'src/wrong.ts': 'export const other = 1;',
      'src/app.ts': "import type { Thing } from './wrong'; export const value: Thing = { value: 1 };" };
    const repaired = await fixWrongSourceImports(files);
    expect(repaired.fixes).toHaveLength(1);
    expect(repaired.files['src/app.ts']).toContain(extension === 'mts' ? './owner.mjs' : './owner.cjs');
    expect(resolvedDiagnostics(repaired.files)).toEqual([]);
  });

  it.each(['mts', 'cts', 'mjs', 'cjs'])('barrels share the same .%s output naming contract', async extension => {
    const files = { [`src/models/Thing.${extension}`]: 'export const Thing = 1;',
      'src/app.ts': "import { Thing } from './models'; export const value = Thing;" };
    const [barrel] = await generateMissingBarrels(files);
    expect(barrel).toBeDefined();
    const repaired = { ...files, [barrel.path]: barrel.content };
    expect(resolvedDiagnostics(repaired)).toEqual([]);
    await bundleOnDisk(repaired);
  });
});

describe('CommonJS export surfaces remain conservative, not falsely empty ESM tables', () => {
  const commonJs = [
    ['cjs', 'module.exports = { Thing: 1 };'],
    ['cjs', 'exports.Thing = 1;'],
    ['cjs', 'module["exports"] = { Thing: 1 };'],
    ['cjs', 'const key = "exports"; module[key] = { Thing: 1 };'],
    ['cjs', 'Object.assign(exports, { Thing: 1 });'],
    ['cjs', 'const target = exports; target.Thing = 1;'],
    ['cjs', 'console.log("a CommonJS module with the default empty exports object");'],
    ['cts', 'const Thing = { value: 1 }; export = Thing;'],
    ['js', 'module.exports = { Thing: 1 };'],
    ['ts', 'declare const module: any; module.exports = { Thing: 1 };'],
  ] as const;

  it.each(commonJs)('accepts an actual bundled default from .%s: %s', async (extension, producer) => {
    const path = `src/producer.${extension}`;
    const spec = extension === 'cts' ? './producer.cjs' : `./producer.${extension}`;
    const files = { [path]: producer, 'src/app.ts': `import lib from '${spec}'; export const value = lib;` };
    await bundleOnDisk(files);
    expect((await analyzeImportExports(files)).mismatches).toEqual([]);
    expect(createExportCapabilities(files).exportsOf(path).uncertain).toBe(true);
    // Uncertain module exports cannot authorize runtime imports, promotions or wrong-source moves.
    expect((await addMissingProjectImports({ ...files, 'src/app.ts': 'export const value = Thing;' })).added).toEqual([]);
    expect((await fixTypeOnlyValueImports({ ...files,
      'src/app.ts': `import type { Thing } from '${spec}'; export const value = Thing;` })).fixes).toEqual([]);
    expect((await fixWrongSourceImports({ ...files, 'src/other.ts': 'export const Thing = 1;',
      'src/app.ts': `import { Thing } from '${spec}'; export const value = Thing;` })).fixes).toEqual([]);
  });

  it.each([
    'function local(module: any, exports: any) { module.exports = 1; exports.Thing = 1; }',
    'const module = { exports: 0 }; module.exports = 1;',
    'const exports = { Thing: 0 }; exports.Thing = 1;',
    'const object = { module: 1, exports: 2 };',
    'const text = "module.exports = Thing"; /* exports.Thing = 1 */',
  ])('does not confuse shadowed identifiers or inert text with CommonJS: %s', producer => {
    const files = { 'src/producer.ts': `${producer}\nexport const Thing = 1;`,
      'src/app.ts': "import { Thing } from './producer'; export const value = Thing;" };
    const surface = createExportCapabilities(files).exportsOf('src/producer.ts');
    expect(surface.uncertain).toBe(false);
    expect(surface.exports.get('Thing')?.runtime).toBe('value');
  });

  it.each(['cts', 'cjs'])('keeps genuine ESM exports in .%s exact', async extension => {
    const files = { [`src/producer.${extension}`]: 'export const Thing = 1;',
      'src/app.ts': `import { Thing } from './producer.${extension === 'cts' ? 'cjs' : extension}'; export const value = Thing;` };
    const surface = createExportCapabilities(files).exportsOf(`src/producer.${extension}`);
    expect(surface.uncertain).toBe(false);
    expect(surface.exports.get('Thing')?.runtime).toBe('value');
    await bundleOnDisk(files);
  });

  it.each([
    ['cts', 'import type { Thing } from "./types"; const value = 1;'],
    ['cts', 'import { type Thing } from "./types"; const value = 1;'],
    ['cts', 'import { Thing } from "./types"; const value: Thing = {};'],
    ['cts', 'import { thing } from "./objects"; console.log(thing);'],
    ['cts', 'import "./source.cjs";'],
    ['cts', 'import value = require("./source.cjs"); console.log(value);'],
    ['cjs', 'import { thing } from "./objects"; console.log(thing);'],
    ['cjs', 'import "./source.cjs";'],
    ['cjs', 'import {} from "./objects";'],
  ])('an import-only .%s file still has a CommonJS default: %s', async (extension, producer) => {
    const path = `src/producer.${extension}`;
    const files = { [path]: producer, 'src/types.ts': 'export interface Thing {}',
      'src/objects.ts': 'export const thing = 1;', 'src/source.cjs': 'module.exports = 1;',
      'src/app.ts': 'import value from "./producer.cjs"; export const result = value;' };
    await bundleOnDisk(files);
    expect(createExportCapabilities(files).exportsOf(path).uncertain).toBe(true);
    expect((await analyzeImportExports(files)).mismatches).toEqual([]);
    if (extension === 'cts' && producer.startsWith('import type')) {
      // The bundler accepts this CommonJS default but this TypeScript compiler mode does not.
      // Uncertain means "do not invent a repair", not a substitute for the real compiler gate.
      expect(resolvedDiagnostics(files)).toContain(1192);
    }
  });

  it.each([
    ['cts', 'export interface Thing {}'],
    ['cts', 'export type Thing = number;'],
    ['cts', 'export declare const Thing: number;'],
    ['cts', 'export type { Thing } from "./types";'],
    ['cts', 'export {};'],
    ['cjs', 'export {};'],
  ])('erased ESM export syntax in .%s does not invent a default: %s', async (extension, producer) => {
    const path = `src/producer.${extension}`;
    const files = { [path]: producer, 'src/types.ts': 'export interface Thing {}',
      'src/app.ts': 'import value from "./producer.cjs"; export const result = value;' };
    await expect(bundleOnDisk(files)).rejects.toThrow(/No matching export/);
    expect(resolvedDiagnostics(files)).toContain(1192);
    expect(createExportCapabilities(files).exportsOf(path).uncertain).toBe(false);
    expect((await analyzeImportExports(files)).mismatches).toMatchObject([{ kind: 'default-import-missing' }]);
  });

  it('TS syntax in a .cjs file is not evidence of a valid CommonJS alternative', async () => {
    await expect(bundleOnDisk({
      'src/producer.cjs': 'export interface Thing {}',
      'src/app.ts': 'import value from "./producer.cjs"; export const result = value;',
    })).rejects.toThrow(/Unexpected "interface"/);
  });

  it('recognizes imported module/exports aliases as real lexical bindings', () => {
    const files = {
      'src/objects.ts': 'export const object = { exports: 0 };',
      'src/producer.ts': 'import { object as module, object as exports } from "./objects"; ' +
        'module.exports = 1; exports.exports = 2; export const Thing = 1;',
    };
    const surface = createExportCapabilities(files).exportsOf('src/producer.ts');
    expect(surface.uncertain).toBe(false);
    expect(surface.exports.get('Thing')?.runtime).toBe('value');
  });

  it('does not reconcile imports or lazy selectors against mixed/uncertain module semantics', async () => {
    const files = {
      'src/named.js': 'export const Thing = 1; module.exports = { Thing: 2 };',
      'src/default.js': 'export default function Thing() {} module.exports = { Thing: 2 };',
      'src/app.ts': "import Thing from './named.js'; export const value = Thing; " +
        "export const lazy = () => import('./default.js').then(mod => ({ default: mod.Thing }));",
    };
    expect((await reconcileImportExports(files)).fixes).toEqual([]);
  });
});

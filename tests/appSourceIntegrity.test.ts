import { describe, expect, it } from 'vitest';
import {
  analyzeProjectIntegrity, dedupeStylesheetImports, findDuplicateStylesheets, findOrphanStylesheets, injectGlobalStylesheetImport,
} from '../src/server/AgentV3/ProjectIntegrityChecks';
import { analyzeHooksRules } from '../src/server/AgentV3/HooksRulesAnalysis';
import { analyzeImportExports, findCircularDependencies } from '../src/server/AgentV3/ImportExportAnalysis';
import { detectHallucinations } from '../src/server/AgentV3/HallucinationDetector';
import { analyzeUndefinedHooks } from '../src/server/AgentV3/UndefinedHookAnalysis';
import { analyzeJsxComponents } from '../src/server/AgentV3/JsxComponentAnalysis';
import ts from 'typescript';

describe('stylesheet repairs preserve distinct files with the same basename', () => {
  const differentSheets = {
    'src/main.tsx': "import './styles/index.css';\n",
    'src/components/Card.tsx': "import './index.css';\nexport const Card = () => <article />;",
    'src/styles/index.css': 'body { margin: 0; }',
    'src/components/index.css': '.card { padding: 8px; }',
  };

  it('does not delete the component stylesheet because the entry imports another index.css', () => {
    expect(findDuplicateStylesheets(differentSheets)).toEqual([]);
    expect(dedupeStylesheetImports(differentSheets)).toEqual({ files: differentSheets, removed: [] });
    expect(findOrphanStylesheets(differentSheets)).toEqual([]);
  });

  it('a reference to one index.css cannot conceal another unwired index.css', () => {
    const files = { ...differentSheets, 'src/components/Card.tsx': 'export const Card = () => null;' };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'src/components/index.css' }]);
  });

  it('resolves relative spellings in the importer that wrote them, regardless of sorted importer order', () => {
    const files = {
      'src/main.tsx': "import './styles/index.css';\n",
      'src/components/Card.tsx': "import '../styles/index.css';\nimport './index.css';\n",
      'src/styles/index.css': 'body {}',
      'src/components/index.css': '.card {}',
    };
    const out = dedupeStylesheetImports(files);
    expect(out.removed).toEqual([{ stylesheet: './styles/index.css', from: 'src/components/Card.tsx' }]);
    expect(out.files['src/components/Card.tsx']).toBe("import './index.css';\n");
    expect(findOrphanStylesheets(out.files)).toEqual([]);
  });

  it('keeps case-sensitive paths distinct and does not treat remote CSS as a local reference', () => {
    const files = {
      'src/main.tsx': "import './Index.css';\n",
      'src/Index.css': '.upper {}',
      'src/index.css': '.lower {}',
      'style.css': 'body {}',
      'index.html': '<link rel="stylesheet" href="https://example.com/style.css">',
    };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'src/index.css' }, { stylesheet: 'style.css' }]);
  });

  it('a bare package import cannot conceal or remove a same-named local stylesheet', () => {
    const files = {
      'src/main.tsx': "import 'theme.css';\n",
      'src/Card.tsx': "import './theme.css';\n",
      'src/theme.css': '.card {}',
    };
    expect(findDuplicateStylesheets(files)).toEqual([]);
    expect(dedupeStylesheetImports(files).files).toBe(files);
    expect(findOrphanStylesheets({ ...files, 'src/Card.tsx': 'export {};' })).toEqual([{ stylesheet: 'src/theme.css' }]);
  });

  it('a local CSS @import wires its target rather than triggering a second global injection', () => {
    const files = {
      'src/main.tsx': "import './styles/index.css';\n",
      'src/styles/index.css': "@import './tokens.css';\nbody {}",
      'src/styles/tokens.css': ':root { --space: 4px; }',
    };
    expect(findOrphanStylesheets(files)).toEqual([]);
  });

  it.each(['/style.css', './style.css'])('an HTML href %s wires the served public file', (href) => {
    const files = {
      'index.html': `<link rel="stylesheet" href="${href}">`,
      'public/style.css': 'body {}',
      'src/main.tsx': 'export {};',
    };
    expect(findOrphanStylesheets(files)).toEqual([]);
    expect(injectGlobalStylesheetImport(files).files).toBe(files);
  });

  it('a public URL prefers public/style.css, while a module import keeps the root source file distinct', () => {
    const files = {
      'index.html': '<link rel="stylesheet" href="/style.css">',
      'public/style.css': '.public {}',
      'style.css': '.source {}',
      'src/main.tsx': 'export {};',
    };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'style.css' }]);
    expect(findOrphanStylesheets({ ...files, 'src/main.tsx': "import '../style.css';" })).toEqual([]);
  });

  it('CSS loaded from public/ resolves relative and root URL imports through the same public mapping', () => {
    const files = {
      'index.html': '<link rel="stylesheet" href="/styles/style.css">',
      'public/styles/style.css': "@import './theme.css';\n@import url('/base.css');",
      'public/styles/theme.css': '.theme {}',
      'public/base.css': '.publicBase {}',
      'base.css': '.sourceBase {}',
      'src/main.tsx': "import '../base.css';",
    };
    expect(findOrphanStylesheets(files)).toEqual([]);
  });

  it('does not create an invalid source-module import for an unwired public stylesheet', () => {
    const files = { 'public/style.css': 'body {}', 'src/main.tsx': 'export {};' };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'public/style.css' }]);
    expect(injectGlobalStylesheetImport(files).injected).toEqual([]);
    expect(injectGlobalStylesheetImport(files).files).toEqual(files);
  });
});

describe('Next root layouts wire global CSS without losing their module directives', () => {
  it.each(['app', 'src/app'])('heals report 5cf3f986 through %s/layout.tsx and preserves the original imports and export', (root) => {
    const layout = "import type { ReactNode } from 'react';\nexport default function RootLayout({ children }: { children: ReactNode }) { return <html><body>{children}</body></html>; }";
    const files = { [`${root}/globals.css`]: 'body { margin: 0; }', [`${root}/layout.tsx`]: layout };
    const out = injectGlobalStylesheetImport(files);
    expect(out.injected).toEqual([{ stylesheet: `${root}/globals.css`, entry: `${root}/layout.tsx` }]);
    expect(out.files[`${root}/layout.tsx`]).toBe(`import './globals.css';\n${layout}`);
    expect(findOrphanStylesheets(out.files)).toEqual([]);
    expect(injectGlobalStylesheetImport(out.files).injected).toEqual([]);
  });

  it.each(["'use client';", '"use server"', "/* license */\n'use strict';\n// Keep the client boundary.\n'use client';"])(
    'the directive prologue %s remains a real directive after CSS is wired', (prologue) => {
      const layout = `${prologue}\nimport Shell from './Shell';\nexport default function RootLayout({ children }) { return <Shell>{children}</Shell>; }`;
      const files = { 'src/app/layout.tsx': layout, 'src/styles/global.css': 'body {}' };
      const out = injectGlobalStylesheetImport(files);
      const source = out.files['src/app/layout.tsx'];
      const parsed = ts.createSourceFile('layout.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const directives: string[] = [];
      for (const statement of parsed.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
        directives.push(statement.expression.text);
      }
      expect(directives).toEqual(prologue.includes('use strict') ? ['use strict', 'use client'] : [prologue.includes('use client') ? 'use client' : 'use server']);
      expect(source).toContain("import '../styles/global.css';");
      expect(source).toContain("import Shell from './Shell';");
      expect(source).toContain('export default function RootLayout');
      expect(findOrphanStylesheets(out.files)).toEqual([]);
    },
  );

  it('does not put an import inside a string expression that is not a directive', () => {
    const layout = "'not a directive'.toString();\nexport default function RootLayout() { return null; }";
    const out = injectGlobalStylesheetImport({ 'app/layout.tsx': layout, 'app/globals.css': 'body {}' });
    expect(out.files['app/layout.tsx']).toBe(`import './globals.css';\n${layout}`);
  });
});

describe('source checks judge the app rather than bundled copies or tool templates', () => {
  // Report 303836a7: a copied Android web bundle produced fourteen hook-order blockers. The same
  // generated files can also look like duplicate roots, orphan CSS and broken relative imports.
  const generatedRoots = [
    'android/app/src/main/assets/public', 'ios/App/App/public', 'dist', '.vercel/output/static', 'node_modules/vendor', '.local/skills/demo',
  ];
  const badHooks = 'export function App() { if (visible) useState(0); return <input autoFocus />; }';

  it('ignores the copied hook violations while still finding the exact same violation in app source', async () => {
    const files = Object.fromEntries(generatedRoots.map((p) => [`${p}/assets/index.js`, badHooks]));
    files['src/App.tsx'] = badHooks;
    const report = await analyzeHooksRules(files);
    expect(report.filesScanned).toBe(1);
    expect(report.violations.map((v) => [v.file, v.kind])).toEqual([['src/App.tsx', 'conditional-hook']]);
  });

  it('applies the same exclusions to Windows separators and leading ./ paths', async () => {
    const report = await analyzeHooksRules({
      '.\\android\\app\\src\\main\\assets\\public\\assets\\index.js': badHooks,
      './dist/assets/index.js': badHooks,
      '.\\.local\\App.tsx': badHooks,
      'src/App.tsx': badHooks,
    });
    expect(report.violations.map((v) => v.file)).toEqual(['src/App.tsx']);
  });

  it('does not repair bundled React roots, focus owners or orphan stylesheets', () => {
    const files: Record<string, string> = { 'src/main.tsx': 'createRoot(root).render(<App />);' };
    for (const path of generatedRoots) {
      files[`${path}/assets/index.js`] = 'createRoot(root).render(<input autoFocus />);';
      files[`${path}/assets/index.css`] = 'body {}';
    }
    expect(analyzeProjectIntegrity(files)).toMatchObject({
      ok: true, focusOwners: [], orphanStylesheets: [], duplicateEntryPoints: [],
    });
  });

  it('ignores generated import mismatches and cycles but keeps real source mismatches visible', async () => {
    const files: Record<string, string> = { 'src/a.ts': "import { missing } from './b';", 'src/b.ts': 'export const value = 1;' };
    for (const path of generatedRoots) {
      files[`${path}/a.js`] = "import { missing } from './b'; export const a = 1;";
      files[`${path}/b.js`] = "import { a } from './a'; export const value = 1;";
    }
    const report = await analyzeImportExports(files);
    expect(report.filesScanned).toBe(2);
    expect(report.mismatches.map((m) => m.file)).toEqual(['src/a.ts']);
    expect(findCircularDependencies(files)).toEqual([]);
  });

  it('still analyzes native-adjacent hand-written source outside the copied public bundle', async () => {
    const report = await analyzeHooksRules({ 'android/src/NativeWidget.tsx': badHooks });
    expect(report.filesScanned).toBe(1);
    expect(report.violations).toHaveLength(1);
  });

  it('a build route and authored Cordova www code remain source under every validator', async () => {
    const paths = ['src/app/build/page.tsx', 'src/app/out/page.tsx', 'src/vendor/Widget.tsx', 'www/js/app.js'];
    const files = Object.fromEntries(paths.map((path) => [path, badHooks]));
    expect((await analyzeHooksRules(files)).violations.map((v) => v.file)).toEqual(paths);
    const imports = Object.fromEntries(paths.map((path) => [path, "import { missing } from './values';"]));
    for (const path of paths) imports[path.replace(/[^/]+$/, 'values.ts')] = 'export const value = 1;';
    expect((await analyzeImportExports(imports)).mismatches.map((m) => m.file)).toEqual(paths);
    const missing = Object.fromEntries(paths.map((path) => [path, "import absent from './not-present';"]));
    expect(detectHallucinations(missing).signals.map((s) => s.file)).toEqual(paths);
  });

  it('the sibling source checks cannot reopen the same generated-file false alarm', async () => {
    const brokenSource = "import absent from './not-present';\nexport function App() { useState(0); return <MissingWidget />; }";
    const files = Object.fromEntries(generatedRoots.map((path) => [`${path}/App.tsx`, brokenSource]));
    files['src/App.tsx'] = brokenSource;
    const [hooks, jsx] = await Promise.all([analyzeUndefinedHooks(files), analyzeJsxComponents(files)]);
    expect(hooks.undefinedHooks.map((h) => h.file)).toEqual(['src/App.tsx']);
    expect(jsx.undefinedComponents.map((c) => c.file)).toEqual(['src/App.tsx']);
    expect(detectHallucinations(files).signals.map((s) => s.file)).toEqual(['src/App.tsx']);
  });
});

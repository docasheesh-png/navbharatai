import { describe, it, expect } from 'vitest';
import {
  findFocusOwners,
  findDuplicateStylesheets,
  findDuplicateEntryPoints,
  findDuplicateComponentModules,
  conventionRootAlternatives,
  duplicateModuleTarget,
  analyzeProjectIntegrity,
  integrityRepairInstruction,
} from './ProjectIntegrityChecks';

// THE bug (Notes build report, 2026-07-11): NoteEditor AND SearchBar both grabbed initial focus at
// mount, so SearchBar stole focus and the required "auto-focus the note input" silently broke.
describe('findFocusOwners — only one component may own initial focus', () => {
  const noteEditor = `import { useRef, useEffect } from 'react';
    export default function NoteEditor() {
      const ref = useRef<HTMLTextAreaElement>(null);
      useEffect(() => { ref.current?.focus(); }, []);
      return <textarea ref={ref} />;
    }`;
  const searchBar = `import { useRef, useEffect } from 'react';
    export default function SearchBar() {
      const ref = useRef<HTMLInputElement>(null);
      useEffect(() => { ref.current?.focus(); }, []);
      return <input ref={ref} />;
    }`;

  it('detects TWO mount-focus owners (the reported conflict)', () => {
    const owners = findFocusOwners({ 'src/NoteEditor.tsx': noteEditor, 'src/SearchBar.tsx': searchBar });
    expect(owners).toHaveLength(2);
    expect(owners.every((o) => o.mechanism === 'mount-focus')).toBe(true);
  });

  it('a single focus owner is fine (no conflict)', () => {
    expect(findFocusOwners({ 'src/NoteEditor.tsx': noteEditor })).toHaveLength(1);
  });

  it('detects a JSX autoFocus attribute as a focus owner', () => {
    const files = {
      'src/A.tsx': 'export default () => <input autoFocus />;',
      'src/B.tsx': 'export default () => <input placeholder="x" />;',
    };
    const owners = findFocusOwners(files);
    expect(owners).toEqual([{ file: 'src/A.tsx', mechanism: 'autoFocus' }]);
  });

  it('autoFocus + a second mount-focus component together are a conflict', () => {
    const owners = findFocusOwners({ 'src/A.tsx': '() => <input autoFocus />', 'src/SearchBar.tsx': searchBar });
    expect(owners).toHaveLength(2);
  });

  it('does NOT flag autoFocus={false}', () => {
    expect(findFocusOwners({ 'src/A.tsx': '() => <input autoFocus={false} />' })).toHaveLength(0);
  });

  it('does NOT count a .focus() inside a NON-empty-deps effect (deliberate, keyed focus)', () => {
    const src = `useEffect(() => { ref.current?.focus(); }, [isEditing]);`;
    expect(findFocusOwners({ 'src/C.tsx': src })).toHaveLength(0);
  });

  it('ignores a commented-out .focus()', () => {
    const src = `useEffect(() => { /* ref.current?.focus(); */ }, []);`;
    expect(findFocusOwners({ 'src/C.tsx': src })).toHaveLength(0);
  });

  it('ignores non-source files (css/json)', () => {
    expect(findFocusOwners({ 'src/a.css': '.x{}', 'p.json': '{"autoFocus":true}' })).toHaveLength(0);
  });
});

// THE bug (Notes build report): global.css was side-effect-imported from BOTH main.tsx and App.tsx.
describe('findDuplicateStylesheets — a stylesheet imported by 2+ modules', () => {
  it('detects the same global stylesheet imported from two modules (relative-path aware)', () => {
    const files = {
      'src/main.tsx': `import './styles/global.css';\nimport App from './App';`,
      'src/App.tsx': `import '../styles/global.css';\nexport default () => null;`,
    };
    const dups = findDuplicateStylesheets(files);
    expect(dups).toHaveLength(1);
    expect(dups[0].importers).toEqual(['src/App.tsx', 'src/main.tsx']);
  });

  it('a stylesheet imported from exactly one module is NOT a duplicate', () => {
    const files = {
      'src/main.tsx': `import './global.css';`,
      'src/App.tsx': `import Header from './Header';`,
    };
    expect(findDuplicateStylesheets(files)).toHaveLength(0);
  });

  it('a component importing its OWN scoped css alongside a shared one only flags the shared one', () => {
    const files = {
      'src/main.tsx': `import './global.css';`,
      'src/App.tsx': `import './global.css';\nimport './App.css';`,
      'src/Header.tsx': `import './Header.css';`,
    };
    const dups = findDuplicateStylesheets(files);
    expect(dups.map((d) => d.stylesheet.toLowerCase())).toContain('./global.css');
    expect(dups).toHaveLength(1);
  });

  it('the same file importing the same sheet twice counts as ONE importer (not a cross-module dup)', () => {
    const files = { 'src/App.tsx': `import './a.css';\nimport './a.css';` };
    expect(findDuplicateStylesheets(files)).toHaveLength(0);
  });
});

describe('analyzeProjectIntegrity + integrityRepairInstruction', () => {
  it('ok=true for a clean project, and an empty repair instruction', () => {
    const files = {
      'src/main.tsx': `import './global.css';\nimport App from './App';`,
      'src/App.tsx': `export default () => <input autoFocus />;`,
    };
    const report = analyzeProjectIntegrity(files);
    expect(report.ok).toBe(true);
    expect(integrityRepairInstruction(report)).toBe('');
  });

  it('ok=false with an actionable, file-named repair instruction for both defect classes', () => {
    const files = {
      'src/main.tsx': `import './global.css';\nimport App from './App';`,
      'src/App.tsx': `import './global.css';\nexport default () => <input autoFocus />;`,
      'src/SearchBar.tsx': `import { useEffect, useRef } from 'react';\nexport default function SB(){const r=useRef(null);useEffect(()=>{r.current?.focus();},[]);return <input ref={r}/>;}`,
    };
    const report = analyzeProjectIntegrity(files);
    expect(report.ok).toBe(false);
    const instr = integrityRepairInstruction(report);
    expect(instr).toContain('FOCUS CONFLICT');
    expect(instr).toContain('DUPLICATE STYLESHEET');
    expect(instr).toContain('global.css');
    expect(instr).toContain('src/SearchBar.tsx');
  });
});

// === ORPHAN STYLESHEET (NotesNest autopsy 2026-07-16) ==============================================
// The app compiled, previewed and shipped — but rendered as RAW unstyled HTML because src/index.css
// was imported by NOTHING (the fallback full builder hand-wrote main.tsx without the import).
import { findOrphanStylesheets, injectGlobalStylesheetImport } from './ProjectIntegrityChecks';

describe('findOrphanStylesheets — a stylesheet wired into nothing ships an unstyled app', () => {
  it('flags a global stylesheet with zero importers (the NotesNest bug)', () => {
    const files = {
      'src/index.css': 'body { margin: 0; }',
      'src/main.tsx': `import App from './App';`, // no css import — the real failure
      'src/App.tsx': `export default () => <div>hi</div>;`,
    };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'src/index.css' }]);
  });

  it('a side-effect import from ANY module clears it (path spelling variations match by filename)', () => {
    const files = {
      'src/index.css': 'body {}',
      'src/main.tsx': `import './index.css';\nimport App from './App';`,
    };
    expect(findOrphanStylesheets(files)).toHaveLength(0);
    const viaParent = {
      'src/styles/index.css': 'body {}',
      'src/main.tsx': `import './styles/index.css';`,
    };
    expect(findOrphanStylesheets(viaParent)).toHaveLength(0);
  });

  it('an HTML <link> also counts as wired (static apps)', () => {
    const files = {
      'style.css': 'body {}',
      'index.html': `<html><head><link rel="stylesheet" href="./style.css"></head><body></body></html>`,
    };
    expect(findOrphanStylesheets(files)).toHaveLength(0);
  });

  it('ignores CSS Modules (unused module sheet = dead code, not an unstyled app) and commented imports do not count as wired', () => {
    const files = {
      'src/Button.module.css': '.btn {}', // module sheet, unreferenced — NOT an orphan finding
      'src/index.css': 'body {}',
      'src/main.tsx': `// import './index.css';\nimport App from './App';`, // commented out — NOT wired
    };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'src/index.css' }]);
  });

  it('a stylesheet wired in nuxt.config `css: []` is NOT orphan (ShopSphere/Nuxt autopsy 2026-07-19)', () => {
    const files = {
      'assets/css/main.css': 'body {}',
      // Nuxt wires CSS by declaration, not by `import` — the `~/` alias resolves to the same filename key.
      'nuxt.config.ts': `export default defineNuxtConfig({\n  css: ['~/assets/css/main.css'],\n});`,
      'app.vue': `<template><NuxtPage /></template>`,
    };
    expect(findOrphanStylesheets(files)).toHaveLength(0);
  });

  it('a commented-out css entry in a config file does NOT count as wired', () => {
    const files = {
      'assets/css/main.css': 'body {}',
      'nuxt.config.ts': `export default defineNuxtConfig({\n  // css: ['~/assets/css/main.css'],\n});`,
    };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'assets/css/main.css' }]);
  });
});

describe('injectGlobalStylesheetImport — the deterministic fix', () => {
  it('injects the import into the entry module and clears the orphan', () => {
    const files = {
      'src/index.css': 'body { margin: 0; }',
      'src/main.tsx': `import App from './App';\nexport {};`,
    };
    const { files: out, injected } = injectGlobalStylesheetImport(files);
    expect(injected).toEqual([{ stylesheet: 'src/index.css', entry: 'src/main.tsx' }]);
    expect(out['src/main.tsx'].startsWith(`import './index.css';`)).toBe(true);
    expect(findOrphanStylesheets(out)).toHaveLength(0);
  });

  it('does NOT guess an importer for a feature-level sheet (left to the LLM repair pass)', () => {
    const files = {
      'src/components/Sidebar.css': '.sidebar {}', // not a global name — injection must not fire
      'src/main.tsx': `import App from './App';`,
    };
    const { injected } = injectGlobalStylesheetImport(files);
    expect(injected).toHaveLength(0);
  });

  it('no entry module → no injection (report finding only), and a wired project is untouched', () => {
    const noEntry = { 'src/index.css': 'body {}', 'src/App.tsx': 'export default () => null;' };
    expect(injectGlobalStylesheetImport(noEntry).injected).toHaveLength(0);
    const wired = { 'src/index.css': 'body {}', 'src/main.tsx': `import './index.css';` };
    expect(injectGlobalStylesheetImport(wired).files).toBe(wired); // same reference — untouched
  });

  it('analyzeProjectIntegrity reports the orphan (ok=false) and the repair instruction names it', () => {
    const files = { 'src/index.css': 'body {}', 'src/App.tsx': 'export default () => null;' };
    const report = analyzeProjectIntegrity(files);
    expect(report.ok).toBe(false);
    expect(report.orphanStylesheets).toEqual([{ stylesheet: 'src/index.css' }]);
    expect(integrityRepairInstruction(report)).toContain('ORPHAN STYLESHEET');
  });
});

// === MIXED IMPORT SPECIFIERS (FitPulse autopsy 2026-07-17) =========================================
// ThemeContext was imported as './context/ThemeContext' in one file and 'context/ThemeContext'
// (baseUrl form) in another — the in-browser bundler instantiated the module TWICE → two React
// contexts → "useTheme must be used within a ThemeProvider" crash only the user's preview showed.
import { findMixedImportSpecifiers, normalizeImportSpecifiers, resolveProjectSpecifier, relativeSpecifier, codePositions } from './ProjectIntegrityChecks';

describe('findMixedImportSpecifiers — the duplicate-module-instance crash class', () => {
  const FILES = {
    'src/context/ThemeContext.tsx': `import { createContext } from 'react';\nexport const useTheme = () => {};\nexport default function ThemeProvider(){return null}`,
    'src/main.tsx': `import ThemeProvider from './context/ThemeContext';`,
    'src/App.tsx': `import { useTheme } from 'context/ThemeContext';`, // baseUrl form — SAME module
  };

  it('flags the FitPulse shape: relative + baseUrl specifiers for one module', () => {
    const mixed = findMixedImportSpecifiers(FILES);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].module).toBe('src/context/ThemeContext.tsx');
    expect(mixed[0].specifiers.sort()).toEqual(['./context/ThemeContext', 'context/ThemeContext']);
  });

  it('consistent imports (one style everywhere) are clean, and package imports never count', () => {
    const clean = {
      'src/a.tsx': `import { x } from './lib/util';\nimport React from 'react';`,
      'src/b.tsx': `import { x } from '../src/lib/util';`, // resolves elsewhere (escapes) — ignored
      'src/lib/util.ts': 'export const x = 1;',
    };
    expect(findMixedImportSpecifiers(clean)).toHaveLength(0);
  });

  it('@/ alias vs relative also counts as mixed', () => {
    const files = {
      'src/hooks/useX.ts': 'export const useX = () => 1;',
      'src/a.tsx': `import { useX } from '@/hooks/useX';`,
      'src/b.tsx': `import { useX } from './hooks/useX';`,
    };
    expect(findMixedImportSpecifiers(files)).toHaveLength(1);
  });
});

describe('normalizeImportSpecifiers — the deterministic fix', () => {
  it('rewrites every import of the mixed module to the canonical relative form (crash gone)', () => {
    const files = {
      'src/context/ThemeContext.tsx': 'export const useTheme = () => {};',
      'src/main.tsx': `import ThemeProvider from './context/ThemeContext';`,
      'src/App.tsx': `import { useTheme } from 'context/ThemeContext';`,
      'src/components/Header.tsx': `import { useTheme } from '@/context/ThemeContext';`,
    };
    const { files: out, rewrites } = normalizeImportSpecifiers(files);
    expect(out['src/App.tsx']).toContain(`from './context/ThemeContext'`);
    expect(out['src/components/Header.tsx']).toContain(`from '../context/ThemeContext'`);
    expect(out['src/main.tsx']).toBe(files['src/main.tsx']); // already canonical — untouched
    expect(rewrites.length).toBe(2);
    expect(findMixedImportSpecifiers(out)).toHaveLength(0); // verified fixed
  });

  it('a clean project is returned untouched (same reference)', () => {
    const files = { 'src/a.tsx': `import { x } from './b';`, 'src/b.ts': 'export const x = 1;' };
    expect(normalizeImportSpecifiers(files).files).toBe(files);
  });

  it('resolveProjectSpecifier + relativeSpecifier basics (suffixes, index, escape-safety)', () => {
    const files = { 'src/lib/index.ts': 'export {}', 'src/x.ts': 'export {}' };
    expect(resolveProjectSpecifier(files, 'src/a.tsx', './lib')).toBe('src/lib/index.ts');
    expect(resolveProjectSpecifier(files, 'src/a.tsx', './x')).toBe('src/x.ts');
    expect(resolveProjectSpecifier(files, 'src/a.tsx', 'react')).toBe(null);
    expect(resolveProjectSpecifier(files, 'src/a.tsx', '../../../etc/passwd')).toBe(null);
    expect(relativeSpecifier('src/components/Header.tsx', 'src/context/ThemeContext.tsx')).toBe('../context/ThemeContext');
    expect(relativeSpecifier('src/main.tsx', 'src/lib/index.ts')).toBe('./lib');
  });
});

// ShopKhata autopsy 2026-07-17: a full-stack build wrote frontend/src/main.jsx (createRoot().render)
// while the scaffold's own src/main.tsx still mounted a root — two entry points, so the preview
// booted the wrong/root app. A well-formed app has exactly ONE root mount; 2+ is a guaranteed defect.
describe('findDuplicateEntryPoints — duplicate React roots (ShopKhata two-mains)', () => {
  it('flags 2+ files that mount a root (the exact ShopKhata shape)', () => {
    const files = {
      'src/main.tsx': `import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<App/>);`,
      'frontend/src/main.jsx': `import ReactDOM from 'react-dom/client';\nReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
      'src/App.tsx': `export default function App(){ return null; }`,
    };
    const dup = findDuplicateEntryPoints(files);
    expect(dup).toHaveLength(1);
    expect(dup[0].entries).toEqual(['frontend/src/main.jsx', 'src/main.tsx']);
  });

  it('counts the legacy ReactDOM.render entry too', () => {
    const files = {
      'src/index.tsx': `import ReactDOM from 'react-dom';\nReactDOM.render(<App/>, document.getElementById('root'));`,
      'src/main.tsx': `import { createRoot } from 'react-dom/client';\ncreateRoot(el).render(<App/>);`,
    };
    expect(findDuplicateEntryPoints(files)).toHaveLength(1);
  });

  it('a SINGLE entry (the normal app) is NEVER flagged', () => {
    const files = {
      'src/main.tsx': `import { createRoot } from 'react-dom/client';\ncreateRoot(el).render(<App/>);`,
      'src/App.tsx': `export default function App(){ return null; }`,
      'src/components/Button.tsx': `export const Button = () => null;`,
    };
    expect(findDuplicateEntryPoints(files)).toHaveLength(0);
  });

  it('a commented-out root mount does not count', () => {
    const files = {
      'src/main.tsx': `createRoot(el).render(<App/>);`,
      'src/old.tsx': `// createRoot(el).render(<Old/>);\nexport const x = 1;`,
    };
    expect(findDuplicateEntryPoints(files)).toHaveLength(0);
  });

  it('analyzeProjectIntegrity.ok is false when duplicate entries exist, and the repair names both files', () => {
    const files = {
      'src/main.tsx': `createRoot(a).render(<App/>);`,
      'frontend/src/main.jsx': `createRoot(b).render(<App/>);`,
    };
    const report = analyzeProjectIntegrity(files);
    expect(report.ok).toBe(false);
    expect(report.duplicateEntryPoints).toHaveLength(1);
    const instr = integrityRepairInstruction(report);
    expect(instr).toContain('DUPLICATE ENTRY POINTS');
    expect(instr).toContain('frontend/src/main.jsx');
    expect(instr).toContain('src/main.tsx');
  });
});

// THE bug (TaskForge autopsy, 2026-07-18): a Next.js-shaped app driven as vite-react → the builder wrote
// the SAME components under app/, src/app/, AND src/components/, interfaces drifted, tsc errored, and the
// agent could not delete the dead directory (self-destruct guard) → 2-hour loop → timeout.
describe('findDuplicateComponentModules — same module under 2+ convention roots (TaskForge)', () => {
  const stub = 'export const X = 1;';

  it('THE case: IssueBoard/Column.tsx under app/ and src/ is one duplicate module', () => {
    const files = {
      'app/components/IssueBoard/Column.tsx': stub,
      'src/components/IssueBoard/Column.tsx': stub,
    };
    const dups = findDuplicateComponentModules(files);
    expect(dups).toHaveLength(1);
    expect(dups[0].module).toBe('components/IssueBoard/Column.tsx');
    expect(dups[0].copies).toEqual(['app/components/IssueBoard/Column.tsx', 'src/components/IssueBoard/Column.tsx']);
  });

  it('groups all three roots (app/, src/app/, src/) for the same module', () => {
    const files = {
      'app/components/Dashboard.tsx': stub,
      'src/app/components/Dashboard.tsx': stub,
      'src/components/Dashboard.tsx': stub,
    };
    const dups = findDuplicateComponentModules(files);
    expect(dups).toHaveLength(1);
    expect(dups[0].copies).toHaveLength(3);
  });

  it('does NOT flag distinct modules that merely share a basename in unrelated feature dirs', () => {
    // src/features/a/index.ts vs src/features/b/index.ts → different convention-relative paths, no collision.
    const files = {
      'src/features/a/index.ts': stub,
      'src/features/b/index.ts': stub,
    };
    expect(findDuplicateComponentModules(files)).toHaveLength(0);
  });

  it('a single copy under one root is not a duplicate', () => {
    expect(findDuplicateComponentModules({ 'src/components/Column.tsx': stub })).toHaveLength(0);
  });

  it('files outside any convention root are ignored (no false positives)', () => {
    expect(findDuplicateComponentModules({ 'lib/util.ts': stub, 'scripts/util.ts': stub })).toHaveLength(0);
  });

  it('analyzeProjectIntegrity.ok is false and the repair tells the agent to make re-export stubs', () => {
    const files = {
      'app/components/IssueBoard/Column.tsx': stub,
      'src/components/IssueBoard/Column.tsx': stub,
    };
    const report = analyzeProjectIntegrity(files);
    expect(report.ok).toBe(false);
    expect(report.duplicateComponentModules).toHaveLength(1);
    const instr = integrityRepairInstruction(report);
    expect(instr).toContain('DUPLICATE MODULE');
    expect(instr).toContain('re-export');
    expect(instr).toContain('delete the directory'); // guard-safe guidance present (do NOT delete)
  });
});

// PREVENTION (TaskForge — the admin's point: fix WHY duplicates get created, not just cleanup). The
// write-time guard uses these pure helpers to refuse creating a parallel copy of an existing module.
describe('conventionRootAlternatives / duplicateModuleTarget — write-time duplicate prevention', () => {
  it('lists the same module under the other convention roots', () => {
    expect(conventionRootAlternatives('app/components/IssueBoard/Column.tsx')).toEqual([
      'src/app/components/IssueBoard/Column.tsx',
      'src/components/IssueBoard/Column.tsx',
    ]);
    expect(conventionRootAlternatives('lib/x.ts')).toEqual([]); // not under a convention root
  });

  it('flags a write that duplicates an existing module under a different root', () => {
    const existing = ['src/components/IssueBoard/Column.tsx', 'src/App.tsx'];
    expect(duplicateModuleTarget('app/components/IssueBoard/Column.tsx', existing))
      .toBe('src/components/IssueBoard/Column.tsx');
  });

  it('does NOT flag a brand-new module or an in-place edit of the same path', () => {
    expect(duplicateModuleTarget('src/components/New.tsx', ['src/App.tsx'])).toBeNull();
    // same exact path present → that's an edit, not a cross-root duplicate:
    expect(duplicateModuleTarget('src/components/Column.tsx', ['src/components/Column.tsx'])).toBeNull();
  });

  it('does NOT flag non-source files or files outside a convention root', () => {
    expect(duplicateModuleTarget('app/data/x.json', ['src/data/x.json'])).toBeNull(); // not a source file
    expect(duplicateModuleTarget('lib/util.ts', ['scripts/util.ts'])).toBeNull(); // no convention root
  });
});

// ═══ normalizeImportSpecifiers must never CORRUPT a file (autopsy 2026-07-27, buildId d1623410) ═══
// The blind regex `(['"])SPEC\1` → `'CANONICAL'` matched quoted text ANYWHERE and always emitted
// SINGLE quotes. On a real build it rewrote a single-quoted *documentation* string in
// src/server/lib/DbConfigGenerator.ts that contains `import { db } from "@/lib/firebase"`, producing
//   instructions: 'Copy config. Then import { db } from '../../lib/firebase'. Done.',
// which terminates the enclosing string → the reported `Expected identifier but found "."`, and the
// whole build failed to compile. It also silently rewrote test fixtures inside template literals.
describe('normalizeImportSpecifiers — never corrupts strings/comments/templates', () => {
  const base = {
    'src/lib/firebase.ts': 'export const db = {};',
    'src/components/A.tsx': "import { db } from '../lib/firebase';\n", // makes the module "mixed"
  };
  const run = (extra: Record<string, string>) =>
    normalizeImportSpecifiers({ ...base, 'src/components/B.tsx': "import { db } from '@/lib/firebase';\n", ...extra });

  it('THE EXACT BUG: a single-quoted doc string containing a double-quoted specifier is untouched', () => {
    const doc = `export const cfg = {\n  instructions: 'Copy config. Then import { db } from "@/lib/firebase". Done.',\n};\n`;
    const out = run({ 'src/server/lib/DbConfigGenerator.ts': doc });
    expect(out.files['src/server/lib/DbConfigGenerator.ts']).toBe(doc);
    // and the result must still parse (the actual failure mode that killed the build)
    expect(() => new Function(out.files['src/server/lib/DbConfigGenerator.ts'].replace(/export /g, ''))).not.toThrow();
  });

  it('a code-generator TEMPLATE literal emitting an import is untouched', () => {
    const gen = 'export const t = `import { db } from "@/lib/firebase";`;\n';
    expect(run({ 'src/gen/Tmpl.ts': gen }).files['src/gen/Tmpl.ts']).toBe(gen);
  });

  it('a comment mentioning an import is untouched', () => {
    const c = "// see: import { db } from '@/lib/firebase'\nexport const x = 1;\n";
    expect(run({ 'src/notes.ts': c }).files['src/notes.ts']).toBe(c);
  });

  it('PRESERVES the original quote character (a single-quoted replacement is what broke the string)', () => {
    const out = run({ 'src/components/C.tsx': 'import { db } from "@/lib/firebase";\n' });
    expect(out.files['src/components/C.tsx']).toBe('import { db } from "../lib/firebase";\n');
  });

  it('still rewrites every genuine specifier form (the feature must not be gutted)', () => {
    const out = run({
      'src/components/C.tsx': 'import { db } from "@/lib/firebase";\n',
      'src/components/D.tsx': "const m = await import('@/lib/firebase');\n",
      'src/components/E.tsx': "import '@/lib/firebase';\n",
      'src/components/F.tsx': "export { db } from '@/lib/firebase';\n",
    });
    expect(out.files['src/components/B.tsx']).toContain("'../lib/firebase'");
    expect(out.files['src/components/C.tsx']).toContain('"../lib/firebase"');
    expect(out.files['src/components/D.tsx']).toContain("import('../lib/firebase')");
    expect(out.files['src/components/E.tsx']).toBe("import '../lib/firebase';\n");
    expect(out.files['src/components/F.tsx']).toContain("'../lib/firebase'");
  });
});

describe('codePositions — conservative code/string/comment mask', () => {
  const codeStr = (src: string) => {
    const m = codePositions(src);
    return Array.from(src, (ch, i) => (m[i] ? ch : ' ')).join('');
  };

  it('marks ordinary code and blanks string contents', () => {
    const out = codeStr(`const a = 'hi';`);
    expect(out).toContain('const a =');  // code kept
    expect(out).toContain(';');
    expect(out).not.toContain('hi');     // string contents masked out
  });

  it('blanks line and block comments', () => {
    expect(codeStr(`a; // x\nb;`).split('\n')[0].trim()).toBe('a;');
    expect(codeStr(`a; /* x */ b;`)).toContain('a;');
    expect(codeStr(`a; /* x */ b;`)).not.toContain('/*');
  });

  it('treats code inside a template ${…} as code, but the literal text as not-code', () => {
    const out = codeStr('`text ${ val } more`');
    expect(out).toContain('val');    // the interpolation is real code
    expect(out).not.toContain('text'); // the literal part is not
  });

  it('handles escaped quotes without losing track of the string end', () => {
    expect(codeStr(`const a = 'it\\'s'; b;`)).toContain('b;');
  });

  it('does not mistake a division for a regex literal', () => {
    expect(codeStr('const r = a / b; const s = 1;')).toContain('const s = 1;');
  });
});

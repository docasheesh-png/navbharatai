import { describe, it, expect } from 'vitest';
import {
  findFocusOwners,
  findDuplicateStylesheets,
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

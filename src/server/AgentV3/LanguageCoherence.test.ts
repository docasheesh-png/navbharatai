import { describe, it, expect } from 'vitest';
import { hasTsOnlySyntax, reconcileLanguageExtensions } from './LanguageCoherence';

describe('hasTsOnlySyntax', () => {
  it('detects the exact clock failure — TS syntax pasted into a .jsx file', () => {
    // The real src/App.jsx from the deep-test App #1 report (fix-attempt-1 version).
    const app = `import React, { useState, useEffect } from 'react';\nimport type { DateFormat, ClockState } from "./types/clock";\nconst Clock = ({ format }: ClockProps) => { const [s, setS] = useState<ClockState>({ time: '' }); return <div>{s.time}</div>; };`;
    expect(hasTsOnlySyntax(app)).toBe(true);
  });
  it('detects enum / interface / declare', () => {
    expect(hasTsOnlySyntax('export enum Color { Red, Blue }')).toBe(true);
    expect(hasTsOnlySyntax('export interface Props { a: number }')).toBe(true);
    expect(hasTsOnlySyntax('declare const x: number;')).toBe(true);
    expect(hasTsOnlySyntax('export type ID = string;')).toBe(true);
  });
  it('does NOT flag ordinary JavaScript (no false positives)', () => {
    expect(hasTsOnlySyntax(`import React from 'react';\nconst App = () => { const [n, setN] = React.useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; };\nexport default App;`)).toBe(false);
    expect(hasTsOnlySyntax(`const obj = { a: 1, b: 2 };\nconst x = cond ? 'a' : 'b';`)).toBe(false); // colons in object/ternary
    expect(hasTsOnlySyntax(`fetch('http://x.com'); // interface here is a comment word`)).toBe(false); // 'interface' only in a comment/string
  });
  it('does not false-trigger on TS keywords appearing inside strings', () => {
    expect(hasTsOnlySyntax(`const msg = "please use the settings interface enum";`)).toBe(false);
  });
});

describe('reconcileLanguageExtensions — the clock cascade never starts', () => {
  it('renames a TS-bearing App.jsx to App.tsx; the extension-less importer needs no change', () => {
    const files = {
      'index.html': '<!doctype html><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': `import React from 'react';\nimport App from './App';\nimport './index.css';\nReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
      'src/App.jsx': `import React, { useState } from 'react';\nexport interface ClockState { time: string }\nconst Clock = () => { const [s] = useState<ClockState>({ time: '' }); return <div>{s.time}</div>; };\nexport default Clock;`,
      'src/index.css': 'body { margin: 0; }',
    };
    const { files: out, renames } = reconcileLanguageExtensions(files);
    expect(renames).toEqual([{ from: 'src/App.jsx', to: 'src/App.tsx', reason: expect.stringMatching(/interface/) }]);
    expect(out['src/App.tsx']).toBeDefined();
    expect(out['src/App.jsx']).toBeUndefined();
    // main.jsx is plain JS → not renamed; its extension-less `import App from './App'` still resolves.
    expect(out['src/main.jsx']).toBeDefined();
    expect(out['src/main.jsx']).toContain("import App from './App'");
    // index.html referenced main.jsx (unchanged) → untouched.
    expect(out['index.html']).toContain('/src/main.jsx');
  });

  it('rewrites an explicit HTML entry reference when the ENTRY file is renamed', () => {
    const files = {
      'index.html': '<script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': `import type { Cfg } from './cfg';\nconst c: Cfg = load(); render(c);`,
    };
    const { files: out, renames } = reconcileLanguageExtensions(files);
    // main.jsx has `import type` → renamed to main.tsx, and index.html's src is rewritten to match.
    expect(renames.map((r) => r.to)).toContain('src/main.tsx');
    expect(out['index.html']).toContain('/src/main.tsx');
    expect(out['index.html']).not.toContain('/src/main.jsx');
  });

  it('rewrites an explicit-extension import reference', () => {
    const files = {
      'src/main.jsx': `import { things } from './data.js';\nconsole.log(things);`,
      'src/data.js': `export interface Thing { id: number }\nexport const things: Thing[] = [];`,
    };
    const { files: out } = reconcileLanguageExtensions(files);
    expect(out['src/data.ts']).toBeDefined();       // no JSX → .ts, not .tsx
    expect(out['src/main.jsx']).toContain("'./data.ts'");
  });

  it('a .js file that CONTAINS JSX becomes .tsx (not .ts)', () => {
    const files = { 'src/Widget.js': `export interface P { x: number }\nexport default (p: P) => <span>{p.x}</span>;` };
    const { renames } = reconcileLanguageExtensions(files);
    expect(renames[0].to).toBe('src/Widget.tsx');
  });

  it('is a no-op for an all-JavaScript project (nothing renamed)', () => {
    const files = {
      'src/main.jsx': `import App from './App';\nrender(<App />);`,
      'src/App.jsx': `export default () => <div>hi</div>;`,
    };
    const { renames } = reconcileLanguageExtensions(files);
    expect(renames).toHaveLength(0);
  });

  it('leaves already-TypeScript files alone and never clobbers an existing target', () => {
    const files = {
      'src/App.tsx': `export interface P {}\nexport default () => <div/>;`,   // already .tsx
      'src/util.js': `export interface Q {}\nexport const q = 1;`,           // would want util.ts
      'src/util.ts': `export const existing = true;`,                       // target already exists
    };
    const { files: out, renames } = reconcileLanguageExtensions(files);
    // App.tsx stays; util.js is NOT renamed because util.ts already exists (no clobber).
    expect(renames).toHaveLength(0);
    expect(out['src/util.js']).toBeDefined();
    expect(out['src/util.ts']).toBe('export const existing = true;');
  });
});

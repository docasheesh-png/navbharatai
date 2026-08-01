import { describe, it, expect } from 'vitest';
import { analyzeHooksRules, hookViolationWriteNote } from './HooksRulesAnalysis';

const wrap = (body: string) => ({ 'src/App.tsx': body });

describe('analyzeHooksRules — clean code (no false positives)', () => {
  it('accepts a normal component with top-level hooks', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState, useEffect } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        useEffect(() => { document.title = String(count); }, [count]);
        return <div onClick={() => setCount(count + 1)}>{count}</div>;
      }
    `));
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.filesScanned).toBe(1);
  });

  it('accepts a custom hook (useX) with top-level hooks', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState, useCallback } from 'react';
      export function useCounter(initial) {
        const [n, setN] = useState(initial);
        const inc = useCallback(() => setN(v => v + 1), []);
        return { n, inc };
      }
    `));
    expect(r.ok).toBe(true);
  });

  it('does not flag a non-hook function that merely starts with "use"-like text', async () => {
    const r = await analyzeHooksRules(wrap(`
      function App() {
        const user = getUser();
        const used = username();
        return null;
      }
    `));
    expect(r.ok).toBe(true);
  });

  it('does not flag setState called inside an event handler (only hooks matter)', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState } from 'react';
      export function App() {
        const [v, setV] = useState(0);
        return <button onClick={() => { if (v > 0) setV(0); }}>x</button>;
      }
    `));
    expect(r.ok).toBe(true);
  });
});

describe('analyzeHooksRules — violations', () => {
  it('flags a hook called conditionally inside an if', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState } from 'react';
      export function App({ enabled }) {
        if (enabled) {
          const [v, setV] = useState(0);
        }
        return null;
      }
    `));
    expect(r.ok).toBe(false);
    expect(r.counts['conditional-hook']).toBe(1);
    expect(r.violations[0].hook).toBe('useState');
    expect(r.violations[0].kind).toBe('conditional-hook');
  });

  it('flags a hook guarded by a && short-circuit', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useMemo } from 'react';
      export function App({ ready }) {
        const value = ready && useMemo(() => compute(), []);
        return <span>{value}</span>;
      }
    `));
    expect(r.counts['conditional-hook']).toBe(1);
  });

  it('flags a hook after an early return', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState } from 'react';
      export function App({ user }) {
        if (!user) return null;
        const [name, setName] = useState(user.name);
        return <div>{name}</div>;
      }
    `));
    expect(r.ok).toBe(false);
    expect(r.counts['hook-after-return']).toBe(1);
    expect(r.violations[0].kind).toBe('hook-after-return');
  });

  it('flags a hook inside a loop', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useEffect } from 'react';
      export function App({ items }) {
        for (let i = 0; i < items.length; i++) {
          useEffect(() => { track(items[i]); }, []);
        }
        return null;
      }
    `));
    expect(r.counts['hook-in-loop']).toBe(1);
    expect(r.violations[0].kind).toBe('hook-in-loop');
  });

  it('flags a hook called from a nested callback (event handler)', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState } from 'react';
      export function App() {
        return <button onClick={() => { const [v] = useState(0); }}>x</button>;
      }
    `));
    expect(r.counts['hook-in-callback']).toBe(1);
    expect(r.violations[0].kind).toBe('hook-in-callback');
  });

  it('flags a hook called inside a .map callback', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useRef } from 'react';
      export function List({ rows }) {
        return <>{rows.map(row => { const ref = useRef(null); return <div ref={ref} key={row.id} />; })}</>;
      }
    `));
    expect(r.counts['hook-in-callback']).toBe(1);
  });

  it('reports the correct line number and multiple violations across files', async () => {
    const r = await analyzeHooksRules({
      'src/A.tsx': `import { useState } from 'react';\nexport function A({ x }) {\n  if (x) { useState(0); }\n  return null;\n}\n`,
      'src/B.tsx': `import { useEffect } from 'react';\nexport function B() {\n  for (;;) { useEffect(() => {}); }\n  return null;\n}\n`,
    });
    expect(r.violations).toHaveLength(2);
    expect(r.filesScanned).toBe(2);
    const a = r.violations.find(v => v.file === 'src/A.tsx')!;
    expect(a.line).toBe(3);
  });

  it('does not flag a hook that is legitimately at the top level even with a later return', async () => {
    const r = await analyzeHooksRules(wrap(`
      import { useState } from 'react';
      export function App({ user }) {
        const [name, setName] = useState('');
        if (!user) return null;
        return <div>{name}</div>;
      }
    `));
    expect(r.ok).toBe(true);
  });
});

describe('analyzeHooksRules — robustness', () => {
  it('skips non-React files and returns honest zeros', async () => {
    const r = await analyzeHooksRules({ 'README.md': '# uses hooks conceptually', 'data.json': '{}' });
    expect(r.filesScanned).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('does not throw on unparseable content', async () => {
    const r = await analyzeHooksRules({ 'src/broken.tsx': 'export function A( { const useState( <<<' });
    expect(Array.isArray(r.violations)).toBe(true);
  });
});

// M1-S1.1 — the WRITE-TIME steering note (prevent-not-heal): when a just-written React file has a
// Rules-of-Hooks violation, the write result carries a clear, model-actionable fix instruction so the
// bug is corrected the same turn, not shipped and caught post-build.
describe('hookViolationWriteNote — write-time steering note', () => {
  it('returns a fix note for a conditional hook (the crashing class)', async () => {
    const r = await analyzeHooksRules({ 'src/Comp.tsx': `
      import { useState } from 'react';
      export function Comp({ on }: { on: boolean }) {
        if (on) { const [x] = useState(0); return <div>{x}</div>; }
        return null;
      }
    ` });
    expect(r.ok).toBe(false); // sanity: analyzer flags it
    const note = hookViolationWriteNote(r);
    expect(note).toContain('RULES OF HOOKS');
    expect(note).toContain('useState');
    expect(note).toMatch(/:\d+:/); // file:line label
  });

  it('labels each violation with its FILE (multi-file batch clarity, M1-S1.2)', async () => {
    const r = await analyzeHooksRules({
      'src/Good.tsx': `import { useState } from 'react';\nexport function Good(){ const [x]=useState(0); return <div>{x}</div>; }`,
      'src/Bad.tsx': `import { useState } from 'react';\nexport function Bad({on}:{on:boolean}){ if(on){ const [x]=useState(0); return <div>{x}</div>; } return null; }`,
    });
    const note = hookViolationWriteNote(r);
    expect(note).toContain('src/Bad.tsx'); // names the offending file
    expect(note).not.toContain('src/Good.tsx'); // the clean file is not flagged
  });

  it('returns a note for a hook after an early return', async () => {
    const r = await analyzeHooksRules({ 'src/Comp.tsx': `
      import { useEffect } from 'react';
      export function Comp({ ready }: { ready: boolean }) {
        if (!ready) return null;
        useEffect(() => {}, []);
        return <div/>;
      }
    ` });
    const note = hookViolationWriteNote(r);
    expect(note).toContain('useEffect');
    expect(note.toLowerCase()).toContain('early return');
  });

  it('returns EMPTY for a clean file (hooks at the top level) — never nags a correct file', async () => {
    const r = await analyzeHooksRules({ 'src/Comp.tsx': `
      import { useState, useEffect } from 'react';
      export function Comp() {
        const [x, setX] = useState(0);
        useEffect(() => { setX(1); }, []);
        return <div>{x}</div>;
      }
    ` });
    expect(r.ok).toBe(true);
    expect(hookViolationWriteNote(r)).toBe('');
  });

  it('is empty for a report with no violations, junk, or missing fields', () => {
    expect(hookViolationWriteNote({ violations: [], filesScanned: 1, counts: { 'conditional-hook': 0, 'hook-after-return': 0, 'hook-in-loop': 0, 'hook-in-callback': 0 }, ok: true })).toBe('');
    expect(hookViolationWriteNote(undefined as never)).toBe('');
  });
});

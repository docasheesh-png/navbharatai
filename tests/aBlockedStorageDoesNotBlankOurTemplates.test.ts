// AUTOPSY 4a1c0157 (2026-10-01): our own templates read browser storage without a guard.
//
// The post-build reviewer on a "Login page" build said it plainly: reading `localStorage` in a
// `useState` initializer and in `ThemeToggle` "will crash the whole app if storage is disabled or in
// a sandboxed/private context". Both lines were OURS. The login form and the light/dark switch come
// from the golden scaffold we pre-seed, and the switch ships in EVERY scaffold. When storage is
// switched off (a private window, a sandboxed frame, a storage quota), reading it throws. A throw in
// the first render blanks the whole page.
//
// The class was already known, which is what makes this a sibling hunt rather than a discovery.
// Half the scaffolds (billing, the Panchang, the Gita, the pro shell) wrap every access in
// try/catch with a comment that says why. The other half were written before that and never
// revisited. So the lock is a census, not a list of fixed lines. It parses every file a golden
// scaffold writes into a user's app with the real TypeScript parser, and fails on any
// `localStorage` access that is not inside a `try` block. A new template that forgets fails CI.
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';

/** Every `localStorage.x` access in `source` that no enclosing `try { … }` block covers. */
function unguardedStorageAccesses(path: string, source: string): string[] {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const isStorage = (e: ts.Expression): boolean =>
    (ts.isIdentifier(e) && e.text === 'localStorage')
    || (ts.isPropertyAccessExpression(e) && e.name.text === 'localStorage');
  const insideTry = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      const parent = n.parent;
      if (parent && ts.isTryStatement(parent) && parent.tryBlock === n) return true;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isStorage(node.expression) && !insideTry(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push(`${path}:${line + 1} ${node.getText(sf)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const CODE = /\.(tsx?|jsx?|mjs|cjs)$/;

describe('a blocked browser storage never blanks one of our templates', () => {
  it('every localStorage access in every golden scaffold is inside a try block', () => {
    const offenders: string[] = [];
    let accesses = 0;
    for (const s of GOLDEN_SCAFFOLDS) {
      for (const [path, content] of Object.entries(goldenScaffoldFiles(s))) {
        if (!CODE.test(path)) continue;
        accesses += (content.match(/localStorage\./g) ?? []).length;
        for (const o of unguardedStorageAccesses(path, content)) offenders.push(`${s.id} ${o}`);
      }
    }
    // Canary: a census that found nothing to check would pass for ever.
    expect(accesses).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('the checker itself sees an unguarded read and accepts a guarded one', () => {
    const bad = `import { useState } from 'react';\nexport function A() { const [v] = useState(() => localStorage.getItem('k')); return v; }\n`;
    const good = `import { useState } from 'react';\nexport function A() { const [v] = useState(() => { try { return localStorage.getItem('k'); } catch { return null; } }); return v; }\n`;
    expect(unguardedStorageAccesses('src/App.tsx', bad)).toHaveLength(1);
    expect(unguardedStorageAccesses('src/App.tsx', good)).toEqual([]);
    // A `typeof localStorage` check is not an access, and `window.localStorage.x` is one.
    expect(unguardedStorageAccesses('a.ts', `const ok = typeof localStorage !== 'undefined';`)).toEqual([]);
    expect(unguardedStorageAccesses('a.ts', `window.localStorage.setItem('k', 'v');`)).toHaveLength(1);
  });

  it('the login template still remembers the email, through the guarded helpers', () => {
    const login = GOLDEN_SCAFFOLDS.find((s) => /login/i.test(s.id));
    expect(login, 'login scaffold').toBeTruthy();
    expect(login!.appTsx).toContain('function readRemembered()');
    expect(login!.appTsx).toContain('useState(readRemembered)');
    expect(login!.appTsx).toContain('writeRemembered(remember ? email : null)');
  });
});

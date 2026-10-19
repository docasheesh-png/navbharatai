import { describe, it, expect } from 'vitest';
import { tsFileHasJsx, tsxRelocationFor, reconcileLanguageExtensions } from '../src/server/AgentV3/LanguageCoherence';

const COMPONENT = `import React from 'react';\nexport function Card({ t }: { t: string }) {\n  return <div className="c">{t}</div>;\n}\n`;
const GENERICS = `export function first<T>(xs: Array<T>): T | undefined { return xs[0]; }\nconst m = new Map<string, number>();\nconst x = a < b && c > d;\n`;

describe('JSX written into a .ts file is moved to .tsx (owner item 3)', () => {
  it('detects JSX but not generics, comparisons or HTML in strings', () => {
    expect(tsFileHasJsx(COMPONENT)).toBe(true);
    expect(tsFileHasJsx(`export const F = () => <><Foo /></>;`)).toBe(true);
    expect(tsFileHasJsx(`export const F = () => <Foo bar={1} />;`)).toBe(true);
    expect(tsFileHasJsx(GENERICS)).toBe(false);
    expect(tsFileHasJsx("const html = '<div></div>'; const t = `<p>${1}</p>`; // </b>")).toBe(false);
  });

  it('relocates a new .ts file with JSX to .tsx', () => {
    expect(tsxRelocationFor('src/Card.ts', COMPONENT, new Set(['src/App.tsx']), ["import { Card } from './Card';"])).toBe('src/Card.tsx');
  });

  it('refuses when unsafe', () => {
    expect(tsxRelocationFor('src/Card.ts', COMPONENT, null, [])).toBeNull(); // unknown tree
    expect(tsxRelocationFor('src/Card.ts', COMPONENT, new Set(['src/Card.ts']), [])).toBeNull(); // exists
    expect(tsxRelocationFor('src/Card.ts', COMPONENT, new Set(['src/Card.tsx']), [])).toBeNull(); // target exists
    expect(tsxRelocationFor('src/Card.ts', COMPONENT, new Set(), ["import { Card } from './Card.ts';"])).toBeNull(); // explicit ext
    expect(tsxRelocationFor('src/types.d.ts', COMPONENT, new Set(), [])).toBeNull();
    expect(tsxRelocationFor('src/util.ts', GENERICS, new Set(), [])).toBeNull();
    expect(tsxRelocationFor('src/Card.ts', COMPONENT, new Set(), [], { AGENTV3_TS_JSX_RENAME: 'off' })).toBeNull();
  });

  it('the pre-write reconcile renames .ts with JSX and rewrites explicit references', () => {
    const r = reconcileLanguageExtensions({ 'src/Card.ts': COMPONENT, 'src/App.tsx': "import { Card } from './Card.ts';", 'src/util.ts': GENERICS });
    expect(Object.keys(r.files).sort()).toEqual(['src/App.tsx', 'src/Card.tsx', 'src/util.ts']);
    expect(r.files['src/App.tsx']).toContain("'./Card.tsx'");
    const off = reconcileLanguageExtensions({ 'src/Card.ts': COMPONENT }, { AGENTV3_TS_JSX_RENAME: 'off' });
    expect(Object.keys(off.files)).toEqual(['src/Card.ts']);
    expect(reconcileLanguageExtensions({ 'src/Card.ts': COMPONENT, 'src/Card.tsx': 'x' }).renames).toEqual([]);
  });
});

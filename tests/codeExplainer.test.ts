import { describe, it, expect } from 'vitest';
import { explainCode } from '../src/server/AgentV3/CodeExplainer';

describe('explainCode', () => {
  it('is empty-safe (blank input → honest empty result, no throw)', () => {
    const r = explainCode('   ');
    expect(r.kind).toBe('empty');
    expect(r.stats.lines).toBe(0);
    expect(r.complexity.label).toBe('Low');
  });

  it('never throws on non-string input', () => {
    // @ts-expect-error — intentional wrong type
    expect(() => explainCode(null)).not.toThrow();
    // @ts-expect-error — intentional wrong type
    expect(explainCode(42).kind).toBe('empty');
  });

  it('identifies a React component with hooks + state + effects', () => {
    const code = `import React, { useState, useEffect } from 'react';
export default function Counter() {
  const [n, setN] = useState(0);
  useEffect(() => { document.title = 'n=' + n; }, [n]);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}`;
    const r = explainCode(code, 'Counter.tsx');
    expect(r.kind).toBe('React component');
    expect(r.stats.hooks).toBeGreaterThanOrEqual(2);
    expect(r.patterns).toContain('State management');
    expect(r.patterns).toContain('Side effects (lifecycle)');
    expect(r.stats.imports).toBe(1);
    expect(r.summary).toContain('React component');
  });

  it('identifies a custom hook', () => {
    const code = `import { useState } from 'react';
export function useToggle(initial: boolean) {
  const [on, setOn] = useState(initial);
  return [on, () => setOn(v => !v)] as const;
}`;
    const r = explainCode(code, 'useToggle.ts');
    expect(r.kind).toBe('React hook');
    expect(r.patterns).toContain('State management');
  });

  it('labels a branchy function as higher complexity', () => {
    const simple = explainCode('export const add = (a: number, b: number) => a + b;');
    expect(simple.complexity.label).toBe('Low');

    const branchy = explainCode(`export function classify(n: number) {
  if (n < 0) return 'neg';
  if (n === 0) return 'zero';
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0 && i > 2) continue;
    while (i > 100) break;
  }
  return n > 10 || n < -10 ? 'big' : 'small';
}`);
    expect(branchy.complexity.score).toBeGreaterThan(simple.complexity.score);
    expect(branchy.complexity.label).not.toBe('Low');
  });

  it('suggests error handling for async code without try/catch', () => {
    const code = `export async function load() {
  const res = await fetch('/api/data');
  return res.json();
}`;
    const r = explainCode(code, 'load.ts');
    expect(r.patterns).toContain('Async data / I/O');
    expect(r.refactors.some((s) => /try\/catch/i.test(s))).toBe(true);
  });

  it('flags a keyless list render', () => {
    const code = `export function List({ items }: { items: string[] }) {
  return <ul>{items.map((it) => <li>{it}</li>)}</ul>;
}`;
    const r = explainCode(code, 'List.tsx');
    expect(r.refactors.some((s) => /key/i.test(s))).toBe(true);
  });

  it('recognizes a plain utility module (no JSX, no hooks)', () => {
    const code = `export function slugify(s: string) {
  return s.toLowerCase().replace(/\\s+/g, '-');
}`;
    const r = explainCode(code, 'slugify.ts');
    expect(r.kind).toBe('utility module');
    expect(r.stats.components).toBe(0);
    expect(r.stats.hooks).toBe(0);
  });

  it('detects a stylesheet by filename', () => {
    const r = explainCode('.btn { color: red; }', 'styles.css');
    expect(r.kind).toBe('stylesheet');
  });
});

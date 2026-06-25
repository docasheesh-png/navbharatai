import { describe, it, expect } from 'vitest';
import { reviewEdit, formatReviewResult } from './PostEditReviewer';

describe('reviewEdit', () => {
  it('returns no issues for a well-formed TSX file', () => {
    const content = [
      "import React from 'react';",
      "import { useState } from 'react';",
      '',
      'export function Counter() {',
      '  const [count, setCount] = useState(0);',
      "  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>;",
      '}',
    ].join('\n');
    const result = reviewEdit('src/Counter.tsx', content);
    expect(result.issues).toHaveLength(0);
    expect(result.hasCritical).toBe(false);
  });

  it('flags a stub file with too few real code lines as critical', () => {
    const result = reviewEdit('src/App.tsx', '// TODO: implement\n');
    expect(result.hasCritical).toBe(true);
    expect(result.issues.some((i) => /empty|stub/i.test(i))).toBe(true);
  });

  it('flags consol.log typo', () => {
    const content = [
      "import React from 'react';",
      "import { useState } from 'react';",
      'export function Foo() {',
      '  consol.log("debug");',
      '  return <div/>;',
      '}',
    ].join('\n');
    const result = reviewEdit('src/Foo.tsx', content);
    expect(result.issues.some((i) => i.includes('console.log'))).toBe(true);
  });

  it('flags JSX with no React/react import', () => {
    const content = [
      'export function App() {',
      '  return <div>Hello</div>;',
      '}',
    ].join('\n');
    const result = reviewEdit('src/App.tsx', content);
    expect(result.issues.some((i) => /react/i.test(i))).toBe(true);
  });

  it('flags missing useNavigate import in a tsx file', () => {
    const content = [
      "import React from 'react';",
      'export function Nav() {',
      '  const nav = useNavigate();',
      '  return <button onClick={() => nav("/")}>Home</button>;',
      '}',
    ].join('\n');
    const result = reviewEdit('src/Nav.tsx', content);
    expect(result.issues.some((i) => i.includes('useNavigate'))).toBe(true);
  });

  it('flags ≥3 TODO markers as incomplete implementation', () => {
    const content = [
      "import React from 'react';",
      'export function Incomplete() {',
      '  // TODO: fetch data',
      '  // TODO: show list',
      '  // TODO: add filter',
      '  return <div/>;',
      '}',
    ].join('\n');
    const result = reviewEdit('src/Incomplete.tsx', content);
    expect(result.issues.some((i) => i.includes('TODO'))).toBe(true);
  });

  it('skips non-code files silently', () => {
    const result = reviewEdit('README.md', '# TODO: document everything\nTODO FIXME PLACEHOLDER');
    expect(result.issues).toHaveLength(0);
    expect(result.hasCritical).toBe(false);
  });

  it('does NOT flag a single TODO (below threshold)', () => {
    const content = [
      "import React from 'react';",
      '// TODO: add tests later',
      'export function Fine() { return <div/>; }',
    ].join('\n');
    const result = reviewEdit('src/Fine.tsx', content);
    expect(result.issues.filter((i) => i.includes('TODO'))).toHaveLength(0);
  });
});

describe('formatReviewResult', () => {
  it('returns empty string when no issues', () => {
    expect(formatReviewResult({ issues: [], hasCritical: false }, 'src/App.tsx')).toBe('');
  });

  it('includes the file name in output', () => {
    const out = formatReviewResult({ issues: ['Missing import'], hasCritical: false }, 'src/App.tsx');
    expect(out).toContain('src/App.tsx');
    expect(out).toContain('Missing import');
  });

  it('labels critical issues distinctly', () => {
    const out = formatReviewResult({ issues: ['File is empty'], hasCritical: true }, 'src/foo.tsx');
    expect(out).toContain('CRITICAL');
  });

  it('labels non-critical issues differently from critical', () => {
    const outNormal = formatReviewResult({ issues: ['Typo'], hasCritical: false }, 'x.tsx');
    const outCritical = formatReviewResult({ issues: ['Empty'], hasCritical: true }, 'x.tsx');
    expect(outNormal).not.toContain('CRITICAL');
    expect(outCritical).toContain('CRITICAL');
  });
});

import { describe, it, expect } from 'vitest';
import {
  normalizeProblemFile,
  esbuildMessagesToProblems,
  problemsSummary,
} from '../src/lib/previewProblems';

/** Real preview "Problems" — pure mapping of esbuild errors to workspace-relative diagnostics. */

describe('normalizeProblemFile', () => {
  it('strips the temp-dir prefix to a workspace-relative path', () => {
    expect(normalizeProblemFile('/tmp/nb-preview-xy/src/App.tsx', '/tmp/nb-preview-xy')).toBe('src/App.tsx');
    expect(normalizeProblemFile('/tmp/nb-preview-xy/src/App.tsx', '/tmp/nb-preview-xy/')).toBe('src/App.tsx');
  });
  it('leaves an already-relative path alone and trims a leading ./', () => {
    expect(normalizeProblemFile('src/App.tsx', '/tmp/other')).toBe('src/App.tsx');
    expect(normalizeProblemFile('./src/App.tsx', '/tmp/other')).toBe('src/App.tsx');
  });
});

describe('esbuildMessagesToProblems', () => {
  it('maps text + location into clean problems', () => {
    const msgs = [
      { text: 'Expected ")" but found ";"', location: { file: '/tmp/p/src/App.tsx', line: 12, column: 4 } },
      { text: 'Could not resolve "./missing"', location: { file: '/tmp/p/src/main.tsx', line: 1, column: 0 } },
    ];
    expect(esbuildMessagesToProblems(msgs, '/tmp/p')).toEqual([
      { file: 'src/App.tsx', line: 12, column: 4, message: 'Expected ")" but found ";"' },
      { file: 'src/main.tsx', line: 1, column: 0, message: 'Could not resolve "./missing"' },
    ]);
  });
  it('is defensive: skips empty text, handles missing location and junk', () => {
    expect(esbuildMessagesToProblems(undefined, '/tmp/p')).toEqual([]);
    expect(esbuildMessagesToProblems([{ text: '' }, {} as any], '/tmp/p')).toEqual([]);
    expect(esbuildMessagesToProblems([{ text: 'boom' }], '/tmp/p')).toEqual([
      { file: '', line: 0, column: 0, message: 'boom' },
    ]);
  });
});

describe('problemsSummary', () => {
  it('pluralises honestly', () => {
    expect(problemsSummary([])).toBe('No problems');
    expect(problemsSummary(null)).toBe('No problems');
    expect(problemsSummary([{ file: 'a', line: 1, column: 0, message: 'x' }])).toBe('1 problem');
    expect(problemsSummary([{ file: 'a', line: 1, column: 0, message: 'x' }, { file: 'b', line: 2, column: 0, message: 'y' }])).toBe('2 problems');
  });
});

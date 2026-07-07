import { describe, it, expect } from 'vitest';
import { sanitizeFileMap } from './fileMapSanitize';

// The crash class this locks out (2026-07-07): one undefined/object value in the files map killed the
// WHOLE app at render ("undefined is not an object (evaluating 'ce.split')").
describe('sanitizeFileMap — only strings may enter the files map', () => {
  it('keeps real string entries untouched', () => {
    expect(sanitizeFileMap({ 'src/App.tsx': 'export {}', 'a.css': '' }))
      .toEqual({ 'src/App.tsx': 'export {}', 'a.css': '' });
  });
  it('drops undefined/null/object/number values (the exact crash class)', () => {
    expect(sanitizeFileMap({
      'ok.ts': 'x',
      'bad1.ts': undefined,
      'bad2.ts': null,
      'bad3.ts': { content: 'nested' },
      'bad4.ts': 42,
    })).toEqual({ 'ok.ts': 'x' });
  });
  it('drops empty/whitespace path keys', () => {
    expect(sanitizeFileMap({ '': 'x', '   ': 'y', 'real.ts': 'z' })).toEqual({ 'real.ts': 'z' });
  });
  it('returns {} for non-object inputs (never throws)', () => {
    expect(sanitizeFileMap(undefined)).toEqual({});
    expect(sanitizeFileMap(null)).toEqual({});
    expect(sanitizeFileMap('not a map')).toEqual({});
    expect(sanitizeFileMap([])).toEqual({});
  });
});

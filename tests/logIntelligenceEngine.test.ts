import { describe, it, expect } from 'vitest';
import {
  parseLocation,
  parseErrorType,
  parseLogErrors,
  errorHint,
  firstStructuredError,
  locationTag,
} from '../src/server/AppMakerLab/intelligence/LogIntelligenceEngine';

/** P-AI.11 — log / stack-trace intelligence (pure). */

describe('parseLocation', () => {
  it('extracts file:line:col from a stack frame', () => {
    expect(parseLocation('at render (src/App.tsx:42:10)')).toEqual({ file: 'src/App.tsx', line: 42, column: 10 });
  });
  it('extracts from a vite/esbuild path', () => {
    expect(parseLocation('Error: ./lib/util.ts:7:3: Unexpected token')).toEqual({ file: './lib/util.ts', line: 7, column: 3 });
  });
  it('returns null when there is no file location', () => {
    expect(parseLocation('TypeError: x is not a function')).toBeNull();
  });
});

describe('parseErrorType', () => {
  it('prefers a TS diagnostic code', () => {
    expect(parseErrorType("src/a.ts(1,1): error TS2304: Cannot find name 'x'.")).toBe('TS2304');
  });
  it('recognises runtime error classes', () => {
    expect(parseErrorType('Uncaught TypeError: y is undefined')).toBe('TypeError');
    expect(parseErrorType('ReferenceError: z is not defined')).toBe('ReferenceError');
  });
  it('returns undefined when none', () => {
    expect(parseErrorType('just a log line')).toBeUndefined();
  });
});

describe('parseLogErrors', () => {
  it('parses multiple TypeScript diagnostics each as its own entry', () => {
    const log = [
      "src/App.tsx(10,5): error TS2304: Cannot find name 'foo'.",
      "src/lib/util.ts(3,1): error TS1005: ';' expected.",
    ].join('\n');
    const errs = parseLogErrors(log);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toMatchObject({ file: 'src/App.tsx', line: 10, column: 5, type: 'TS2304' });
    expect(errs[1].type).toBe('TS1005');
  });
  it('parses a free-form runtime error into one structured entry', () => {
    const errs = parseLogErrors('Uncaught TypeError: cannot read foo\n    at handle (src/App.tsx:88:12)');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ file: 'src/App.tsx', line: 88, column: 12, type: 'TypeError' });
  });
  it('returns [] for empty input', () => {
    expect(parseLogErrors('')).toEqual([]);
    expect(parseLogErrors('   ')).toEqual([]);
  });
});

describe('errorHint / firstStructuredError / locationTag', () => {
  it('formats a compact hint', () => {
    const e = firstStructuredError("src/App.tsx(10,5): error TS2304: Cannot find name 'foo'.")!;
    expect(errorHint(e)).toContain('src/App.tsx:10:5');
    expect(errorHint(e)).toContain('[TS2304]');
  });
  it('locationTag wraps a parsed location, or "" when nothing parses', () => {
    expect(locationTag('at x (src/App.tsx:42:10)')).toContain('[at src/App.tsx:42:10]');
    expect(locationTag('TypeError: boom')).toBe(' [TypeError]');
    expect(locationTag('plain log, nothing here')).toBe('');
  });
});

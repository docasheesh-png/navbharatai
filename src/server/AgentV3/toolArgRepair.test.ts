import { describe, it, expect } from 'vitest';
import { resolveStringArg, missingArgMessage } from './toolArgRepair';

describe('resolveStringArg — malformed tool-call repair (CrewHub autopsy: 9× missing "path")', () => {
  it('the canonical key always wins when present', () => {
    expect(resolveStringArg({ path: 'a.ts', file: 'b.ts' }, 'path')).toEqual({ value: 'a.ts', via: 'path' });
  });

  it('THE CrewHub case: {"file": …} instead of {"path": …} now succeeds via the alias', () => {
    expect(resolveStringArg({ file: 'app/page.tsx' }, 'path')).toEqual({ value: 'app/page.tsx', via: 'file' });
    expect(resolveStringArg({ filepath: 'x.ts' }, 'path')?.value).toBe('x.ts');
    expect(resolveStringArg({ file_path: 'x.ts' }, 'path')?.value).toBe('x.ts');
    expect(resolveStringArg({ filename: 'x.ts' }, 'path')?.value).toBe('x.ts');
  });

  it('edit_file aliases: old/new map to old_string/new_string', () => {
    expect(resolveStringArg({ old: 'foo' }, 'old_string')?.value).toBe('foo');
    expect(resolveStringArg({ replacement: 'bar' }, 'new_string')?.value).toBe('bar');
  });

  it('an empty-string alias does not count (a blank path is not a repair)', () => {
    expect(resolveStringArg({ file: '   ' }, 'path')).toBeNull();
  });

  it('returns null when nothing matches (unknown key names, wrong types)', () => {
    expect(resolveStringArg({ location: 'x.ts' }, 'path')).toBeNull();
    expect(resolveStringArg({ path: 42 }, 'path')).toBeNull();
    expect(resolveStringArg({}, 'path')).toBeNull();
  });
});

describe('missingArgMessage — the error TEACHES the model the retry shape', () => {
  it('names the required key, lists what was sent, and shows a concrete example', () => {
    const msg = missingArgMessage({ location: 'x.ts', mode: 'read' }, 'path');
    expect(msg).toContain('Missing/invalid string argument: path');
    expect(msg).toContain('[location, mode]');           // what the model actually sent
    expect(msg).toContain('"path": "src/App.tsx"');      // the concrete retry example
    expect(msg).toContain('Retry the SAME tool call');
  });

  it('handles a call with no arguments at all', () => {
    expect(missingArgMessage({}, 'command')).toContain('You sent NO arguments.');
  });
});

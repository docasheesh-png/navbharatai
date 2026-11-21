// failedbr #1248 (2026-11-20): write-time errors went 5 → 4 → 14 across three repair edits, and every note quoted only the
// errors of the moment — never that the last edit had tripled them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeErrorTrendNote } from '../src/server/AgentV3/writeTimeTypecheck';

describe('a write that made it worse says so (failedbr #1248)', () => {
  it('the reported jump leads the note', () => {
    expect(writeErrorTrendNote(4, 14)).toMatch(/^📈 This write raised the project's TypeScript errors from 4 to 14/);
  });
  it('a small change, a drop, or the first run says nothing', () => {
    expect(writeErrorTrendNote(5, 4)).toBe('');
    expect(writeErrorTrendNote(4, 6)).toBe('');
    expect(writeErrorTrendNote(null, 14)).toBe('');
  });
  it('🔒 the dispatcher remembers the last count and puts the trend first', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toContain('const trendNote = writeErrorTrendNote(this._lastWriteTscErrors, errors.length);');
    expect(src).toContain('return trendNote + healedNote + writeTypecheckNote(errors, tsPaths, sources);');
  });
});

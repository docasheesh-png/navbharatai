// failedbr #1077 (2026-11-20): "you have now read src/App.tsx the 3rd time … it has NOT changed since your first read" — the file
// had been edited after the first read; the comparison is with the LAST read.
import { describe, expect, it } from 'vitest';
import { repeatedReadNotice } from '../src/server/AgentV3/repeatedReads';

describe('the unchanged-read note says what it compared (failedbr #1077)', () => {
  it('names the last read, never the first', () => {
    const n = repeatedReadNotice('src/App.tsx', 3, true);
    expect(n).toMatch(/has NOT changed since you last read it/);
    expect(n).not.toMatch(/first read/);
  });
});

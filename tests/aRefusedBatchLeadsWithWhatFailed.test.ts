// r6–r10 autopsy (2026-10-18): a partly-refused write_files_batch opened with "Wrote 2 file(s)…" and "Not written"
// came last, where a capped tool result truncated it. The refusal must lead with what was NOT written.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { batchRefusalText } from '../src/server/AgentV3/ToolDispatcher';

describe('a refused batch leads with what failed', () => {
  const longSummary = 'Wrote 2 file(s) in dependency order: src/lib/a.ts, src/App.tsx.' + ' steering note'.repeat(500);
  const t = batchRefusalText(['src/lib/a.ts', 'src/App.tsx'], [{ path: 'src/pages/Home.tsx', failed: 'blocked' }], longSummary);
  it('the first line names the files not written', () => {
    expect(t.split('\n')[0]).toMatch(/^Not written \(1 file\(s\) — rewrite these\): src\/pages\/Home\.tsx — blocked/);
  });
  it('survives a cap: the first 300 chars still carry it', () => {
    expect(t.slice(0, 300)).toContain('src/pages/Home.tsx');
    expect(t.slice(0, 300)).toContain('Written (do not rewrite these): src/lib/a.ts, src/App.tsx');
  });
  it('the dispatcher refuses with it', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toMatch(/refuse\(batchRefusalText\(written, notWritten, summary\)\)/);
  });
});

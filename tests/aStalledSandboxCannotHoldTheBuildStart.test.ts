// A STALLED SANDBOX CANNOT HOLD THE BUILD'S START (failedbr #2484, Q-3245: "Project memory restored and indexed in 76714ms —
// indexing is capped at 8000ms", then "indexed 27 file(s) in 78399ms" by a second fill with no deadline at all).
// 🧬 Class: a deadline that stops STARTING work but still waits for work in flight. A read on a stalled sandbox never settles.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceMemory, warmIndexFiles, warmIndexTimedOutCount, WARM_INDEX_BUILD_START_MS, WARM_READ_MAX_MS } from '../src/server/AgentV3/WorkspaceMemory';

const files = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`);

describe('the warm index is bounded in wall-clock time', () => {
  it('reads that never answer: it returns at the deadline, indexes what did answer, and counts the rest', async () => {
    const mem = getWorkspaceMemory('ws-stall-test');
    const read = (p: string) => (/f[0-4]\.ts$/.test(p) ? Promise.resolve(`export const x${p.length} = 1;`) : new Promise<string>(() => { /* stalled sandbox */ }));
    const t0 = Date.now();
    const indexed = await warmIndexFiles(mem, files, read, { deadlineMs: 400 });
    const took = Date.now() - t0;
    expect(took).toBeLessThan(1500);                                                  // was: forever
    expect(indexed.length).toBeGreaterThanOrEqual(5);
    expect(warmIndexTimedOutCount()).toBeGreaterThan(0);
  });
  it('a late answer is never written into the graph', async () => {
    const mem = getWorkspaceMemory('ws-late-test');
    const read = () => new Promise<string>((r) => setTimeout(() => r('export const late = 1;'), 600));
    const indexed = await warmIndexFiles(mem, ['src/late.ts'], read, { deadlineMs: 100 });
    expect(indexed).toEqual([]);
    await new Promise((r) => setTimeout(r, 700));
    expect(mem.graph().files).not.toContain('src/late.ts');
  });
  it('one file is never waited for longer than the per-read cap', () => {
    expect(WARM_READ_MAX_MS).toBeLessThanOrEqual(WARM_INDEX_BUILD_START_MS);
  });
  it('both build-start fills carry the deadline, and the setup line says how many reads were not answered', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("{ maxFiles: 400, deadlineMs: WARM_INDEX_BUILD_START_MS }");
    expect(route).toContain("{ maxFiles: 200, deadlineMs: WARM_INDEX_BUILD_START_MS }");
    expect(route).toContain('${warmIndexTimedOutCount()} read(s) not answered within the cap');
  });
});

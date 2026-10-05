/**
 * Q-116: the build-start graph fill read at most 80 files, so on a bigger app every file past the 80th stayed a
 * STUB — exactly the projects whose edits most need the contract card, the invariants and grounding that read
 * the graph. The fill now reads up to 400 files, bounded by time so a big project never holds up the start;
 * whatever is left is still counted by the GRAPH_RESTORED_STUBS instrument.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { WorkspaceMemory, warmIndexFiles } from '../src/server/AgentV3/WorkspaceMemory';

const tree = (n: number) => Array.from({ length: n }, (_, i) => `src/components/C${i}.tsx`);
const read = async (p: string) => `export default function ${p.split('/').pop()!.replace('.tsx', '')}() { return null; }`;

describe('a big project is not hollow', () => {
  it('the build-start fill reads past 80 files', async () => {
    const mem = new WorkspaceMemory('ws-big');
    const indexed = await warmIndexFiles(mem, tree(200), read, { maxFiles: 400, deadlineMs: 8_000 });
    expect(indexed.length).toBe(200);
  });

  it('the time bound stops new reads — nothing hangs the start', async () => {
    const mem = new WorkspaceMemory('ws-slow');
    const slow = async (p: string) => { await new Promise((r) => setTimeout(r, 30)); return read(p); };
    const started = Date.now();
    const indexed = await warmIndexFiles(mem, tree(400), slow, { maxFiles: 400, deadlineMs: 100 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(indexed.length).toBeGreaterThan(0);
    expect(indexed.length).toBeLessThan(400);
  });

  it('the build-start call uses the larger, time-bounded fill', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('await warmIndexFiles(wsMem, fileTree, (p) => actuator.readFile(workspaceId, p), { maxFiles: 400, deadlineMs: WARM_INDEX_BUILD_START_MS });');
  });
});

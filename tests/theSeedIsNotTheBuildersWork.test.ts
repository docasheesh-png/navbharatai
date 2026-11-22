// THE SEED IS NOT THE BUILDER'S WORK (failedbr #2487, Q-3246: "Structural readiness was judged finished at step 3 (100/100);
// the build then ran 32 more step(s)" — at step 3 the builder had not written one file; the platform's game kit is a complete
// app structurally). 🧬 Class: "did this run write?" answered with a counter the platform's seed had already moved.
import { describe, it, expect } from 'vitest';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ActuatorPort } from '../src/server/AgentV3/ports';

class Act implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
}

describe('"this run wrote" counts from the run\'s start, so the seed before it does not count', () => {
  it('after a seed write, the run has written nothing until the builder writes', async () => {
    const act = new Act();
    act.files.set('package.json', JSON.stringify({ name: 'g', dependencies: {} }));
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, `ws-seed-${Math.random()}`, new WorkspaceState(stream), stream);
    await d.dispatch({ id: 's', name: 'write_file', input: { path: 'src/seed.ts', content: 'export const seed = 1;\n' } }, 'architect');
    expect(d.wroteAnything()).toBe(true);                                  // the old question: already true before the run
    const changesAtRunStart = d.changeCount();
    const wroteThisRun = () => d.changeCount() - changesAtRunStart > 0;
    expect(wroteThisRun()).toBe(false);                                    // the run itself has written nothing
    await d.dispatch({ id: 'b', name: 'write_file', input: { path: 'src/feature.ts', content: 'export const f = 1;\n' } }, 'architect');
    expect(wroteThisRun()).toBe(true);
  }, 30_000);
});

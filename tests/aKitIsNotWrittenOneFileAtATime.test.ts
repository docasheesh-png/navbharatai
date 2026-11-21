// THE KIT IS NOT WRITTEN ONE FILE AT A TIME (failedbr #2485, Q-3232: 113 s before the first model call; the seed's
// recipes took 61 s).
//
// 🧬 THE CLASS: a batch of independent sandbox operations run strictly one after another. A recipe's files do not depend on
// each other, yet each waited for the one before it: three sandbox round trips per file, ~120 files, ~360 in a row. A few
// go at once now; the receipt keeps the recipe's own order, and a failure starts no new file.
import { describe, it, expect } from 'vitest';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ActuatorPort } from '../src/server/AgentV3/ports';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

class SlowSandbox implements ActuatorPort {
  files = new Map<string, string>();
  inFlight = 0; most = 0; trips = 0;
  failOn: string | null = null;
  startedAfterFailure: string[] = [];
  failed = false;
  private async trip<T>(path: string, work: () => T): Promise<T> {
    if (this.failed) this.startedAfterFailure.push(path);
    this.trips++; this.inFlight++; this.most = Math.max(this.most, this.inFlight);
    await new Promise((r) => setTimeout(r, 4));
    this.inFlight--;
    return work();
  }
  readFile(_w: string, p: string) {
    return this.trip(p, () => {
      if (p === this.failOn) { this.failed = true; throw new Error('sandbox timed out'); }
      const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f;
    });
  }
  writeFile(_w: string, p: string, c: string) { return this.trip(p, () => { this.files.set(p, c); }); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
}
function setup() {
  const act = new SlowSandbox();
  act.files.set('package.json', JSON.stringify({ name: 'g', dependencies: { three: '0.170.0' }, devDependencies: { '@types/three': '0.170.0', vitest: '^3.2.4' } }));
  const stream = new AgentEventStream();
  return { act, d: new ToolDispatcher(act, `ws-kit-parallel-${Math.random()}`, new WorkspaceState(stream), stream) };
}
const shell = generateGameShell().files;
const paths = Object.keys(shell);

describe('⏱️ a recipe writes several of its files at once', () => {
  it('more than one sandbox operation is in flight, never more than the bound — and every file lands exactly', async () => {
    const { act, d } = setup();
    const res = await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect');
    expect(res.is_error).toBeFalsy();
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) expect(act.files.get(p), p).toBe(shell[p]);
    expect(act.most).toBeGreaterThan(1);                                         // put the one-by-one loop back ⇒ 1
    expect(act.most).toBeLessThanOrEqual(ToolDispatcher.RECIPE_WRITE_CONCURRENCY);
  }, 60_000);

  it('the receipt lists the files in the recipe\'s own order, whichever finished first', async () => {
    const { d } = setup();
    const text = String((await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect')).content);
    const at = paths.map((p) => text.indexOf(`Created ${p}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  }, 60_000);

  it('a second run changes nothing and says so', async () => {
    const { act, d } = setup();
    await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect');
    const before = new Map(act.files);
    const text = String((await d.dispatch({ id: 't2', name: 'generate_game_shell', input: {} }, 'architect')).content);
    for (const p of paths) { expect(text).toContain(`Unchanged ${p}`); expect(act.files.get(p)).toBe(before.get(p)); }
  }, 60_000);

  it('a sandbox that cannot be read is an error, and no NEW file is started after it', async () => {
    const { act, d } = setup();
    act.failOn = paths[1];
    const res = await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect');
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toContain('could not inspect');
    // Only files already in flight when it failed may finish; the rest of the recipe is never begun.
    const begun = new Set(act.startedAfterFailure.filter((p) => paths.includes(p)));
    expect(begun.size).toBeLessThanOrEqual(ToolDispatcher.RECIPE_WRITE_CONCURRENCY);
    expect(paths.filter((p) => act.files.has(p)).length).toBeLessThan(paths.length);
  }, 60_000);
});

/**
 * failedbr #1925 (2026-11-08, a Svelte game): the platform did not lay the React kit into a Svelte project, but
 * `run_recipe` let the model run `generate_game_shell`, which writes React components. Twenty minutes of reconciling
 * React files with a Svelte app followed, and the build ended RED.
 */
import { describe, expect, it } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { recipeWritesReact, projectRunsReact } from '../src/server/lib/gameRecipeLayers';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>([['package.json', '{"name":"g","dependencies":{"svelte":"^4"}}']]);
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
const make = (framework?: string) => {
  const actuator = new FakeActuator();
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(actuator, 'ws-1925', new WorkspaceState(stream), stream,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, framework);
  return { actuator, d };
};

describe('which recipes write React is read from what they emit', () => {
  it('the shell and the royale layer write .tsx; the runtime, effects, melody and 2D kits do not', () => {
    expect(recipeWritesReact('generate_game_shell')).toBe(true);
    expect(recipeWritesReact('generate_game_royale')).toBe(true);
    for (const r of ['generate_game_runtime', 'generate_game_vfx', 'generate_melody', 'generate_game_2d', 'generate_game_3d']) expect(recipeWritesReact(r), r).toBe(false);
  });
  it('React projects', () => {
    for (const f of [undefined, 'vite-react', 'nextjs', 'remix']) expect(projectRunsReact(f), String(f)).toBe(true);
    for (const f of ['svelte', 'sveltekit', 'vue', 'nuxt', 'astro', 'angular', 'static']) expect(projectRunsReact(f), f).toBe(false);
  });
});

describe('the run_recipe door', () => {
  it('a Svelte project: generate_game_shell is refused, nothing is written', async () => {
    const { actuator, d } = make('svelte');
    const r = await d.dispatch({ id: 'r', name: 'run_recipe', input: { name: 'generate_game_shell' } }, 'architect');
    expect(r.is_error).toBe(true);
    expect(String(r.content)).toMatch(/writes React components/);
    expect([...actuator.files.keys()].some((p) => p.endsWith('.tsx'))).toBe(false);
  });
  it('a React project: the same recipe runs', async () => {
    const { actuator, d } = make('vite-react');
    const r = await d.dispatch({ id: 'r', name: 'run_recipe', input: { name: 'generate_game_shell' } }, 'architect');
    expect(String(r.content)).not.toMatch(/writes React components/);
    expect([...actuator.files.keys()].some((p) => p.endsWith('GameCanvas.tsx'))).toBe(true);
  });
});

// EVERY TOOL THE PROMPT NAMES IS ONE THE BUILDER CAN REACH (admin 2026-09-30: "one recipe tool").
// 56 tools were named in the architect prompt and offered to no role. 54 are code recipes and now run
// through one catalog entry, `run_recipe`, each through its OWN unchanged handler; `write_files_batch`
// and `find_ui_element` are offered directly (a write door and a visual tool are not recipes).

import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { roleConfig } from '../src/server/AgentV3/AgentRegistry';
import { RECIPE_TOOLS, catalogForTools, recipeToolDef, isRecipeName } from '../src/server/AgentV3/ToolCatalog';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>([['package.json', '{"name":"app","dependencies":{"react":"^19.0.0"}}']]);
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function dispatcher() {
  const act = new FakeActuator();
  const stream = new AgentEventStream();
  return { act, d: new ToolDispatcher(act, 'ws-recipe', new WorkspaceState(stream), stream) };
}
const recipe = (input: Record<string, unknown>) => ({ id: 'r1', name: 'run_recipe', input });

describe('the catalog', () => {
  it('every build role holds run_recipe and write_files_batch; the architect also holds find_ui_element', () => {
    for (const role of ['architect', 'frontend', 'backend', 'fullstack'] as const) {
      const tools = roleConfig(role).tools as string[];
      expect(tools, role).toContain('run_recipe');
      expect(tools, role).toContain('write_files_batch');
    }
    expect(roleConfig('architect').tools as string[]).toContain('find_ui_element');
  });

  it('one entry, not 54: no recipe is listed as a tool of its own', () => {
    const names = catalogForTools(roleConfig('architect').tools).map((t) => t.name);
    expect(names).toContain('run_recipe');
    for (const r of RECIPE_TOOLS) expect(names).not.toContain(r);
  });

  it('the one entry names every recipe, and stays far smaller than the schemas it replaces', () => {
    const def = recipeToolDef();
    for (const r of RECIPE_TOOLS) expect(def.description).toContain(`- ${r}:`);
    expect(JSON.stringify(def).length).toBeLessThan(12_000);
  });
});

describe('the dispatcher', () => {
  it('"list" returns every recipe with its inputs', async () => {
    const { d } = dispatcher();
    const res = await d.dispatch(recipe({ name: 'list' }), 'architect');
    expect(res.is_error).toBe(false);
    for (const r of RECIPE_TOOLS) expect(res.content).toContain(r);
    expect(res.content).toMatch(/generate_sms[\s\S]*provider: "twilio" \| "vonage"/);
  });

  it('an unknown recipe is told so and shown the list — never guessed', async () => {
    const { d, act } = dispatcher();
    const before = act.files.size;
    const res = await d.dispatch(recipe({ name: 'generate_everything' }), 'architect');
    expect(res.content).toMatch(/^There is no recipe called "generate_everything"/);
    expect(act.files.size).toBe(before);
  });

  it('a recipe that needs input, called without it, gets that recipe\'s inputs and writes nothing', async () => {
    const { d, act } = dispatcher();
    const before = act.files.size;
    const res = await d.dispatch(recipe({ name: 'generate_sms' }), 'architect');
    expect(res.content).toMatch(/needs input[\s\S]*provider/);
    expect(act.files.size).toBe(before);
  });

  it('a recipe runs through its OWN handler, exactly as if it had been called directly', async () => {
    const viaRecipe = dispatcher();
    const direct = dispatcher();
    const a = await viaRecipe.d.dispatch(recipe({ name: 'generate_sms', input: { provider: 'twilio' } }), 'architect');
    const b = await direct.d.dispatch({ id: 'r2', name: 'generate_sms', input: { provider: 'twilio' } }, 'architect');
    expect(a.content).toBe(b.content);
    expect([...viaRecipe.act.files.entries()]).toEqual([...direct.act.files.entries()]);
    expect(viaRecipe.act.files.size).toBeGreaterThan(1);
  });

  it('a recipe with no required inputs runs with none', async () => {
    const { d, act } = dispatcher();
    const res = await d.dispatch(recipe({ name: 'generate_slug' }), 'architect');
    expect(res.is_error).toBe(false);
    expect(act.files.size).toBeGreaterThan(1);
  });

  it('run_recipe cannot be used to reach a tool that is not a recipe', async () => {
    expect(isRecipeName('bash')).toBe(false);
    expect(isRecipeName('deploy')).toBe(false);
    expect(isRecipeName('request_secrets')).toBe(false);
    const { d } = dispatcher();
    const res = await d.dispatch(recipe({ name: 'deploy', input: {} }), 'frontend');
    expect(res.content).toMatch(/^There is no recipe called "deploy"/);
  });
});

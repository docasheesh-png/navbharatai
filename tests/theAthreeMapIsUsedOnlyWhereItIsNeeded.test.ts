// THE ATHREE MAP IS WIRED, AND WIRED HONESTLY (admin plan 2026-11-14): the recipe tool decides from the REQUEST through the same
// pure intent the tests in src/server/lib/athreeMap check, so the builder cannot put a world under an app that has none, cannot
// override a refusal, and the library lists the map only while it is switched on. These tests drive the REAL ToolDispatcher.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';
import { defaultToolCatalog, CATALOG_TOOL_NAMES } from '../src/server/AgentV3/ToolCatalog';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';
import { searchGameLibrary } from '../src/server/AgentV3/gameAssets/gameLibrary';
import { ATHREE_MAP } from '../src/server/lib/athreeMap/athreeMapLibrary';

class Fake implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

let act: Fake;
let d: ToolDispatcher;
const run = (request: string) => { d.setCoverageRequest(request); return d.dispatch({ id: 't', name: 'generate_athree_map', input: {} }, 'architect'); };

beforeEach(() => {
  act = new Fake();
  const stream = new AgentEventStream();
  clearPreviewGaveUp('ws-athree');
  d = new ToolDispatcher(act, 'ws-athree', new WorkspaceState(stream), stream);
});
afterEach(() => { delete process.env.AGENTV3_ATHREE_MAP; });

describe('the tool is registered everywhere a recipe must be', () => {
  it('is in the catalogue, both name lists and the recipe pool', () => {
    expect(defaultToolCatalog().some((t) => t.name === 'generate_athree_map')).toBe(true);
    expect(CATALOG_TOOL_NAMES).toContain('generate_athree_map');
    expect(Object.keys(GAME_RECIPES)).toContain('generate_athree_map');
  });
});

describe('OFF by default', () => {
  it('refuses honestly and writes nothing while AGENTV3_ATHREE_MAP is not on', async () => {
    const res = await run('athree map par racing game banao');
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/not switched on/i);
    expect([...act.files.keys()].some((p) => p.includes('athree'))).toBe(false);
  });
});

describe('ON: the request decides', () => {
  beforeEach(() => { process.env.AGENTV3_ATHREE_MAP = 'on'; });

  it('named + needed → the six files are written', async () => {
    const res = await run('athree map par ek 3D racing game banao');
    expect(res.is_error).toBeFalsy();
    for (const m of ['noise', 'config', 'world', 'collider', 'chunks', 'index']) expect(act.files.has(`src/game/athree/${m}.ts`), m).toBe(true);
    expect(res.content).toMatch(/Athree map/);
  });
  it('needed without the name (a racing game) → written too (Athree is the only map the library has)', async () => {
    const res = await run('ek 3D racing game banao');
    expect(res.is_error).toBeFalsy();
    expect(act.files.has('src/game/athree/index.ts')).toBe(true);
  });
  it('named but NOT needed → refused with the reason, nothing written', async () => {
    const res = await run('athree map use karke ek calculator banao');
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/no world to put it on/);
    expect(act.files.has('src/game/athree/index.ts')).toBe(false);
  });
  it('an app that needs no map and never named it → refused', async () => {
    const res = await run('ek billing app banao');
    expect(res.is_error).toBe(true);
    expect(act.files.has('src/game/athree/index.ts')).toBe(false);
  });
  it('a refusal by the user is obeyed even if the builder calls the tool', async () => {
    const res = await run('racing game banao, athree map nahi chahiye');
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/not to use the Athree/i);
  });
  it('once a project has the map, later edits keep it (the stored choice), even when the edit never mentions a world', async () => {
    await run('athree map par racing game banao');
    const res = await run('make the car faster');
    expect(res.is_error).toBeFalsy();
    expect(res.content).toMatch(/already uses the athree map/i);
  });
});

describe('the library lists the map only while it is switched on', () => {
  it('OFF: no maps category entry; ON: the map is there with its owner licence and recipe', () => {
    expect(searchGameLibrary({ category: 'maps' }).entries).toEqual([]);
    process.env.AGENTV3_ATHREE_MAP = 'on';
    const on = searchGameLibrary({ category: 'maps' });
    expect(on.entries.map((e) => e.id)).toEqual(['map:athree']);
    expect(on.entries[0]).toMatchObject({ category: 'maps', kind: 'recipe', builder: 'generate_athree_map', availability: 'code-recipe' });
    expect(on.entries[0].license?.spdx).toBe(ATHREE_MAP.license.spdx);
    expect(on.categories.find((c) => c.category === 'maps')?.count).toBe(1);
    expect(searchGameLibrary({ query: 'athree' }).entries[0]?.id).toBe('map:athree');
  });
});

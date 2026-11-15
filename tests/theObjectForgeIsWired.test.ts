// THE OBJECT FORGE IS WIRED, AND WIRED HONESTLY (admin 2026-11-15: NavBharatAI makes ANY object itself). These tests drive the REAL
// ToolDispatcher: the tool is registered everywhere a recipe must be; a bad spec writes nothing and says why; a good spec writes the
// engine once and the object by id; calling again with the same id REPLACES the object (that is how the builder fixes what the drawing
// showed); the kill switch refuses; and the system prompt tells the builder when to reach for it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';
import { defaultToolCatalog, CATALOG_TOOL_NAMES, RECIPE_TOOLS } from '../src/server/AgentV3/ToolCatalog';
import { GAME_RECIPES, recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { FORGE_EXAMPLES } from '../src/server/lib/objectForge/forgeExamples';
import { FORGE_ENGINE } from '../src/server/lib/objectForge/forgeEngineSource';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

class Fake implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

let act: Fake;
let d: ToolDispatcher;
const forge = (input: Record<string, unknown> = {}) => d.dispatch({ id: 't', name: 'author_object', input }, 'architect');
const text = (r: { content: unknown }) => String(r.content);

beforeEach(() => {
  act = new Fake();
  const stream = new AgentEventStream();
  clearPreviewGaveUp('ws-forge');
  d = new ToolDispatcher(act, 'ws-forge', new WorkspaceState(stream), stream);
});
afterEach(() => { delete process.env.AGENTV3_OBJECT_FORGE; });

const lamp = (extra: Record<string, unknown> = {}) => ({
  id: 'street-lamp', name: 'Street lamp',
  materials: { iron: { color: '#2d3136', metalness: 0.7 }, glow: { color: '#ffe9a8', emissive: '#ffd45e' } },
  nodes: [
    { name: 'pole', shape: { type: 'cylinder', radiusTop: 0.05, radiusBottom: 0.08, height: 4, seg: 10 }, material: 'iron', position: [0, 2, 0] },
    { name: 'arm', shape: { type: 'box', size: [0.08, 0.08, 0.8] }, material: 'iron', position: [0, 3.95, 0.35] },
    { name: 'bulb', shape: { type: 'sphere', radius: 0.15, seg: 10 }, material: 'glow', position: [0, 3.8, 0.75] },
  ],
  ...extra,
});

describe('registered everywhere a recipe must be', () => {
  it('is in the catalogue, both name lists and the recipe pool (so a stale engine in a project is refreshed like any kit file)', () => {
    expect(defaultToolCatalog().some((t) => t.name === 'author_object')).toBe(true);
    expect(CATALOG_TOOL_NAMES).toContain('author_object');
    expect(RECIPE_TOOLS).toContain('author_object');
    expect(Object.keys(GAME_RECIPES)).toContain('author_object');
    expect(recipeFilePool().get('src/game/forge/forge.ts')?.recipe).toBe('author_object');
  });

  it('takes a spec object or an example name, and says what it is for and what it is not (stylised, not photoreal)', () => {
    const tool = defaultToolCatalog().find((t) => t.name === 'author_object')!;
    const props = (tool.input_schema as any).properties;
    expect(props.spec.type).toBe('object'); expect(props.example.type).toBe('string');
    expect(tool.description).toMatch(/ANY object/); expect(tool.description).toMatch(/not photoreal/);
  });

  it('is named in the architect prompt: library first, then the Forge, and never hand-written vertices', () => {
    const prompt = architectSystemPrompt();
    expect(prompt).toContain('author_object');
    expect(prompt).toMatch(/Look in the game library first/);
    expect(prompt).toMatch(/stylised/);
  });
});

describe('calling it with nothing, or with an example', () => {
  it('no input returns the guide and writes nothing', async () => {
    const r = await forge();
    expect(r.is_error).toBeFalsy();
    expect(text(r)).toMatch(/OBJECT FORGE/);
    expect(act.files.size).toBe(0);
  });

  it('an example returns its spec and its drawing, and still writes nothing', async () => {
    const r = await forge({ example: 'person' });
    expect(text(r)).toContain('"id":"person"');
    expect(text(r)).toMatch(/FRONT/);
    expect(act.files.size).toBe(0);
  });

  it('an unknown example lists the real ones', async () => {
    expect(text(await forge({ example: 'dragon' }))).toMatch(new RegExp('Examples: ' + Object.keys(FORGE_EXAMPLES).join(', ')));
  });
});

describe('a spec', () => {
  it('that is wrong writes NOTHING and comes back as a list of reasons (not a crash)', async () => {
    const r = await forge({ spec: { id: 'Bad Id', name: 'x', materials: {}, nodes: [] } });
    expect(r.is_error).toBeFalsy();
    expect(text(r)).toMatch(/NOT built/); expect(text(r)).toMatch(/id must be lowercase/);
    expect(act.files.size).toBe(0);
  });

  it('that is valid writes the engine once and the object by its id, and answers with the drawing, the numbers and how to use it', async () => {
    const r = await forge({ spec: lamp() });
    expect(r.is_error).toBeFalsy();
    expect(act.files.get('src/game/forge/forge.ts')).toBe(FORGE_ENGINE);
    const obj = act.files.get('src/game/objects/street-lamp.ts')!;
    expect(obj).toContain("from '../forge/forge'");
    expect(obj).toContain('export function createStreetLamp(');
    expect(obj).toContain('"id": "street-lamp"');
    expect(text(r)).toMatch(/Created src\/game\/objects\/street-lamp\.ts/);
    expect(text(r)).toMatch(/street-lamp: \d+ triangles/);
    expect(text(r)).toMatch(/FRONT[\s\S]*SIDE[\s\S]*TOP/);
    expect(text(r)).toMatch(/import \{ createStreetLamp \} from '\.\/objects\/street-lamp'/);
  });

  it('may arrive as JSON text (models often send it that way)', async () => {
    const r = await forge({ spec: JSON.stringify(lamp()) });
    expect(act.files.has('src/game/objects/street-lamp.ts')).toBe(true);
    expect(r.is_error).toBeFalsy();
    expect(text(await forge({ spec: '{not json' }))).toMatch(/not valid JSON/);
  });

  it('called again with the same id REPLACES the object and leaves the engine alone', async () => {
    await forge({ spec: lamp() });
    const first = act.files.get('src/game/objects/street-lamp.ts')!;
    const r = await forge({ spec: lamp({ name: 'Street lamp, taller', nodes: [{ name: 'pole', shape: { type: 'cylinder', radiusTop: 0.05, radiusBottom: 0.08, height: 6, seg: 10 }, material: 'iron', position: [0, 3, 0] }, { name: 'bulb', shape: { type: 'sphere', radius: 0.15, seg: 10 }, material: 'glow', position: [0, 5.9, 0] }] }) });
    const second = act.files.get('src/game/objects/street-lamp.ts')!;
    expect(second).not.toBe(first);
    expect(second).toContain('Street lamp, taller');
    expect(text(r)).toMatch(/Replaced src\/game\/objects\/street-lamp\.ts/);
    expect(text(r)).toMatch(/Unchanged src\/game\/forge\/forge\.ts/);
  });

  it('two different objects share one engine file', async () => {
    await forge({ spec: lamp() });
    await forge({ spec: { ...lamp(), id: 'street-lamp-2' } });
    expect([...act.files.keys()].filter((p) => p.startsWith('src/game/forge/'))).toEqual(['src/game/forge/forge.ts']);
    expect([...act.files.keys()].filter((p) => p.startsWith('src/game/objects/')).sort()).toEqual(['src/game/objects/street-lamp-2.ts', 'src/game/objects/street-lamp.ts']);
  });

  it('floating parts come back as a warning the builder is told to fix, and the object is still written', async () => {
    const spec = lamp(); (spec.nodes as any[]).push({ name: 'balloon', shape: { type: 'sphere', radius: 0.3 }, material: 'glow', position: [0, 9, 0] });
    const r = await forge({ spec });
    expect(text(r)).toMatch(/WARNINGS \(fix these, then call again\)/); expect(text(r)).toMatch(/float free of the main body: \[balloon\]/);
    expect(act.files.has('src/game/objects/street-lamp.ts')).toBe(true);
  });

  it('every worked example builds through the real tool', async () => {
    for (const [id, e] of Object.entries(FORGE_EXAMPLES)) {
      const r = await forge({ spec: e.spec });
      expect(r.is_error, id).toBeFalsy();
      expect(act.files.has(`src/game/objects/${id}.ts`), id).toBe(true);
      expect(text(r), id).not.toMatch(/WARNINGS/);
    }
  });
});

describe('the kill switch', () => {
  it('AGENTV3_OBJECT_FORGE=off refuses honestly and writes nothing', async () => {
    process.env.AGENTV3_OBJECT_FORGE = 'off';
    const r = await forge({ spec: lamp() });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/switched off/);
    expect(act.files.size).toBe(0);
  });
});

// THE OBJECT FORGE IS WIRED, AND WIRED HONESTLY (admin 2026-11-15: NavBharatAI makes ANY object itself). These tests drive the REAL
// ToolDispatcher: the tool is registered everywhere a recipe must be; a bad spec writes nothing and says why; a good spec writes the
// engine once and the object by id; replacements require explicit customisation and a genuine CAS capability.
// Unknown or changed source is preserved; the kill switch refuses; the prompt reports capability limits.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aiRouter } from '../src/server/lib/aiRouter';
import { madeCache } from '../src/server/lib/objectForge/forgeSelfAuthor';
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
  writes: string[] = [];
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.writes.push(p); this.files.set(p, c); }
  async createFileExclusive(_w: string, p: string, c: string): Promise<void> {
    if (this.files.has(p)) throw new Error('EEXIST: ' + p);
    this.files.set(p, c); this.writes.push(p);
  }
  async compareAndSwapFile(_w: string, p: string, expected: string, c: string): Promise<void> {
    if (this.files.get(p) !== expected) throw new Error('Changed since read: ' + p);
    this.files.set(p, c); this.writes.push(p);
  }
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
afterEach(() => { delete process.env.AGENTV3_OBJECT_FORGE; vi.restoreAllMocks(); madeCache.clear(); });

const lamp = (extra: Record<string, unknown> = {}) => ({
  id: 'street-lamp', name: 'Street lamp',
  materials: { iron: { color: '#2d3136', metalness: 0.7 }, glow: { color: '#ffe9a8', emissive: '#ffd45e' } },
  nodes: [
    { name: 'pole', shape: { type: 'cylinder', radiusTop: 0.05, radiusBottom: 0.08, height: 4, seg: 10 }, material: 'iron', position: [0, 2, -0.35] },
    { name: 'arm', shape: { type: 'box', size: [0.08, 0.08, 0.8] }, material: 'iron', position: [0, 3.95, 0.05] },
    { name: 'bulb', shape: { type: 'sphere', radius: 0.15, seg: 10 }, material: 'glow', position: [0, 3.8, 0.4] },
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

  it('creation with an existing id cannot authorize replacement, but an identical retry is unchanged', async () => {
    await forge({ spec: lamp() });
    const first = act.files.get('src/game/objects/street-lamp.ts')!;
    act.writes.length = 0;
    const r = await forge({ spec: lamp({ name: 'Different lamp' }) });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/Creation cannot authorize replacement/);
    expect(act.files.get('src/game/objects/street-lamp.ts')).toBe(first);
    expect(act.writes).toEqual([]);
    const retry = await forge({ spec: lamp() });
    expect(retry.is_error).toBeFalsy();
    expect(text(retry)).toMatch(/Unchanged.*does not verify the kit, scene mount or gameplay/);
    expect(act.writes).toEqual([]);
  });

  it('two different objects share one engine file', async () => {
    await forge({ spec: lamp() });
    await forge({ spec: { ...lamp(), id: 'street-lamp-2' } });
    expect([...act.files.keys()].filter((p) => p.startsWith('src/game/forge/')).sort()).toEqual(['src/game/forge/behave.ts', 'src/game/forge/customise.ts', 'src/game/forge/forge.ts']);
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

describe('describe-only calls require admitted provider context', () => {
  it('refuses without a sidecall or write and tells the admitted architect to supply a spec', async () => {
    const route = vi.spyOn(aiRouter, 'routeDetailed');
    const r = await forge({ describe: 'a street lamp', id: 'lamp-post' });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/held pending admitted provider accounting\/cancellation/);
    expect(text(r)).toContain('author_object({ spec })');
    expect(route).not.toHaveBeenCalled();
    expect(act.files.size).toBe(0);
  });

  it('a supplied spec wins over the description without a sidecall', async () => {
    const route = vi.spyOn(aiRouter, 'routeDetailed');
    expect((await forge({ describe: 'a lamp', spec: lamp({ id: 'mine' }) })).is_error).toBeFalsy();
    expect(route).not.toHaveBeenCalled();
    expect(act.files.has('src/game/objects/mine.ts')).toBe(true);
  });

  it('the kill switch still stops describe-only calls before any sidecall', async () => {
    process.env.AGENTV3_OBJECT_FORGE = 'off';
    const route = vi.spyOn(aiRouter, 'routeDetailed');
    expect((await forge({ describe: 'a lamp' })).is_error).toBe(true);
    expect(route).not.toHaveBeenCalled();
  });
});

describe('customise: the user\'s words change an object that exists', () => {
  const paramsOf = (path: string) => JSON.parse(act.files.get(path)!.split('export const SPEC: ObjectSpec = ')[1].split(';\n\n/**')[0]).params;

  it('starts from a person, applies the wishes, and writes the changed object', async () => {
    const r = await forge({ customise: 'ladki banao, baal lambe karo, dress ka rang neela karo', target: 'sita', base: 'person' });
    expect(r.is_error).toBeFalsy();
    expect(text(r)).toMatch(/Changed: gender → female; hair length → long; dress \(dress\)? ?→|Changed: .*gender → female.*hair length → long/);
    expect(act.files.has('src/game/objects/sita.ts')).toBe(true);
    expect(paramsOf('src/game/objects/sita.ts')).toMatchObject({ gender: 'female', hairLength: 2, dress: true });
    expect(text(r)).toMatch(/FRONT/);
  });

  it('edits COMPOUND: a second request keeps the first one\'s changes', async () => {
    await forge({ customise: 'ladki banao, shirt ka rang lal', target: 'sita', base: 'person' });
    await forge({ customise: 'thoda lamba karo, joote kaale karo', target: 'sita' });
    const p = paramsOf('src/game/objects/sita.ts');
    expect(p.gender).toBe('female'); expect(p.colors.top).toBe('#c62828'); expect(p.colors.shoes).toBe('#1a1a1a'); expect(p.height).toBeGreaterThan(1.8);
  });

  it('changes a part of an ordinary object: the door of a house, and only the door', async () => {
    await forge({ spec: FORGE_EXAMPLES.house.spec });
    const r = await forge({ customise: 'door ka rang neela karo', target: 'house' });
    expect(text(r)).toMatch(/Changed: door → #1e5bb8/);
    const saved = JSON.parse(act.files.get('src/game/objects/house.ts')!.split('export const SPEC: ObjectSpec = ')[1].split(';\n\n/**')[0]);
    const door = saved.nodes.find((n: any) => n.name === 'door');
    expect(saved.materials[door.material].color).toBe('#1e5bb8');
    expect(saved.materials.wall.color).toBe((FORGE_EXAMPLES.house.spec as any).materials.wall.color);
  });

  it('a wish the object cannot take changes NOTHING, writes nothing new, and says why', async () => {
    await forge({ spec: FORGE_EXAMPLES.house.spec });
    const before = act.files.get('src/game/objects/house.ts');
    act.writes.length = 0;
    const r = await forge({ customise: 'ladki banao, baal bade karo', target: 'house' });
    expect(act.writes).toEqual([]); // nothing was changed, so nothing was written at all (not even an identical file)
    expect(text(r)).toMatch(/Nothing could be changed/); expect(text(r)).toMatch(/CANNOT be done/);
    expect(act.files.get('src/game/objects/house.ts')).toBe(before);
  });

  it('what it did not understand comes back to the builder, with the part that WAS understood applied', async () => {
    const r = await forge({ customise: 'shirt ka rang lal, kuch jaadu karo', target: 'p1', base: 'person' });
    expect(text(r)).toMatch(/Changed: clothes/); expect(text(r)).toMatch(/NOT UNDERSTOOD.*jaadu/);
  });

  it('with no target, or a target that is not here, it lists what is here instead of guessing', async () => {
    await forge({ spec: lamp() });
    expect(text(await forge({ customise: 'neela karo' }))).toMatch(/Say which object to change.*street-lamp/);
    expect(text(await forge({ customise: 'neela karo', target: 'castle' }))).toMatch(/no Forge object called "castle".*street-lamp.*base: "person"/);
    expect(text(await forge({ customise: 'neela karo', target: '../etc/passwd' }))).toMatch(/Say which object to change/);
  });

  it('a spec the builder passes still wins over customise, and the kill switch stops customise too', async () => {
    const seen = await forge({ customise: 'lal', target: 'x', spec: lamp({ id: 'mine' }) });
    expect(seen.is_error).toBeFalsy(); expect(act.files.has('src/game/objects/mine.ts')).toBe(true);
    process.env.AGENTV3_OBJECT_FORGE = 'off';
    expect((await forge({ customise: 'lal', target: 'mine' })).is_error).toBe(true);
  });

  it('is described to the builder: the tool says it understands English, Hinglish and Hindi, and the prompt says to report exactly what it returns', () => {
    const tool = defaultToolCatalog().find((t) => t.name === 'author_object')!;
    const props = (tool.input_schema as any).properties;
    expect(props.customise.description).toMatch(/Hinglish/); expect(props.target.type).toBe('string'); expect(props.base.enum).toEqual(['person']);
    const prompt = architectSystemPrompt();
    expect(prompt).toMatch(/customise: "<their words>"/); expect(prompt).toMatch(/never claim a change it did not make/);
  });
});

describe('source preservation and atomic capability boundaries', () => {
  it('without exclusive creation no kit or object file is written', async () => {
    Object.defineProperty(act, 'createFileExclusive', { value: undefined });
    const r = await forge({ spec: lamp() });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/atomic object write capability is unavailable/);
    expect(act.writes).toEqual([]);
  });

  it('without genuine CAS an existing object is preserved and the change is refused', async () => {
    await forge({ spec: FORGE_EXAMPLES.house.spec });
    const first = new Map(act.files);
    act.writes.length = 0;
    Object.defineProperty(act, 'compareAndSwapFile', { value: undefined });
    const r = await forge({ customise: 'door ka rang neela karo', target: 'house' });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/atomic object write capability is unavailable/);
    expect(act.files).toEqual(first);
    expect(act.writes).toEqual([]);
  });

  it('custom source is never replaced or mistaken for a missing person', async () => {
    const path = 'src/game/objects/sita.ts';
    act.files.set(path, '// user-authored source');
    const r = await forge({ customise: 'ladki banao', target: 'sita', base: 'person' });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/customized or not a canonical Forge object/);
    expect(act.files.get(path)).toBe('// user-authored source');
    expect(act.writes).toEqual([]);
  });

  it('an unreadable target is preserved instead of being recreated from a base', async () => {
    vi.spyOn(act, 'readFile').mockRejectedValue(new Error('EACCES: permission denied'));
    const r = await forge({ customise: 'ladki banao', target: 'sita', base: 'person' });
    expect(r.is_error).toBe(true);
    expect(act.writes).toEqual([]);
  });

  it('a canonical object with a different embedded identity is not a valid target', async () => {
    await forge({ spec: lamp() });
    act.files.set('src/game/objects/sita.ts', act.files.get('src/game/objects/street-lamp.ts')!);
    act.writes.length = 0;
    const r = await forge({ customise: 'lal karo', target: 'sita' });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/identity does not match/);
    expect(act.writes).toEqual([]);
  });

  it('a changed runtime kit is preserved and no missing files are added', async () => {
    act.files.set('src/game/forge/forge.ts', '// customized runtime');
    const r = await forge({ spec: lamp() });
    expect(r.is_error).toBe(true);
    expect(text(r)).toMatch(/Existing Forge kit differs/);
    expect(act.files).toEqual(new Map([['src/game/forge/forge.ts', '// customized runtime']]));
    expect(act.writes).toEqual([]);
  });

  it('exclusive create cannot clobber an object that appeared after the read', async () => {
    const original = act.createFileExclusive.bind(act);
    vi.spyOn(act, 'createFileExclusive').mockImplementation(async (w, p, c) => {
      if (p === 'src/game/objects/street-lamp.ts') act.files.set(p, '// concurrently authored');
      return original(w, p, c);
    });
    const r = await forge({ spec: lamp() });
    expect(r.is_error).toBe(true);
    expect(act.files.get('src/game/objects/street-lamp.ts')).toBe('// concurrently authored');
    expect(act.writes).not.toContain('src/game/objects/street-lamp.ts');
  });

  it('atomic replacement rejects a concurrent edit and preserves its bytes', async () => {
    await forge({ spec: FORGE_EXAMPLES.house.spec });
    act.writes.length = 0;
    const original = act.compareAndSwapFile.bind(act);
    vi.spyOn(act, 'compareAndSwapFile').mockImplementation(async (w, p, expected, c) => {
      act.files.set(p, '// concurrent edit');
      return original(w, p, expected, c);
    });
    const r = await forge({ customise: 'door ka rang neela karo', target: 'house' });
    expect(r.is_error).toBe(true);
    expect(act.files.get('src/game/objects/house.ts')).toBe('// concurrent edit');
    expect(act.writes).toEqual([]);
  });
});

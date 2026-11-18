// THE MAP KINDS ARE WIRED (admin 2026-11-15, "100+ type ke maps, 1 km se 1000 km"): through the REAL ToolDispatcher, a request's words or the
// builder's own archetype and size_km choose the map; a bad choice is refused with the real list; the choice lands in the project's config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { ARCHETYPE_IDS } from '../src/server/lib/athreeMap/athreeMapKinds';

class Fake implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

let act: Fake; let d: ToolDispatcher;
const CONFIG = 'src/game/athree/config.ts';
const run = (request: string, input: Record<string, unknown> = {}) => { d.setCoverageRequest(request); return d.dispatch({ id: 't', name: 'generate_athree_map', input }, 'architect'); };
const optionsIn = (): any => { const m = /export const MAP_OPTIONS: MapOptions = (\{[\s\S]*?\});/.exec(act.files.get(CONFIG)!); return m ? JSON.parse(m[1]) : null; };

beforeEach(() => {
  process.env.AGENTV3_ATHREE_MAP = 'on';
  act = new Fake();
  const stream = new AgentEventStream();
  clearPreviewGaveUp('ws-kinds');
  d = new ToolDispatcher(act, 'ws-kinds', new WorkspaceState(stream), stream);
});
afterEach(() => { delete process.env.AGENTV3_ATHREE_MAP; });

describe('the tool and the prompt offer the choice', () => {
  it('takes archetype and size_km, and names the kinds', () => {
    const props = (defaultToolCatalog().find((t) => t.name === 'generate_athree_map')!.input_schema as any).properties;
    expect(props.archetype.type).toBe('string'); expect(props.size_km.type).toBe('number');
    for (const k of ARCHETYPE_IDS) expect(props.archetype.description).toContain(k);
    expect(props.size_km.description).toMatch(/1 to 1000/);
  });
  it('the architect prompt names the 12 kinds, the 1 to 1000 km range and the road limit', () => {
    const p = architectSystemPrompt();
    expect(p).toMatch(/12 kinds/); expect(p).toMatch(/1 to 1000 km/); expect(p).toMatch(/under 20 km has no roads/);
  });
});

describe('what the user said chooses the map', () => {
  it('"5 km ka registan racing game" is a desert map, 5 km, recorded in the project', async () => {
    const r = await run('athree map par 5 km ka registan racing game banao');
    expect(r.is_error).toBeFalsy();
    expect(optionsIn()).toMatchObject({ mode: 'loop', sizeMeters: 5000, style: { aridity: 0.45 } });
    expect(String(r.content)).toMatch(/THE MAP CHOSEN FOR THIS GAME: desert map, 5 km/);
    expect(String(r.content)).toMatch(/no roads and no runway/);
  });
  it('"a huge island" is a bounded island, hundreds of km across', async () => {
    await run('athree map par ek huge island battle royale');
    expect(optionsIn().mode).toBe('bounded'); expect(optionsIn().sizeMeters).toBeGreaterThanOrEqual(250000);
  });
  it('a request that names no size and no kind of land gets the default world (empty MAP_OPTIONS)', async () => {
    await run('athree map par 3D racing game banao');
    expect(act.files.get(CONFIG)).toMatch(/export const MAP_OPTIONS: MapOptions = \{\};/);
  });
});

describe('what the builder chose wins over the words', () => {
  it('archetype and size_km are used as given', async () => {
    await run('athree map par racing game banao', { archetype: 'tundra', size_km: 40 });
    expect(optionsIn()).toMatchObject({ mode: 'loop', sizeMeters: 40000, style: { warmth: -0.45 } });
  });
  it('a size alone gets the default kind; a kind alone gets 100 km', async () => {
    await run('athree map par racing game banao', { size_km: 12 });
    expect(optionsIn()).toMatchObject({ sizeMeters: 12000, style: {} });
    const b = new Fake(); act = b;
    const stream = new AgentEventStream(); d = new ToolDispatcher(b, 'ws-kinds2', new WorkspaceState(stream), stream);
    await run('athree map par racing game banao', { archetype: 'jungle' });
    expect(optionsIn()).toMatchObject({ sizeMeters: 100000 });
  });
  it('a size out of range is held to 1..1000 km, never refused and never passed through', async () => {
    await run('athree map par racing game banao', { archetype: 'desert', size_km: 99999 });
    expect(optionsIn().sizeMeters).toBe(1_000_000);
  });
  it('a size that is not a number is ignored (the words decide)', async () => {
    await run('athree map par 7 km racing game banao', { size_km: 'huge' });
    expect(optionsIn().sizeMeters).toBe(7000);
  });
  it('an unknown kind of land is refused with the real list and writes nothing', async () => {
    const r = await run('athree map par racing game banao', { archetype: 'volcano' });
    expect(String(r.content)).toMatch(/Unknown map kind "volcano"/);
    for (const k of ARCHETYPE_IDS) expect(String(r.content)).toContain(k);
    expect(act.files.size).toBe(0);
  });
  it('the kind is read in any case', async () => {
    await run('athree map par racing game banao', { archetype: '  DESERT ', size_km: 10 });
    expect(optionsIn().style.aridity).toBe(0.45);
  });
});

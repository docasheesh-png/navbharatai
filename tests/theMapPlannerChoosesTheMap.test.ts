// THE MAP PLANNER IS WIRED (admin 2026-11-27, wave 1 part 1): through the REAL ToolDispatcher, the one planner chooses the Athree map
// from the user's words, writes its plan into the project, adds the robot checks, runs them on the map it wrote, and says in the build
// note exactly which layers this world applies and which are only recorded — never more.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';

vi.setConfig({ testTimeout: 120000 });

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
const optionsIn = (): any => JSON.parse(/export const MAP_OPTIONS: MapOptions = (\{[\s\S]*?\});/.exec(act.files.get(CONFIG)!)![1]);
const planIn = (): any => JSON.parse(/export const MAP_PLAN = (\{[\s\S]*?\}) as const;/.exec(act.files.get(CONFIG)!)![1]);

beforeEach(() => {
  process.env.AGENTV3_ATHREE_MAP = 'on';
  act = new Fake();
  const stream = new AgentEventStream();
  clearPreviewGaveUp('ws-plan');
  d = new ToolDispatcher(act, 'ws-plan', new WorkspaceState(stream), stream);
});
afterEach(() => { delete process.env.AGENTV3_ATHREE_MAP; });

describe('real prompts choose the map through the one planner', () => {
  it('"athree map par 5 km ka registan shooter, pahaadon se ghira, do talab, raat ka": side 5 km, desert, mountains, two ponds, night', async () => {
    const r = await run('athree map par 5 km ka registan shooter game, pahaadon se ghira, do talab, raat ka');
    expect(r.is_error).toBeFalsy();
    expect(optionsIn()).toMatchObject({ mode: 'loop', sizeMeters: 5000, style: { aridity: 0.45 } });
    expect(planIn()).toMatchObject({ areaKm2: 25, archetype: 'desert', boundary: 'mountains', water: { ponds: 2 }, timeOfDay: 'night', gameType: 'shooter' });
    const text = String(r.content);
    expect(text).toMatch(/MAP PLAN: a shooter game; desert land, 5 x 5 km \(25 km², the size you asked for\)/);
    expect(text).toMatch(/boundary: a ring of mountains \(asked for\) — APPLIED/);
    expect(text).toMatch(/water: 2 ponds — APPLIED/);
    expect(text).toMatch(/pass skyOptions \{ hours: 22 \}/);
    expect(text).toMatch(/density .*do not claim it/);
  });
  it('"athree map par battle royale": the 8 km island, sea all round, and the robot checks ran and passed on it', async () => {
    const r = await run('athree map par ek battle royale game banao');
    expect(optionsIn()).toMatchObject({ mode: 'bounded', sizeMeters: 8000 });
    const text = String(r.content);
    expect(text).toMatch(/ROBOT CHECKS \(build time, sample seed 1; the game re-checks its own seed\): every check passed/);
    expect(text).toMatch(/boundary-closed: passed/);
    expect(act.files.get('src/game/athree/mapChecks.ts')).toMatch(/export function publishMapChecks/);
  });
  // Roads exist on every size since #4626; a runway fits a 100 km² flight map, so it is not raised (it was raised to 400 km² before).
  it('"athree map par plane game": flight, 100 km² (10 km across), with its runway, and not raised', async () => {
    const r = await run('athree map par ek plane game banao');
    expect(optionsIn().sizeMeters).toBe(10000);
    expect(String(r.content)).toMatch(/default for a flight game is 100 km²/);
    expect(String(r.content)).not.toMatch(/raised to/);
  });
  it('the user\'s size wins over the game default: "athree map par 2 sq km ka car racing game"', async () => {
    const r = await run('athree map par 2 sq km ka open world car racing game');
    expect(optionsIn().sizeMeters).toBe(1410);
    expect(planIn().areaKm2).toBe(2);
    expect(String(r.content)).toMatch(/2 km² was read as the AREA/);
    expect(String(r.content)).not.toMatch(/raised to/);
  });
  it('the shared world options reach createAthreeWorld through MAP_OPTIONS', async () => {
    await run('athree map par Kerala backwaters explore game, curvy roads');
    const config = act.files.get(CONFIG)!;
    expect(config).toMatch(/Object\.assign\(MAP_OPTIONS, \{"areaKm2":5,"boundary":"sea","water":\{"sea":true,"rivers":0,"lakes":1,"ponds":0,"canals":1\},"roadStyle":"hill","density":"normal"\}\);/);
    expect(act.files.get('src/game/athree/index.ts')).toContain('createAthreeWorld({ ...MAP_OPTIONS, ...options })');
  });
});

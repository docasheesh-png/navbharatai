// THE OWN-LAND NOTE NEVER SILENCES THE ROAD NOTE (re-review 2026-11-23 of the feature-land scan). The first version shared the
// ground note's once-per-build flag: a feature's football pitch (105 x 68) fired a land note, set the flag, and a later
// hand-written flat road on hilly terrain — the note that exists for exactly that — was never said. Now the land note has
// its own flag, fires only in an open world (src/game/world.ts exists) and only for map-scale land. The REAL dispatcher,
// an in-memory sandbox, synthetic files.
import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
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
const make = (act: FakeActuator) => { const stream = new AgentEventStream(); return new ToolDispatcher(act, 'ws-ground', new WorkspaceState(stream), stream); };
let n = 0;
const write = async (d: ToolDispatcher, path: string, content: string) => String((await d.dispatch({ id: `w${++n}`, name: 'write_file', input: { path, content } }, 'architect')).content ?? '');

const STADIUM = "import * as THREE from 'three';\nconst pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshStandardMaterial());\npitch.rotation.x = -Math.PI / 2;\nexport const stadium = pitch;\n";
const SCENE = "import * as THREE from 'three';\nimport { createTerrain } from '../three/surfaces';\nconst terrain = createTerrain({ palette: 'indianVillage', size: 400 });\nconst road = new THREE.Mesh(new THREE.PlaneGeometry(8, 800), new THREE.MeshStandardMaterial());\nexport const scene = [terrain, road];\n";
const MEADOW = "import * as THREE from 'three';\nconst field = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial());\nfield.rotation.x = -Math.PI / 2;\nfield.position.y = -0.1;\nexport const meadow = field;\n";

describe('🌱 the land note has its own flag, and the road note still fires', () => {
  it('the reviewer\'s repro: a stadium pitch first, then a flat road on hilly terrain — the road note fires, the pitch gets none', async () => {
    const act = new FakeActuator(); act.files.set('package.json', '{"name":"app"}'); act.files.set('src/game/world.ts', 'export const WORLD = { regions: [] };\n');
    const d = make(act);
    const first = await write(d, 'src/game/features/stadium.ts', STADIUM);
    expect(first).not.toContain('A FEATURE LAYS ITS OWN LAND');
    expect(first).not.toContain('HAND-WRITTEN GROUND');
    const second = await write(d, 'src/game/racing/Scene.ts', SCENE);
    expect(second).toContain('⛰️ HAND-WRITTEN GROUND');
    expect(second).not.toContain('A FEATURE LAYS ITS OWN LAND');
  }, 60_000);

  it('a map-scale land in an open world gets its note, and the road note after it still fires', async () => {
    const act = new FakeActuator(); act.files.set('package.json', '{"name":"app"}'); act.files.set('src/game/world.ts', 'export const WORLD = { regions: [] };\n');
    const d = make(act);
    const first = await write(d, 'src/game/features/meadow.ts', MEADOW);
    expect(first).toContain('A FEATURE LAYS ITS OWN LAND');
    const second = await write(d, 'src/game/racing/Scene.ts', SCENE);
    expect(second).toContain('⛰️ HAND-WRITTEN GROUND');
    expect(second).not.toContain('A FEATURE LAYS ITS OWN LAND');      // once per build
  }, 60_000);

  it('a features-only game with no src/game/world.ts: no land note', async () => {
    const act = new FakeActuator(); act.files.set('package.json', '{"name":"app"}');
    const d = make(act);
    expect(await write(d, 'src/game/features/meadow.ts', MEADOW)).not.toContain('A FEATURE LAYS ITS OWN LAND');
  }, 60_000);
});

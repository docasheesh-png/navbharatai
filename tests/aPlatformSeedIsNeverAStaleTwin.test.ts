// Autopsy 14ea28b8 (2026-10-21): a 3D game build seeded the platform's game kit (src/game/Game.ts), the model
// then wrote its own src/game/Game.tsx, and the shadow-twin guard DELETED the kit's Game.ts as a "stale copy".
// Every kit module importing './Game' lost its exports; the app rendered but failed its production build
// (TS2614 "no exported member 'GameContext'"). CLASS: the guard was armed with `modelAuthoredPaths` — the set
// that excludes our own seeds — so a seed looked like debris. Only a file nobody in this build wrote (an earlier
// attempt's unsaved leftover, the e725e002 case) is stale.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shadowingTwins, shadowKeptToolNote } from '../src/server/AgentV3/shadowTwin';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { modelAuthoredPaths } from '../src/server/AgentV3/platformAuthored';

class Act implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_w: string, cmd: string) { if (cmd.startsWith('rm -f ')) for (const m of cmd.matchAll(/'([^']+)'/g)) this.files.delete(m[1]); return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_w: string, port: number) { return `https://x-${port}.dev`; }
}

const KIT_GAME = "export interface GameOptions { debug?: boolean }\nexport class Game { constructor(public o: GameOptions) {} }\nexport const GameContext = {};\n";
const MODEL_GAME = 'export default function GameView() { return null; }\n';

function build(armWith: (written: Map<string, string>) => Iterable<string>) {
  const act = new Act();
  const written = new Map<string, string>();
  act.files.set('src/game/Game.ts', KIT_GAME);
  written.set('src/game/Game.ts', KIT_GAME); // the kit seed is recorded in writtenFiles like every write
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, 'ws-seed', new WorkspaceState(stream), stream, undefined, undefined, undefined, undefined, undefined, undefined, (p) => { written.set(p, 'x'); });
  d.armShadowTwins(() => armWith(written));
  return { act, d, written };
}

describe('a platform seed is never removed as a stale twin', () => {
  it('the real shape: the kit\'s Game.ts survives the model writing Game.tsx, and the model is told about the clash', async () => {
    const { act, d } = build((w) => w.keys());
    const res = await d.dispatch({ id: 't', name: 'write_file', input: { path: 'src/game/Game.tsx', content: MODEL_GAME } }, 'architect');
    expect(act.files.get('src/game/Game.ts')).toBe(KIT_GAME);
    expect(d.shadowTwinTally().removed).toEqual([]);
    expect(String(res.content)).toMatch(/NAME CLASH/);
    expect(String(res.content)).toContain('src/game/Game.ts');
  });
  it('a genuinely stale twin (nobody in this build wrote it) is still removed — e725e002 keeps working', async () => {
    const { act, d } = build((w) => w.keys());
    act.files.set('src/data/products.js', 'export const OLD = 1;\n');
    await d.dispatch({ id: 't', name: 'write_file', input: { path: 'src/data/products.ts', content: 'export const NEW = 1;\n' } }, 'architect');
    expect(act.files.has('src/data/products.js')).toBe(false);
  });
  it('the old arming (modelAuthoredPaths) would have deleted the kit file — the failure this pins', () => {
    const written = new Map([['src/game/Game.ts', KIT_GAME]]);
    // modelAuthoredPaths excludes byte-exact platform seeds only when they are registered as seeds; the wiring
    // must therefore not depend on that set at all. Pin the wiring itself.
    expect(modelAuthoredPaths(written)).toBeInstanceOf(Array);
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/dispatcher\.armShadowTwins\(\(\) => writtenFiles\.keys\(\)\)/);
    expect(route).not.toMatch(/armShadowTwins\(\(\) => modelAuthoredPaths/);
  });
  it('helper: with an empty authored set every earlier-resolving twin is reported (for the clash note)', () => {
    expect(shadowingTwins('src/game/Game.tsx', ['src/game/Game.ts', 'src/game/Game.tsx'], new Set())).toEqual(['src/game/Game.ts']);
    expect(shadowKeptToolNote('src/game/Game.tsx', [])).toBe('');
  });
});

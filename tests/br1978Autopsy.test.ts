/**
 * BR1978 (87a6202d, "Build one game", succeeded, charged ₹5.55) — retained evidence, not a replay.
 *
 * The build started under SANDBOX_UNAVAILABLE (E2B cap of 20). The workspace held nothing (0 paths), yet
 * GAME_KIT_SEEDED said generate_game_runtime, generate_game_vfx and generate_melody were laid down with
 * **0 files**, and told the builder the kit was on disk. The builder then found no App.tsx, rebuilt the
 * Vite project by hand, and WRITE_TIME_TYPECHECK reported "never ran although 20 TypeScript write(s)
 * happened — no tsconfig.json was found", although the builder wrote tsconfig.json at 09:53:53 IST.
 *
 * All three holes were closed on main by later merged fixes; this file locks each against BR1978's
 * exact shape so none of them can come back:
 *   • BR1958 (#4132) — no recipe runs without a readable React manifest (`prepareGameSeedWorkspace`).
 *   • BR1977 (#4170) — a recipe "success" with fewer landed files than successes is not a seed.
 *   • BR1951 — a successful tsconfig.json write supersedes the cached "not TypeScript" verdict.
 */
import { describe, it, expect } from 'vitest';
import { prepareGameSeedWorkspace } from '../src/server/AgentV3/gameSeedWorkspace';
import {
  gameKitPlan, gameKitHandoffBlock, gameKitSeededMessage, downgradeEmptyKitSeedSuccesses, type GameKitSeedResult,
} from '../src/server/AgentV3/gameKitSeed';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { assessBuildInput } from '../src/server/AgentV3/buildableInput';

const PROMPT = 'Build one game';
const REACT_MANIFEST = JSON.stringify({ name: 'game', dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } });

describe('BR1978 — no recipe runs into a workspace that has no project', () => {
  it('the prompt plans the 2D kit (the three recipes this report listed)', () => {
    expect(gameKitPlan(PROMPT, 'vite-react')).toEqual(['generate_game_runtime', 'generate_game_vfx', 'generate_melody']);
  });

  it('sandbox down: no manifest and starter recovery fails → not ready, nothing seeded', async () => {
    let recovered = 0;
    const r = await prepareGameSeedWorkspace({
      stopped: () => false,
      readManifest: async () => { throw new Error('Rate limit exceeded — maximum number of concurrent E2B sandboxes (20)'); },
      recoverStarter: async () => { recovered++; throw new Error('Rate limit exceeded'); },
      takeScaffold: () => undefined,
    });
    expect(recovered).toBe(1);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('workspace setup did not recover; no game recipes were run');
  });

  it('recovery that still leaves no readable React manifest is not ready either', async () => {
    const r = await prepareGameSeedWorkspace({
      stopped: () => false,
      readManifest: async () => { throw new Error('ENOENT: package.json'); },
      recoverStarter: async () => {},
      takeScaffold: () => ({}),
    });
    expect(r.ready).toBe(false);
  });

  it('neighbour: a recovered starter with a React manifest is ready and its scaffold is kept', async () => {
    let calls = 0;
    const r = await prepareGameSeedWorkspace({
      stopped: () => false,
      readManifest: async () => { if (calls++ === 0) throw new Error('ENOENT: package.json'); return REACT_MANIFEST; },
      recoverStarter: async () => {},
      takeScaffold: () => ({ 'package.json': REACT_MANIFEST }),
    });
    expect(r.ready).toBe(true);
    expect(r.scaffold).toEqual({ 'package.json': REACT_MANIFEST });
  });

  it('neighbour: an existing React manifest needs no recovery', async () => {
    let recovered = 0;
    const r = await prepareGameSeedWorkspace({
      stopped: () => false,
      readManifest: async () => REACT_MANIFEST,
      recoverStarter: async () => { recovered++; },
      takeScaffold: () => undefined,
    });
    expect(r).toMatchObject({ ready: true, reason: 'manifest present' });
    expect(recovered).toBe(0);
  });
});

describe('BR1978 — three recipe successes and 0 files is not a seeded kit', () => {
  const ok = (recipe: GameKitSeedResult['recipe']): GameKitSeedResult => ({ recipe, ok: true, content: 'Created nothing' });
  const plan = () => gameKitPlan(PROMPT, 'vite-react').map(ok);

  it('this report\'s claim is downgraded, the handoff is silent, the admin line says not laid down', () => {
    const results = plan();
    downgradeEmptyKitSeedSuccesses(results, 0);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].content).toContain('only 0 file(s) landed for 3 recipe(s)');
    expect(gameKitHandoffBlock(results)).toBe('');
    expect(gameKitSeededMessage(results, 0, 7400)).toContain('Not laid down: generate_game_runtime, generate_game_vfx, generate_melody');
  });

  it('neighbour: a healthy 2D seed keeps its claim and its handoff', () => {
    const results = plan();
    downgradeEmptyKitSeedSuccesses(results, 12);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(gameKitHandoffBlock(results)).toContain('Their files are on disk NOW');
  });
});

class MemorySandbox implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  async readFile(_ws: string, p: string) {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`ENOENT: ${p}`);
    return c;
  }
  async writeFile(_ws: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_ws: string, cmd: string) { this.commands.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl() { return 'https://example.invalid'; }
}
let seq = 0;
const call = (d: ToolDispatcher, name: string, input: Record<string, unknown>) => d.dispatch({ id: `br1978-${++seq}`, name, input }, 'architect');
const compiled = (a: MemorySandbox) => a.commands.some((c) => c.includes('--noEmit'));

describe('BR1978 — the write-time compiler wakes up when the builder writes tsconfig.json', () => {
  it('the delivered order: game files, then the hand-rebuilt project, then App.tsx is compiled', async () => {
    const a = new MemorySandbox();
    const d = new ToolDispatcher(a, `br1978-${++seq}`);
    await call(d, 'write_file', { path: 'src/game/color-rush/types.ts', content: 'export type Color = string;\n' });
    await call(d, 'write_file', { path: 'src/game/color-rush/GameLogic.ts', content: 'export const speed = 1;\n' });
    expect(compiled(a)).toBe(false); // genuinely no config yet
    await call(d, 'write_file', { path: 'package.json', content: REACT_MANIFEST });
    await call(d, 'write_file', { path: 'tsconfig.json', content: '{"compilerOptions":{"jsx":"react-jsx","strict":true}}' });
    a.commands = [];
    await call(d, 'write_file', { path: 'src/App.tsx', content: 'export default function App() { return null; }\n' });
    expect(compiled(a)).toBe(true);
  });

  it('neighbour: a project that never writes a tsconfig is still not compiled', async () => {
    const a = new MemorySandbox();
    const d = new ToolDispatcher(a, `br1978-${++seq}`);
    await call(d, 'write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' });
    await call(d, 'write_file', { path: 'src/b.ts', content: 'export const b = 2;\n' });
    expect(compiled(a)).toBe(false);
  });
});

describe('BR1978 — measured, not changed here (Q-2653 / Q-2654)', () => {
  // "Build one game" is read as buildable today; that is Q-2653 / Q-2654 and is deliberately NOT locked here.
  it('neighbour: "Build one app" still asks what to build', () => {
    expect(assessBuildInput('Build one app')).toMatchObject({ buildable: false, reason: 'no-object' });
  });
});

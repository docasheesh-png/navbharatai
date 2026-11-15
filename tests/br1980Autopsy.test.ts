/**
 * BR1980 (c96f6eb3, house-explorer game, succeeded, free / not charged) —
 * retained evidence, not a replay.
 *
 * The build started under SANDBOX_UNAVAILABLE (E2B cap of 20) at 09:51:30 IST, one minute
 * after BR1978 during the same cap incident. The workspace held nothing, yet GAME_KIT_SEEDED
 * said generate_game_runtime, generate_game_vfx and generate_melody were laid down with
 * **0 files in 17.9 s**, and FAST_LANE_SKIPPED_GAME told the builder the kit was already on
 * disk. The builder rebuilt the Vite project by hand (tsconfig.json at 09:55:12 IST). First
 * tsc failed with TS17004 ('--jsx' is not set) and TS2307 (Cannot find module '../fx/audio').
 * WRITE_TIME_TYPECHECK later said "never ran although 34 TypeScript write(s) happened — no
 * tsconfig.json was found". The app still shipped READY 84/100 (step limit 80, 21.0 min,
 * OVER the 8.9–17.3 min game band, YELLOW for leftover dependency vulnerabilities).
 *
 * All three holes were closed on main by later merged fixes; this file locks each against
 * BR1980's exact shape so none of them can come back:
 *   • BR1961 F2 (#4146) — sandboxUnavailableNotice does not invite a retry.
 *   • BR1958 (#4132) — no recipe runs without a readable React manifest (`prepareGameSeedWorkspace`).
 *   • BR1977 (#4170) — a recipe "success" with fewer landed files than successes is not a seed,
 *     and FAST_LANE_SKIPPED_GAME is honest after that downgrade.
 *   • BR1951 — a successful tsconfig.json write supersedes the cached "not TypeScript" verdict.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { prepareGameSeedWorkspace } from '../src/server/AgentV3/gameSeedWorkspace';
import {
  gameKitPlan, gameKitHandoffBlock, gameKitSeededMessage, downgradeEmptyKitSeedSuccesses, type GameKitSeedResult,
} from '../src/server/AgentV3/gameKitSeed';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';

const PROMPT = '. Suno mujhe aisa game Banakar Jo Jiske andar Ek house banaa kar do Jiske andar Panch Kamre Ho latrin bathroom left side mein hun Achcha aur uska color aur red Uske Uske ghar ka bol ka color aur blue aur uske andar players bhi hone chahie mujhe ai';
const REACT_MANIFEST = JSON.stringify({ name: 'house-explorer', dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } });
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('BR1980 — a busy sandbox is not a goodbye', () => {
  it('the notice says we are still trying and does not invite a second Start (this report\'s old goodbye is gone)', () => {
    const n = sandboxUnavailableNotice();
    expect(n).toMatch(/temporarily unavailable/i);
    expect(n).toMatch(/still trying|as soon as I can/i);
    expect(n).not.toMatch(/I can't create files right now/i);
    expect(n).not.toMatch(/please try building again in a little while/i);
    expect(n).not.toMatch(/try building again|try again later|please retry/i);
  });
});

describe('BR1980 — no recipe runs into a workspace that has no project', () => {
  it('this prompt plans the 2D kit (the three recipes this report listed)', () => {
    expect(gameKitPlan(PROMPT, 'vite-react')).toEqual(['generate_game_runtime', 'generate_game_vfx', 'generate_melody']);
  });

  it('sandbox down: no manifest and starter recovery fails → not ready, nothing seeded', async () => {
    let recovered = 0;
    const r = await prepareGameSeedWorkspace({
      stopped: () => false,
      readManifest: async () => { throw new Error('Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes (20)'); },
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

describe('BR1980 — three recipe successes and 0 files is not a seeded kit', () => {
  const ok = (recipe: GameKitSeedResult['recipe']): GameKitSeedResult => ({ recipe, ok: true, content: 'Created nothing' });
  const plan = () => gameKitPlan(PROMPT, 'vite-react').map(ok);

  it('this report\'s claim is downgraded, the handoff is silent, the admin line says not laid down', () => {
    const results = plan();
    downgradeEmptyKitSeedSuccesses(results, 0);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].content).toContain('only 0 file(s) landed for 3 recipe(s)');
    expect(gameKitHandoffBlock(results)).toBe('');
    const line = gameKitSeededMessage(results, 0, 17_900);
    expect(line).toContain('Not laid down: generate_game_runtime, generate_game_vfx, generate_melody');
    expect(line).toContain('0 files, 17.9 s');
    // After the downgrade the route records GAME_KIT_NOT_SEEDED (gameKitSeeded is empty).
    expect(results.filter((r) => r.ok).map((r) => r.recipe)).toEqual([]);
  });

  it('neighbour: a healthy 2D seed keeps its claim and its handoff', () => {
    const results = plan();
    downgradeEmptyKitSeedSuccesses(results, 12);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(gameKitHandoffBlock(results)).toContain('Their files are on disk NOW');
    expect(gameKitSeededMessage(results, 12, 17_900)).toContain('generate_game_runtime, generate_game_vfx, generate_melody (12 files, 17.9 s)');
    expect(gameKitSeededMessage(results, 12, 17_900)).not.toContain('Not laid down:');
  });

  it('FAST_LANE_SKIPPED_GAME states whether the kit is on disk from gameKitSeeded, after the downgrade', () => {
    const at = ROUTE.indexOf("code: 'FAST_LANE_SKIPPED_GAME'");
    expect(at).toBeGreaterThan(0);
    const around = ROUTE.slice(Math.max(0, at - 800), at + 400);
    expect(around).toContain('const kitFact = gameKitSeeded.length > 0');
    expect(around).toContain('The game kit is already laid down');
    expect(around).toContain('The game kit was NOT laid down');
    // The list is filled only from recipes that are still ok after downgradeEmptyKitSeedSuccesses.
    expect(ROUTE).toContain('downgradeEmptyKitSeedSuccesses(kitResults, recipeFiles)');
    const downgradeAt = ROUTE.indexOf('downgradeEmptyKitSeedSuccesses(kitResults, recipeFiles)');
    const filledAt = ROUTE.indexOf('for (const r of kitResults) if (r.ok) gameKitSeeded.push(r.recipe);');
    expect(downgradeAt).toBeGreaterThan(0);
    expect(filledAt).toBeGreaterThan(downgradeAt);
    expect(filledAt).toBeLessThan(at);
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
const call = (d: ToolDispatcher, name: string, input: Record<string, unknown>) => d.dispatch({ id: `br1980-${++seq}`, name, input }, 'architect');
const compiled = (a: MemorySandbox) => a.commands.some((c) => c.includes('--noEmit'));

describe('BR1980 — the write-time compiler wakes up when the builder writes tsconfig.json', () => {
  it('this report\'s delivered order: house-explorer files, then the hand-rebuilt project, then later TS writes are compiled', async () => {
    const a = new MemorySandbox();
    const d = new ToolDispatcher(a, `br1980-${++seq}`);
    await call(d, 'write_file', { path: 'src/App.tsx', content: 'export default function App() { return null; }\n' });
    await call(d, 'write_file', { path: 'src/game/house-explorer/types.ts', content: 'export type RoomType = string;\n' });
    await call(d, 'write_file', { path: 'src/game/house-explorer/state.ts', content: 'export const rooms = 5;\n' });
    await call(d, 'write_file', { path: 'src/game/house-explorer/GameRenderer.tsx', content: 'export default function GameRenderer() { return null; }\n' });
    expect(compiled(a)).toBe(false); // genuinely no config yet (this report, 09:52 IST)
    await call(d, 'write_file', { path: 'index.html', content: '<div id="root"></div>\n' });
    await call(d, 'write_file', { path: 'src/main.tsx', content: 'export {};\n' });
    await call(d, 'write_file', { path: 'src/index.css', content: 'body{}\n' });
    await call(d, 'write_file', { path: 'package.json', content: REACT_MANIFEST });
    await call(d, 'write_file', { path: 'tsconfig.json', content: '{"compilerOptions":{"jsx":"react-jsx","strict":true}}' });
    a.commands = [];
    // 09:55:12 IST tsconfig landed; later writes (audio.ts, storage.ts, GameRenderer rewrite) must compile.
    await call(d, 'write_file', { path: 'src/game/house-explorer/audio.ts', content: 'export function play() {}\n' });
    expect(compiled(a)).toBe(true);
    a.commands = [];
    await call(d, 'write_file', { path: 'src/game/house-explorer/storage.ts', content: 'export function loadProgress() {}\n' });
    expect(compiled(a)).toBe(true);
  });

  it('neighbour: a project that never writes a tsconfig is still not compiled', async () => {
    const a = new MemorySandbox();
    const d = new ToolDispatcher(a, `br1980-${++seq}`);
    await call(d, 'write_file', { path: 'src/game/house-explorer/types.ts', content: 'export type RoomType = string;\n' });
    await call(d, 'write_file', { path: 'src/App.tsx', content: 'export default function App() { return null; }\n' });
    expect(compiled(a)).toBe(false);
  });
});

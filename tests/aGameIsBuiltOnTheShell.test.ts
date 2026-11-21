// A 3D GAME IS BUILT ON THE SHELL, OR IT IS TOLD WHAT IT LOSES (admin 2026-11-20, "aur kya missing hai game me").
// Evidence: builds #2475, #2476 and #2477 — three "pubg / bgmi jaisa" games, all asking for a JOYSTICK. The kit's shell
// (src/game/GameCanvas.tsx) was seeded each time and each time the builder wrote its own `new THREE.WebGLRenderer()` and
// loop, so the shell's touch controls, menus and HUD never existed: #2476 shipped a d-pad with "empty functions",
// #2477's arrows "changed nothing". The fixture below is the SHAPE of #2476's own CityBattleRoyale.tsx.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shellHalves, shellBypassFinding, shellBypassNote, shellBypassWarning } from '../src/server/AgentV3/shellBypass';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

/** The shape of build #2476's hand-rolled scene: its own renderer in a mountRef div, its own loop. */
const HAND_ROLLED = `import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { createHumanoid } from './three/humanoid';
export default function CityBattleRoyale() {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    mountRef.current!.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const tick = () => { renderer.render(scene, camera); requestAnimationFrame(tick); }; tick();
  }, []);
  return <div ref={mountRef}><button onTouchStart={() => {}}>▲</button></div>;
}`;
const ON_SHELL = `import GameCanvas from './GameCanvas';
export default function Battle() { return <GameCanvas setup={(ctx) => []} update={() => {}} />; }`;
const R3F = `import { Canvas } from '@react-three/fiber';
export default function G() { return <Canvas><mesh /></Canvas>; }`;
const CANVAS_2D = `export function draw(c: HTMLCanvasElement) { const g = c.getContext('2d')!; g.fillRect(0, 0, 10, 10); }`;

const index = (files: Record<string, string>) => new Map(Object.entries(files).map(([p, c]) => [p, shellHalves(p, c)]));

describe('🎮 the check', () => {
  it('🔴 build #2476\'s shape: the shell is in the project, the game builds its own renderer and never mounts it → flagged', () => {
    const f = shellBypassFinding(index({ 'src/game/CityBattleRoyale.tsx': HAND_ROLLED, 'src/App.tsx': 'import C from "./game/CityBattleRoyale"; export default () => <C />;' }), true);
    expect(f).toEqual({ files: ['src/game/CityBattleRoyale.tsx'] });
    const note = shellBypassNote(f!);
    expect(note).toMatch(/touch joystick/);
    expect(note).toMatch(/<GameCanvas setup=/);
    expect(note).toMatch(/requestAnimationFrame/);
    expect(shellBypassWarning(f!)).toMatch(/GAME SHELL SKIPPED: src\/game\/CityBattleRoyale\.tsx/);
  });
  it('a react-three-fiber <Canvas> is its own renderer too', () => {
    expect(shellBypassFinding(index({ 'src/game/G.tsx': R3F }), true)?.files).toEqual(['src/game/G.tsx']);
  });
  it('never flagged: a game ON the shell (even with extra three.js of its own), new Game(...), or the racing starter', () => {
    expect(shellBypassFinding(index({ 'src/game/CityBattleRoyale.tsx': HAND_ROLLED, 'src/game/Battle.tsx': ON_SHELL }), true)).toBeNull();
    expect(shellBypassFinding(index({ 'src/game/X.tsx': HAND_ROLLED + '\nconst g = new Game({ container });' }), true)).toBeNull();
    expect(shellBypassFinding(index({ 'src/game/X.tsx': HAND_ROLLED, 'src/App.tsx': 'import RacingRoadGame from "./game/RacingRoadGame"; export default () => <RacingRoadGame />;' }), true)).toBeNull();
  });
  it('never flagged: no shell in the project (Q-2715 — a game may draw its own canvas), a 2D canvas game, or the kit\'s own files', () => {
    expect(shellBypassFinding(index({ 'src/game/CityBattleRoyale.tsx': HAND_ROLLED }), false)).toBeNull();
    expect(shellBypassFinding(index({ 'src/game/draw.ts': CANVAS_2D }), true)).toBeNull();
    expect(shellBypassFinding(index({ 'src/game/three/renderer.ts': 'export const r = new THREE.WebGLRenderer();' }), true)).toBeNull();
    expect(shellBypassFinding(index({ 'src/game/X.tsx': '// new THREE.WebGLRenderer() was here\nexport const x = 1;' }), true)).toBeNull();
  });
});

class Fake implements ActuatorPort {
  files = new Map<string, string>();
  failRead = false;
  async readFile(_w: string, p: string): Promise<string> { if (this.failRead) throw new Error('EIO'); const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
const READY: ReadinessReport = { score: 100, ready: true, blockers: [], warnings: [], tier: 'production' } as ReadinessReport;
const gate = (d: ToolDispatcher, r: ReadinessReport = READY): Promise<ReadinessReport> =>
  (d as unknown as { _warnIfShellSkipped(x: ReadinessReport): Promise<ReadinessReport> })._warnIfShellSkipped(r);
const dispatcher = (act: Fake) => { const s = new AgentEventStream(); return new ToolDispatcher(act, 'ws-shell', new WorkspaceState(s), s); };

describe('the readiness report', () => {
  it('🔴 a game that skipped the shell carries the warning; existing warnings are kept', async () => {
    const act = new Fake();
    act.files.set('src/game/GameCanvas.tsx', 'export default function GameCanvas() { return null; }');
    act.files.set('src/game/CityBattleRoyale.tsx', HAND_ROLLED);
    const r = await gate(dispatcher(act), { ...READY, warnings: ['other'] });
    expect(r.warnings[0]).toBe('other');
    expect(r.warnings.join('\n')).toMatch(/GAME SHELL SKIPPED/);
    expect(r.ready).toBe(true);   // a warning, never a blocker
  });
  it('a game on the shell, or a project without the shell, is untouched; it fails open on its own trouble', async () => {
    const on = new Fake(); on.files.set('src/game/GameCanvas.tsx', 'x'); on.files.set('src/game/Battle.tsx', ON_SHELL);
    expect(await gate(dispatcher(on))).toEqual(READY);
    const none = new Fake(); none.files.set('src/game/CityBattleRoyale.tsx', HAND_ROLLED);
    expect(await gate(dispatcher(none))).toEqual(READY);
    const broken = new Fake(); broken.files.set('src/game/GameCanvas.tsx', 'x'); broken.files.set('src/game/C.tsx', HAND_ROLLED); broken.failRead = true;
    expect(await gate(dispatcher(broken))).toEqual(READY);
  });
  it('the warning is called from assessBuildReadiness, and the note is said where files are written (source guard)', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toMatch(/this\._warnIfShellSkipped\(await this\._warnIfActionsAreNotSeen\(/); // still in the readiness chain (the Forge check wraps it since 2026-11-20)
    expect(src).toMatch(/vehicle \+= shellBypassNote\(finding\); this\._shellNoted = true;/);
  });
});

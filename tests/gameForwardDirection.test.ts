// FORWARD DIRECTION (admin 2026-10-16): runners and racers moved OUT of the screen toward the user.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vehicleShapeHalves, vehicleShapeFindings, handWrittenVehicleNote, type VehicleShapeHalves } from '../src/server/AgentV3/handWrittenVehicleScan';
import { FORWARD_DIRECTION_RULE_LINES, GAME_KIT_RULE, architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { arcadeAppTsx } from '../src/server/AgentV3/goldenScaffolds/games';

const scan = (files: Record<string, string>) => {
  const idx = new Map<string, VehicleShapeHalves>();
  for (const [p, c] of Object.entries(files)) idx.set(p, vehicleShapeHalves(p, c));
  return vehicleShapeFindings(idx).map((f) => f.kind);
};
const FORWARD_KINDS = ['world-backwards', 'runner-toward-camera', 'scroll-backwards'];

describe('the inverted patterns are caught', () => {
  it('3D runner: obstacles moved AWAY from a fixed camera (player seems to run backwards)', () => {
    const src = `camera.position.set(0, 3, 8);\ncamera.lookAt(0, 0, 0);\nfor (const o of obstacles) { o.position.z -= speed * dt; }`;
    expect(scan({ 'src/Game.ts': src })).toContain('world-backwards');
  });
  it('3D runner: the player moved TOWARD a fixed camera (comes out of the screen)', () => {
    const src = `camera.position.set(0, 4, 10);\nplayer.position.z += speed * dt;`;
    expect(scan({ 'src/Game.ts': src })).toContain('runner-toward-camera');
  });
  it('2D side runner scrolling the world right, top-down racer scrolling the road up', () => {
    expect(scan({ 'src/runner.ts': 'const jump = 1; for (const obstacle of list) { obstacle.x += speed * dt; }' })).toContain('scroll-backwards');
    expect(scan({ 'src/race.ts': 'const car = {}; // road\nroad.y -= speed * dt;' })).toContain('scroll-backwards');
  });
  it('the note explains forward = into the screen', () => {
    const kinds = [{ kind: 'world-backwards' as const, path: 'a.ts', line: 'x' }];
    expect(handWrittenVehicleNote(kinds)).toMatch(/INTO the screen/);
  });
});

describe('the correct convention is silent', () => {
  it('3D runner: world toward the camera, player into the screen with a following camera', () => {
    const ok1 = `camera.position.set(0, 3, 8);\nfor (const o of obstacles) { o.position.z += speed * dt; if (o.position.z > camera.position.z) o.position.z = -80; }`;
    const ok2 = `player.rotation.y = Math.PI;\nplayer.position.z -= speed * dt;\ncamera.position.z = player.position.z + 7;`;
    for (const s of [ok1, ok2]) expect(scan({ 'src/Game.ts': s }).filter((k) => FORWARD_KINDS.includes(k))).toEqual([]);
  });
  it('2D: world scrolls left; road scrolls down', () => {
    expect(scan({ 'src/runner.ts': 'const jump = 1; obstacle.x -= speed * dt;' })).toEqual([]);
    expect(scan({ 'src/race.ts': 'const car = {}; road.y += speed * dt;' })).toEqual([]);
  });
});

describe('STATIC CHECK: no template, scaffold or kit file teaches the inverted pattern', () => {
  it('kit recipes and golden game scaffolds', () => {
    const files: Record<string, string> = {};
    for (const r of [generateGame3D(), generateGameShell(), generateGameController(), generateGameSystems()]) {
      for (const [p, c] of Object.entries(r.files)) files[`check/${p}`] = c; // outside the library path so it is read
    }
    files['check/arcade/App.tsx'] = arcadeAppTsx;
    expect(scan(files).filter((k) => FORWARD_KINDS.includes(k))).toEqual([]);
  });
  it('the Templates panel game prompts state the direction', () => {
    const t = readFileSync(join(__dirname, '..', 'src/components/panels/TemplatesPanel.tsx'), 'utf8');
    expect(t).toMatch(/runs RIGHT; the ground, obstacles and parallax scroll LEFT/);
    expect(t).toMatch(/forward is INTO the screen/);
  });
});

describe('the FORWARD DIRECTION rule reaches every builder', () => {
  it('car and bike recipe examples turn the nose into world -Z before capturing the driving heading', () => {
    for (const text of [generateGame3D().instructions, generateGameShell().instructions]) {
      expect(text).toMatch(/car = createCar[\s\S]*?car\.rotation\.y = Math\.PI;[\s\S]*?createVehicleState\(car\)/);
    }
    expect(generateGame3D().instructions).toMatch(/bike = createMotorcycle[\s\S]*?bike\.root\.rotation\.y = Math\.PI;[\s\S]*?createVehicleState\(bike\.root\)/);
  });

  it('architect prompt and the writing sub-agents carry it', () => {
    const head = FORWARD_DIRECTION_RULE_LINES[0];
    expect(architectSystemPrompt('react')).toContain(head);
    expect(GAME_KIT_RULE).toContain(head);
  });
  it('states −Z forward, camera behind/above, spawn ahead, model rotation, 2D scroll directions', () => {
    const r = FORWARD_DIRECTION_RULE_LINES.join('\n');
    expect(r).toMatch(/Forward is world −Z/);
    expect(r).toMatch(/BEHIND and ABOVE/);
    expect(r).toMatch(/SPAWN FAR AHEAD at negative z/);
    expect(r).toMatch(/rotation\.y = Math\.PI/);
    expect(r).toMatch(/scrolls LEFT/);
    expect(r).toMatch(/scroll DOWN/);
  });
});

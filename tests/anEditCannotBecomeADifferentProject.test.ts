// INCIDENT: a complex 3D game was built, then an edit replaced its files with a different game. The turn-end
// guard only asked "does it render?", and a different game renders. CLASS: a candidate was promoted without
// being compared with the version it was an edit OF.
import { describe, it, expect } from 'vitest';
import { assessEditCandidate, rejectionMessage, isIdentityFile, userAskedForBroadRewrite, pathsTheUserNamedForRemoval } from '../src/server/AgentV3/editPromotionGate';
import { cityGame, differentGame } from './fixtures/threeDGame';

const edit = (mutate: (f: Record<string, string>) => void) => { const f = cityGame(); mutate(f); return f; };

describe('the gate rejects replacement', () => {
  it('🔴 the incident: a different game that renders is rejected', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: differentGame(), userMessage: 'make the camera third-person' });
    expect(v.verdict).toBe('reject');
    const rules = v.reasons.map((r) => r.rule);
    expect(rules).toContain('identity-file-removed');
    expect(rules).toContain('most-of-project-removed');
    expect(rules).toContain('engine-dropped');
    expect(rejectionMessage(v)).toMatch(/exactly as it was/);
  });
  it('a candidate that deletes a scene and its asset without being asked is rejected', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: edit((f) => { delete f['src/scenes/HarborScene.tsx']; delete f['public/models/harbor.glb']; }), userMessage: 'make the camera third-person' });
    expect(v.verdict).toBe('reject');
    expect(v.reasons[0].rule).toBe('identity-file-removed');
  });
  it('a deletion nobody followed through (a surviving file still imports it) is rejected', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: edit((f) => { delete f['src/game/collision.ts']; f['src/game/PlayerCar.tsx'] = 'import { collides } from "./collision";export function PlayerCar(){return <mesh/>}'; }), userMessage: 'remove the collision file' });
    expect(v.reasons.map((r) => r.rule)).toContain('dangling-import');
    expect(v.verdict).toBe('reject');
  });
  it('rewriting nearly everything in place is rejected unless a rewrite was asked for', () => {
    const rewritten = edit((f) => { for (const p of Object.keys(f)) if (!p.endsWith('.glb')) f[p] = `${f[p]}\n// rewritten`; });
    expect(assessEditCandidate({ base: cityGame(), candidate: rewritten, userMessage: 'tweak the sky colour' }).verdict).toBe('reject');
    expect(assessEditCandidate({ base: cityGame(), candidate: rewritten, userMessage: 'refactor everything to the new style' }).verdict).toBe('promote');
  });
});

describe('the gate lets real edits through', () => {
  it('a camera edit (one file) promotes', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: edit((f) => { f['src/game/CameraRig.tsx'] = 'export function CameraRig({mode}:{mode:"first"|"third"}){return mode==="third"?null:null}'; f['src/game/settings.ts'] = 'export function useGameSettings(){return {cameraMode:(localStorage.getItem("cam") as "first"|"third")??"first"}}'; }), userMessage: 'add a third-person camera option' });
    expect(v.verdict).toBe('promote');
    expect(v.stats.changed).toBe(2);
  });
  it('a collision edit (one file plus a new test) promotes', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: edit((f) => { f['src/game/collision.ts'] = 'export function collides(a:number,b:number){return Math.abs(a-b)<1.5}'; f['src/game/collision.test.ts'] = 'test("c",()=>{})'; }), userMessage: 'fix collision so I cannot drive through buildings' });
    expect(v.verdict).toBe('promote');
    expect(v.stats.added).toBe(1);
  });
  it('a rename is a move, not a deletion', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: edit((f) => { f['src/game/physics/collision.ts'] = f['src/game/collision.ts']; delete f['src/game/collision.ts']; }), userMessage: 'move collision into a physics folder' });
    expect(v.stats.moved).toBe(1);
    expect(v.verdict).toBe('promote');
  });
  it('a deletion the user named is allowed (and its importers must follow)', () => {
    const f = edit((x) => { delete x['src/game/collision.ts']; });
    expect(assessEditCandidate({ base: cityGame(), candidate: f, userMessage: 'please delete collision.ts, I do not need it' }).verdict).toBe('promote');
  });
  it('an explicit fresh start or approved rebuild may replace the project', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: differentGame(), allowReplace: true });
    expect(v.verdict).toBe('promote');
    expect(v.note).toMatch(/fresh start/);
  });
  it('a starter-sized base has nothing to protect', () => {
    expect(assessEditCandidate({ base: { 'src/App.tsx': 'a', 'src/main.tsx': 'b' }, candidate: differentGame() }).verdict).toBe('promote');
  });
  it('platform-written files never count as the user\'s project', () => {
    const v = assessEditCandidate({ base: cityGame(), candidate: edit((f) => { f['public/sw.js'] = 'x'; f['public/robots.txt'] = 'y'; f['e2e/smoke.spec.ts'] = 'z'; f['package-lock.json'] = '{}'; }), userMessage: 'tweak colours' });
    expect(v.verdict).toBe('promote');
    expect(v.stats.added).toBe(0);
  });
});

describe('the helpers', () => {
  it('identity files', () => {
    for (const p of ['src/App.tsx', 'index.html', 'src/scenes/CityScene.tsx', 'public/models/city.glb', 'src/game/CameraRig.tsx']) expect(isIdentityFile(p), p).toBe(true);
    for (const p of ['src/utils/format.ts', 'src/styles.css', 'README.md']) expect(isIdentityFile(p), p).toBe(false);
  });
  it('broad rewrite and named removal', () => {
    expect(userAskedForBroadRewrite('please refactor the project')).toBe(true);
    expect(userAskedForBroadRewrite('make the sky blue')).toBe(false);
    expect([...pathsTheUserNamedForRemoval('delete collision.ts', ['src/game/collision.ts', 'src/game/controls.ts'])]).toEqual(['src/game/collision.ts']);
    expect(pathsTheUserNamedForRemoval('make collision better', ['src/game/collision.ts']).size).toBe(0);
  });
});

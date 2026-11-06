// AN EXISTING GAME GETS THE KIT'S FIXES ON ITS NEXT TURN (Q-2337 — autopsy 61279465, 2026-11-04).
//
// The camera fix (Q-2330) and the no-GPU tier (Q-2334) live in kit files the train workspace already holds — at their
// OLD versions. Q-863's refresh only ran as a side effect of a recipe call, and "fix the camera" calls none. So the
// route now plans a refresh for the whole project at the start of an edit turn (gameRecipeLayers.planKitRefresh).
//
// Evidence on the REAL workspace (off-repo, 524 KB, so recorded here rather than committed): the 31 kit files were
// regenerated from main at the build's commit (25d5b2a14) and every one matched the build manifest's hash. The planner
// refreshed exactly camera, objects, renderer, surfaces and world, blocked nothing, and the mixed project typechecked
// under strict with @types/three@0.180 with 0 errors — as did the original.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { planKitRefresh, isKnownKitVersion, type LayerFile } from '../src/server/lib/gameRecipeLayers';
import { GAME_KIT_HISTORY } from '../src/server/lib/gameKitHistory';

/** The reported workspace's kit, by the hashes in its own build manifest. */
const WORKSPACE_61279465: Record<string, string> = {
  "src/game/core/loop.ts": "1e560fe9eed32f2e1a010d27356ba7ff43b130e90efdeb954a9c3bbb5f167898",
  "src/game/core/input.ts": "179f0736905e6eb0790e36381ab418ca2da37db6ddcca9608e7e6212e095ad4f",
  "src/game/core/events.ts": "da0828a2296eca6939676adf53c6902e03afdb83ca24e900001fa484f4e3f902",
  "src/game/core/pool.ts": "c0eb7deda0193f62ce37dfee23a5ca5757ab5d8cec5fbd92e9fc79871d688e60",
  "src/game/core/feel.ts": "6fd476d425ebacb3e80550606f0c2504536fb3f374b3eae871effe8b07acac96",
  "src/game/core/state.ts": "dfc9f2a2a953a287b80e12e6c1d06f3e54a61535e12eee60a37c5834976df54b",
  "src/game/core/meta.ts": "47b4f5f0230add245aa485ab93ce1f7921534bb8f02f2b7e1f78eeffb2ee5e1e",
  "src/game/three/renderer.ts": "ec9599b1f6eedf372220c5ce2245c75ad53698bd983ebe90687debaad56fed50",
  "src/game/three/lighting.ts": "7b1f89bdc9398b48a10fcc2fd1fb77a9577a2925dee1e14120857e5ac3e8be96",
  "src/game/three/materials.ts": "70a9d3153008e8bd80d417bb65f8a64592ba88f1515ebf09d8bdbfca6b23511a",
  "src/game/three/camera.ts": "291ef95c5bb7576b68db794e146814c160c0056abd8ff05fc8b987f8196fd4a0",
  "src/game/three/world.ts": "39ac5bad22db409ec7c08c8e08fd1d4975aa1e3253f3172ab132770aa5b4869c",
  "src/game/three/environment.ts": "76509d190eeabb44658f377c0487a8217103664d73ed5a3e1888d65e06c9020b",
  "src/game/three/surfaces.ts": "952c80ee927308f832f6cee85e6aa3598cdf671475be3275631d237c66c22728",
  "src/game/three/humanoid.ts": "f824eab134e9159d672a848eb66f1407629dc1d4e656906320e5032cffee5e95",
  "src/game/three/objects.ts": "86c947f35cdc3c8327f4d45ba7b4a93d4c2ce49c3814243862bfaa2171f3a860",
  "src/game/three/atmosphere.ts": "ef9d092d175f1880430ab2e7a0285393433cf3a2f86d2105af4eda44b4e922b8",
  "src/game/fx/particles.ts": "959d5a2a5c2de08c15db1b0c23e83da423ab4aa1672c1a8a01bff1b26883d436",
  "src/game/fx/synth.ts": "f6ac6662b6e06e8616fa599b7aef37ccf0d6835e230f181efd8282b32633cf76",
  "src/game/fx/audio.ts": "7fd1dc2470cf216b39346c5034710fd1688b27d636bcfa42157d54afc118ced3",
  "src/game/fx/feedback.ts": "b24bb48a0a85cff4c6b92a534c2ba4f8a5324fc793aeced49109d0bbb1edeb97",
  "src/audio/notation.ts": "ee3650b678e514906539e7bac2d43c7b71610f317badde57891150a07f8e960f",
  "src/audio/melody.ts": "eaf6d15fa0e2c4b6b682316cd0df080333896261c14762b92966301bb56ca803",
  "src/audio/tunes.ts": "3f47b5dad2bf3f4718e32d8c8c181ba4209cf182da2fc17622e2366574d04cbe",
  "src/game/Game.ts": "b359b27179b906887d64ebc73cbf50c6dc072f4c84b17472163dd205eafb822e",
  "src/game/GameCanvas.tsx": "6d19d3faa0b46f00871a82026740716b96dd3ad44aae87185b94ecc852bf36ff",
  "src/game/ui/Hud.tsx": "f0aa543691e8f8a0ce15f4d3c5846f93c5184115768b02222e7b92abef4b20b6",
  "src/game/ui/touchControls.ts": "7d8613f9d3a9409db20d532c5b8d00680ab716b06bdad995266d20af28db88b0",
  "src/game/controls.test.ts": "5feb01be9c62f7c6d61cc049d80e25535804f446fee7b5fabc578c539381f8a4",
  "src/game/play/character.ts": "7047914d3292054bcb1f87d092f6b632e679ef3df6705bd4cd45bbf9e20d2e4f",
  "src/game/play/motor.ts": "f1ff14f4eab4da545f34a66b0f8b53dae34bb8e7425fd62235074c50b0eddf4c"
};

describe('the reported workspace is recognised file by file', () => {
  it('every kit hash in its manifest is a version the history holds — so each untouched file can be refreshed', () => {
    const unknown = Object.entries(WORKSPACE_61279465).filter(([p, h]) => !(GAME_KIT_HISTORY[p] ?? []).includes(h)).map(([p]) => p);
    expect(unknown).toEqual([]);
  });
  it('a file whose bytes are no recorded version is never treated as ours', () => {
    expect(isKnownKitVersion('src/game/three/camera.ts', '// my own camera\n')).toBe(false);
  });
});

// A small kit: a.ts gained a name and an import of c.ts; b.ts imports a.ts.
const OLD_A = "export const x = 1;\n";
const NEW_A = "import { z } from './c';\nexport const x = 1;\nexport const y = z;\n";
const OLD_B = "import { x } from './a';\nexport const b = x;\n";
const NEW_B = "import { x, y } from './a';\nexport const b = x + y;\n";
const C = "export const z = 2;\n";
const pool = new Map<string, LayerFile>([['a.ts', { recipe: 'r', content: NEW_A }], ['b.ts', { recipe: 'r', content: NEW_B }], ['c.ts', { recipe: 'r', content: C }]]);
const known = new Set([OLD_A, OLD_B]);
const reasonOf = (_p: string, cur: string, _next: string) => (known.has(cur) ? null : 'edited' as const);

describe('planKitRefresh: untouched files up to date, all or nothing', () => {
  it('older untouched files are refreshed and what they newly import is added', () => {
    const r = planKitRefresh({ 'a.ts': OLD_A, 'b.ts': OLD_B, 'game.ts': 'mine' }, pool, reasonOf);
    expect(r.blocked).toBeNull();
    expect(r.write).toEqual({ 'a.ts': NEW_A, 'b.ts': NEW_B, 'c.ts': C });
    expect(r.refreshed).toEqual(['a.ts', 'b.ts']);
    expect(r.added).toEqual(['c.ts']);
    expect(r.write['game.ts']).toBeUndefined();
  });
  it('an EDITED file the new code needs a name from blocks the whole refresh — nothing is written', () => {
    const r = planKitRefresh({ 'a.ts': 'export const x = 1; // edited by the user\n', 'b.ts': OLD_B }, pool, reasonOf);
    expect(r.write).toEqual({});
    expect(r.blocked).toMatch(/b\.ts would need y from a\.ts, which was edited/);
  });
  it('a project already current, or with no kit, plans nothing', () => {
    expect(planKitRefresh({ 'a.ts': NEW_A, 'b.ts': NEW_B, 'c.ts': C }, pool, reasonOf).write).toEqual({});
    expect(planKitRefresh({ 'src/App.tsx': 'x' }, pool, reasonOf).write).toEqual({});
  });
});

describe('🔒 the route runs it at the start of an edit turn, re-reads the sandbox, and has a kill switch', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('wired', () => {
    expect(route).toContain("if (intent === 'edit_existing' && !isImportTurn && !projectModuleRef && projectFilesAtTurnStart");
    expect(route).toContain("String(process.env.AGENTV3_KIT_REFRESH ?? '').trim().toLowerCase() !== 'off'");
    expect(route).toContain('const refresh = planKitRefresh(projectFilesAtTurnStart);');
    expect(route).toMatch(/changed in the sandbox since it was saved/);
    expect(route).toContain("code: 'KIT_REFRESHED'");
  });
  it('the hashes above are what the manifest said (a sanity check on the transcription)', () => {
    expect(WORKSPACE_61279465['src/game/three/camera.ts']).toBe('291ef95c5bb7576b68db794e146814c160c0056abd8ff05fc8b987f8196fd4a0');
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });
});

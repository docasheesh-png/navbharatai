// 🧩 admin 2026-11-20: "jab yuzer koi aisi cheez maange jo library me nahi hai, to platform use Object Forge se khud bana de"
// — "han", and "user ko bataya jaye user ki language me ki user apna module khud bhi upload kar sake". The CLASS: an object
// the library and the kit cannot provide was left to one generic system-prompt line, so a weak builder drew it from boxes.
// Now it is assigned to the Forge PER OBJECT, the user is told (in their language) they can attach their own model, and a
// build that skipped the Forge is warned about — never blocked.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { missingObjectSubjects, forgeAssignment, forgeMissingHandoff, forgeNotUsedFor, forgeNotUsedWarning } from '../src/server/AgentV3/forgeForMissing';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';

describe('what the library lacks is made with the Object Forge', () => {
  it('assigns exactly the named objects that neither the library nor the kit provides', () => {
    expect(missingObjectSubjects('3d camel race game banao', REVIEWED_GAME_ASSETS).map((m) => m.word)).toEqual(['camel']);
    expect(missingObjectSubjects('3d game: a peacock and a tiger in a jungle with a temple', REVIEWED_GAME_ASSETS).map((m) => m.word)).toEqual(['peacock', 'tiger', 'temple']);
    // In the library (horse, cow, train) or built by the kit (car), or nothing named at all: nothing is assigned.
    for (const p of ['3d horse riding game with cows', 'ek 3d train game banao', '3d car racing game in a city', 'make a bgmi for me']) {
      expect(missingObjectSubjects(p, REVIEWED_GAME_ASSETS), p).toEqual([]);
    }
  });

  it('only for a seeded 3D kit with the Forge on', () => {
    expect(forgeAssignment('3d camel race game banao', REVIEWED_GAME_ASSETS, { kit3D: false, forgeOn: true })).toEqual([]);
    expect(forgeAssignment('3d camel race game banao', REVIEWED_GAME_ASSETS, { kit3D: true, forgeOn: false })).toEqual([]);
    expect(forgeAssignment('3d camel race game banao', REVIEWED_GAME_ASSETS, { kit3D: true, forgeOn: true })).toHaveLength(1);
  });

  it('tells the builder to Forge each object with its example, and to tell the user — in their language — they can attach their own model', () => {
    const block = forgeMissingHandoff(missingObjectSubjects('3d game: a peacock and a temple', REVIEWED_GAME_ASSETS));
    expect(block).toMatch(/"peacock" \(bird\): run_recipe\(\{ name: "author_object"/);
    expect(block).toMatch(/"temple" \(building\)/);
    expect(block).toMatch(/USER'S OWN LANGUAGE/);
    expect(block).toMatch(/\.glb, \.gltf, \.obj/);
    expect(forgeMissingHandoff([])).toBe('');
  });

  it('warns (never blocks) for an assigned object with no Forge object saved', () => {
    const missing = missingObjectSubjects('3d game: a peacock and a temple', REVIEWED_GAME_ASSETS);
    const forged = new Map([['src/game/objects/peacock.ts', 'export const SPEC = { id: "peacock" }']]);
    expect(forgeNotUsedFor(missing, forged)).toEqual(['temple']);
    expect(forgeNotUsedFor(missing, new Map([...forged, ['src/game/objects/temple.ts', '{}']]))).toEqual([]);
    expect(forgeNotUsedWarning(['temple'])).toMatch(/Object Forge not used for temple/);
  });

  it('is wired: the route assigns, the dispatcher remembers and checks it in readiness as a warning', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/forgeAssignment\(gameTurnRequest\(prompt, milestoneRequest\), REVIEWED_GAME_ASSETS/);
    expect(route).toContain('dispatcher.requireForgeSubjects(missingObjects)');
    const dispatcher = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(dispatcher).toMatch(/return await this\._warnIfForgeSkipped\(/);
    expect(dispatcher).toMatch(/warnings: \[\.\.\.report\.warnings, forgeNotUsedWarning\(skipped\)\]/);
  });
});

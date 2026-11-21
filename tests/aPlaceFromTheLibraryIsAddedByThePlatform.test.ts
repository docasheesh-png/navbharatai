// A PLACE PICKED FROM THE LIBRARY IS ADDED BY THE PLATFORM ITSELF, NOT BY ASKING A MODEL (admin 2026-11-21: "game library se
// user chun ke khud map add karwa sake" + "rocksolid karo, adhura pura karo").
// 🧬 THE CLASS: a mechanical, one-line change of the user's project left to a model to carry out.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapPlaceAsked, appendPlace, placeAddedHandoff, placeNotAddedHandoff, MAX_PLACES } from '../src/server/AgentV3/worldGrow';
import { addLibraryPlaceAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { addToGamePrompt, mapPlaceRows, libraryBrowseRows } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { parseRegions, growthVerdict, WORLD_FILE } from '../src/server/AgentV3/growthGuard';
import { gameWorldFileSource } from '../src/server/lib/GameOpenWorldGenerator';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('🗺️ the library\'s own request is recognised exactly', () => {
  it('every map place the library offers; never a model, never a sentence a user typed', () => {
    for (const row of mapPlaceRows()) expect(mapPlaceAsked(addToGamePrompt(row)), row.id).toBe(row.id.split(':')[1]);
    expect(mapPlaceAsked(addToGamePrompt(libraryBrowseRows()[0]))).toBeNull();
    expect(mapPlaceAsked('ek aur shehar jodo')).toBeNull();          // typed wishes go to the builder with the rule
    expect(mapPlaceAsked('')).toBeNull();
  });
});

describe('🗺️ one more place, nothing else touched', () => {
  const world = gameWorldFileSource({ city: true });
  it('the file the platform wrote: a town is appended, the city entry is byte-for-byte the same', () => {
    const r = appendPlace(world, 'town');
    if (!r.ok) throw new Error('expected an append');
    expect(r.id).toBe('town-1');
    expect(r.count).toBe(2);
    expect(parseRegions(r.source)!.map((x) => x.id)).toEqual(['main-city', 'town-1']);
    expect(r.source).toContain("    { id: 'main-city', kind: 'city' },\n    { id: 'town-1', kind: 'town' },\n  ],");
    // The growth guard agrees it is a pure addition.
    expect(growthVerdict({ path: WORLD_FILE, before: world, after: r.source, request: 'x' }).allow).toBe(true);
  });

  it('added again and again: fresh ids, every earlier place kept, until the map is full — then it says so', () => {
    let src = world; const ids: string[] = [];
    for (let i = 0; i < MAX_PLACES - 1; i++) {
      const r = appendPlace(src, i % 2 ? 'village' : 'town');
      if (!r.ok) throw new Error(`append ${i} failed`);
      src = r.source; ids.push(r.id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseRegions(src)!.map((x) => x.id)).toEqual(['main-city', ...ids]);
    expect(appendPlace(src, 'city')).toEqual({ ok: false, reason: 'full' });
  });

  it('an empty list, a hand-edited list with settings and no trailing comma, and an id already taken', () => {
    const empty = appendPlace(gameWorldFileSource({}), 'village');
    expect(empty.ok && parseRegions(empty.source)!.map((x) => x.id)).toEqual(['village-1']);
    const edited = "export const WORLD = {\n  seed: 3,\n  regions: [\n    { id: 'main-city', kind: 'city', city: { blocksX: 6, traffic: { count: 20 } } },\n    { id: 'town-1', kind: 'town', toward: 'east' }\n  ],\n  style: { relief: 0.5 },\n};\n";
    const r = appendPlace(edited, 'town');
    if (!r.ok) throw new Error('expected an append');
    expect(r.id).toBe('town-2');
    expect(parseRegions(r.source)!.map((x) => x.id)).toEqual(['main-city', 'town-1', 'town-2']);
    expect(r.source).toContain('city: { blocksX: 6, traffic: { count: 20 } } }');   // settings untouched
    expect(r.source).toContain("style: { relief: 0.5 },");
    expect(appendPlace('export const WORLD = { seed: 1 };', 'city')).toEqual({ ok: false, reason: 'no-list' });
  });

  it('the builder is told it is done (or that the map is full) and to change nothing', () => {
    expect(placeAddedHandoff('town', 'town-1', 2)).toMatch(/ALREADY DONE BY THE PLATFORM/);
    expect(placeAddedHandoff('town', 'town-1', 2)).toMatch(/Do NOT edit src\/game\/world\.ts again/);
    expect(placeNotAddedHandoff('city')).toMatch(/did NOT add another city/);
  });

  it('the turn-start step: adds from the LIVE file, records it, and returns what the builder is told', async () => {
    const live = appendPlace(world, 'village'); if (!live.ok) throw new Error('setup');
    const disk = new Map([[WORLD_FILE, live.source]]);                    // the sandbox is ahead of the saved copy
    const codes: string[] = [];
    const handoff = await addLibraryPlaceAtTurnStart({ prompt: addToGamePrompt({ id: 'map-place:town', name: 'New town' }), filesAtTurnStart: { [WORLD_FILE]: world },
      read: async (p) => disk.get(p)!, write: async (p, c) => { disk.set(p, c); }, record: (i) => { codes.push(i.code); } });
    expect(handoff).toMatch(/ALREADY DONE BY THE PLATFORM: one new town \("town-1"\)/);
    expect(parseRegions(disk.get(WORLD_FILE)!)!.map((r) => r.id)).toEqual(['main-city', 'village-1', 'town-1']);   // nothing in the live file lost
    expect(codes).toEqual(['MAP_PLACE_ADDED']);
    // Not the library's request, or a game with no map file: nothing happens.
    expect(await addLibraryPlaceAtTurnStart({ prompt: 'ek aur shehar jodo', filesAtTurnStart: { [WORLD_FILE]: world }, read: async () => world, write: async () => { throw new Error('must not write'); }, record: () => undefined })).toBe('');
    expect(await addLibraryPlaceAtTurnStart({ prompt: addToGamePrompt({ id: 'map-place:town', name: 'x' }), filesAtTurnStart: {}, read: async () => world, write: async () => { throw new Error('must not write'); }, record: () => undefined })).toBe('');
  });

  it('the route calls it before the builder, with the sandbox as the source of truth', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/const placeHandoff = await addLibraryPlaceAtTurnStart\(\{ prompt, filesAtTurnStart: projectFilesAtTurnStart, read: \(p\) => actuator\.readFile\(workspaceId, p\),/);
    expect(route).toMatch(/if \(placeHandoff\) buildPrompt = `\$\{placeHandoff\}/);
  });
});

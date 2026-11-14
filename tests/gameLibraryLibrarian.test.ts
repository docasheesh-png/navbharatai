import { describe, expect, it } from 'vitest';
import { createGameLibrary, searchGameLibrary, gameLibraryObjectNote } from '../src/server/AgentV3/gameAssets/gameLibrary';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';
import { OBJECT_CATALOG } from '../src/server/lib/objectCatalog';
import { readFileSync } from 'node:fs';

describe('one categorized game librarian over existing sources', () => {
  it('indexes every object specification and reviewed model without pretending specifications are assets', () => {
    const r = searchGameLibrary({ limit: 20 });
    expect(r.total).toBe(OBJECT_CATALOG.length + REVIEWED_GAME_ASSETS.length);
    expect(r.categories.reduce((n, c) => n + c.count, 0)).toBe(r.total);
    expect(r.entries).toHaveLength(20);
    const train = searchGameLibrary({ query: 'train' });
    expect(train.entries.some(e => e.kind === 'reviewed-model' && e.availability === 'requires-admission')).toBe(true);
    expect(train.entries.some(e => e.kind === 'specification' && e.availability === 'specification-only')).toBe(true);
  });
  it('finds model and recipe options through existing multilingual vocabulary', () => {
    for (const query of ['car', 'कार', 'house', 'घर', 'tree', 'पेड़']) {
      const r = searchGameLibrary({ query });
      expect(r.entries.length, query).toBeGreaterThan(0);
      expect(r.entries.some(e => e.kind === 'reviewed-model'), query).toBe(true);
    }
  });
  it('filters categories and required animations, not a nearby unrelated replacement', () => {
    expect(searchGameLibrary({ query: 'car', category: 'animal' }).entries).toEqual([]);
    expect(searchGameLibrary({ query: 'human', animation: 'run' }).entries.every(e => e.kind === 'reviewed-model')).toBe(true);
    expect(searchGameLibrary({ query: 'car', animation: 'fly' }).entries).toEqual([]);
    expect(searchGameLibrary({ query: 'human', animation: 'run' }).entries.length).toBeGreaterThan(0);
  });
  it('exposes provenance, scale and checks without calling a model downloaded or game verified', () => {
    const r = searchGameLibrary({ query: 'car' });
    const model = r.entries.find(e => e.kind === 'reviewed-model')!;
    expect(model.license?.spdx).toBe('CC0-1.0');
    expect(model.license?.evidenceUrl).toMatch(/^https:/);
    expect(model.size).toContain('height');
    expect(model.verification.join(' ')).toMatch(/collision/);
    expect(model.verification.join(' ')).toMatch(/keyboard and touch/);
    expect(model.availability).toBe('requires-admission');
    expect(gameLibraryObjectNote('car')).toContain('metadata');
  });
  it('does not invent maps or claim every game is supported', () => {
    const r = searchGameLibrary({ query: 'PUBG Erangel map', category: 'maps' });
    expect(r.entries).toEqual([]);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.categories.find(c => c.category === 'maps')?.count).toBe(0);
    expect(r.notes.join(' ')).toContain('No claim of universal game support');
  });
  it('rejects unlicensed or invalid model metadata even if supplied in the catalogue', () => {
    const bad = { ...REVIEWED_GAME_ASSETS[0], license: { ...REVIEWED_GAME_ASSETS[0].license, redistributeSource: false as unknown as true } };
    expect(createGameLibrary([bad], []).search().total).toBe(0);
    expect(createGameLibrary([{ ...REVIEWED_GAME_ASSETS[0], sha256: 'bad' }], []).search().total).toBe(0);
  });
  it('bounds output, handles unknown categories and never leaks mutable index arrays', () => {
    expect(searchGameLibrary({ limit: 999 }).entries.length).toBe(20);
    expect(searchGameLibrary({ category: '__proto__' }).entries).toEqual([]);
    expect(searchGameLibrary({ query: 'not-an-indexed-asset' }).missing.length).toBeGreaterThan(0);
    const before = searchGameLibrary({ query: 'car' });
    const changed = searchGameLibrary({ query: 'car' });
    changed.entries[0].name = 'tampered';
    changed.categories[0].count = -1;
    expect(searchGameLibrary({ query: 'car' })).toEqual(before);
  });
  it('is wired into existing object_spec, with search returning before any model fallback', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const branch = src.slice(src.indexOf("case 'object_spec':"), src.indexOf("case 'generate_game_3d':"));
    expect(branch.indexOf('searchGameLibrary')).toBeGreaterThan(0);
    expect(branch.indexOf('searchGameLibrary')).toBeLessThan(branch.indexOf('this.dispatchObjectSpec'));
    expect(src).toContain('gameLibraryObjectNote(wanted)');
    const catalog = readFileSync('src/server/AgentV3/ToolCatalog.ts', 'utf8');
    expect(catalog).toContain('library_query:');
  });
});

describe('actual generator handoff', () => {
  it('only marks actual prepared outcomes ready; failed persistence and off states cannot claim readiness', async () => {
    const { gameLibraryBuildReport } = await import('../src/server/AgentV3/gameAssets/gameLibrary');
    const outcomes = [{ subject: 'car', outcome: { kind: 'model' } }];
    const parse = (status: string) => JSON.parse(gameLibraryBuildReport('car game', { status, outcomes }).split('\n')[1]);
    expect(parse('prepared').selected[0].status).toBe('local-model-prepared');
    for (const status of ['off', 'procedural']) {
      expect(parse(status).selected[0].status).toBe('not-prepared');
      expect(parse(status).missing).toContain('car');
    }
    expect(parse('prepared').verification.gameplay).toContain('pending');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('gameLibraryBuildReport(prompt, assets)');
  });
});

describe('library dispatch execution', () => {
  it('returns indexed results without mutating workspace and retains ordinary local-model priority', async () => {
    const { makeDispatcher, toolCall } = await import('./helpers/dispatcherHarness');
    const { d, act } = makeDispatcher();
    const before = [...act.files.entries()];
    const result = await d.dispatch(toolCall('object_spec', { library_query: 'car' }), 'architect');
    expect(result.is_error).toBeFalsy();
    const parsed = JSON.parse(String(result.content));
    expect(parsed.entries.some((e: { kind: string }) => e.kind === 'reviewed-model')).toBe(true);
    expect([...act.files.entries()]).toEqual(before);
    const mixed = await d.dispatch(toolCall('object_spec', { object: 'car', category: 'animal' }), 'architect');
    expect(JSON.parse(String(mixed.content)).entries).toEqual([]);
    const explicit = await d.dispatch(toolCall('object_spec', { library_query: 'car', object: 'fox' }), 'architect');
    expect(JSON.parse(String(explicit.content)).entries).toEqual(parsed.entries);
    act.files.set('src/game/three/assetModels.ts', 'const assets: Record<string, LocalGameAsset> = {"train":{}};\n');
    const ordinary = String((await d.dispatch(toolCall('object_spec', { object: 'train' }), 'architect')).content);
    expect(ordinary.indexOf('REVIEWED LOCAL 3D MODEL IS READY')).toBeLessThan(ordinary.indexOf('[GAME_LIBRARY]'));
  });
});

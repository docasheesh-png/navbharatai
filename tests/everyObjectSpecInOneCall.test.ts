// EVERY OBJECT SPEC IN ONE CALL (Q-2335 — autopsy 61279465, 2026-11-04).
//
// 2.37 M input tokens over 39 model calls (~60 k each). Six of those calls did nothing but ask object_spec for ONE
// object — train, tree, building, mountain, then "railway track" and "railway" (both answered with the train) — because
// the tool's own schema said "one object per call". Each such turn re-sends the whole conversation: ~55 k input tokens
// and ~5 s. The tool now takes `objects: [...]` and answers them all in one result.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

describe('object_spec answers a list in one result', () => {
  it('THE REPORTED SET: train, tree, building, mountain, railway track — one call, one spec per object', async () => {
    const { d } = makeDispatcher();
    const r = await d.dispatch(toolCall('object_spec', { objects: ['train', 'tree', 'building', 'mountain', 'railway track'] }), 'architect');
    const text = String(r.content);
    expect(r.is_error).toBeFalsy();
    for (const head of ['TRAIN', 'TREE', 'MOUNTAIN']) expect(text).toContain(head);
    expect((text.match(/OBJECT SPEC — /g) ?? []).length + (text.match(/SPEC-FIRST|spec-first/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it('duplicates are asked once; the old single `object` still works; nothing named is a clear answer', async () => {
    const { d } = makeDispatcher();
    const dup = String((await d.dispatch(toolCall('object_spec', { objects: ['tree', 'Tree', 'tree'] }), 'architect')).content);
    expect((dup.match(/OBJECT SPEC — TREE/g) ?? []).length).toBe(1);
    expect(String((await d.dispatch(toolCall('object_spec', { object: 'tree' }), 'architect')).content)).toContain('OBJECT SPEC — TREE');
    expect(String((await d.dispatch(toolCall('object_spec', {}), 'architect')).content)).toMatch(/all in one call/);
  });
  it('a model L3 prepared leads ITS spec, and only its spec', async () => {
    const { d, act } = makeDispatcher();
    act.files.set('src/game/three/assetModels.ts', 'const assets: Record<string, LocalGameAsset> = {"train":{}};\n');
    const text = String((await d.dispatch(toolCall('object_spec', { objects: ['train', 'mountain'] }), 'architect')).content);
    expect((text.match(/REVIEWED LOCAL 3D MODEL IS READY/g) ?? []).length).toBe(1);
    expect(text.indexOf('loadRequestedAsset(\'train\'')).toBeLessThan(text.indexOf('MOUNTAIN'));
  });
  it('🔒 the schema asks for every object at once and no longer says "one object per call"', () => {
    const cat = readFileSync('src/server/AgentV3/ToolCatalog.ts', 'utf8');
    const at = cat.indexOf("name: 'object_spec'");
    const entry = cat.slice(at, cat.indexOf("name: 'generate_game_3d'", at));
    expect(entry).not.toMatch(/one object per call/);
    expect(entry).toMatch(/objects: \{\n\s*type: 'array'/);
    expect(entry).toMatch(/call this ONCE with ALL their names/);
  });
});

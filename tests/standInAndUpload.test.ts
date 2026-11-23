import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { userModelNote, userModelsFromFiles } from '../src/server/AgentV3/gameAssets/userModels';
import { generateStandIn } from '../src/server/AgentV3/gameAssets/standInObject';
import { architectSystemPrompt, GAME_KIT_RULE } from '../src/server/AgentV3/systemPrompt';
import { GROUND_CONTACT_RULE, missingGroundContact } from '../src/server/AgentV3/groundContactRule';
import { paddedSyntheticGlb } from './fixtures/gameAssetFixtures';

const PLAN = JSON.stringify({
  version: 1, label: 'Market stall',
  parts: [{ id: 'top', geometry: { kind: 'box', size: [1.2, 0.1, 0.8] }, position: [0, 1, 0], rotation: [0, 0, 0], color: '#8a5a2b', roughness: 0.7, metalness: 0 }],
});

describe('a missing library object is generated and sat on the ground', () => {
  it('asks the model and the written object calls standOnGround', async () => {
    let asked = 0;
    const made = await generateStandIn('purple teapot', async () => { asked++; return { text: PLAN }; });
    expect(asked).toBe(1);
    expect(made.kind).toBe('generated');
    if (made.kind !== 'generated') return;
    expect(made.source).toContain('standOnGround');
    expect(made.source).toContain('BoxGeometry');
    expect(made.triangles).toBeGreaterThan(0);
  });

  it('does not call the model when the library already has the object', async () => {
    let asked = 0;
    const made = await generateStandIn('knight', async () => { asked++; return { text: PLAN }; });
    expect(asked).toBe(0);
    expect(made.kind).toBe('library');
  });

  it('a model that answers nothing does not invent an object', async () => {
    expect(await generateStandIn('purple teapot', async () => null)).toEqual({ kind: 'none' });
    expect(await generateStandIn('purple teapot', async () => ({ text: 'not json' }))).toEqual({ kind: 'none' });
  });
});

describe('an uploaded model is checked and told to sit on the ground', () => {
  it('accepts a real glb and refuses a text file wearing a glb name', () => {
    const glb = new Uint8Array(paddedSyntheticGlb());
    const ok = userModelsFromFiles(new Map([['cart.glb', glb]]));
    expect(ok.refused).toEqual([]);
    expect(ok.models[0].triangles).toBeGreaterThan(0);
    expect(ok.models[0].bytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(userModelNote(ok.models, [])).toContain('standOnGround');
    const bad = userModelsFromFiles(new Map([['notes.glb', new TextEncoder().encode('hello')]]));
    expect(bad.models).toEqual([]);
    expect(bad.refused[0].reason).toMatch(/not a \.glb/);
    const notGltf = userModelsFromFiles(new Map([['scene.gltf', new TextEncoder().encode('{ "not": "a model" }')]]));
    expect(notGltf.refused[0].reason).toMatch(/not a \.gltf/);
  });
});

describe('the ground-contact and library-first rule cannot quietly disappear', () => {
  it('the prompt, the validator, CLAUDE.md and AGENTS.md all still state it', () => {
    const prompt = architectSystemPrompt();
    expect(prompt).toContain('GROUND CONTACT IS MANDATORY');
    expect(prompt).toContain('generate_stand_in');
    expect(prompt).toContain('library FIRST');
    expect(GAME_KIT_RULE).toContain('GROUND CONTACT IS MANDATORY');
    expect(GROUND_CONTACT_RULE).toContain('standOnGround');
    expect(GROUND_CONTACT_RULE).toContain('generate_stand_in');
    expect(missingGroundContact(new Map([['src/race.ts', "createTerrain();\ncar.position.y = 0;"]]))).toContain('GROUND CONTACT MISSING');
    for (const file of ['CLAUDE.md', 'AGENTS.md']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toContain('must never be removed');
      expect(text, file).toContain('groundContact');
      expect(text, file).toContain('library');
      expect(text, file).toContain('generate_stand_in');
      expect(text, file).toContain('.glb');
    }
  });
});

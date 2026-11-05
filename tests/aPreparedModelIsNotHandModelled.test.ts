// A MODEL L3 PREPARED IS NOT HAND-MODELLED (autopsy 61279465, 2026-11-04 — the 3D train simulator).
//
// The build downloaded and saved six reviewed CC0 models, a Kenney locomotive among them, and wrote them into
// assetModels.ts. In the same build the hero-object contract and the object_spec tool said "TRAIN — There is no
// library builder for this one, so HAND-MODEL it". The builder obeyed the spec and shipped a box train. The spec
// now reads what L3 prepared and says so first; the asset handoff overrides every hand-modelling line.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { localModelSubjects, readyModelFor, localModelLead, localModelsOverride, ASSET_MODELS_PATH } from '../src/server/AgentV3/gameAssets/localModelNote';

// The shape assetSeed.ts writes (src/game/three/assetModels.ts), with the six subjects of the reported build.
const ASSET_MODELS = "import { loadGameAsset, type GameAssetHandle, type LocalGameAsset } from './externalAssets';\n"
  + 'const assets: Record<string, LocalGameAsset> = ' + JSON.stringify({ train: { url: '/game-assets/83d6.glb' }, tree: {}, building: {}, mountain: {}, hill: {}, house: {} }) + ';\n'
  + 'export function loadRequestedAsset() {}\n';

describe('what L3 prepared is read back from the game itself', () => {
  it('the six subjects of the reported build', () => {
    expect(localModelSubjects(ASSET_MODELS)).toEqual(['train', 'tree', 'building', 'mountain', 'hill', 'house']);
  });
  it('anything else reads as nothing prepared', () => {
    expect(localModelSubjects('')).toEqual([]);
    expect(localModelSubjects('const assets: Record<string, LocalGameAsset> = not json;\n')).toEqual([]);
  });
  it('object_spec names reach the prepared subject through the catalogue aliases', () => {
    const ready = localModelSubjects(ASSET_MODELS);
    expect(readyModelFor('train', ready)).toBe('train');
    expect(readyModelFor('locomotive', ready)).toBe('train');
    expect(readyModelFor('tree', ready)).toBe('tree');
    expect(readyModelFor('railway track', ready)).toBeNull();   // no model for the track: its spec stands
    expect(readyModelFor('train', [])).toBeNull();
  });
  it('the lead says use the model and demotes the spec to the fallback', () => {
    expect(localModelLead('train')).toMatch(/do NOT hand-model it: const handle = await loadRequestedAsset\('train', fallback\)/);
    expect(localModelsOverride(['train', 'tree'])).toMatch(/OVERRIDES every "HAND-MODEL it" instruction .* for: train, tree/);
    expect(localModelsOverride([])).toBe('');
  });
});

describe('🔒 both places that tell the builder how to make an object carry it', () => {
  it('object_spec reads the game\'s assetModels.ts and leads with the ready model', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const at = src.indexOf("case 'object_spec': {");
    const body = src.slice(at, src.indexOf("case 'generate_game_3d': {", at));
    expect(body).toContain('this.actuator.readFile(this.workspaceId, ASSET_MODELS_PATH)');
    expect(body).toMatch(/readyModel \? localModelLead\(readyModel\) : ''/);
    expect(ASSET_MODELS_PATH).toBe('src/game/three/assetModels.ts');
  });
  it('the asset handoff opens with the override', () => {
    expect(readFileSync('src/server/AgentV3/gameAssets/assetSeed.ts', 'utf8')).toMatch(/out\.handoff = `\$\{localModelsOverride\(ready\.map\(r => r\.subject\)\)\} LOCAL 3D MODELS PREPARED/);
  });
});

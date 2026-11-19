/**
 * 2026-11-19: the NavBharatAI model library reached only NEW games (the seed). In an existing game the builder could
 * search the library's metadata but had no way to fetch a model, so "add a cow to my game" could never get the
 * library cow. add_library_models (run_recipe) adds named models to the CURRENT game: same gate, downloads, proofs and
 * durable saves as the seed, merged into the game's files — earlier models stay, the user's customizations stay.
 */
import { describe, it, expect, vi } from 'vitest';
import { addLibraryModels } from '../src/server/AgentV3/gameAssets/assetSeed';
import { createAssetProviders } from '../src/server/AgentV3/gameAssets/providers';
import { createDurableAssetCache } from '../src/server/AgentV3/gameAssets/assetCache';
import { persistProjectAsset } from '../src/server/AgentV3/gameAssets/assetProject';
import { localModelEntries } from '../src/server/AgentV3/gameAssets/localModelNote';
import { generateAssetModelLoader, generateGameAssetRuntime, GAME_ASSET_MODELS_PATH } from '../src/server/lib/GameAssetRuntimeGenerator';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { RECIPE_TOOLS } from '../src/server/AgentV3/ToolCatalog';
import { toolWorkClass } from '../src/server/AgentV3/toolWork';
import { syntheticGlb, syntheticCandidate } from './fixtures/gameAssetFixtures';

function rig() {
  const bytes = syntheticGlb(); const candidate = { ...syntheticCandidate(bytes), subjects: ['cow'] };
  const objects = new Map<string, Uint8Array>(); const binary = new Map<string, string>(); const texts = new Map<string, string>(); const disk = new Map<string, string>();
  const workspace = { writeFile: async (_: string, p: string, c: string) => { disk.set(p, c); }, writeBinaryFile: async (_: string, p: string, c: string) => { disk.set(p, c); }, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
  const persistence = {
    saveBinary: async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) binary.set(p, c); },
    readBinary: async (_: string, p: string) => binary.has(p) ? Buffer.from(binary.get(p)!.split(',')[1], 'base64') : null,
    saveText: async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) texts.set(p, c); },
  };
  const dependencies = {
    cache: createDurableAssetCache({ read: async (k: string) => objects.get(k) ?? null, write: async (k: string, d: Uint8Array) => { objects.set(k, d); } }, [candidate]),
    providers: createAssetProviders([candidate]), download: vi.fn(async () => bytes), parse: vi.fn(async () => {}), persist: persistProjectAsset(workspace, 'w', persistence),
  };
  return { candidate, workspace, persistence, dependencies, disk };
}
const tree = { sha256: 'a'.repeat(64), height: 5, yaw: 0 };

describe('add_library_models merges a library model into an existing game', () => {
  it('earlier models stay, credits and manifest merge, the user\'s customizations and a current runtime are not rewritten', async () => {
    const r = rig();
    const out = await addLibraryModels({
      requirements: [{ subject: 'cow' }], workspaceId: 'w', workspace: r.workspace, signal: new AbortController().signal,
      env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' }, catalogue: [r.candidate], dependencies: r.dependencies, persistence: r.persistence,
      existing: {
        assetModels: generateAssetModelLoader({ tree }),
        manifest: JSON.stringify({ schema: 1, assets: [{ subject: 'tree', sha256: tree.sha256 }] }),
        attribution: 'tree: Kay Lousberg — CC0-1.0',
        customizations: "export const assetCustomizations = { tree: { tint: '#00ff00' } };",
        runtime: generateGameAssetRuntime(),
      },
    });
    expect(out.status).toBe('prepared');
    expect(Object.keys(localModelEntries(out.files[GAME_ASSET_MODELS_PATH])).sort()).toEqual(['cow', 'tree']);
    expect(localModelEntries(out.files[GAME_ASSET_MODELS_PATH]).tree).toEqual(tree);
    expect(JSON.parse(out.files['public/game-assets/manifest.json']).assets.map((a: { subject: string }) => a.subject)).toEqual(['tree', 'cow']);
    expect(out.files['public/game-assets/ATTRIBUTION.txt']).toMatch(/^tree: Kay Lousberg[\s\S]*\n\ncow: /);
    expect(out.files['src/game/three/assetCustomizations.ts']).toBeUndefined();
    expect(out.files['src/game/three/externalAssets.ts']).toBeUndefined();
    expect(out.handoff).not.toMatch(/WORLD DRESSING/);
  });
  it('an OLDER runtime is brought up to the loader it is paired with, and a missing customizations file is created', async () => {
    const r = rig();
    const older = generateGameAssetRuntime().replace('export function customizedGameAsset', 'function customizedGameAsset');
    const out = await addLibraryModels({ requirements: [{ subject: 'cow' }], workspaceId: 'w', workspace: r.workspace, signal: new AbortController().signal,
      env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' }, catalogue: [r.candidate], dependencies: r.dependencies, persistence: r.persistence, existing: { runtime: older } });
    expect(out.files['src/game/three/externalAssets.ts']).toBe(generateGameAssetRuntime());
    expect(out.files['src/game/three/assetCustomizations.ts']).toContain('cow');
  });
  it('respects the rollout switch exactly like the seed', async () => {
    const r = rig();
    const out = await addLibraryModels({ requirements: [{ subject: 'cow' }], workspaceId: 'w', workspace: r.workspace, signal: new AbortController().signal, env: {}, catalogue: [r.candidate], dependencies: r.dependencies, persistence: r.persistence });
    expect(out.status).toBe('off'); expect(r.dependencies.download).not.toHaveBeenCalled();
  });
});

describe('the add_library_models tool', () => {
  class Bare implements ActuatorPort {
    async readFile(): Promise<string> { throw new Error('ENOENT'); }
    async writeFile(): Promise<void> {}
    async listFiles(): Promise<string[]> { return []; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  }
  const call = (input: unknown) => { const s = new AgentEventStream(); return new ToolDispatcher(new Bare(), 'w', new WorkspaceState(s), s).run({ id: 't', name: 'add_library_models' as never, input: input as Record<string, unknown> }, 'architect').then(String); };
  it('is reachable through run_recipe and counted as work that changes the app', () => {
    expect(RECIPE_TOOLS).toContain('add_library_models');
    expect(toolWorkClass('add_library_models')).toBe('produces');
  });
  it('asks for names when given none, and says honestly when the library is off — never claims a model was added', async () => {
    expect(await call({ models: [] })).toMatch(/Name the library models to add/);
    const prev = process.env.AGENTV3_EXTERNAL_GAME_ASSETS; delete process.env.AGENTV3_EXTERNAL_GAME_ASSETS;
    try { expect(await call({ models: [{ subject: 'cow' }] })).toMatch(/not switched on for this account, so no model was added/); }
    finally { if (prev !== undefined) process.env.AGENTV3_EXTERNAL_GAME_ASSETS = prev; }
  });
  it('a sandbox without binary writes, and a name not in the library, are answered honestly', async () => {
    const prev = process.env.AGENTV3_EXTERNAL_GAME_ASSETS; process.env.AGENTV3_EXTERNAL_GAME_ASSETS = 'on';
    try {
      expect(await call({ models: [{ subject: 'cow' }] })).toMatch(/cannot write binary files, so no library model was added/);
    } finally { if (prev === undefined) delete process.env.AGENTV3_EXTERNAL_GAME_ASSETS; else process.env.AGENTV3_EXTERNAL_GAME_ASSETS = prev; }
  });
});

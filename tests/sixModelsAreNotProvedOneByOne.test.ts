// SIX MODELS ARE NOT PROVED ONE BY ONE — AND THEIR SAVES STILL ARE (Q-2343, autopsy 61279465, 2026-11-04).
//
// The seed waited 72.7 s before the first model call; ~45 s of it came after the last recipe. prepareGameAssets took
// its models strictly in turn — download, then a fresh-browser proof in the sandbox — measured off-sandbox at 11.6 s
// of downloads + 14.0 s of proofs for that build's six. Download and proof now run up to GAME_ASSET_CONCURRENCY at
// once. The durable save does NOT: saveWorkspaceAssets read-modify-writes the workspace's `paths` list, so two saves
// at once would drop a model from it, and that model would be gone on reload.
import { describe, it, expect } from 'vitest';
import { syntheticGlb, syntheticCandidate } from './fixtures/gameAssetFixtures';
import { createDurableAssetCache } from '../src/server/AgentV3/gameAssets/assetCache';
import { createAssetProviders } from '../src/server/AgentV3/gameAssets/providers';
import { persistProjectAsset, type GameAssetWorkspace } from '../src/server/AgentV3/gameAssets/assetProject';
import { prepareGameAssets, GAME_ASSET_CONCURRENCY } from '../src/server/AgentV3/gameAssets/assetSeed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Four DIFFERENT models (different bytes, so different hashes), each serving its own subjects.
const VARIANTS: Array<[boolean, boolean, string[]]> = [[true, false, ['train']], [false, false, ['tree']], [true, true, ['building']], [false, true, ['dog', 'cow']]];
function rig(proofMs: number) {
  const models = VARIANTS.map(([anim, tex, subjects]) => { const b = syntheticGlb(anim, tex); return { ...syntheticCandidate(b), id: `synthetic-${subjects[0]}`, subjects, animations: anim ? ['Move'] : [], animationRoles: anim ? { walk: 'Move', fly: 'Move' } : {} }; });
  const bytesOf = new Map(VARIANTS.map(([anim, tex], i) => [models[i].sha256, syntheticGlb(anim, tex)]));
  const candidate = models[0];
  const objects = new Map<string, Uint8Array>();
  const binary = new Map<string, string>();
  const workspace: GameAssetWorkspace = { writeFile: async () => {}, writeBinaryFile: async () => {}, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
  let proving = 0, maxProving = 0, saving = 0, maxSaving = 0;
  const persistence = {
    // The shape of the real store: read the list, wait (a network round trip), write it back.
    saveBinary: async (_id: string, files: Record<string, string>) => {
      saving++; maxSaving = Math.max(maxSaving, saving);
      await sleep(20);
      for (const [p, c] of Object.entries(files)) binary.set(p, c);
      saving--;
    },
    readBinary: async (_id: string, p: string) => (binary.has(p) ? Buffer.from(binary.get(p)!.split(',')[1], 'base64') : null),
    saveText: async () => {},
  };
  const deps = {
    cache: createDurableAssetCache({ read: async (k: string) => objects.get(k) ?? null, write: async (k: string, d: Uint8Array) => { objects.set(k, d); } }, models),
    providers: createAssetProviders(models),
    download: async (c: { sha256: string }) => bytesOf.get(c.sha256)!,
    parse: async () => { proving++; maxProving = Math.max(maxProving, proving); await sleep(proofMs); proving--; },
    persist: persistProjectAsset(workspace, 'w', persistence),
  };
  return { candidate, models, workspace, deps, persistence, stats: () => ({ maxProving, maxSaving }) };
}

describe('prepareGameAssets: proofs at once, saves in turn', () => {
  const PROMPT = 'a 3D train game with a train, trees, buildings, a dog and a cow';
  it('proves several at once — and never runs two saves at once', async () => {
    const r = rig(150);
    const t0 = Date.now();
    const result = await prepareGameAssets({ prompt: PROMPT, workspaceId: 'w', workspace: r.workspace, signal: new AbortController().signal, dependencies: r.deps, persistence: r.persistence, catalogue: r.models, env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' } });
    const ms = Date.now() - t0;
    const n = result.outcomes.length;
    expect(n).toBeGreaterThanOrEqual(4);
    // dog and cow share ONE model, so the first wave of three holds two DISTINCT proofs — and that model is proved once.
    expect(result.outcomes.every((o) => o.outcome.kind === 'model')).toBe(true);
    expect(r.stats().maxProving).toBeGreaterThanOrEqual(2);
    expect(r.stats().maxProving).toBeLessThanOrEqual(GAME_ASSET_CONCURRENCY);
    expect(r.stats().maxSaving, 'two durable saves overlapped — the paths list would lose one').toBe(1);
    const distinct = r.models.length; // 4 different models behind the 5 subjects
    expect(ms, `${distinct} proofs of 150 ms took ${ms} ms — they ran one by one`).toBeLessThan(distinct * 150);
  });
  it('the outcomes keep the requirement order, whatever finishes first', async () => {
    const r = rig(20);
    const result = await prepareGameAssets({ prompt: PROMPT, workspaceId: 'w', workspace: r.workspace, signal: new AbortController().signal, dependencies: r.deps, persistence: r.persistence, catalogue: r.models, env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' } });
    const seq = await prepareGameAssets({ prompt: PROMPT, workspaceId: 'w', workspace: r.workspace, signal: new AbortController().signal, dependencies: r.deps, persistence: r.persistence, catalogue: r.models, env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' } });
    expect(result.outcomes.map((o) => o.subject)).toEqual(seq.outcomes.map((o) => o.subject));
    expect(result.outcomes[0].subject).toBe('train');
  });
});

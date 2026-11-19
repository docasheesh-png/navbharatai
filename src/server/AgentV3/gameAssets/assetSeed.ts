import { prepareHumanAssets } from './humanPack';
import { createPolyHavenDiscovery, withDiscoveredAssetCache, isDiscoveredAsset } from './polyHavenDiscovery';
import { createHash } from 'node:crypto';
import { localModelsOverride, localModelSubjects } from './localModelNote';
import { downloadGameAsset } from './assetDownload';
import { acquireGameAsset, type AssetEngineDependencies, type AssetOutcome } from './assetEngine';
import type { AssetRequirement } from './assetPolicy';
import { createAssetProviders, REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';
import { createDurableAssetCache } from './assetCache';
import { gameAssetObjectStore } from './objectStore';
import { downloadReviewedAsset, polyHavenTransport } from './assetTransport';
import { externalGameAssetsEnabled, gameAssetRequirements } from './assetPlan';
import { persistProjectAsset, type GameAssetWorkspace, type GameAssetPersistence } from './assetProject';
import { proveAssetInSandbox } from './assetBrowserProof';
import { saveWorkspaceAssets, readWorkspaceAssetBytes } from '../WorkspaceAssetStore';
import { mergeWorkspaceFiles } from '../WorkspaceFileStore';
import { GAME_ASSET_MODELS_PATH, generateAssetModelLoader, generateGameAssetRuntime } from '../../lib/GameAssetRuntimeGenerator';
import { sceneryFor, generateWorldDressingModule } from './worldDressing';
/** MIT requires its permission notice in every copy; the copyright line is the entry's `attribution`. */
export const MIT_PERMISSION_NOTICE = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';

const discover = createPolyHavenDiscovery(polyHavenTransport, (url, signal) => downloadGameAsset({ downloadUrl: url }, new Set(['https://dl.polyhaven.org']), signal));

export interface GameAssetSeedResult {
  files: Record<string, string>;
  handoff: string;
  outcomes: Array<{ subject: string; outcome: AssetOutcome }>;
  status: 'off' | 'empty-catalogue' | 'prepared' | 'procedural';
}
export interface GameAssetSeedOptions {
  prompt: string;
  /** Trusted builder plan override; false means deliberately no visible human. */
  needsHuman?: boolean;
  workspaceId: string;
  verifiedOwnerUid?: string;
  workspace: GameAssetWorkspace;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  catalogue?: readonly ReviewedAsset[];
  /** Test adapters exercise the same orchestration without live accounts or paid sandbox creation. */
  dependencies?: AssetEngineDependencies;
  persistence?: GameAssetPersistence;
}

/** Called only inside the existing new-game seed guard, after the 3D recipe has installed Three.js. */
/** Models downloaded and proved at once. Bounded: each proof is a browser in a sandbox with ~3.7 GB. */
export const GAME_ASSET_CONCURRENCY = 3;

export async function prepareGameAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult> {
  // Preserve scenery/vehicles and their manifest. Optional humans use separate filenames.
  const scenery = await prepareExternalGameAssets(options);
  options.signal.throwIfAborted();
  // Never install a second competing visible-human authority.
  if (localModelSubjects(scenery.files[GAME_ASSET_MODELS_PATH]).includes('human')) return scenery;
  const humanPaths = ['src/game/three/humanRuntime.ts', 'src/game/three/humanAssets.ts', 'public/game-assets/HUMANS_NOTICE.txt'];
  if (humanPaths.some(path => Object.prototype.hasOwnProperty.call(scenery.files, path))) return scenery;
  let humans: GameAssetSeedResult | null;
  try {
    humans = await prepareHumanAssets(options);
  } catch {
    options.signal.throwIfAborted();
    // Do not discard already prepared scenery or advertise an unprepared human.
    return scenery;
  }
  if (!humans) return scenery;
  return {
    files: { ...scenery.files, ...humans.files },
    handoff: [scenery.handoff, humans.handoff].filter(Boolean).join('\n'),
    outcomes: [...scenery.outcomes, ...humans.outcomes],
    status: 'prepared',
  };
}

async function prepareExternalGameAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult> {
  const out: GameAssetSeedResult = { files: {}, handoff: '', outcomes: [], status: 'off' };
  if (!externalGameAssetsEnabled(options.env, options.verifiedOwnerUid)) return out;
  const catalogue = options.catalogue ?? REVIEWED_GAME_ASSETS;
  // Named subjects first, then the scenery this KIND of game needs (L3 step 4) — same bound of six models.
  const named = gameAssetRequirements(options.prompt, catalogue);
  const scenery = sceneryFor(options.prompt);
  const served = new Set(catalogue.flatMap((c) => c.subjects));
  const requirements = [...named, ...(scenery?.subjects ?? [])
    .filter((subject) => served.has(subject) && !named.some((r) => r.subject === subject))
    .map((subject): AssetRequirement => ({ subject }))].slice(0, 6);
  if (!requirements.length) return { ...out, status: 'procedural' };
  const persistence: GameAssetPersistence = options.persistence ?? {
    saveBinary: (id, assets) => saveWorkspaceAssets(id, assets, options.verifiedOwnerUid),
    readBinary: readWorkspaceAssetBytes,
    async saveText(id, files) {
      const result = await mergeWorkspaceFiles(id, files);
      if (result.status !== 'saved') throw new Error('Model manifest persistence not acknowledged');
    },
  };
  const store = options.dependencies ? undefined : gameAssetObjectStore();
  const dependencies: AssetEngineDependencies = options.dependencies ?? {
    cache: withDiscoveredAssetCache(createDurableAssetCache(store!, catalogue), store!),
    discover,
    providers: createAssetProviders(catalogue, polyHavenTransport),
    download(candidate, signal) {
      const approved = catalogue.find(c => c.sha256 === candidate.sha256 && c.provider === candidate.provider && c.id === candidate.id && c.revision === candidate.revision);
      if (!approved) throw new Error('Candidate is outside reviewed catalogue');
      return downloadReviewedAsset(approved, signal);
    },
    parse: (bytes, requirement) => proveAssetInSandbox(options.workspace, options.workspaceId, bytes, requirement),
    persist: persistProjectAsset(options.workspace, options.workspaceId, persistence),
  };
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]);
  // 🔴 SIX MODELS, ONE AFTER ANOTHER (autopsy 61279465, Q-2343). The seed waited ~45 s after its last recipe: each
  // model was downloaded, then proved in a FRESH browser in the sandbox, strictly in turn — measured off-sandbox at
  // 11.6 s of downloads + 14.0 s of proofs for that build's six. The PROOFS now run up to GAME_ASSET_CONCURRENCY at
  // once, overlapping the downloads. Downloads stay in turn (see `download` below) and so does the durable SAVE:
  // saveWorkspaceAssets read-modify-writes the workspace's `paths` list, so two at once would drop a model from it.
  const persistOne = dependencies.persist;
  let persistChain: Promise<unknown> = Promise.resolve();
  // ONE MODEL IS FETCHED AND PROVED ONCE PER REQUEST, however many subjects share it: in turn, the second subject
  // found the first's bytes in the cache; at once, both would miss it. The in-flight promise is shared instead.
  const downloading = new Map<string, Promise<Uint8Array>>();
  let downloadChain: Promise<unknown> = Promise.resolve();
  const proving = new Map<string, Promise<void>>();
  const proofKey = (bytes: Uint8Array, requirement: AssetRequirement) => `${createHash('sha256').update(bytes).digest('hex')}:${requirement.animation ?? ''}`;
  const serialDependencies: AssetEngineDependencies = {
    ...dependencies,
    // DOWNLOADS STAY ONE AT A TIME: the guarded transport allows about one request per second per origin and throws
    // past one queued request (assetProviderBudget.ts — politeness to the providers, kept as designed). Measured: three
    // at once failed "Provider rate limit". So downloads are chained and only the browser proofs overlap them.
    download: (candidate, s) => {
      const key = `${candidate.provider}:${candidate.id}:${candidate.revision}:${candidate.sha256}`;
      let p = downloading.get(key);
      if (!p) {
        p = downloadChain.then(() => dependencies.download(candidate, s));
        downloadChain = p.catch(() => {});
        downloading.set(key, p);
        p.catch(() => downloading.delete(key));
      }
      return p;
    },
    parse: (bytes, requirement) => {
      const key = proofKey(bytes, requirement);
      let p = proving.get(key);
      if (!p) { p = dependencies.parse(bytes, requirement); proving.set(key, p); p.catch(() => proving.delete(key)); }
      return p;
    },
    persist: (entry, bytes) => {
      const next = persistChain.then(() => persistOne(entry, bytes));
      persistChain = next.catch(() => {});
      return next;
    },
  };
  const results: Array<{ subject: string; outcome: AssetOutcome } | undefined> = new Array(requirements.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < requirements.length && !signal.aborted) {
      const i = cursor++;
      const requirement = requirements[i];
      results[i] = { subject: requirement.subject, outcome: await acquireGameAsset(requirement, serialDependencies, signal) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(GAME_ASSET_CONCURRENCY, requirements.length) }, worker));
  for (const r of results) if (r) out.outcomes.push(r);
  const ready = out.outcomes.filter((r): r is { subject: string; outcome: Extract<AssetOutcome, { kind: 'model' }> } => r.outcome.kind === 'model');
  if (!ready.length || signal.aborted) return { ...out, status: 'procedural' };
  const manifest = { schema: 1, assets: ready.map(r => ({ subject: r.subject, ...r.outcome.entry })) };
  const local = Object.fromEntries(ready.map(r => {
    const c = r.outcome.entry.candidate;
    const role = requirements.find(req => req.subject === r.subject)?.animation;
    const reviewed = isDiscoveredAsset(c) ? c : catalogue.find(a => a.sha256 === c.sha256 && a.provider === c.provider && a.id === c.id && a.revision === c.revision);
    return [r.subject, { sha256: c.sha256, height: c.height, yaw: c.yaw,
      ...(role ? { animation: c.animationRoles?.[role] ?? role } : {}),
      ...(reviewed?.serviceCredit ? { serviceCredit: reviewed.serviceCredit } : {}),
      ...(!isDiscoveredAsset(c) && reviewed && 'hiddenNodes' in reviewed && reviewed.hiddenNodes?.length ? { hidden: [...reviewed.hiddenNodes] } : {}),
      // Roles from the REVIEWED entry (the same authority as hidden nodes), the candidate's only as a fallback.
      ...((reviewed?.animationRoles ?? c.animationRoles) && Object.keys(reviewed?.animationRoles ?? c.animationRoles ?? {}).length ? { roles: { ...(reviewed?.animationRoles ?? c.animationRoles) } } : {}),
      ...(c.license.spdx === 'CC-BY-4.0' ? { attributionCredit: `${c.license.author} — CC BY 4.0` } : {}) }];
  }));
  const credits = ready.map(r => {
    const c = r.outcome.entry.candidate;
    const reviewed = isDiscoveredAsset(c) ? c : catalogue.find(a => a.sha256 === c.sha256 && a.provider === c.provider && a.id === c.id && a.revision === c.revision);
    return `${r.subject}: ${c.license.author} — ${c.license.spdx}\n${c.license.attribution}\nSource: ${c.sourceUrl}\nLicense evidence: ${c.license.evidenceUrl}\nRevision: ${c.revision}\nChanges: ${reviewed?.optimization === 'animation-selection-v1' ? 'retained clips ' + reviewed.retainedAnimations?.join(', ') + '; removed other clips and unused data (animation-selection-v1); ' : reviewed?.optimization === 'compact-v1' ? 'lossless GLB buffer compaction (compact-v1); ' : ''}glTF packaging when applicable; runtime scale, grounding, curated orientation normalization and eligible bounded static LOD generation.\nSHA-256: ${c.sha256}${reviewed?.sourceSha256 ? '\nSource SHA-256: ' + reviewed.sourceSha256 : ''}${c.license.spdx === 'MIT' ? '\n\n' + MIT_PERMISSION_NOTICE : ''}`;
  }).join('\n\n');
  const files: Record<string, string> = {
    'public/game-assets/manifest.json': JSON.stringify(manifest, null, 2),
    'public/game-assets/ATTRIBUTION.txt': credits,
    'src/game/three/externalAssets.ts': generateGameAssetRuntime(),
    [GAME_ASSET_MODELS_PATH]: generateAssetModelLoader(local),
  };
  const dressed = scenery ? scenery.subjects.filter((subject) => ready.some((r) => r.subject === subject)) : [];
  if (scenery && dressed.length) files['src/game/three/worldDressing.ts'] = generateWorldDressingModule(dressed, scenery.layout);
  try {
    signal.throwIfAborted();
    await persistence.saveText(options.workspaceId, files);
    for (const [path, content] of Object.entries(files)) {
      signal.throwIfAborted();
      await options.workspace.writeFile(options.workspaceId, path, content);
    }
    out.files = files;
    out.status = 'prepared';
    out.handoff = `${localModelsOverride(ready.map(r => r.subject))} LOCAL 3D MODELS PREPARED: ${ready.map(r => r.subject).join(', ')}. Import loadRequestedAsset from src/game/three/assetModels.ts. Await loadRequestedAsset(subject, proceduralFallback); add handle.root to the scene; call handle.update(dt) each frame and handle.dispose() on teardown. The fallback must return { root, source: 'procedural', update, dispose } using the existing appropriate real/lite builder. Use these matching local models for those subjects, preserve gameplay physics and controls, and do not fetch provider URLs. Keep manifest.json and ATTRIBUTION.txt in the published bundle. A model passed an isolated render check; the finished game's normal playtest still must verify its integration.`
      + (dressed.length ? ` WORLD DRESSING READY (${dressed.join(', ')}; ${scenery!.layout} layout): import { dressWorld } from src/game/three/worldDressing.ts and call await dressWorld(scene, { heightAt, accept }) ONCE after the terrain/road exists — pass the kit's ground-height function as heightAt and an accept(x, z) that returns false on the road, track and play space. Solid scenery carries collision geometry into the scene with each clone. Do not also scatter procedural copies of these subjects.` : '');
    return out;
  } catch {
    return { ...out, files: {}, handoff: '', status: 'procedural' };
  }
}

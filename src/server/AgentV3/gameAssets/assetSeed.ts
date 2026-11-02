import { createPolyHavenDiscovery, withDiscoveredAssetCache, isDiscoveredAsset } from './polyHavenDiscovery';
import { downloadGameAsset } from './assetDownload';
import { acquireGameAsset, type AssetEngineDependencies, type AssetOutcome } from './assetEngine';
import { createAssetProviders, REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';
import { createDurableAssetCache } from './assetCache';
import { gameAssetObjectStore } from './objectStore';
import { downloadReviewedAsset, polyHavenTransport } from './assetTransport';
import { externalGameAssetsEnabled, gameAssetRequirements } from './assetPlan';
import { persistProjectAsset, type GameAssetWorkspace, type GameAssetPersistence } from './assetProject';
import { proveAssetInSandbox } from './assetBrowserProof';
import { saveWorkspaceAssets, readWorkspaceAssetBytes } from '../WorkspaceAssetStore';
import { mergeWorkspaceFiles } from '../WorkspaceFileStore';
import { generateGameAssetRuntime } from '../../lib/Game3DGenerator';

const discover = createPolyHavenDiscovery(polyHavenTransport, (url, signal) => downloadGameAsset({ downloadUrl: url }, new Set(['https://dl.polyhaven.org']), signal));

export interface GameAssetSeedResult {
  files: Record<string, string>;
  handoff: string;
  outcomes: Array<{ subject: string; outcome: AssetOutcome }>;
  status: 'off' | 'empty-catalogue' | 'prepared' | 'procedural';
}
export interface GameAssetSeedOptions {
  prompt: string;
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
export async function prepareGameAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult> {
  const out: GameAssetSeedResult = { files: {}, handoff: '', outcomes: [], status: 'off' };
  if (!externalGameAssetsEnabled(options.env, options.verifiedOwnerUid)) return out;
  const catalogue = options.catalogue ?? REVIEWED_GAME_ASSETS;
  const requirements = gameAssetRequirements(options.prompt, catalogue);
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
  for (const requirement of requirements) {
    if (signal.aborted) break;
    const outcome = await acquireGameAsset(requirement, dependencies, signal);
    out.outcomes.push({ subject: requirement.subject, outcome });
  }
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
      ...(c.license.spdx === 'CC-BY-4.0' ? { attributionCredit: `${c.license.author} — CC BY 4.0` } : {}) }];
  }));
  const credits = ready.map(r => {
    const c = r.outcome.entry.candidate;
    const reviewed = isDiscoveredAsset(c) ? c : catalogue.find(a => a.sha256 === c.sha256 && a.provider === c.provider && a.id === c.id && a.revision === c.revision);
    return `${r.subject}: ${c.license.author} — ${c.license.spdx}\n${c.license.attribution}\nSource: ${c.sourceUrl}\nLicense evidence: ${c.license.evidenceUrl}\nRevision: ${c.revision}\nChanges: ${reviewed?.optimization === 'animation-selection-v1' ? 'retained clips ' + reviewed.retainedAnimations?.join(', ') + '; removed other clips and unused data (animation-selection-v1); ' : reviewed?.optimization === 'compact-v1' ? 'lossless GLB buffer compaction (compact-v1); ' : ''}glTF packaging when applicable; runtime scale, grounding, curated orientation normalization and eligible bounded static LOD generation.\nSHA-256: ${c.sha256}${reviewed?.sourceSha256 ? '\nSource SHA-256: ' + reviewed.sourceSha256 : ''}`;
  }).join('\n\n');
  const files = {
    'public/game-assets/manifest.json': JSON.stringify(manifest, null, 2),
    'public/game-assets/ATTRIBUTION.txt': credits,
    'src/game/three/externalAssets.ts': generateGameAssetRuntime(),
    'src/game/three/assetModels.ts': `import { loadGameAsset, type GameAssetHandle, type LocalGameAsset } from './externalAssets';\nconst assets: Record<string, LocalGameAsset> = ${JSON.stringify(local)};\nexport function loadRequestedAsset(subject: string, fallback: () => GameAssetHandle, signal?: AbortSignal): Promise<GameAssetHandle> {\n  return assets[subject] ? loadGameAsset(assets[subject], fallback, signal) : Promise.resolve(fallback());\n}\n`,
  };
  try {
    signal.throwIfAborted();
    await persistence.saveText(options.workspaceId, files);
    for (const [path, content] of Object.entries(files)) {
      signal.throwIfAborted();
      await options.workspace.writeFile(options.workspaceId, path, content);
    }
    out.files = files;
    out.status = 'prepared';
    out.handoff = `LOCAL 3D MODELS PREPARED: ${ready.map(r => r.subject).join(', ')}. Import loadRequestedAsset from src/game/three/assetModels.ts. Await loadRequestedAsset(subject, proceduralFallback); add handle.root to the scene; call handle.update(dt) each frame and handle.dispose() on teardown. The fallback must return { root, source: 'procedural', update, dispose } using the existing appropriate real/lite builder. Use these matching local models for those subjects, preserve gameplay physics and controls, and do not fetch provider URLs. Keep manifest.json and ATTRIBUTION.txt in the published bundle. A model passed an isolated render check; the finished game's normal playtest still must verify its integration.`;
    return out;
  } catch {
    return { ...out, files: {}, handoff: '', status: 'procedural' };
  }
}

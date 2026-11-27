import { REALISTIC_HUMANS } from './realisticHumans';
import { GAME_PLAYER_FILE_PATH, gamePlayerFileSource } from '../../lib/GamePlayerBodyGenerator';
import { setPlayerModel } from '../characterSwap';
import { needsHumanCharacter, prepareHumanAssets } from './humanPack';
import { createPolyHavenDiscovery, withDiscoveredAssetCache, isDiscoveredAsset } from './polyHavenDiscovery';
import { createHash } from 'node:crypto';
import { pickVariant } from '../../lib/projectVariety';
import { localModelEntries, localModelsOverride, localModelSubjects } from './localModelNote';
import { downloadGameAsset } from './assetDownload';
import { acquireGameAsset, type AssetEngineDependencies, type AssetOutcome } from './assetEngine';
import type { AssetRequirement } from './assetPolicy';
import { createAssetProviders, REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';
import { createDurableAssetCache } from './assetCache';
import { gameAssetObjectStore } from './objectStore';
import { downloadReviewedAsset, polyHavenTransport } from './assetTransport';
import { externalGameAssetsEnabled, gameAssetRequirements } from './assetPlan';
import { libraryPicksIn, type PickRole } from './libraryPicks';
import { persistProjectAsset, type GameAssetWorkspace, type GameAssetPersistence } from './assetProject';
import { proveAssetInSandbox } from './assetBrowserProof';
import { saveWorkspaceAssets, readWorkspaceAssetBytes } from '../WorkspaceAssetStore';
import { mergeWorkspaceFiles } from '../WorkspaceFileStore';
import { GAME_ASSET_CUSTOMIZATIONS_PATH, GAME_ASSET_MODELS_PATH, generateAssetCustomizations, generateAssetModelLoader, generateGameAssetRuntime, runtimeExportsAll, runtimeImportNames } from '../../lib/GameAssetRuntimeGenerator';
import { sceneryFor, generateWorldDressingModule } from './worldDressing';
import { GAME_WORLD_STREAMING_PATH, generateWorldStreamingModule, WORLD_STREAMING_HANDOFF } from '../../lib/GameWorldStreamingGenerator';
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
  /** Player source newly created by this build, before the asset seed. */
  starterPlayerSource?: string;
  workspaceId: string;
  verifiedOwnerUid?: string;
  workspace: GameAssetWorkspace;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  catalogue?: readonly ReviewedAsset[];
  /** Test adapters exercise the same orchestration without live accounts or paid sandbox creation. */
  dependencies?: AssetEngineDependencies;
  persistence?: GameAssetPersistence;
  /** Explicit models to add (edit turns: add_library_models) instead of reading them from the prompt; no scenery. */
  requirements?: readonly AssetRequirement[];
  /**
   * The game's current files, for MERGING into an existing game rather than seeding a new one: earlier models
   * stay in the loader, the manifest and the credits; the user's customization file is never replaced; the runtime
   * is written only when missing or too old to export what the new loader imports.
   */
  existing?: { assetModels?: string | null; manifest?: string | null; attribution?: string | null; customizations?: string | null; runtime?: string | null; streaming?: string | null };
}

/** Called only inside the existing new-game seed guard, after the 3D recipe has installed Three.js. */
/** Models downloaded and proved at once. Bounded: each proof is a browser in a sandbox with ~3.7 GB. */
export const GAME_ASSET_CONCURRENCY = 3;

/** The project's durable store for seeded binary assets (models, sounds) and their text manifests. One adapter, every seed. */
export function workspaceGameAssetPersistence(verifiedOwnerUid?: string): GameAssetPersistence {
  return {
    saveBinary: (id, assets) => saveWorkspaceAssets(id, assets, verifiedOwnerUid),
    readBinary: readWorkspaceAssetBytes,
    async saveText(id, files) {
      const result = await mergeWorkspaceFiles(id, files);
      if (result.status !== 'saved') throw new Error('Asset manifest persistence not acknowledged');
    },
  };
}

export async function prepareGameAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult> {
  // Preserve scenery/vehicles and their manifest. Optional humans use separate filenames.
  const scenery = await prepareExternalGameAssets(options);
  options.signal.throwIfAborted();
  // Never install a second competing visible-human authority.
  if (scenery.files[GAME_PLAYER_FILE_PATH] || localModelSubjects(scenery.files[GAME_ASSET_MODELS_PATH]).includes('human')) return scenery;
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

/**
 * Add named library models to an EXISTING game (the add_library_models tool, 2026-11-19). Same gate, catalogue,
 * downloads, proofs and durable saves as the new-game seed; merges into the game's current files (see `existing`).
 * Without this, the library only reached NEW games: "add a cow to my game" could never get the library cow.
 */
export function addLibraryModels(options: Omit<GameAssetSeedOptions, 'prompt' | 'needsHuman'> & { requirements: readonly AssetRequirement[] }): Promise<GameAssetSeedResult> {
  return prepareExternalGameAssets({ ...options, prompt: '', existing: options.existing ?? {} });
}

/**
 * What the builder is told about the user's Game library picks: which are in the game, under which name, and what each is
 * already wired as — and, honestly, which could not be added. '' when the request named none. PURE.
 */
export function pickedModelsHandoff(picks: ReadonlyArray<{ id: string; role: PickRole; subject: string }>, ready: ReadonlySet<string>, playerSet: boolean): string {
  if (!picks.length) return '';
  const lines = picks.map((p) => {
    if (!ready.has(p.subject)) return `"${p.id}" could not be added to the game, so it is not in it — tell the user plainly; do not draw a replacement and call it theirs`;
    if (p.role === 'player') return playerSet ? `"${p.id}" is the player: PLAYER.model = '${p.subject}' is already set in ${GAME_PLAYER_FILE_PATH} — do not change it` : `"${p.id}" is saved as '${p.subject}'; set PLAYER.model = '${p.subject}' (and PLAYER.file = null) in ${GAME_PLAYER_FILE_PATH}`;
    if (p.role === 'enemy') return `"${p.id}" is saved as '${p.subject}' for the enemies: ENEMIES.model = '${p.subject}' in src/game/features/enemies.ts dresses each one (Entities.dress) — never a second enemy system`;
    return `"${p.id}" is saved as '${p.subject}'; place it where the user's words say`;
  });
  return ` 🎯 THE USER'S GAME LIBRARY PICKS: ${lines.join('; ')}.`;
}

async function prepareExternalGameAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult> {
  const out: GameAssetSeedResult = { files: {}, handoff: '', outcomes: [], status: 'off' };
  if (!externalGameAssetsEnabled(options.env, options.verifiedOwnerUid)) return out;
  const explicit = options.requirements !== undefined;
  // 🎯 THE USER'S GAME LIBRARY PICKS COME FIRST, EXACTLY (build #2565: "@character:lib12-young-man ki hero banana hai, aur
  // @model:q7-ranger-man ko enemy bot"). The request names exact library ids (libraryPicks.ts); each is pinned like
  // add_library_models pins one — other models serving its subjects leave this call's catalogue — so the young man the user
  // tapped never arrives as a different young man. The player's pick becomes PLAYER.model below; the enemies' pick is the
  // subject their feature wears (GameEnemiesFeature.ts). A car pick is the race's own path (carSwap.ts), not this one.
  const full = options.catalogue ?? REVIEWED_GAME_ASSETS;
  const picks = explicit ? [] : libraryPicksIn(options.prompt)
    .filter((p) => p.role !== 'car')
    .map((p) => ({ ...p, entry: full.find((c) => c.id === p.id) }))
    .filter((p): p is typeof p & { entry: ReviewedAsset } => !!p.entry && typeof p.entry.subjects[0] === 'string');
  const pinnedSubjects = new Set(picks.flatMap((p) => p.entry.subjects));
  const catalogue = picks.length ? full.filter((c) => picks.some((p) => p.entry === c) || !c.subjects.some((s) => pinnedSubjects.has(s))) : full;
  const pickClip = (entry: ReviewedAsset, role: string) => (entry.animationRoles && role in entry.animationRoles ? { animation: role } : {});
  const picked: AssetRequirement[] = picks.map((p) => ({ subject: p.entry.subjects[0], ...pickClip(p.entry, p.role === 'player' ? 'idle' : p.role === 'enemy' ? 'walk' : '') }));
  // Named subjects first, then the scenery this KIND of game needs (L3 step 4) — same bound of six models.
  const named = explicit ? options.requirements!.slice(0, 6).map((r) => ({ subject: r.subject, ...(r.animation ? { animation: r.animation } : {}) }))
    : [...picked, ...gameAssetRequirements(options.prompt, catalogue).filter((r) => !picked.some((p) => p.subject === r.subject))];
  const playerPick = picks.find((p) => p.role === 'player');
  const freshPlayer = !explicit && options.starterPlayerSource === gamePlayerFileSource(options.workspaceId);
  const starter = freshPlayer && playerPick ? playerPick.entry
    : freshPlayer && !playerPick
    && needsHumanCharacter(options) && !/cartoon|stylized|stylised|low[ -]?poly|voxel|anime|pixel art/i.test(options.prompt)
    && !named.some(r => r.subject !== 'human' && catalogue.some(c => c.libraryCategory === 'character' && c.subjects.includes(r.subject)))
    ? pickVariant(options.workspaceId, 'human', REALISTIC_HUMANS)
    : undefined;
  const starterSubject = starter && catalogue.some(c => c.id === starter.id) ? starter.subjects[0] : undefined;
  const requested = starterSubject
    ? [{ subject: starterSubject, ...(playerPick && starter === playerPick.entry ? pickClip(playerPick.entry, 'idle') : { animation: 'idle' }) }, ...named.filter(r => r.subject !== 'human' && r.subject !== starterSubject)]
    : named;
  const scenery = explicit ? null : sceneryFor(options.prompt);
  const served = new Set(catalogue.flatMap((c) => c.subjects));
  const requirements = [...requested, ...(scenery?.subjects ?? [])
    .filter((subject) => served.has(subject) && !named.some((r) => r.subject === subject))
    .map((subject): AssetRequirement => ({ subject }))].slice(0, 6);
  if (!requirements.length) return { ...out, status: 'procedural' };
  const persistence: GameAssetPersistence = options.persistence ?? workspaceGameAssetPersistence(options.verifiedOwnerUid);
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
  // THE PIN HOLDS WHEREVER A CANDIDATE COMES FROM: a model left out for a pick (another young man) is refused from every
  // source and every cached copy too, not only from the catalogue the default sources are built on.
  const left = picks.length ? new Set(full.filter((c) => !catalogue.includes(c)).map((c) => c.id)) : null;
  const sources = dependencies.providers;
  const cache = dependencies.cache;
  const serialDependencies: AssetEngineDependencies = {
    ...dependencies,
    ...(left ? {
      providers: sources.map((p) => ({ id: p.id, search: async (r: AssetRequirement, s: AbortSignal) => (await p.search(r, s)).filter((c) => !left.has(c.id)) })),
      cache: { find: async (r: AssetRequirement) => (await cache.find(r)).filter((e) => !left.has(e.candidate.id)), read: (sha: string) => cache.read(sha), put: (e, b) => cache.put(e, b) },
    } : {}),
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
  const existing = options.existing;
  const added = new Set(ready.map((r) => r.subject));
  const previousLocal = existing ? localModelEntries(existing.assetModels) : {};
  const mergedLocal: Record<string, unknown> = { ...previousLocal, ...local };
  let previousManifest: unknown[] = [];
  try { const m = JSON.parse(existing?.manifest ?? '') as { assets?: unknown[] }; if (Array.isArray(m?.assets)) previousManifest = m.assets; } catch { /* no earlier manifest */ }
  const mergedManifest = { schema: 1, assets: [...previousManifest.filter((a) => !added.has(String((a as { subject?: unknown })?.subject ?? ''))), ...manifest.assets] };
  const mergedCredits = existing?.attribution?.trim() ? `${existing.attribution.trim()}\n\n${credits}` : credits;
  const loader = generateAssetModelLoader(mergedLocal);
  const keepRuntime = !!existing?.runtime && runtimeExportsAll(existing.runtime, runtimeImportNames(loader));
  const files: Record<string, string> = {
    'public/game-assets/manifest.json': JSON.stringify(mergedManifest, null, 2),
    'public/game-assets/ATTRIBUTION.txt': mergedCredits,
    ...(keepRuntime ? {} : { 'src/game/three/externalAssets.ts': generateGameAssetRuntime() }),
    [GAME_ASSET_MODELS_PATH]: loader,
    ...(existing?.customizations ? {} : { [GAME_ASSET_CUSTOMIZATIONS_PATH]: generateAssetCustomizations(Object.keys(mergedLocal)) }),
    // Big worlds stream (GameWorldStreamingGenerator.ts). Written once; a later turn never overwrites the game's copy.
    ...(existing?.streaming ? {} : { [GAME_WORLD_STREAMING_PATH]: generateWorldStreamingModule() }),
  };
  const dressed = scenery ? scenery.subjects.filter((subject) => ready.some((r) => r.subject === subject)) : [];
  if (scenery && dressed.length) files['src/game/three/worldDressing.ts'] = generateWorldDressingModule(dressed, scenery.layout);
  if (starterSubject && options.starterPlayerSource && ready.some(r => r.subject === starterSubject)) {
    const player = setPlayerModel(options.starterPlayerSource, starterSubject);
    if (player.ok) files[GAME_PLAYER_FILE_PATH] = player.source;
  }
  try {
    signal.throwIfAborted();
    await persistence.saveText(options.workspaceId, files);
    for (const [path, content] of Object.entries(files)) {
      signal.throwIfAborted();
      await options.workspace.writeFile(options.workspaceId, path, content);
    }
    out.files = files;
    out.status = 'prepared';
    out.handoff = `${localModelsOverride(ready.map(r => r.subject))} LOCAL 3D MODELS PREPARED: ${ready.map(r => r.subject).join(', ')}. Import loadRequestedAsset from src/game/three/assetModels.ts. Await loadRequestedAsset(subject, proceduralFallback); add handle.root to the scene; call handle.update(dt) each frame and handle.dispose() on teardown. The fallback must return { root, source: 'procedural', update, dispose } using the existing appropriate real/lite builder. Use these matching local models for those subjects, preserve gameplay physics and controls, and do not fetch provider URLs. Keep manifest.json and ATTRIBUTION.txt in the published bundle. A model passed an isolated render check; the finished game's normal playtest still must verify its integration. EVERY MODEL IS CHANGEABLE: when the user asks to recolour, resize, turn, move, hide a part of, re-animate, swap to the code-built object, or fully replace a model with their own .glb (or add a new one), edit ONLY src/game/three/assetCustomizations.ts (examples are in that file) — never the library files, manifest.json, assetModels.ts or externalAssets.ts. ${WORLD_STREAMING_HANDOFF}`
      + (dressed.length ? ` WORLD DRESSING READY (${dressed.join(', ')}; ${scenery!.layout} layout): import { dressWorld } from src/game/three/worldDressing.ts and call await dressWorld(scene, { heightAt, accept }) ONCE after the terrain/road exists — pass the kit's ground-height function as heightAt and an accept(x, z) that returns false on the road, track and play space. Solid scenery carries collision geometry into the scene with each clone. Do not also scatter procedural copies of these subjects.` : '')
      + pickedModelsHandoff(picks.map((p) => ({ id: p.id, role: p.role, subject: p.entry.subjects[0] })), new Set(ready.map((r) => r.subject)), files[GAME_PLAYER_FILE_PATH] !== undefined);
    return out;
  } catch {
    return { ...out, files: {}, handoff: '', status: 'procedural' };
  }
}

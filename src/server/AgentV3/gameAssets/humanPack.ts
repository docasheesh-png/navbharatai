import { asksForBattleRoyale } from '../gameIntent';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRecoveredHumanGlb } from './humanPackPolicy';
import { proveAssetInSandbox } from './assetBrowserProof';
import type { GameAssetSeedOptions, GameAssetSeedResult } from './assetSeed';
import { saveWorkspaceAssets, readWorkspaceAssetBytes } from '../WorkspaceAssetStore';
import { mergeWorkspaceFiles } from '../WorkspaceFileStore';
import { generateAssetModelLoader, generateGameAssetRuntime } from '../../lib/GameAssetRuntimeGenerator';

/** Original bytes recovered from the owner’s AI-assisted Work conversation. These are NOT CC0 assets and are not in the frontend public catalogue; repository access still applies. */
export const HUMAN_PACK = Object.freeze([
  { id: 'cap', file: 'human_01_cap.glb', sha256: '7dbe7b32310b89398a8e21ebceb9723986f3109e8c358583647303f038548180', bytes: 2620816 },
  { id: 'leather', file: 'human_02_leather.glb', sha256: '72896823eef0c702d4479e02fc9bc2306ddbd4cd4310200422aa58710a42c9c3', bytes: 2548388 },
  { id: 'denim', file: 'human_03_denim.glb', sha256: '86233496f6f4a87cc7e519877002bbf9b33faa1e0295721fdf8089b6d0b86cd1', bytes: 2504296 },
]);

/** Separate reviewed change must record image/likeness and commercial redistribution permission.
 * An environment toggle alone cannot grant rights. No approval was supplied with the recovered files. */
export const HUMAN_PACK_RIGHTS_REVIEW: { approved: boolean; evidence: string | null } = Object.freeze({ approved: false, evidence: null });

/** Rights approval is not engineering approval. Existing persistence adapters do not
 * guarantee an atomic, no-overwrite multi-file installation. Keep activation blocked
 * until a separately reviewed implementation provides that guarantee and acceptance. */
export const HUMAN_PACK_INTEGRATION_REVIEW: { approved: boolean; evidence: string | null } = Object.freeze({ approved: false, evidence: null });

/** Bounded intent inference, not a claim to understand every possible game.
 * A trusted structured builder plan can override both ways. Explicit exclusions win. */
export function needsHumanCharacter(options: Pick<GameAssetSeedOptions, 'prompt' | 'needsHuman'>): boolean {
  if (typeof options.needsHuman === 'boolean') return options.needsHuman;
  const prompt = options.prompt.normalize('NFKC').slice(0, 16000);
  if (/\b(?:no|without)\s+(?:any\s+)?(?:humans?|people|characters?|persons?)\b|बिना\s*(?:इंसान|मानव)/i.test(prompt)) return false;
  // A royale is a game of people — read by the ONE royale reader (failedbr #2475: this private list had no "bgmi").
  if (asksForBattleRoyale(prompt)) return true;
  return /\b(?:humans?|persons?|people|characters?|humanoids?|soldiers?|pedestrians?|npcs?|third[- ]person\s*(?:shooter|adventure)|football|soccer|basketball|boxing)\b|इंसान|मानव|कैरेक्टर/i.test(prompt);
}

/** Existing new-3D-game seed calls this, never an edit/import/reopen migration. */
export async function prepareHumanAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult | null> {
  const env = options.env ?? process.env;
  if (!HUMAN_PACK_INTEGRATION_REVIEW.approved || !HUMAN_PACK_INTEGRATION_REVIEW.evidence || env.AGENTV3_HUMAN_PACK !== 'on' || !HUMAN_PACK_RIGHTS_REVIEW.approved || !HUMAN_PACK_RIGHTS_REVIEW.evidence
      || !options.verifiedOwnerUid || !env.AGENTV3_HUMAN_PACK_OWNER_ALLOWLIST?.split(',').map(v => v.trim()).includes(options.verifiedOwnerUid)) return null;
  if (!needsHumanCharacter(options)) return null;
  options.signal.throwIfAborted();
  const index = createHash('sha256').update(options.workspaceId).digest().readUInt32BE(0) % HUMAN_PACK.length;
  const model = HUMAN_PACK[index];
  const bytes = await readFile(resolve('private-game-assets/humans', model.file));
  if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256) throw new Error('Human model integrity mismatch');
  const validated = validateRecoveredHumanGlb(bytes);
  if (!['Idle', 'Walk'].every(name => validated.animations.includes(name))) throw new Error('Human model required animation missing');
  // Runtime acceptance remains mandatory for future activation.
  await proveAssetInSandbox(options.workspace, options.workspaceId, bytes, { subject: 'human', animation: 'Idle' });
  options.signal.throwIfAborted();
  const path = `public/game-assets/${model.sha256}.glb`;
  const persistence = options.persistence ?? {
    saveBinary: (id: string, assets: Record<string, string>) => saveWorkspaceAssets(id, assets, options.verifiedOwnerUid),
    readBinary: readWorkspaceAssetBytes,
    async saveText(id: string, files: Record<string, string>) {
      const result = await mergeWorkspaceFiles(id, files);
      if (result.status !== 'saved') throw new Error('Human model source persistence not acknowledged');
    },
  };
  await persistence.saveBinary(options.workspaceId, { [path]: `data:model/gltf-binary;base64,${bytes.toString('base64')}` });
  const saved = await persistence.readBinary(options.workspaceId, path, model.bytes);
  if (!saved || createHash('sha256').update(saved).digest('hex') !== model.sha256) throw new Error('Human model durable bytes not acknowledged');
  options.signal.throwIfAborted();
  await options.workspace.writeBinaryFile(options.workspaceId, path, bytes.toString('base64'));
  const files = {
    'src/game/three/humanRuntime.ts': generateGameAssetRuntime(),
    'src/game/three/humanAssets.ts': generateAssetModelLoader({ human: { sha256: model.sha256, height: 1.8, yaw: 0, lod: false, animation: 'Idle', roles: { idle: 'Idle', walk: 'Walk' } } }).replace("from './externalAssets'", "from './humanRuntime'"),
    'public/game-assets/HUMANS_NOTICE.txt': `Human character ${model.id}. Models recovered from the owner’s AI-assisted Work conversation; the owner's rights record is kept separately. Original model bytes preserved. This is not a CC0/public-domain asset. Only Idle/Walk clips are supplied.`,
  };
  options.signal.throwIfAborted();
  await persistence.saveText(options.workspaceId, files);
  for (const [file, content] of Object.entries(files)) {
    options.signal.throwIfAborted();
    await options.workspace.writeFile(options.workspaceId, file, content);
  }
  return { files, status: 'prepared', outcomes: [], handoff: `An approved human model (${model.id}) was saved for this NEW 3D game. Import loadRequestedAsset from src/game/three/humanAssets.ts and await loadRequestedAsset('human', existingProceduralFallback). Attach its root to the current player's visual container; keep existing physics, collision, controls and camera. Update and dispose the handle normally; play('idle')/play('walk') only. No riding, jumping, combat or 2D animation is supplied. This source preparation is not proof of finished gameplay; preserve the HUMANS_NOTICE.txt attribution/rights notice. Do not replace existing projects or fetch another face.` };
}

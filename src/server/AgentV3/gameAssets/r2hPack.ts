import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateGlb } from './assetPolicy';
import { proveAssetInSandbox } from './assetBrowserProof';
import type { GameAssetSeedOptions, GameAssetSeedResult } from './assetSeed';
import { saveWorkspaceAssets, readWorkspaceAssetBytes } from '../WorkspaceAssetStore';
import { mergeWorkspaceFiles } from '../WorkspaceFileStore';
import { generateAssetModelLoader, generateGameAssetRuntime } from '../../lib/GameAssetRuntimeGenerator';

/** Original recovered bytes. These are NOT CC0 assets and are never in the public catalogue. */
export const R2H_PACK = Object.freeze([
  { id: 'cap', file: 'R2H_01_Cap.glb', sha256: '7dbe7b32310b89398a8e21ebceb9723986f3109e8c358583647303f038548180', bytes: 2620816 },
  { id: 'leather', file: 'R2H_02_Leather.glb', sha256: '72896823eef0c702d4479e02fc9bc2306ddbd4cd4310200422aa58710a42c9c3', bytes: 2548388 },
  { id: 'denim', file: 'R2H_03_Denim.glb', sha256: '86233496f6f4a87cc7e519877002bbf9b33faa1e0295721fdf8089b6d0b86cd1', bytes: 2504296 },
]);

/** Separate reviewed change must record image/likeness and commercial redistribution permission.
 * An environment toggle alone cannot grant rights. No approval was supplied with the recovered files. */
export const R2H_RIGHTS_REVIEW: { approved: boolean; evidence: string | null } = Object.freeze({ approved: false, evidence: null });

/** Rights approval is not engineering approval. Existing persistence adapters do not
 * guarantee an atomic, no-overwrite multi-file installation. Keep activation blocked
 * until a separately reviewed implementation provides that guarantee and acceptance. */
export const R2H_INTEGRATION_REVIEW: { approved: boolean; evidence: string | null } = Object.freeze({ approved: false, evidence: null });

/** Existing new-3D-game seed calls this, never an edit/import/reopen migration. */
export async function prepareR2hAssets(options: GameAssetSeedOptions): Promise<GameAssetSeedResult | null> {
  const env = options.env ?? process.env;
  if (!R2H_INTEGRATION_REVIEW.approved || !R2H_INTEGRATION_REVIEW.evidence || env.AGENTV3_R2H_CHARACTERS !== 'on' || !R2H_RIGHTS_REVIEW.approved || !R2H_RIGHTS_REVIEW.evidence
      || !options.verifiedOwnerUid || !env.AGENTV3_R2H_OWNER_ALLOWLIST?.split(',').map(v => v.trim()).includes(options.verifiedOwnerUid)) return null;
  // Preserve unrelated games. An explicit human request is needed; rollout is operator-allowlisted.
  if (!/\br2h\b|round\s*2\s*hell|\bhuman\b|\bperson\b|\bcharacter\b|इंसान|मानव|कैरेक्टर/i.test(options.prompt)) return null;
  options.signal.throwIfAborted();
  const index = createHash('sha256').update(options.workspaceId).digest().readUInt32BE(0) % R2H_PACK.length;
  const model = R2H_PACK[index];
  const bytes = await readFile(resolve('private-game-assets/r2h', model.file));
  if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256) throw new Error('R2H original asset integrity mismatch');
  const validated = validateGlb(bytes);
  if (!['Idle', 'Walk'].every(name => validated.animations.includes(name))) throw new Error('R2H required animation missing');
  // Runtime acceptance is retained. The owner's no-test instruction applies to this development run,
  // not to removing safety gates from future generated builds.
  await proveAssetInSandbox(options.workspace, options.workspaceId, bytes, { subject: 'human', animation: 'Idle' });
  options.signal.throwIfAborted();
  const path = `public/game-assets/${model.sha256}.glb`;
  const persistence = options.persistence ?? {
    saveBinary: (id: string, assets: Record<string, string>) => saveWorkspaceAssets(id, assets, options.verifiedOwnerUid),
    readBinary: readWorkspaceAssetBytes,
    async saveText(id: string, files: Record<string, string>) {
      const result = await mergeWorkspaceFiles(id, files);
      if (result.status !== 'saved') throw new Error('R2H source persistence not acknowledged');
    },
  };
  await persistence.saveBinary(options.workspaceId, { [path]: `data:model/gltf-binary;base64,${bytes.toString('base64')}` });
  const saved = await persistence.readBinary(options.workspaceId, path, model.bytes);
  if (!saved || createHash('sha256').update(saved).digest('hex') !== model.sha256) throw new Error('R2H durable bytes not acknowledged');
  options.signal.throwIfAborted();
  await options.workspace.writeBinaryFile(options.workspaceId, path, bytes.toString('base64'));
  const files = {
    'src/game/three/r2hRuntime.ts': generateGameAssetRuntime(),
    'src/game/three/r2hAssets.ts': generateAssetModelLoader({ human: { sha256: model.sha256, height: 1.8, yaw: 0, lod: false, animation: 'Idle', roles: { idle: 'Idle', walk: 'Walk' } } }).replace("from './externalAssets'", "from './r2hRuntime'"),
    'public/game-assets/R2H_NOTICE.txt': `R2H reference-derived character ${model.id}. Licensed use must follow the separately maintained owner rights record. Original model bytes preserved. This is not a CC0/public-domain asset. Do not imply endorsement. Only Idle/Walk clips are supplied.`,
  };
  options.signal.throwIfAborted();
  await persistence.saveText(options.workspaceId, files);
  for (const [file, content] of Object.entries(files)) {
    options.signal.throwIfAborted();
    await options.workspace.writeFile(options.workspaceId, file, content);
  }
  return { files, status: 'prepared', outcomes: [], handoff: `An approved R2H human model (${model.id}) was saved for this NEW 3D game. Import loadRequestedAsset from src/game/three/r2hAssets.ts and await loadRequestedAsset('human', existingProceduralFallback). Attach its root to the current player's visual container; keep existing physics, collision, controls and camera. Update and dispose the handle normally; play('idle')/play('walk') only. No riding, jumping, combat or 2D animation is supplied. This source preparation is not proof of finished gameplay; preserve the R2H_NOTICE.txt attribution/rights notice. Do not replace existing projects or fetch another face.` };
}

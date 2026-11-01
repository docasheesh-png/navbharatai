import { createHash } from 'node:crypto';
import { ASSET_LIMITS } from './assetPolicy';
import type { AssetManifestEntry } from './assetEngine';

export interface GameAssetWorkspace {
  writeFile(workspaceId: string, path: string, content: string): Promise<void>;
  writeBinaryFile(workspaceId: string, path: string, base64: string): Promise<void>;
  runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}
export interface GameAssetPersistence {
  saveBinary(workspaceId: string, assets: Record<string, string>): Promise<void>;
  readBinary(workspaceId: string, path: string, maxBytes: number): Promise<Uint8Array | null>;
  saveText(workspaceId: string, files: Record<string, string>): Promise<void>;
}

/** Durable bytes first, exact read-back second, sandbox materialization last. No best-effort success. */
export function persistProjectAsset(workspace: GameAssetWorkspace, workspaceId: string, store: GameAssetPersistence) {
  return async (entry: AssetManifestEntry, bytes: Uint8Array): Promise<void> => {
    if (bytes.byteLength > ASSET_LIMITS.bytes || entry.path !== `public/game-assets/${entry.sha256}.glb`
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Invalid project asset');
    const base64 = Buffer.from(bytes).toString('base64');
    await store.saveBinary(workspaceId, { [entry.path]: `data:model/gltf-binary;base64,${base64}` });
    const saved = await store.readBinary(workspaceId, entry.path, ASSET_LIMITS.bytes);
    if (!saved || createHash('sha256').update(saved).digest('hex') !== entry.sha256) throw new Error('Model persistence not acknowledged');
    await workspace.writeBinaryFile(workspaceId, entry.path, base64);
  };
}

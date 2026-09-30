// A BINARY FILE THE BUILD MADE IS PART OF THE APP, SO IT IS SAVED WITH THE APP.
//
// 🔴 AUTOPSY 728a402d (2026-09-30, "Nemi Mart"). The builder drew the app's PWA icons with a Python
// script in the sandbox. The sandbox held two real PNGs; the durable project held neither — the text
// store skips binaries by design (`collectWorkspaceFiles`), and the binary store
// (`WorkspaceAssetStore`) was only ever written by an IMPORT. So every file a build created with a
// command — an icon, a generated image, a font it downloaded — lived exactly as long as that sandbox,
// and a restore into a fresh one brought back a manifest pointing at pictures that were gone.
//
// Now, at the end of a build that is being kept, every binary asset in the project that the store does
// not already hold is read as bytes and saved there, bounded. Imported assets are already held, so an
// imported app pays no reads here.
//
// ⚠️ A path the store ALREADY holds is not re-read: a build that regenerates an existing icon under the
// same name keeps the older bytes in the store. Detecting that needs the file's size or mtime, which the
// listing does not carry — recorded as an open item rather than solved by re-reading every asset on
// every build.

import { isBinaryAsset } from './fileClassification';
import { isExcludedPath } from './WorkspaceFiles';
import { contentTypeFor } from './bucketPublish';

/** At most this many assets are saved by one build, and none larger than this. */
export const MAX_BUILD_ASSETS = 40;
export const MAX_BUILD_ASSET_BYTES = 5 * 1024 * 1024;

/** Binary assets in the project the store does not hold yet, in listing order, capped. PURE. */
export function unsavedBuildAssets(
  projectPaths: readonly string[],
  heldPaths: readonly string[],
  max = MAX_BUILD_ASSETS,
): { save: string[]; overCap: string[] } {
  const held = new Set(heldPaths);
  const candidates = [...new Set(projectPaths)].filter((p) => isBinaryAsset(p) && !isExcludedPath(p) && !held.has(p));
  return { save: candidates.slice(0, max), overCap: candidates.slice(max) };
}

export interface BuildAssetSource {
  listFiles(workspaceId: string): Promise<string[]>;
  readBinaryFile?(workspaceId: string, filePath: string): Promise<string>;
}

export interface BuildAssetDeps {
  heldPaths(workspaceId: string): Promise<string[] | null>;
  save(workspaceId: string, assets: Record<string, string>): Promise<void>;
}

export interface BuildAssetOutcome {
  saved: string[];
  /** Read but not saved: empty, too large, or unreadable. */
  skipped: string[];
  overCap: string[];
  /** Why nothing was attempted, when nothing was. */
  standDown?: 'no-binary-read' | 'store-unreadable';
}

/**
 * Save the build's new binary assets. Never throws — a persistence failure never affects a build.
 * `standDown: 'store-unreadable'` when the store's own listing could not be read: without it every
 * asset would look new, so nothing is saved rather than everything re-read.
 */
export async function persistBuildAssets(
  source: BuildAssetSource,
  workspaceId: string,
  deps: BuildAssetDeps,
): Promise<BuildAssetOutcome> {
  const out: BuildAssetOutcome = { saved: [], skipped: [], overCap: [] };
  if (typeof source.readBinaryFile !== 'function') return { ...out, standDown: 'no-binary-read' };
  try {
    const held = await deps.heldPaths(workspaceId);
    if (held === null) return { ...out, standDown: 'store-unreadable' };
    const paths = await source.listFiles(workspaceId);
    const { save, overCap } = unsavedBuildAssets(paths, held);
    out.overCap = overCap;
    const assets: Record<string, string> = {};
    for (const path of save) {
      try {
        const base64 = await source.readBinaryFile(workspaceId, path);
        const bytes = Math.floor((base64.length * 3) / 4);
        // A zero-byte "asset" is a broken file, not a picture — never saved as if it were one.
        if (!base64 || bytes === 0 || bytes > MAX_BUILD_ASSET_BYTES) { out.skipped.push(path); continue; }
        assets[path] = `data:${contentTypeFor(path).split(';')[0]};base64,${base64}`;
      } catch {
        out.skipped.push(path);
      }
    }
    if (Object.keys(assets).length > 0) {
      await deps.save(workspaceId, assets);
      out.saved = Object.keys(assets);
    }
  } catch { /* best-effort: the build's text files are already saved */ }
  return out;
}

/** The admin build-report line, or null when there is nothing to say. PURE. */
export function buildAssetsNote(o: BuildAssetOutcome): string | null {
  if (o.saved.length === 0 && o.skipped.length === 0 && o.overCap.length === 0) return null;
  const parts: string[] = [];
  if (o.saved.length > 0) parts.push(`${o.saved.length} binary file(s) this build created were saved with the project (${o.saved.slice(0, 6).join(', ')}${o.saved.length > 6 ? ', …' : ''})`);
  if (o.skipped.length > 0) parts.push(`${o.skipped.length} could not be saved (empty, over ${MAX_BUILD_ASSET_BYTES / 1024 / 1024} MB, or unreadable: ${o.skipped.slice(0, 4).join(', ')})`);
  if (o.overCap.length > 0) parts.push(`${o.overCap.length} over the ${MAX_BUILD_ASSETS}-file limit were not saved`);
  return `${parts.join('; ')}.`;
}

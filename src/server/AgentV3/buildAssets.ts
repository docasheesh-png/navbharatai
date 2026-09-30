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
// A path the store ALREADY holds is re-saved only when THIS build changed it. A marker file is touched
// in the sandbox once setup (and its asset restore) is done; `find -newer` against it names the files
// the build itself wrote or regenerated. Both ends read the sandbox's own clock, so a skew between our
// server and the machine cannot misjudge it. No marker (a machine replaced mid-build) ⇒ only new paths
// are saved, exactly as if the marker had never existed.

import { isBinaryAsset } from './fileClassification';
import { isExcludedPath } from './WorkspaceFiles';
import { contentTypeFor } from './bucketPublish';

/** At most this many assets are saved by one build, and none larger than this. */
export const MAX_BUILD_ASSETS = 40;
export const MAX_BUILD_ASSET_BYTES = 5 * 1024 * 1024;

/**
 * Paths inside the project that are NOT the app's: our own landing archive (`.nbai-landing.tar.gz`)
 * and the output of a test run (Playwright's failure screenshots), which the vaccine may have produced
 * in this very sandbox.
 */
const NOT_THE_APPS = /(^|\/)\.nbai[^/]*|(^|\/)(test-results|playwright-report|blob-report)(\/|$)/i;

/**
 * Binary assets to save: every one the store does not hold, plus every held one this build changed
 * (`changed`, from `changedSinceBaseline`). In listing order, capped. PURE.
 */
export function unsavedBuildAssets(
  projectPaths: readonly string[],
  heldPaths: readonly string[],
  max = MAX_BUILD_ASSETS,
  changed: ReadonlySet<string> = new Set(),
): { save: string[]; overCap: string[] } {
  const held = new Set(heldPaths);
  const candidates = [...new Set(projectPaths)].filter((p) => isBinaryAsset(p) && !isExcludedPath(p) && !NOT_THE_APPS.test(p) && (!held.has(p) || changed.has(p)));
  return { save: candidates.slice(0, max), overCap: candidates.slice(max) };
}

export interface BuildAssetSource {
  listFiles(workspaceId: string): Promise<string[]>;
  readBinaryFile?(workspaceId: string, filePath: string): Promise<string>;
  runCommand?(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** The sandbox file whose mtime marks "setup is done; what is newer, this build wrote". */
export const ASSET_BASELINE_MARKER = '/tmp/.nbai-asset-baseline';
export const MARK_ASSET_BASELINE_COMMAND = `touch ${ASSET_BASELINE_MARKER}`;
/** Fails (non-zero) when the marker is missing, so a machine without one is never read as "nothing changed". */
export const CHANGED_SINCE_BASELINE_COMMAND = `test -f ${ASSET_BASELINE_MARKER} && find . -type f -newer ${ASSET_BASELINE_MARKER} `
  + `-not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' 2>/dev/null | head -2000`;

/** Parse the `find` listing into workspace-relative paths. PURE. */
export function parseChangedListing(stdout: string): string[] {
  return String(stdout ?? '').split('\n').map((l) => l.trim().replace(/^\.\//, '')).filter(Boolean);
}

/** Paths the build changed since the baseline, or null when that cannot be known. Never throws. */
export async function changedSinceBaseline(source: BuildAssetSource, workspaceId: string): Promise<Set<string> | null> {
  if (typeof source.runCommand !== 'function') return null;
  try {
    const r = await source.runCommand(workspaceId, CHANGED_SINCE_BASELINE_COMMAND);
    if (r.exitCode !== 0) return null;
    return new Set(parseChangedListing(r.stdout));
  } catch {
    return null;
  }
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
    const changed = held.length > 0 ? await changedSinceBaseline(source, workspaceId) : null;
    const { save, overCap } = unsavedBuildAssets(paths, held, MAX_BUILD_ASSETS, changed ?? new Set());
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

// WHAT AN IMPORT BODY IS MADE OF, SORTED BEFORE ANYTHING IS WRITTEN (single-file game autopsy, 2026-11-14).
//
// 🔴 THE ROOT CAUSE. The browser sends one object — `{ ...textFiles, ...assets }` — where an asset is a `data:<mime>;base64,…`
// string. The `import-files` route had no notion of an asset: it wrote every value as TEXT. A logo landed in the sandbox as a
// text file holding a base64 string (a broken image), and in the durable store as a text document. Nothing failed, so nothing
// said so.
//
// 🔑 THE FIX, ONE PLACE. Every door that receives files hands them here first:
//   • entries whose value is a data: URI at a binary path are ASSETS — real bytes, saved in the asset store;
//   • HTML pages that carry media inline are reduced to code, their media becoming assets/media/ files (liftEmbeddedMedia);
//   • everything else is text, as before.
// PURE: no I/O, no clock. Never throws.
import { BINARY_EXT_RE } from '../../lib/importRules';
import { liftEmbeddedMedia, liftSummary, type LiftedImport } from '../../lib/liftEmbeddedMedia';
import { materializeAssets, saveWorkspaceAssets, type BinaryFileSink } from './WorkspaceAssetStore';

export interface PreparedImport {
  /** Text files, ready for the sandbox and the durable text store. */
  text: Record<string, string>;
  /** `path → data:<mime>;base64,…`, ready for materializeAssets + saveWorkspaceAssets. */
  assets: Record<string, string>;
  /** '' when no page was reduced; otherwise one honest sentence for the import message. */
  summary: string;
  /** Pages that still hold media after the step (over a cap) — reported, never hidden. */
  unlifted: LiftedImport['unlifted'];
}

const DATA_URI_HEAD = /^data:[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9=._-]+)*;base64,/i;

/** Is this entry an asset rather than text: a data: URI value at a path that names a binary file? */
export function isAssetEntry(path: string, value: unknown): value is string {
  return typeof value === 'string' && BINARY_EXT_RE.test(path) && DATA_URI_HEAD.test(value);
}

export function prepareImportBody(files: Record<string, string>): PreparedImport {
  const text: Record<string, string> = {};
  const assets: Record<string, string> = {};
  try {
    for (const [path, value] of Object.entries(files ?? {})) {
      if (isAssetEntry(path, value)) assets[path] = value;
      else if (typeof value === 'string') text[path] = value;
    }
    const lifted = liftEmbeddedMedia(text);
    Object.assign(assets, lifted.assets);
    return { text: lifted.files, assets, summary: liftSummary(lifted), unlifted: lifted.unlifted };
  } catch {
    return { text: files ?? {}, assets: {}, summary: '', unlifted: [] };
  }
}

/** A pasted one-file page reduced to code: the document to seed as index.html, and the media files to write beside it. */
export function preparePastedPage(pastedFull: string): { doc: string; assets: Record<string, string> } {
  if (!pastedFull) return { doc: pastedFull, assets: {} };
  const prepared = prepareImportBody({ 'index.html': pastedFull });
  return { doc: prepared.text['index.html'] ?? pastedFull, assets: prepared.assets };
}

/** Write a lifted page's media as real files and into the durable asset store. Best-effort: media never blocks a seed. */
export async function landPageAssets(
  sink: BinaryFileSink,
  workspaceId: string,
  assets: Record<string, string>,
  ownerUid?: string | null,
): Promise<void> {
  if (Object.keys(assets).length === 0) return;
  try { await materializeAssets(sink, workspaceId, assets); } catch { /* an asset failing never blocks the seed */ }
  await saveWorkspaceAssets(workspaceId, assets, ownerUid).catch(() => {});
}

/**
 * The zip / GitHub landing's step: lift media out of the pages ONLY when we write the files ourselves (a git clone is already in
 * the sandbox exactly as committed). One call so the landing function carries no new branches (the chat handler has a budget).
 */
export function liftForLanding(
  files: Record<string, string>,
  assets: Record<string, string> | undefined,
  writeToSandbox: boolean,
): { files: Record<string, string>; assets: Record<string, string>; noteLine: string } {
  if (!writeToSandbox) return { files, assets: assets ?? {}, noteLine: '' };
  const prepared = prepareImportBody(files);
  return { files: prepared.text, assets: { ...(assets ?? {}), ...prepared.assets }, noteLine: prepared.summary ? `\n🎞️ ${prepared.summary}` : '' };
}

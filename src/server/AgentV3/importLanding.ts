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

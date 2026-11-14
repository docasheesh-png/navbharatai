// ONE STEP EVERY DOOR USES: lift embedded media out of the HTML pages in an import (single-file game autopsy, 2026-11-14).
//
// The browser runs it before upload (a 5.4 MB page becomes a ~760 KB page plus files); the server runs it again on whatever
// arrives — the import-files route, the zip landing — so a page that came in by ANY door lands as code plus assets, never
// as megabytes of base64 text that a size cap then drops or a model then reads.
//
// PURE and dependency-free apart from `embeddedMedia`. Never throws; a page it cannot read is left exactly as it was.
import { extractEmbeddedMedia, type EmbeddedMediaReport } from './embeddedMedia';
import { IMPORT_LIMITS } from './importRules';

const HTML_PATH = /\.html?$/i;

/** Is this path an HTML page whose media may be lifted out? */
export function isHtmlPagePath(path: string): boolean {
  return HTML_PATH.test(String(path ?? ''));
}

/**
 * May a text file of `bytes` be read in full ON THE EXPECTATION that its media will be lifted out? Only HTML pages, and only
 * up to the page ceiling. Everything else keeps the ordinary text cap.
 */
export function allowedBeforeLifting(path: string, bytes: number): boolean {
  return isHtmlPagePath(path) && bytes <= IMPORT_LIMITS.maxHtmlSourceBytes;
}

export interface LiftedImport {
  /** The text files, with every HTML page reduced to code. The same object is returned when nothing was lifted. */
  files: Record<string, string>;
  /** New asset files, `path → data:<mime>;base64,…` — the shape every importer already carries assets in. */
  assets: Record<string, string>;
  /** One report per page that held media, keyed by the page's path. */
  reports: Record<string, EmbeddedMediaReport>;
  /** Pages that still hold media after lifting (over a cap) — the import must say so, never pretend. */
  unlifted: Array<{ path: string; reason: string; bytes: number }>;
}

const dirOf = (p: string): string => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

/**
 * Lift the media out of every HTML page in `files`. `budget` is shared across the pages so ten pages cannot each take the
 * whole total.
 */
export function liftEmbeddedMedia(files: Record<string, string>): LiftedImport {
  const out: LiftedImport = { files, assets: {}, reports: {}, unlifted: [] };
  try {
    let next: Record<string, string> | null = null;
    let budget: number = IMPORT_LIMITS.maxEmbeddedMediaTotalBytes;
    for (const [path, content] of Object.entries(files)) {
      if (!isHtmlPagePath(path) || typeof content !== 'string' || content.length < 2_000) continue;
      const r = extractEmbeddedMedia(content, {
        baseDir: dirOf(path), maxAssetBytes: IMPORT_LIMITS.maxEmbeddedMediaBytes, maxTotalBytes: budget,
      });
      if (r.report.extracted.length === 0 && r.report.skipped.length === 0) continue;
      for (const e of r.report.extracted) budget -= e.bytes;
      for (const s of r.report.skipped) if (s.reason !== 'not-media') out.unlifted.push({ path, reason: s.reason, bytes: s.bytes });
      if (r.report.extracted.length === 0) continue;
      next ??= { ...files };
      next[path] = r.html;
      Object.assign(out.assets, r.assets);
      out.reports[path] = r.report;
    }
    if (next) out.files = next;
  } catch { /* an import is never blocked by this step */ }
  return out;
}

/** A one-line, honest summary of what was lifted, for the import message and the build report. '' when nothing was. */
export function liftSummary(lift: LiftedImport): string {
  const pages = Object.keys(lift.reports);
  if (pages.length === 0) return '';
  const files = Object.keys(lift.assets).length;
  const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
  const before = pages.reduce((n, p) => n + lift.reports[p].htmlBytesBefore, 0);
  const after = pages.reduce((n, p) => n + lift.reports[p].htmlBytesAfter, 0);
  return `Moved ${files} embedded media file(s) out of ${pages.length} page(s) into assets/media/ (${mb(before)} MB of page text → ${mb(after)} MB of code).`;
}

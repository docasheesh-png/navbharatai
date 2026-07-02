// P-PIPE.78 — bundle-size measurement for a generated app's production build.
//
// The v3.0 deploy path already downloads the built dist/ as an in-memory path→Buffer map
// (E2BActuator.downloadDistFiles) but the deploy message only reported the file COUNT. This module
// turns that same map — already in memory, zero extra sandbox I/O — into an honest size summary
// (raw + gzip, plus the largest JS chunk) so the user learns how heavy their shipped app is.
//
// PURE + never throws (a gzip failure on one buffer falls back to its raw size). It measures data the
// deploy path already fetched, so it can never break or slow a build. Same "pure logic + thin caller"
// split as the design/SEO linters.

import { gzipSync } from 'zlib';

export interface BundleSummary {
  fileCount: number;
  totalRawBytes: number;
  totalGzipBytes: number;
  /** The single heaviest .js chunk (by raw bytes), or null when the bundle has no JS. */
  largestJs: { name: string; rawBytes: number; gzipBytes: number } | null;
}

/** Human-readable byte size (B / KB / MB). Pure. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Measure the raw + gzipped size of a built dist file map. Never throws: a buffer that can't be
 * gzipped counts its raw size instead. Pure.
 */
export function summarizeBundle(files: Map<string, Buffer>): BundleSummary {
  let totalRawBytes = 0;
  let totalGzipBytes = 0;
  let largestJs: BundleSummary['largestJs'] = null;
  for (const [path, buf] of files) {
    const raw = buf?.length ?? 0;
    totalRawBytes += raw;
    let gz = raw;
    try {
      gz = gzipSync(buf).length;
    } catch {
      gz = raw; // gzip failed on this buffer — count its raw size, never throw
    }
    totalGzipBytes += gz;
    if (/\.js$/i.test(path) && (!largestJs || raw > largestJs.rawBytes)) {
      largestJs = { name: path, rawBytes: raw, gzipBytes: gz };
    }
  }
  return { fileCount: files.size, totalRawBytes, totalGzipBytes, largestJs };
}

/** One honest line for the deploy message, or '' for an empty bundle. Pure. */
export function bundleSummaryLine(s: BundleSummary): string {
  if (s.fileCount === 0) return '';
  const base = `Bundle: ${s.fileCount} files, ${formatBytes(s.totalRawBytes)} (${formatBytes(s.totalGzipBytes)} gzipped)`;
  if (s.largestJs) {
    return `${base}; largest JS ${s.largestJs.name} ${formatBytes(s.largestJs.rawBytes)} (${formatBytes(s.largestJs.gzipBytes)} gz).`;
  }
  return `${base}.`;
}

// A pdf.js WORKER LOADED FROM A CDN URL BUILT FROM THE VERSION — named while the file is open.
//
// 🔴 WHY (autopsy 981ce4cc, 2026-10-04). The PDF app set
// `pdfjs.GlobalWorkerOptions.workerSrc = \`//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs\``.
// The file name changes between pdfjs-dist versions (3.x ships `pdf.worker.min.js`, 4.x and later `.mjs`), so
// after the build moved to pdfjs-dist 3.11.174 the URL named a file that does not exist. The published app showed
// "Setting up fake worker failed: Cannot load script at …pdf.worker.min.mjs" and "Failed to load PDF file" — the
// one thing it was for. A CDN path also fails wherever that CDN is blocked. The worker the app installed is in
// node_modules; Vite serves it from there with `?url`, and a wrong name then fails the build loudly instead of the
// app silently. PURE.

const WORKER_SRC = /GlobalWorkerOptions\s*\.\s*workerSrc\s*=\s*([^;\n]+)/;
const CDN_HOST = /\b(?:unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|esm\.sh|cdn\.skypack\.dev)\b/;

/** Does this source set the pdf.js worker to a CDN URL? PURE. */
export function setsCdnPdfWorker(content: string): boolean {
  const m = WORKER_SRC.exec(String(content ?? ''));
  return !!m && CDN_HOST.test(m[1]);
}

/** The note for the tool result, or ''. PURE. */
export function cdnPdfWorkerNote(path: string, content: string): string {
  if (!/\.(?:[cm]?[jt]sx?)$/i.test(String(path ?? '')) || !setsCdnPdfWorker(content)) return '';
  return `\n⚠️ ${path} loads the pdf.js worker from a CDN URL. That file's name differs between pdfjs-dist versions `
    + '(3.x: pdf.worker.min.js, 4.x and later: pdf.worker.min.mjs), so a version change silently breaks every PDF, '
    + 'and it fails wherever the CDN is blocked. Load the worker the app installed instead: '
    + "`import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;` "
    + '(use the file name that exists in node_modules/pdfjs-dist/build/).';
}

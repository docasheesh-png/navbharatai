// Real compile-error "Problems" for the Code Studio IDE.
//
// The live preview bundles the workspace with server-side esbuild (/api/preview-bundle). When that
// bundle fails, esbuild reports REAL errors with a file/line/column/message — the same diagnostics a
// real IDE's "Problems" panel shows. This module is the shared shape + pure normalisation used by both
// the server (mapping esbuild errors) and the client (rendering the panel) — no fake/synthetic entries.

export interface PreviewProblem {
  file: string;
  line: number;
  column: number;
  message: string;
}

/**
 * Strip a known temp-dir prefix from an esbuild location.file so the path is workspace-relative
 * (e.g. "/tmp/nb-preview-xy/src/App.tsx" → "src/App.tsx"). Leaves already-relative paths untouched. Pure.
 */
export function normalizeProblemFile(file: string, tmpDir: string): string {
  let f = (file || '').replace(/\\/g, '/');
  const base = (tmpDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && f.startsWith(base + '/')) f = f.slice(base.length + 1);
  return f.replace(/^\.?\//, '');
}

/** Map esbuild's Message[] (text + optional location) to clean PreviewProblem[]. Pure, defensive. */
export function esbuildMessagesToProblems(
  messages: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } | null }> | undefined,
  tmpDir: string,
): PreviewProblem[] {
  if (!Array.isArray(messages)) return [];
  const out: PreviewProblem[] = [];
  for (const m of messages) {
    if (!m || typeof m.text !== 'string' || !m.text) continue;
    const loc = m.location || undefined;
    out.push({
      file: loc?.file ? normalizeProblemFile(loc.file, tmpDir) : '',
      line: typeof loc?.line === 'number' && loc.line > 0 ? loc.line : 0,
      column: typeof loc?.column === 'number' && loc.column >= 0 ? loc.column : 0,
      message: m.text.slice(0, 1000),
    });
  }
  return out;
}

/** A short human summary like "2 problems" / "1 problem" / "No problems". Pure. */
export function problemsSummary(problems: PreviewProblem[] | null | undefined): string {
  const n = Array.isArray(problems) ? problems.length : 0;
  return n === 0 ? 'No problems' : `${n} problem${n === 1 ? '' : 's'}`;
}

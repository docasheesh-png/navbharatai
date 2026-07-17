// exportSurface — Fix 69 (token-cost autopsy, item #3: incremental build context).
//
// WHY: the fast lane's per-file generation feeds every file the FULL SOURCE of all earlier-tier
// files (dependencyContext, capped 4,000 chars/file). Real build reports (PaisaTrack / LedgerLite /
// HabitTracker, 2026-07-16) showed input tokens 26–45× output — a 30-file app re-sends ~25 sibling
// bodies to every later call (O(n²) growth). But a consumer never needs a sibling's IMPLEMENTATION —
// it needs the EXPORT SURFACE: exact exported names, enum members, type/interface shapes, function
// signatures, component prop types, CSS class names. That is precisely what dependencyContext's own
// instruction tells the model to use.
//
// QUALITY (admin rule: v5.0 may only be ENHANCED): this module extracts that surface from the whole
// file, so it also FIXES a real defect of the old capped dump — `content.slice(0, 4000)` silently cut
// off any export declared past 4,000 chars, hiding it from consumers. Extraction scans the full file,
// so every export is visible regardless of position. Shapes that consumers must copy exactly
// (interfaces, type aliases, enum member lists) are kept in FULL; only implementation bodies are
// dropped. Any file whose surface can't be extracted falls back to the old capped body — by
// construction never worse than today. Kill switch: AGENTV3_SIGNATURE_CONTEXT=off restores the old
// full-body context verbatim.
//
// PURE + dependency-free (line/brace scanning, no TS compiler) — fully unit-testable.

export interface SurfaceFile {
  path: string;
  content: string;
}

/** True when the signature-surface context is enabled (default ON; env kill switch). */
export function signatureContextEnabled(): boolean {
  return process.env.AGENTV3_SIGNATURE_CONTEXT !== 'off';
}

/** Slice a brace-balanced block starting at the line that contains the opening `{`. */
function captureBlock(lines: string[], start: number): { text: string; end: number } {
  let depth = 0;
  let opened = false;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth += 1; opened = true; }
      else if (ch === '}') depth -= 1;
    }
    if (opened && depth <= 0) return { text: out.join('\n'), end: i };
    if (out.length > 400) break; // runaway guard — treat as unparseable
  }
  return { text: out.join('\n'), end: start };
}

/** First line of a declaration, trimmed to the signature (cut the `= …` body of arrows/consts). */
function signatureLine(line: string): string {
  // `export function foo(a: X): Y {` → keep up to the opening brace.
  const brace = line.indexOf('{');
  if (/\bfunction\b|\bclass\b/.test(line) && brace > 0) return `${line.slice(0, brace).trimEnd()} { … }`;
  // `export const useNotes = (a) => …` / `export const MAX = 42;` → keep the head, mark the body.
  const eq = line.indexOf('=');
  if (eq > 0 && !/=>/.test(line.slice(0, eq))) return `${line.slice(0, eq).trimEnd()} = …;`;
  return line.trim();
}

/** Export surface of a TS/TSX/JS/JSX file, or null when nothing recognizable was found. */
export function scriptExportSurface(content: string): string | null {
  const lines = content.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trimStart();
    if (!t.startsWith('export ') && !t.startsWith('export{') && !t.startsWith('export*')) continue;
    // Shapes consumers must copy EXACTLY → keep the FULL declaration (brace-balanced block).
    if (/^export\s+(declare\s+)?(interface|enum)\b/.test(t) || /^export\s+(declare\s+)?type\s+\w+\s*=\s*\{/.test(t)) {
      const block = captureBlock(lines, i);
      out.push(block.text);
      i = block.end;
      continue;
    }
    // One-line type aliases / re-exports / export lists — keep verbatim.
    if (/^export\s+(declare\s+)?type\s+/.test(t) || /^export\s*\{/.test(t) || /^export\s*\*/.test(t)) {
      out.push(line.trim());
      continue;
    }
    // Functions / classes / consts / default exports — signature only, bodies dropped.
    out.push(signatureLine(line.trim()));
  }
  return out.length > 0 ? out.join('\n') : null;
}

/** Export surface of a CSS file: the class/id/var/keyframes vocabulary a consumer may reference. */
export function cssExportSurface(content: string): string | null {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const vars = new Set<string>();
  const keyframes = new Set<string>();
  for (const m of content.matchAll(/(^|[\s,>+~({])\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(m[2]);
  for (const m of content.matchAll(/(^|[\s,>+~({])#([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.add(m[2]);
  for (const m of content.matchAll(/--([A-Za-z_][A-Za-z0-9_-]*)\s*:/g)) vars.add(`--${m[1]}`);
  for (const m of content.matchAll(/@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g)) keyframes.add(m[1]);
  const parts: string[] = [];
  if (classes.size) parts.push(`classes: ${[...classes].join(', ')}`);
  if (ids.size) parts.push(`ids: ${[...ids].join(', ')}`);
  if (vars.size) parts.push(`css vars: ${[...vars].join(', ')}`);
  if (keyframes.size) parts.push(`keyframes: ${[...keyframes].join(', ')}`);
  return parts.length > 0 ? parts.join('\n') : null;
}

/** The export surface of one file, or null when extraction found nothing (caller falls back). */
export function exportSurfaceOf(path: string, content: string): string | null {
  if (typeof content !== 'string' || content.trim().length === 0) return null;
  if (/\.(css|scss)$/i.test(path)) return cssExportSurface(content);
  if (/\.(ts|tsx|js|jsx|mts|cts)$/i.test(path)) return scriptExportSurface(content);
  return null; // html/json/md/etc → caller falls back to the capped body
}

/**
 * The signature-based replacement for dependencyContext: every producer rendered as its export
 * surface (full file scanned — no truncated exports), with a per-file FALLBACK to the old capped
 * body whenever extraction finds nothing (so no file is ever represented WORSE than before).
 * Returns '' when there are no real producers, exactly like dependencyContext. PURE.
 */
export function signatureDependencyContext(producers: SurfaceFile[], perFileCap = 4000): string {
  const real = (producers || []).filter((f) => f && f.path && typeof f.content === 'string');
  if (real.length === 0) return '';
  const dump = real
    .map((f) => {
      const surface = exportSurfaceOf(f.path, f.content);
      const body = surface !== null ? surface.slice(0, Math.max(0, perFileCap)) : f.content.slice(0, Math.max(0, perFileCap));
      return `<<<EXPORTS ${f.path}>>>\n${body}\n<<<ENDEXPORTS>>>`;
    })
    .join('\n\n');
  return [
    '',
    'ALREADY-WRITTEN FILES YOU CAN IMPORT — their REAL export surface (exact exported names, enum',
    'members, type/interface shapes, function signatures, component prop types, CSS class names).',
    'Import ONLY these exact names; do NOT invent or re-case names. Implementation bodies are omitted',
    'on purpose (“{ … }” / “= …;”) — code against these signatures exactly as declared:',
    dump,
  ].join('\n');
}

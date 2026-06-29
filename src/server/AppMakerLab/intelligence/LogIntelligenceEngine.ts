// P-AI.11 — Log / Stack-Trace Intelligence.
//
// Errors reached the repair pass and the build report as raw strings — a TypeScript diagnostic, a
// Vite/esbuild error, or a browser stack trace, all unparsed. This turns that raw text into a
// structured `{ file, line, column, type, message }` so the repair pass can jump straight to the
// failing location and the downloadable build report shows WHERE/WHAT, not just a blob.
//
// Pure, dependency-free, regex-based → unit-tested. Conservative: it only reports a field it can
// actually extract, and never throws.

export interface StructuredError {
  file?: string;
  line?: number;
  column?: number;
  /** Error class / diagnostic code, e.g. TypeError, ReferenceError, SyntaxError, TS2304. */
  type?: string;
  message: string;
}

// A source-file path with a known code extension, e.g. src/App.tsx, ./lib/util.ts.
const FILE_LOC = /([\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte)):(\d+):(\d+)/;
// TypeScript diagnostic: path(line,col): error TS1234: message
const TS_DIAG = /([\w./@-]+)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):\s*(.+)/g;
// A runtime error head: TypeError: x is not a function   |   ReferenceError: y is not defined
const ERR_HEAD = /\b([A-Z][A-Za-z]*(?:Error|Warning|Exception))\b\s*:?\s*(.*)/;

function clip(s: string, n = 300): string {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n) : t;
}

/** Extract the first file:line:col location from text (Vite/esbuild/stack frames). Pure. */
export function parseLocation(text: string): { file: string; line: number; column: number } | null {
  const m = FILE_LOC.exec(String(text || ''));
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
}

/** Extract an error type / diagnostic code from text. Pure. */
export function parseErrorType(text: string): string | undefined {
  const s = String(text || '');
  const ts = /\b(TS\d{3,5})\b/.exec(s);
  if (ts) return ts[1];
  const head = ERR_HEAD.exec(s);
  if (head) return head[1];
  return undefined;
}

/**
 * Parse raw log/error text into structured errors. Picks up TypeScript diagnostics (each becomes its
 * own entry) and, for free-form runtime/build output, a single best-effort entry with whatever
 * location/type can be extracted. Returns [] for empty input. Pure; never throws.
 */
export function parseLogErrors(text: string): StructuredError[] {
  const src = String(text || '');
  if (!src.trim()) return [];
  const out: StructuredError[] = [];
  const seen = new Set<string>();

  // 1) TypeScript diagnostics — structured and unambiguous.
  TS_DIAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TS_DIAG.exec(src))) {
    const e: StructuredError = { file: m[1], line: Number(m[2]), column: Number(m[3]), type: m[4], message: clip(m[5]) };
    const key = `${e.file}:${e.line}:${e.column}:${e.type}`;
    if (!seen.has(key)) { seen.add(key); out.push(e); }
  }
  if (out.length > 0) return out;

  // 2) Free-form runtime/build output — one best-effort structured entry.
  const loc = parseLocation(src);
  const type = parseErrorType(src);
  const headLine = src.split('\n').map((l) => l.trim()).find(Boolean) || '';
  out.push({
    file: loc?.file,
    line: loc?.line,
    column: loc?.column,
    type,
    message: clip(headLine || src),
  });
  return out;
}

/** A compact one-line hint for a structured error: "src/App.tsx:42:10 [TypeError] message". Pure. */
export function errorHint(e: StructuredError): string {
  const where = e.file ? `${e.file}:${e.line ?? '?'}:${e.column ?? '?'} ` : '';
  const what = e.type ? `[${e.type}] ` : '';
  return `${where}${what}${clip(e.message, 200)}`.trim();
}

/** The single best structured error from raw text, or null if none. Pure. */
export function firstStructuredError(text: string): StructuredError | null {
  const errs = parseLogErrors(text);
  return errs.length > 0 ? errs[0] : null;
}

/** A short "[at file:line:col TYPE]" tag for a raw error string, or '' when nothing parses. Pure. */
export function locationTag(text: string): string {
  const e = firstStructuredError(text);
  if (!e) return '';
  if (e.file) return ` [at ${e.file}:${e.line ?? '?'}:${e.column ?? '?'}${e.type ? ' ' + e.type : ''}]`;
  if (e.type) return ` [${e.type}]`;
  return '';
}

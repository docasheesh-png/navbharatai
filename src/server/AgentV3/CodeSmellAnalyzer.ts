// T3 (roadmap 2026-07-19) — Code-smell analyzer (magic numbers + duplicate blocks).
//
// The audit's Code-Quality ❌ included "magic numbers" and "duplicate code" — no analyzer detected either.
// This PURE analyzer scans the workspace source and surfaces both, advisory-only (it never blocks a build):
//   • magic numbers — numeric literals outside a generous allow-list (0/1/2, HTTP codes, time constants),
//     which usually want a named constant,
//   • duplicate blocks — a run of ≥6 identical non-trivial lines appearing in two or more places, which
//     usually wants to be extracted into one shared function.
// Deterministic + dependency-free → unit-tested.

export interface CodeSmellFinding {
  file: string;
  line: number;
  detail: string;
}

export interface CodeSmellReport {
  magicNumbers: CodeSmellFinding[];
  duplicates: CodeSmellFinding[];
}

// Numbers that are almost never "magic" — indices, HTTP status codes, common time/size constants.
const ALLOWED_NUMBERS = new Set([
  '0', '1', '2', '-1', '-2', '3', '4', '5', '10', '12', '24', '60', '100', '1000', '7', '30', '365', '1024',
  '200', '201', '204', '301', '302', '400', '401', '403', '404', '409', '422', '429', '500', '503',
]);

const MIN_DUP_LINES = 6;
const MIN_DUP_CHARS = 120;
const MAX_FINDINGS = 40;

// A standalone number NOT part of an identifier, decimal member, or hex/version (e.g. matches 5000 in
// setTimeout(fn, 5000) but not the 2 in v2 or the 16 in 0x10ff).
const NUMBER_RE = /(?<![\w.$])-?\d+(?:\.\d+)?(?![\w.])/g;

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#');
}

/** Normalize a line for duplicate detection: trim + collapse internal whitespace. */
function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/** Detect magic numbers + duplicate blocks across the given source files. Pure. */
export function analyzeCodeSmells(files: Array<{ path: string; content: string }>): CodeSmellReport {
  const magicNumbers: CodeSmellFinding[] = [];
  const duplicates: CodeSmellFinding[] = [];

  // ── magic numbers ────────────────────────────────────────────────────────────────────────────────
  for (const f of files || []) {
    if (!f || typeof f.content !== 'string') continue;
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const matches = line.match(NUMBER_RE);
      if (!matches) continue;
      for (const m of matches) {
        if (ALLOWED_NUMBERS.has(m)) continue;
        // a lone number with a decimal point but tiny (like 0.5) is usually fine; skip <=2 magnitude
        const val = Math.abs(Number(m));
        if (!Number.isFinite(val) || val <= 2) continue;
        magicNumbers.push({ file: f.path, line: i + 1, detail: `magic number ${m} — consider a named constant` });
        if (magicNumbers.length >= MAX_FINDINGS) break;
      }
      if (magicNumbers.length >= MAX_FINDINGS) break;
    }
    if (magicNumbers.length >= MAX_FINDINGS) break;
  }

  // ── duplicate blocks ─────────────────────────────────────────────────────────────────────────────
  // Build windows of MIN_DUP_LINES consecutive NON-trivial (non-blank, non-comment) normalized lines,
  // keyed by their joined text; a key seen in ≥2 places (with enough total characters) is a duplicate.
  const seen = new Map<string, { file: string; line: number }>();
  const reported = new Set<string>();
  for (const f of files || []) {
    if (!f || typeof f.content !== 'string') continue;
    const raw = f.content.split('\n');
    // keep only substantive lines but remember their original 1-based line numbers
    const kept: Array<{ norm: string; line: number }> = [];
    for (let i = 0; i < raw.length; i++) {
      if (!raw[i].trim() || isCommentLine(raw[i])) continue;
      kept.push({ norm: normalize(raw[i]), line: i + 1 });
    }
    for (let i = 0; i + MIN_DUP_LINES <= kept.length; i++) {
      const windowLines = kept.slice(i, i + MIN_DUP_LINES);
      const key = windowLines.map((k) => k.norm).join('\n');
      if (key.length < MIN_DUP_CHARS) continue;
      const prev = seen.get(key);
      if (prev) {
        const dedupKey = key;
        if (!reported.has(dedupKey)) {
          reported.add(dedupKey);
          duplicates.push({
            file: f.path,
            line: windowLines[0].line,
            detail: `duplicate of ${prev.file}:${prev.line} (${MIN_DUP_LINES}+ identical lines) — extract a shared function`,
          });
          if (duplicates.length >= MAX_FINDINGS) break;
        }
      } else {
        seen.set(key, { file: f.path, line: windowLines[0].line });
      }
    }
    if (duplicates.length >= MAX_FINDINGS) break;
  }

  return { magicNumbers, duplicates };
}

/** Render the report as a compact, human-readable block. Pure. */
export function renderCodeSmells(report: CodeSmellReport): string {
  const parts: string[] = [];
  if (report.magicNumbers.length === 0 && report.duplicates.length === 0) {
    return 'No magic numbers or duplicate blocks detected.';
  }
  if (report.magicNumbers.length) {
    parts.push(`Magic numbers (${report.magicNumbers.length}):`);
    for (const m of report.magicNumbers.slice(0, 20)) parts.push(`  ${m.file}:${m.line} — ${m.detail}`);
  }
  if (report.duplicates.length) {
    parts.push(`Duplicate blocks (${report.duplicates.length}):`);
    for (const d of report.duplicates.slice(0, 20)) parts.push(`  ${d.file}:${d.line} — ${d.detail}`);
  }
  parts.push('Advisory only — these never block a build.');
  return parts.join('\n');
}

// AgentV3 — deterministic credential-log redaction (DNA fix, SaaS-dashboard autopsy 2026-07-22).
//
// THE ROOT CAUSE this closes: the readiness gate's ONLY high-severity privacy/compliance finding is
// `pii-in-logs` — a `console.*(...)` line that logs a credential/token (password/otp/secret/apiKey/…).
// A single such line hard-caps the build's confidence score (BuildConfidence.hardBlock) and forces a
// NOT-READY verdict → the build is marked failed. So a complete, working app was being killed by ONE
// mechanically-fixable debug log (a real leak, but never load-bearing app logic). There was NO heal for
// it: the gate detected and blocked, and nothing repaired it.
//
// THE FIX (50/50 law): this is the last-line-of-defence, 100%-RELIABLE deterministic heal. A debug log
// that prints a credential is never app logic, so stripping its arguments both (a) removes the real
// data-protection leak and (b) unblocks the build — never a cosmetic patch, an actual security fix.
//
// SAFETY (the one absolute rule — never break the app): the transform is provably non-breaking. It ONLY
// rewrites a console statement when ALL hold: the line begins (after indentation) with `console.<method>(`
// (a standalone statement, not `x = console…` or `foo(console.log(…))`), the call's parentheses BALANCE
// on that single line (a multi-line call → left untouched), and the line contains no backtick/template
// literal (whose `${…}` nesting a single-line scan can't safely bound). Anything ambiguous is SKIPPED,
// leaving the honest finding — i.e. today's behaviour. The rewrite keeps the call (`console.log()`), so
// the statement stays syntactically valid; only the leaked arguments are dropped. Idempotent: the result
// has no sensitive token, so it is never re-flagged or re-transformed.
//
// Kill switch: AGENTV3_CRED_LOG_GUARD=off (default on). Pure — no I/O; the caller persists the result.

import { CODE_EXT, SKIP_PATH, lineLogsCredential, CONSOLE_CALL } from './ComplianceAnalysis';

export interface CredentialLogRedaction {
  file: string;
  line: number; // 1-indexed
  before: string;
  after: string;
}

export interface CredentialLogRedactionResult {
  /** New file map with credential logs redacted (unchanged files share the original reference). */
  files: Record<string, string>;
  redactions: CredentialLogRedaction[];
}

/**
 * Redact ONE line if it is a standalone, single-line, paren-balanced `console.<method>(...)` statement
 * that logs a credential. Returns the rewritten line, or null when it cannot be transformed safely
 * (multi-line call, not statement-leading, contains a template literal) — null ⇒ caller leaves it as-is.
 */
export function redactCredentialLogLine(line: string): string | null {
  if (!lineLogsCredential(line)) return null;
  // A template literal's `${…}` can nest arbitrary parens/quotes that a single-line scan can't bound
  // safely — never risk mangling it; leave the honest finding instead.
  if (line.includes('`')) return null;

  // Must be a STANDALONE console statement: only indentation before `console.<method>(`.
  const head = /^(\s*)console\.(log|info|warn|error|debug)\s*\(/.exec(line);
  if (!head) return null;
  const indent = head[1];
  const method = head[2];
  const openIdx = line.indexOf('(', head[0].length - 1);
  if (openIdx < 0) return null;

  // Balanced-paren scan across the single line, string-aware, to find the matching close paren.
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let closeIdx = -1;
  for (let i = openIdx; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  // Never closed on this line (multi-line call) or a dangling string → cannot transform safely.
  if (closeIdx < 0 || quote) return null;

  const after = `${indent}console.${method}()${line.slice(closeIdx + 1)}`;
  // Guard the invariant: the rewrite must actually clear the finding and must not re-open it.
  if (lineLogsCredential(after)) return null;
  if (after === line) return null;
  return after;
}

/**
 * Scan every source file and deterministically redact credential-logging console statements.
 * Pure: returns a new file map (untouched files keep their original reference) plus the list of
 * redactions for honest diagnostics. HTML files are scanned too (inline `<script>` logs).
 */
export function redactCredentialLogs(files: Record<string, string>): CredentialLogRedactionResult {
  const out: Record<string, string> = { ...files };
  const redactions: CredentialLogRedaction[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    if (!CODE_EXT.test(file) || SKIP_PATH.test(file)) continue;
    // Cheap pre-filter: skip files that cannot contain the finding.
    if (!CONSOLE_CALL.test(content)) continue;
    const lines = content.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const fixed = redactCredentialLogLine(lines[i]);
      if (fixed !== null) {
        redactions.push({ file, line: i + 1, before: lines[i].trim(), after: fixed.trim() });
        lines[i] = fixed;
        changed = true;
      }
    }
    if (changed) out[file] = lines.join('\n');
  }
  return { files: out, redactions };
}

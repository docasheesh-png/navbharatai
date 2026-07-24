// Full-App Debugger — LLM semantic-analysis core + finding merge/rank (admin request 2026-07-24).
//
// This is layer 2 of the Full-App Debugger (layer 1 = the deterministic appStaticScan). It reads the
// ACTUAL contents of the project's real source files and asks the FREE-tier AI chain to report deeper,
// semantic problems the regex scanner cannot see (broken logic, race conditions, missing error
// handling, insecure flows, wrong async usage, dead/unreachable code, …) — each anchored to file+line
// with a concrete fix suggestion.
//
// HONESTY: the AI pass reads a PRIORITISED, budget-bounded subset of files (source code first); the
// static pass covers every file. The route reports exactly how many files each layer saw, so a large
// app is never silently under-scanned — the cap is surfaced, not hidden.
//
// WHITE-LABEL: the system prompt brands the assistant as "NavBharatAI" and forbids naming any
// underlying model/vendor, so nothing the user sees can leak provider identity.
//
// Pure (no I/O, no LLM call here) → fully unit-testable. The route wires these to the AI router.

import { SKIP_DIR_RE, JUNK_FILE_RE, SECRET_FILE_RE, BINARY_EXT_RE } from '../AgentV3/ProjectImport';
import type { FindingSeverity, StaticFinding } from './appStaticScan';

export interface AppFinding {
  severity: FindingSeverity;
  file: string;
  line?: number;
  category: string;
  problem: string;
  suggestion: string;
  /** 'static'/'graph' = deterministic (always real); 'ai' = semantic model pass. */
  source: 'static' | 'graph' | 'ai';
}

export interface DebugScanMeta {
  filesTotal: number;
  filesStaticScanned: number;
  filesAiScanned: number;
  /** AI-pass files dropped purely because of the token budget (honest truncation signal). */
  filesAiSkippedForBudget: number;
  bytesAiScanned: number;
}

export interface ProjectHealth {
  /** 0–100, where 100 is a clean app. Heuristic, computed from weighted severity vs. size. */
  score: number;
  verdict: string;
  topCategories: Array<{ category: string; count: number }>;
}

export interface DebugScanSummary extends DebugScanMeta {
  counts: Record<FindingSeverity, number>;
  total: number;
  health: ProjectHealth;
}

const HEALTH_WEIGHT: Record<FindingSeverity, number> = { critical: 12, high: 6, medium: 2, low: 0.5 };

/**
 * A project HEALTH score (0–100) + a plain-language verdict + the top problem categories. Honest
 * heuristic: it weights findings by severity against the app's size (so a big app isn't unfairly
 * punished, and a tiny app isn't over-penalized per file). Pure + tested.
 */
export function computeHealth(findings: AppFinding[], filesScanned: number): ProjectHealth {
  let penalty = 0;
  const byCat = new Map<string, number>();
  for (const f of findings) {
    penalty += HEALTH_WEIGHT[f.severity] ?? 1;
    byCat.set(f.category, (byCat.get(f.category) || 0) + 1);
  }
  const denom = Math.max(8, filesScanned); // small apps: don't over-weight per-file
  const score = Math.max(0, Math.min(100, Math.round(100 - (penalty / denom) * 20)));
  const verdict =
    findings.length === 0 ? 'Clean — no problems found' :
    score >= 90 ? 'Excellent — very few issues' :
    score >= 75 ? 'Good — minor issues to tidy up' :
    score >= 50 ? 'Needs attention — several real issues' :
    score >= 25 ? 'Poor — many issues; fix the criticals first' :
    'Critical — serious problems to address';
  const topCategories = [...byCat.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { score, verdict, topCategories };
}

/** How many files the AI pass reads at most, and its char budgets. Tunable via env without a deploy. */
function num(env: string, def: number): number {
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v > 0 ? v : def;
}
export const AI_MAX_FILES = () => num('APP_DEBUG_AI_MAX_FILES', 45);
export const AI_MAX_TOTAL_CHARS = () => num('APP_DEBUG_AI_MAX_CHARS', 130_000);
export const AI_BATCH_CHARS = () => num('APP_DEBUG_AI_BATCH_CHARS', 26_000);
/** A single file bigger than this is truncated for the AI pass (its head carries the most signal). */
export const AI_MAX_FILE_CHARS = () => num('APP_DEBUG_AI_MAX_FILE_CHARS', 20_000);

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|php|java|kt|swift|c|cc|cpp|h|hpp|cs|vue|svelte)$/i;
const CONFIG_RE = /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.[jt]s|next\.config\.[jt]s|webpack\.config\.[jt]s|\.eslintrc[^/]*|Dockerfile|docker-compose\.ya?ml|[^/]*\.ya?ml|firebase\.json|firestore\.rules)$/i;
const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|py|rb|go|rs|php|java|kt|swift|c|cc|cpp|h|hpp|cs|sql|ya?ml|xml|html|css|scss|vue|svelte|toml|ini|env\.example)$/i;

/**
 * A file the AI pass may read: real text/code, not a build artifact, junk, secret file, or binary.
 * Secret files (.env, keys) are excluded on purpose — never send credentials to the model.
 */
export function isAnalyzableFile(path: string): boolean {
  if (!path) return false;
  if (SKIP_DIR_RE.test(path) || JUNK_FILE_RE.test(path) || SECRET_FILE_RE.test(path) || BINARY_EXT_RE.test(path)) {
    return false;
  }
  const base = path.split('/').pop() || path;
  return TEXT_EXT_RE.test(path) || base === 'Dockerfile' || CONFIG_RE.test(path);
}

/** Lower number = read earlier. Source code first, then config, then everything else. */
export function filePriority(path: string): number {
  if (/\.(test|spec)\./.test(path)) return 5; // tests are lowest-value for a bug scan
  if (CONFIG_RE.test(path)) return 1;          // check before source: vite.config.ts is config, not source
  if (SOURCE_EXT_RE.test(path)) return 0;
  if (/\.(sql|html|css|scss)$/i.test(path)) return 2;
  return 3;
}

export interface SelectedBatch {
  files: Array<{ path: string; content: string }>;
}

export interface FileSelection {
  batches: SelectedBatch[];
  picked: string[];
  analyzableTotal: number;
  skippedForBudget: number;
  bytesAiScanned: number;
}

/**
 * Choose + order the files the AI pass reads, then split them into char-bounded batches. Deterministic:
 * priority first, then path A→Z, so the same app always scans in the same order (stable, testable).
 */
export function selectFilesForAI(files: Record<string, string>): FileSelection {
  const analyzable = Object.keys(files || {})
    .filter((p) => isAnalyzableFile(p) && typeof files[p] === 'string');
  analyzable.sort((a, b) => filePriority(a) - filePriority(b) || (a < b ? -1 : a > b ? 1 : 0));

  const maxFiles = AI_MAX_FILES();
  const maxTotal = AI_MAX_TOTAL_CHARS();
  const maxFileChars = AI_MAX_FILE_CHARS();
  const batchChars = AI_BATCH_CHARS();

  const picked: string[] = [];
  const batches: SelectedBatch[] = [];
  let current: SelectedBatch = { files: [] };
  let currentChars = 0;
  let totalChars = 0;

  for (const path of analyzable) {
    if (picked.length >= maxFiles || totalChars >= maxTotal) break;
    let content = files[path];
    if (content.length > maxFileChars) {
      content = content.slice(0, maxFileChars) + `\n/* … file truncated at ${maxFileChars} chars for analysis … */\n`;
    }
    if (totalChars + content.length > maxTotal && picked.length > 0) break;

    if (currentChars + content.length > batchChars && current.files.length > 0) {
      batches.push(current);
      current = { files: [] };
      currentChars = 0;
    }
    current.files.push({ path, content });
    picked.push(path);
    currentChars += content.length;
    totalChars += content.length;
  }
  if (current.files.length > 0) batches.push(current);

  return {
    batches,
    picked,
    analyzableTotal: analyzable.length,
    skippedForBudget: Math.max(0, analyzable.length - picked.length),
    bytesAiScanned: totalChars,
  };
}

/** The white-label debugger persona + strict JSON-array output contract. */
export function buildAppDebugSystemPrompt(): string {
  return `You are NavBharatAI's Full-App Debugger — an expert code auditor built into NavBharatAI.
IDENTITY RULE: you are simply "NavBharatAI". NEVER mention any underlying AI model, engine, or vendor name.

TASK: you are given real source files from ONE app. Read them carefully and report GENUINE problems:
real bugs, broken or missing logic, unhandled errors, race conditions, insecure patterns, wrong async
usage, dead/unreachable code, incorrect state updates, missing validation, and similar defects.

RULES:
- Report ONLY real, concrete problems you can point to. If a file is fine, say nothing about it — NEVER
  invent problems or pad the list to look thorough. An honest short list beats a padded one.
- Anchor every finding to the exact file path and the line number where it occurs.
- Give a specific, actionable fix suggestion for each (what to change), not a generic lecture.
- Do NOT report pure formatting/style preferences. Focus on correctness, security, and reliability.

LANGUAGE: write "problem" and "suggestion" in the same language style the user tends to use (Hindi,
Hinglish, or English); keep any code in professional English.

OUTPUT FORMAT (MANDATORY): reply with ONLY a JSON array, no markdown fences, no prose around it:
[
  {
    "severity": "critical" | "high" | "medium" | "low",
    "file": "exact/path/from/the/input",
    "line": <integer line number>,
    "category": "short-kebab-category, e.g. logic, security, error-handling, async, state, validation",
    "problem": "one or two sentences naming the exact defect",
    "suggestion": "the concrete fix"
  }
]
If you find NO real problems in the given files, reply with exactly: []`;
}

/** Build one batch's user prompt: each file with a header and 1-based line-numbered body (bounded). */
export function buildAppDebugBatchPrompt(batch: SelectedBatch): string {
  const parts: string[] = [
    'Analyze these files and return the JSON array of real findings (or [] if none). Use the shown line numbers when citing a line.',
  ];
  for (const f of batch.files) {
    const numbered = f.content.split('\n').map((ln, i) => `${i + 1}\t${ln}`).join('\n');
    parts.push(`===== FILE: ${f.path} =====\n${numbered}`);
  }
  return parts.join('\n\n');
}

const clampStr = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';

function normalizeSeverity(v: unknown): FindingSeverity {
  const s = String(v || '').toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  if (s === 'error' || s === 'severe' || s === 'blocker') return 'high';
  if (s === 'warning' || s === 'warn' || s === 'minor') return 'low';
  return 'medium';
}

/**
 * Parse the model's reply into AppFindings. Tolerates ```json fences, a leading sentence, or a single
 * object instead of an array. HONESTY: a finding with no problem text is dropped rather than shown as
 * an empty card; an unparseable reply yields [] (the route reports the pass produced nothing, not a
 * fabricated result). `allowedPaths` (when given) maps a cited path back to a real input path.
 */
export function parseAiFindings(text: string, allowedPaths?: string[]): AppFinding[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const candidates: string[] = [unfenced];
  const firstBracket = unfenced.indexOf('[');
  const lastBracket = unfenced.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(unfenced.slice(firstBracket, lastBracket + 1));
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(`[${unfenced.slice(firstBrace, lastBrace + 1)}]`);

  const allowed = allowedPaths && allowedPaths.length ? new Set(allowedPaths) : null;
  const byBase = allowed ? new Map(allowedPaths!.map((p) => [p.split('/').pop() || p, p])) : null;

  for (const c of candidates) {
    let parsed: unknown;
    try { parsed = JSON.parse(c); } catch { continue; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const out: AppFinding[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const problem = clampStr(o.problem ?? o.issue ?? o.message ?? o.description, 1_000);
      if (!problem) continue; // never surface an empty finding
      let file = clampStr(o.file ?? o.path ?? o.filename, 400);
      if (allowed && file && !allowed.has(file)) {
        const mapped = byBase!.get(file.split('/').pop() || file);
        if (mapped) file = mapped;
      }
      const lineNum = Number(o.line ?? o.lineNumber ?? o.ln);
      out.push({
        severity: normalizeSeverity(o.severity ?? o.level),
        file: file || '(unspecified)',
        line: Number.isInteger(lineNum) && lineNum > 0 ? lineNum : undefined,
        category: clampStr(o.category ?? o.type, 60) || 'general',
        problem,
        suggestion: clampStr(o.suggestion ?? o.fix ?? o.recommendation, 1_000),
        source: 'ai',
      });
    }
    if (out.length || Array.isArray(parsed)) return out; // a valid [] means "no findings" — honour it
  }
  return [];
}

/** Stable dedupe key. Deterministic static findings win over an AI finding at the same spot. */
function findingKey(f: AppFinding): string {
  return `${f.file}::${f.line ?? '?'}::${f.category.toLowerCase()}`;
}

/**
 * Merge the deterministic + AI findings: static findings take precedence at a shared (file,line,
 * category) spot, near-duplicate AI findings are dropped, and the result is ranked most-severe first,
 * then by file, then by line. Pure + stable.
 */
export function mergeFindings(deterministicFindings: Array<StaticFinding | AppFinding>, aiFindings: AppFinding[]): AppFinding[] {
  const seen = new Set<string>();
  const merged: AppFinding[] = [];
  for (const f of deterministicFindings as AppFinding[]) {
    const k = findingKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(f);
  }
  for (const f of aiFindings) {
    const k = findingKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(f);
  }
  merged.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    (a.line ?? 0) - (b.line ?? 0));
  return merged;
}

/** Roll findings + scan metadata into the summary the client renders (honest counts + health). */
export function summarizeScan(findings: AppFinding[], meta: DebugScanMeta): DebugScanSummary {
  const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return { ...meta, counts, total: findings.length, health: computeHealth(findings, meta.filesStaticScanned) };
}

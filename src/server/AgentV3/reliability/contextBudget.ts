/**
 * P3 — MEMORY: COMPACT BY TOKEN BUDGET, NOT BY MESSAGE COUNT (fix/build-reliability).
 *
 * Before: every turn, every message older than the last 6 had its tool results cut to 2,000 chars —
 * on turn 7 of a build, with the context window 5% full. The model then re-read files it had just
 * written, or edited from a stale memory of them (edit_file "old_string not found"). Claude Code /
 * Codex keep the transcript verbatim until the window is genuinely filling.
 *
 * AGENTV3_TOKEN_COMPACT=on:
 *   • below AGENTV3_COMPACT_TRIGGER_PCT (default 50) % of the build's SMALLEST ladder window
 *     (AGENTV3_COMPACT_WINDOW_TOKENS, default 128,000 — GLM's, the smallest on the weak ladder), the
 *     transcript goes out verbatim (only a runaway single tool dump is still capped);
 *   • above it, compaction runs with HIGHER thresholds first (AGENTV3_TOKEN_COMPACT_KEEP_RECENT,
 *     default 12 messages; AGENTV3_TOKEN_COMPACT_MAX_CHARS, default 6,000), and only if that is still
 *     over the trigger, with the old tight ones (6 / 2,000).
 *
 * AGENTV3_WORKING_SET=on: the CURRENT on-disk content of the files touched most recently is appended
 * as the last thing the model reads, so an edit is made against the file as it is, not as remembered.
 * PURE except for the caller-supplied file reader.
 */
import { reliabilityFlag, reliabilityInt } from './flags';

export interface TokenCompactConfig {
  windowTokens: number;
  triggerPct: number;
  keepRecent: number;
  maxChars: number;
}

export function tokenCompactConfig(env: NodeJS.ProcessEnv = process.env): TokenCompactConfig {
  return {
    windowTokens: reliabilityInt('AGENTV3_COMPACT_WINDOW_TOKENS', 128_000, 8_000, env),
    triggerPct: Math.min(95, reliabilityInt('AGENTV3_COMPACT_TRIGGER_PCT', 50, 10, env)),
    keepRecent: reliabilityInt('AGENTV3_TOKEN_COMPACT_KEEP_RECENT', 12, 2, env),
    maxChars: reliabilityInt('AGENTV3_TOKEN_COMPACT_MAX_CHARS', 6_000, 500, env),
  };
}

/** Rough token count of an arbitrary transcript: every string it carries, /4. Cheap, never throws. */
export function roughTokens(value: unknown, depth = 0): number {
  if (depth > 8 || value === null || value === undefined) return 0;
  if (typeof value === 'string') return Math.ceil(value.length / 4);
  if (typeof value === 'number' || typeof value === 'boolean') return 1;
  if (Array.isArray(value)) {
    let t = 0;
    for (const v of value) t += roughTokens(v, depth + 1);
    return t;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // An image is billed by the provider at a fixed-ish cost, not by its base64 length.
    if (o.type === 'image') return 1_600;
    let t = 4;
    for (const k of Object.keys(o)) t += roughTokens(o[k], depth + 1);
    return t;
  }
  return 0;
}

type CompactFn = (messages: unknown[], opts: { keepRecentMessages?: number; maxOldToolResultChars?: number }) => unknown[];

export interface BudgetCompactResult {
  messages: unknown[];
  /** 'none' (under budget), 'gentle' (higher thresholds), 'tight' (old thresholds). */
  level: 'none' | 'gentle' | 'tight';
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Compact only when the transcript (+ system prompt) passes the trigger. `compact` is
 * `compactTranscriptForModel` — injected so this stays pure and testable.
 */
export function compactForBudget(messages: unknown[], systemChars: number, compact: CompactFn, cfg: TokenCompactConfig = tokenCompactConfig()): BudgetCompactResult {
  const trigger = Math.floor((cfg.windowTokens * cfg.triggerPct) / 100);
  const sys = Math.ceil(systemChars / 4);
  const before = roughTokens(messages) + sys;
  if (before <= trigger) {
    // Verbatim, except a single runaway tool dump (the existing 40k recent cap) — keepRecent = all.
    const out = compact(messages, { keepRecentMessages: messages.length, maxOldToolResultChars: cfg.maxChars });
    return { messages: out, level: 'none', tokensBefore: before, tokensAfter: roughTokens(out) + sys };
  }
  const gentle = compact(messages, { keepRecentMessages: cfg.keepRecent, maxOldToolResultChars: cfg.maxChars });
  const g = roughTokens(gentle) + sys;
  if (g <= trigger) return { messages: gentle, level: 'gentle', tokensBefore: before, tokensAfter: g };
  const tight = compact(messages, { keepRecentMessages: 6, maxOldToolResultChars: 2_000 });
  return { messages: tight, level: 'tight', tokensBefore: before, tokensAfter: roughTokens(tight) + sys };
}

export function tokenCompactEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('TOKEN_COMPACT', env);
}

export function workingSetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('WORKING_SET', env);
}

export interface WorkingSetConfig {
  files: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
}

export function workingSetConfig(env: NodeJS.ProcessEnv = process.env): WorkingSetConfig {
  return {
    files: reliabilityInt('AGENTV3_WORKING_SET_FILES', 4, 1, env),
    maxCharsPerFile: reliabilityInt('AGENTV3_WORKING_SET_FILE_CHARS', 12_000, 1_000, env),
    maxTotalChars: reliabilityInt('AGENTV3_WORKING_SET_TOTAL_CHARS', 32_000, 2_000, env),
  };
}

/** The text block that carries the fresh files. Empty string when there is nothing to show. */
export function workingSetBlock(files: ReadonlyArray<{ path: string; content: string }>, cfg: WorkingSetConfig = workingSetConfig()): string {
  const parts: string[] = [];
  let total = 0;
  for (const f of files.slice(0, cfg.files)) {
    let body = f.content;
    if (body.length > cfg.maxCharsPerFile) body = `${body.slice(0, cfg.maxCharsPerFile)}\n… [file continues — read_file with start_line/end_line for the rest]`;
    if (total + body.length > cfg.maxTotalChars) break;
    total += body.length;
    parts.push(`--- ${f.path} (${f.content.split('\n').length} lines, current on disk) ---\n${body}`);
  }
  if (!parts.length) return '';
  return [
    '📂 WORKING SET (platform note) — the CURRENT content of the files you touched most recently.',
    'This is the truth on disk right now; when an edit_file old_string must match, copy it from here.',
    ...parts,
  ].join('\n');
}

/**
 * Return a NEW array whose last user message carries the working-set block at its end. Never mutates
 * the input (the stored transcript must not accumulate a copy per turn). No-op when the last message
 * is not a user turn.
 */
export function withWorkingSet(messages: unknown[], block: string): unknown[] {
  if (!block || messages.length === 0) return messages;
  const last = messages[messages.length - 1] as { role?: unknown; content?: unknown } | null;
  if (!last || last.role !== 'user') return messages;
  const content = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }, { type: 'text', text: block }]
    : Array.isArray(last.content) ? [...last.content, { type: 'text', text: block }] : null;
  if (!content) return messages;
  return [...messages.slice(0, -1), { ...last, content }];
}

/** Most-recent-first unique list of paths written/edited in the transcript's tool calls. */
export function recentlyTouchedPaths(messages: unknown[], limit: number): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const blocks = m.content as Array<{ type?: string; name?: string; input?: unknown }>;
    for (let j = blocks.length - 1; j >= 0 && out.length < limit; j--) {
      const b = blocks[j];
      if (b?.type !== 'tool_use') continue;
      if (b.name === 'write_file' || b.name === 'edit_file' || b.name === 'append_file') {
        const p = (b.input as { path?: unknown })?.path;
        if (typeof p === 'string' && p && !out.includes(p)) out.push(p);
      } else if (b.name === 'write_files_batch') {
        const files = (b.input as { files?: unknown })?.files;
        if (Array.isArray(files)) {
          for (let k = files.length - 1; k >= 0 && out.length < limit; k--) {
            const p = (files[k] as { path?: unknown })?.path;
            if (typeof p === 'string' && p && !out.includes(p)) out.push(p);
          }
        }
      }
    }
  }
  return out;
}

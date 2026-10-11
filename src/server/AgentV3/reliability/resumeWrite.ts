/**
 * P2b — RESUME A TRUNCATED WRITE INSTEAD OF REWRITING IT (fix/build-reliability, AGENTV3_RESUME_TRUNCATED).
 *
 * When a write_file is cut at the output ceiling, its JSON arguments no longer parse. Until now the
 * adapter salvaged only the PATH and the loop asked for the whole file again — which, for a file that
 * did not fit once, usually does not fit the second time either (report cc8c9075: two 158-second
 * calls, same failure). bolt.diy solves this with "continue from where you stopped".
 *
 * With the flag on:
 *   1. the adapter also salvages the PARTIAL content (`_partial_content`) — decoded exactly as JSON
 *      would, minus any half-written escape at the cut;
 *   2. the dispatcher NEVER writes it to disk; it holds it in a per-build pending buffer and tells the
 *      model where it stopped;
 *   3. the model finishes with `append_file` (`done: true` on the last part). Only then is the whole
 *      file written — through write_file, so every write guard still runs on the complete content.
 * A partial file can therefore never be persisted, previewed or typechecked.
 */
import { reliabilityFlag } from './flags';
import type { ClaudeToolDef } from '../ClaudeClient';

export const PARTIAL_CONTENT_KEY = '_partial_content';

export function resumeTruncatedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('RESUME_TRUNCATED', env);
}

/**
 * Recover the partial `content` string from a write_file arguments JSON that was cut mid-string.
 * Returns null when there is no content field. PURE.
 */
export function salvageTruncatedContent(args: string | undefined): string | null {
  if (!args) return null;
  const m = /"content"\s*:\s*"/.exec(args);
  if (!m) return null;
  let raw = args.slice(m.index + m[0].length);
  // If the string actually closed (the cut came later, e.g. in another field), keep only its body.
  let end = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"') { end = i; break; }
  }
  if (end >= 0) raw = raw.slice(0, end);
  // Drop a half-written escape at the cut: a lone trailing backslash, or an incomplete \uXXXX.
  raw = raw.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/(^|[^\\])((?:\\\\)*)\\$/, '$1$2');
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

export const APPEND_FILE_TOOL: ClaudeToolDef = {
  name: 'append_file',
  description:
    'Append text to the end of a file. Use it to FINISH a write_file that was cut off (the platform tells ' +
    'you exactly where it stopped — continue from the very next character, do not repeat anything), or to ' +
    'build a long file in parts. Set done:true on the LAST part; a cut-off write is only saved to disk then.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      content: { type: 'string', description: 'The text to append, starting exactly where the previous part ended.' },
      done: { type: 'boolean', description: 'true when this is the last part and the file is complete.' },
    },
    required: ['path', 'content'],
  },
};

/** The tool result the model reads when its write was cut off and buffered. */
export function truncatedWriteNotice(path: string, partial: string): string {
  const lines = partial.split('\n');
  const tail = partial.slice(-240);
  return [
    `⚠️ write_file ${path} was CUT OFF by the output limit after ${partial.length} chars (${lines.length} lines). It was NOT saved — the partial text is held in a buffer.`,
    'Finish it with append_file: continue from the very next character after the text below (do not repeat it), and pass done:true on the last part.',
    'If the remaining part is large, split it across several append_file calls (each well under ~150 lines).',
    '--- the buffered text ENDS with ---',
    tail,
    '--- (end) ---',
  ].join('\n');
}

/** The pending-write buffer: path → text so far. One per dispatcher (= per build). */
export class PendingWrites {
  private readonly buf = new Map<string, string>();
  start(path: string, partial: string): void { this.buf.set(path, partial); }
  has(path: string): boolean { return this.buf.has(path); }
  append(path: string, more: string): string {
    const next = (this.buf.get(path) ?? '') + more;
    this.buf.set(path, next);
    return next;
  }
  take(path: string): string | undefined {
    const v = this.buf.get(path);
    this.buf.delete(path);
    return v;
  }
  /** A fresh whole-file write supersedes the buffer. */
  drop(path: string): void { this.buf.delete(path); }
  paths(): string[] { return [...this.buf.keys()]; }
}

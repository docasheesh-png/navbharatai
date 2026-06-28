// AgentV3 — Project memory context for the build prompt (Claude-level continuity).
//
// A new message used to start the build loop with ONLY the new prompt, so a follow-up like
// "continue" had no idea what was being built → the model replied "what would you like me to
// continue with?". This builds a compact CONTEXT block — the current files, the project map, and
// the recent user requests — that is prepended to the build prompt so the agent KNOWS it is
// continuing an existing project and resumes instead of asking. Pure + dependency-free (testable).

export interface ProjectContextInput {
  /** Current workspace file paths (the durable, cross-instance signal of what exists). */
  files: string[];
  /** WorkspaceMemory.projectMap() output (components/routes/deps/recent errors) — may be ''. */
  projectMap?: string;
  /** Recent user requests in this session (oldest→newest), e.g. "build a calculator". */
  recentRequests?: string[];
}

const HEAVY = /^(node_modules|\.git|dist|build|\.next|__pycache__|coverage)\//;

/**
 * Build the project-memory context block, or '' when there is genuinely nothing to remember
 * (a brand-new empty workspace). Caller prepends it to the build prompt.
 */
export function buildProjectContext(input: ProjectContextInput): string {
  const files = (input.files ?? []).filter((p) => p && !HEAVY.test(p)).slice(0, 60);
  const requests = (input.recentRequests ?? []).map((r) => r.trim()).filter(Boolean);
  const map = (input.projectMap ?? '').trim();
  if (files.length === 0 && requests.length === 0 && !map) return '';

  const lines: string[] = [];
  lines.push('[PROJECT MEMORY — you are CONTINUING an existing project in this session, NOT starting from scratch.]');
  if (files.length) {
    lines.push('');
    lines.push(`The workspace already contains these ${files.length} file(s) — edit/extend them, do not recreate the project:`);
    lines.push(files.map((f) => `  - ${f}`).join('\n'));
  }
  if (map) {
    lines.push('');
    lines.push(map);
  }
  if (requests.length) {
    lines.push('');
    lines.push('What the user asked for earlier in this session (most recent last):');
    lines.push(requests.slice(-6).map((r) => `  - ${r.slice(0, 200)}`).join('\n'));
  }
  lines.push('');
  lines.push('Use this context as your memory. Do NOT ask "what would you like me to continue with" — read the files above and CONTINUE the same project. If the user just said "continue", resume building/fixing exactly this project from where it was left.');
  return lines.join('\n');
}

/**
 * Summarize a prior build transcript (raw Anthropic messages) into a short, readable
 * "User: … / You: …" recap of the last `maxTurns` turns — so the model REMEMBERS the
 * conversation (what was asked, what it did) on a follow-up. Tool calls are noted compactly;
 * tool results are skipped (noisy). Pure + exported for testing.
 */
export function extractConversationSummary(messages: unknown[], maxTurns = 8): string {
  const turns: string[] = [];
  for (const m of messages ?? []) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const b of content) {
        if (b && typeof b === 'object') {
          const bb = b as { type?: string; text?: string; name?: string };
          if (bb.type === 'text' && typeof bb.text === 'string') parts.push(bb.text);
          else if (bb.type === 'tool_use' && bb.name) parts.push(`[called ${bb.name}]`);
          // tool_result blocks are intentionally skipped — too noisy for a recap.
        }
      }
      text = parts.join(' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    turns.push(`${role === 'user' ? 'User' : 'You'}: ${text.slice(0, 280)}`);
  }
  return turns.slice(-maxTurns).join('\n');
}

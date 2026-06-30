// AgentV3 — Project memory context for the build prompt (Claude-level continuity).
//
// A new message used to start the build loop with ONLY the new prompt, so a follow-up like
// "continue" had no idea what was being built → the model replied "what would you like me to
// continue with?". This builds a compact CONTEXT block — the current files, the project map, and
// the recent user requests — that is prepended to the build prompt so the agent KNOWS it is
// continuing an existing project and resumes instead of asking. Pure + dependency-free (testable).

import type { TodoItem, TodoStatus } from './types';

export interface ProjectContextInput {
  /** Current workspace file paths (the durable, cross-instance signal of what exists). */
  files: string[];
  /** WorkspaceMemory.projectMap() output (components/routes/deps/recent errors) — may be ''. */
  projectMap?: string;
  /** Recent user requests in this session (oldest→newest), e.g. "build a calculator". */
  recentRequests?: string[];
  /**
   * The plan (todo statuses) the build was working through last time, already rendered by
   * formatPlanState(). On a follow-up like "continue" the model otherwise resets the plan to
   * 0/N and re-scaffolds — this carries the statuses over so it resumes the unfinished items.
   */
  lastPlan?: string;
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
  const plan = (input.lastPlan ?? '').trim();
  if (files.length === 0 && requests.length === 0 && !map && !plan) return '';

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
  if (plan) {
    lines.push('');
    lines.push('The build plan you were working through last time (statuses ✓ done · ⋯ in progress · ✗ blocked · ○ pending). CONTINUE the unfinished items — do NOT reset the plan to 0 or re-scaffold what is already done:');
    lines.push(plan);
  }
  lines.push('');
  lines.push('Use this context as your memory. Do NOT ask "what would you like me to continue with" — read the files above and CONTINUE the same project. If the user just said "continue", resume building/fixing exactly this project from where it was left.');
  return lines.join('\n');
}

interface Turn { role: 'user' | 'you'; text: string }

/**
 * Flatten raw Anthropic messages into compact { role, text } turns. Tool calls are noted
 * (`[called X]`); tool_result blocks are skipped (noisy); empty turns are dropped; each text
 * is capped. Shared by extractConversationSummary and buildRunningSummary. Pure.
 */
function messagesToTurns(messages: unknown[]): Turn[] {
  const turns: Turn[] = [];
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
    turns.push({ role: role === 'user' ? 'user' : 'you', text: text.slice(0, 280) });
  }
  return turns;
}

const renderTurns = (turns: Turn[]): string =>
  turns.map((t) => `${t.role === 'user' ? 'User' : 'You'}: ${t.text}`).join('\n');

/**
 * Summarize a prior build transcript (raw Anthropic messages) into a short, readable
 * "User: … / You: …" recap of the last `maxTurns` turns — so the model REMEMBERS the
 * conversation (what was asked, what it did) on a follow-up. Tool calls are noted compactly;
 * tool results are skipped (noisy). Pure + exported for testing.
 */
export function extractConversationSummary(messages: unknown[], maxTurns = 8): string {
  return renderTurns(messagesToTurns(messages).slice(-maxTurns));
}

/**
 * A ROLLING conversation summary for LONG sessions. extractConversationSummary keeps only the
 * last N turns verbatim — so in a long session the early context (what the app even is, the
 * original ask) silently falls off the window and the model "forgets" it. buildRunningSummary
 * keeps the recent turns verbatim AND condenses everything before them into a compact digest:
 * the distinct things the user asked for + the actions taken. Short sessions (≤ recentTurns)
 * return the same recap as before. Pure + deterministic + exported for testing.
 */
export function buildRunningSummary(messages: unknown[], opts: { recentTurns?: number } = {}): string {
  const recentTurns = opts.recentTurns ?? 8;
  const turns = messagesToTurns(messages);
  if (turns.length <= recentTurns) return renderTurns(turns);

  const earlier = turns.slice(0, turns.length - recentTurns);
  const recent = turns.slice(turns.length - recentTurns);

  const userAsks = [...new Set(earlier.filter((t) => t.role === 'user').map((t) => t.text.slice(0, 120)))].slice(0, 10);
  const actions = [...new Set(
    earlier.filter((t) => t.role === 'you').flatMap((t) => t.text.match(/\[called \w+\]/g) ?? []).map((a) => a.replace(/^\[called /, '').replace(/\]$/, '')),
  )].slice(0, 15);

  const lines: string[] = [];
  lines.push(`[Earlier in this session — ${earlier.length} turn(s) condensed so nothing is forgotten]`);
  if (userAsks.length) {
    lines.push('Things the user asked for earlier:');
    lines.push(userAsks.map((a) => `  - ${a}`).join('\n'));
  }
  if (actions.length) lines.push(`Actions taken earlier: ${actions.join(', ')}`);
  lines.push('');
  lines.push('[Most recent turns — verbatim]');
  lines.push(renderTurns(recent));
  return lines.join('\n');
}

const PLAN_MARK: Record<string, string> = {
  done: '✓', in_progress: '⋯', blocked: '✗', pending: '○',
};

/**
 * Render a list of plan todos into a compact, human/model-readable status block — the durable
 * "plan so far" that gets persisted with WorkspaceMemory and surfaced via buildProjectContext on a
 * follow-up build. Returns '' when there is no plan to carry over. Pure + exported for testing.
 */
export function formatPlanState(todos: Array<{ title?: unknown; status?: unknown }>): string {
  const items = (todos ?? []).filter((t) => t && typeof (t as { title?: unknown }).title === 'string' && (t as { title: string }).title.trim());
  if (items.length === 0) return '';
  return items.slice(0, 20).map((t) => {
    const status = typeof t.status === 'string' ? t.status : 'pending';
    const mark = PLAN_MARK[status] ?? '○';
    return `  ${mark} ${String(t.title).trim().slice(0, 120)} [${status}]`;
  }).join('\n');
}

const VALID_STATUS = new Set<TodoStatus>(['done', 'in_progress', 'blocked', 'pending']);

/**
 * Inverse of formatPlanState: parse a persisted PLAN_STATE block back into structured todos so a
 * RESUMED session (after a server cold-start, when the in-memory plan is gone) can repopulate the
 * plan/todos panel from durable storage instead of resetting it to 0/N. Tolerates the stored
 * "PLAN_STATE\n" note prefix and ignores any line that isn't a "<mark> <title> [status]" entry.
 * Pure + exported for testing.
 */
export function parsePlanState(text: string | null | undefined): TodoItem[] {
  if (!text || typeof text !== 'string') return [];
  const body = text.replace(/^PLAN_STATE\s*\n?/, '');
  const out: TodoItem[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // "<mark> <title> [<status>]" — REQUIRE a known status mark (✓/⋯/✗/○) so arbitrary prose that
    // merely happens to end in "[word]" is never mis-parsed as a todo.
    const m = line.match(/^(?:✓|⋯|✗|○)\s+(.*?)\s*\[([a-z_]+)\]$/);
    if (!m) continue;
    const title = m[1].trim();
    if (!title) continue;
    const status = (VALID_STATUS.has(m[2] as TodoStatus) ? m[2] : 'pending') as TodoStatus;
    out.push({ id: `restored-${out.length}`, title, status });
  }
  return out;
}

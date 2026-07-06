// AgentV3 — role chats (admin's 3-role model, FIX #5): PLANNER + ADVISOR lanes.
//
// The 3-role model: Chat 1 (the existing builder) is the ONLY writer — it drains the per-app command
// queue serially. Chat 2 (PLANNER) and Chat 3 (ADVISOR: audit / test / research / explain / compare)
// are READ-ONLY: they analyze the real project and PROPOSE concrete build steps, which the user
// approves into the executor's queue (source 'planner' / 'advisor'). They never touch a file.
//
// The no-write guarantee is STRUCTURAL, not a prompt promise: a role turn runs the model with NO
// TOOLS AT ALL — a pure text completion over context we inject (the real file tree + a bounded,
// relevance-picked set of file contents). With no tools there is nothing to write with.
//
// This module is the pure, unit-tested core: role parsing, the role system prompts, the proposed-steps
// output contract (a fenced ```steps JSON block) with its strict parser, and the deterministic
// context-file selection. The route wires it into a lock-free read-only lane.

import { MAX_QUEUE_ITEMS } from './BuildQueue';

export type ChatRole = 'planner' | 'advisor';

/** Parse the request's chatRole field. Anything but the two known roles → null (the normal lane). */
export function parseChatRole(v: unknown): ChatRole | null {
  return v === 'planner' || v === 'advisor' ? v : null;
}

/**
 * The proposed-steps OUTPUT CONTRACT shared by both roles: a fenced ```steps block holding a JSON
 * array of build commands. Kept in one string so the prompt and the parser can never drift.
 */
const STEPS_CONTRACT =
  'When (and only when) you have concrete work to hand to the builder, end your reply with a fenced ' +
  'block EXACTLY like this — a JSON array of self-contained build commands, each one executable on its ' +
  'own, in order, at most ' + MAX_QUEUE_ITEMS + ' items:\n' +
  '```steps\n["First command for the builder", "Second command"]\n```\n' +
  'Each command must be a complete instruction (the builder sees ONLY that text, not this chat). ' +
  'If the user is still exploring and nothing is ready to build, output NO steps block.';

/** The read-only role system prompt (the route appends the injected project context after this). */
export function roleSystemPrompt(role: ChatRole): string {
  if (role === 'planner') {
    return (
      'You are the PLANNER for this project — a read-only planning partner. You NEVER build or edit ' +
      'anything yourself; a separate builder executes work from a queue. Discuss goals, decompose them ' +
      'into an ordered, dependency-aware sequence of small buildable steps, refine on feedback, and be ' +
      'honest about risks and unknowns. Ground everything in the REAL project context provided below — ' +
      'never invent files or state.\n\n' + STEPS_CONTRACT
    );
  }
  return (
    'You are the ADVISOR for this project — a read-only reviewer. Your priorities: AUDIT code for ' +
    'bugs/risks, propose TESTS, RESEARCH approaches/libraries, EXPLAIN how things work, and COMPARE ' +
    'options — whatever the user asks. You NEVER build or edit anything yourself; a separate builder ' +
    'executes work from a queue. Ground findings in the REAL project context provided below and say ' +
    'plainly when something is outside the provided context (you see the file tree and a relevant ' +
    'subset of file contents, not every byte). Turn actionable findings into concrete fix/test ' +
    'commands for the builder.\n\n' + STEPS_CONTRACT
  );
}

const STEPS_FENCE_RE = /```steps\s*\n([\s\S]*?)```/;

/**
 * Extract proposed steps from a role reply, STRICTLY: a fenced ```steps block containing a JSON array
 * of strings (or {prompt} objects). Anything malformed → []. Trims, drops blanks, dedupes, caps at
 * MAX_QUEUE_ITEMS — so nothing unbounded or empty can ever reach the queue.
 */
export function parseProposedSteps(reply: string | null | undefined): string[] {
  if (!reply) return [];
  const m = reply.match(STEPS_FENCE_RE);
  if (!m) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(m[1]); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    const text = typeof item === 'string' ? item : typeof (item as { prompt?: unknown })?.prompt === 'string' ? (item as { prompt: string }).prompt : '';
    const trimmed = text.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= MAX_QUEUE_ITEMS) break;
  }
  return out;
}

/** Remove the machine-facing ```steps block from the reply so the chat shows clean prose (the steps
 *  themselves are delivered separately via the proposed_steps event). */
export function stripStepsBlock(reply: string): string {
  return reply.replace(STEPS_FENCE_RE, '').trim();
}

/** Bounds for the injected file contents — big enough to ground a real review, small enough for one turn. */
export const ROLE_CONTEXT_MAX_FILES = 8;
export const ROLE_CONTEXT_MAX_FILE_CHARS = 4_000;
export const ROLE_CONTEXT_MAX_TOTAL_CHARS = 24_000;

/**
 * Deterministically pick the most relevant files for a role turn: score by how many prompt words hit
 * the path (strong) or the content (weak), tie-break by path. Binary-ish/lock files are skipped.
 * Bounded (ROLE_CONTEXT_*), pure, and stable — the same prompt + files always pick the same context.
 */
export function selectRoleContextFiles(
  files: Record<string, string>,
  prompt: string,
): Array<{ path: string; content: string }> {
  const words = [...new Set((prompt.toLowerCase().match(/[a-z0-9_-]{3,}/g) || []))];
  const skip = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|lock)$|package-lock\.json$/i;
  const scored = Object.entries(files)
    .filter(([p, c]) => typeof c === 'string' && !skip.test(p))
    .map(([path, content]) => {
      const pl = path.toLowerCase();
      const cl = content.slice(0, 20_000).toLowerCase();
      let score = 0;
      for (const w of words) {
        if (pl.includes(w)) score += 5;
        if (cl.includes(w)) score += 1;
      }
      return { path, content, score };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const out: Array<{ path: string; content: string }> = [];
  let total = 0;
  for (const f of scored) {
    if (out.length >= ROLE_CONTEXT_MAX_FILES) break;
    const content = f.content.slice(0, ROLE_CONTEXT_MAX_FILE_CHARS);
    if (total + content.length > ROLE_CONTEXT_MAX_TOTAL_CHARS) break;
    out.push({ path: f.path, content });
    total += content.length;
  }
  return out;
}

/** Format the injected project context block (file tree + the picked file contents), honestly labeled. */
export function formatRoleContext(fileTree: string, picked: Array<{ path: string; content: string }>): string {
  const filesBlock = picked.length
    ? picked.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')
    : '(no file contents matched this question — reason from the file tree, and say so when it matters)';
  return (
    `\n\n== REAL PROJECT CONTEXT ==\nFILE TREE:\n${fileTree || '(empty project)'}\n\n` +
    `RELEVANT FILE CONTENTS (a bounded, relevance-picked subset — not the whole project):\n${filesBlock}`
  );
}

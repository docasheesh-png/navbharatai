// AgentV3 — a specialist that runs AT THE SAME TIME as others is told what the others are building.
//
// 🔴 WHY (autopsy Sur Taal / cda57ed6, 2026-10-04). The architect sent four `task(frontend, …)` calls in one
// turn, so they ran in parallel (AGENTV3_PARALLEL_BUILD). Each child was handed its own instruction plus
// the user's whole request (`userRequestBlock`, which ends "decide it from this request and build"), and
// nothing about the three others. Each one read the 2,600-character design note and set out to build the
// whole app: "अब मुझे पूरी ऐप बिल्ड करनी है" (now I have to build the whole app). The project ended with two
// contexts, two stores, `icons.tsx` beside `Icons.tsx`, and every screen written twice (src/components/ and
// src/screens/). Thirteen minutes of type errors later the 25-minute window closed, RED, with $3.35 of
// NavBharatAI's money spent on a free build.
//
// The per-path write lock (`lockedActuator`) only stops two children writing the SAME path at once; it
// cannot stop two children writing the same thing at two paths. Only the children can, and only if they
// know about each other. So each parallel writer is now told its siblings' tasks and three rules: build only
// your task, look for a shared file before creating one, and never make a second copy under another name.
//
// PURE. AgentRunner computes the siblings for a turn; ToolDispatcher's `task` case appends the brief.

/** One task running beside another in the same turn. */
export interface SiblingTask { role: string; instruction: string }

/** The hidden input key AgentRunner uses to hand a `task` call its siblings. Not part of the tool schema. */
export const SIBLING_TASKS_INPUT_KEY = '_parallelSiblings';

/** How much of each sibling's instruction is shown — enough to know its scope, not a second prompt. */
export const SIBLING_INSTRUCTION_MAX_CHARS = 280;

interface ToolUseLike { name?: string; input?: Record<string, unknown> }

/**
 * For each writer `task` call among `idxs` that runs beside at least one other writer task, the OTHER
 * writer tasks in the same batch. A lone writer gets nothing (nothing runs beside it). PURE.
 */
export function writerTaskSiblings(
  toolUses: readonly ToolUseLike[],
  idxs: readonly number[],
  isWriterRole: (role: string) => boolean,
): Map<number, SiblingTask[]> {
  const writers: Array<{ i: number; task: SiblingTask }> = [];
  for (const i of idxs) {
    const tu = toolUses[i];
    if (!tu || tu.name !== 'task') continue;
    const role = typeof tu.input?.role === 'string' ? tu.input.role : '';
    const instruction = typeof tu.input?.instruction === 'string' ? tu.input.instruction : '';
    if (!role || !isWriterRole(role)) continue;
    writers.push({ i, task: { role, instruction } });
  }
  const out = new Map<number, SiblingTask[]>();
  if (writers.length < 2) return out;
  for (const w of writers) out.set(w.i, writers.filter((o) => o.i !== w.i).map((o) => o.task));
  return out;
}

/** Read the siblings back out of a `task` call's input. Anything malformed ⇒ none. PURE. */
export function readSiblingTasks(input: Record<string, unknown> | undefined): SiblingTask[] {
  const raw = input?.[SIBLING_TASKS_INPUT_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is SiblingTask => !!s && typeof (s as SiblingTask).role === 'string' && typeof (s as SiblingTask).instruction === 'string')
    .slice(0, 8);
}

function oneLine(text: string): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > SIBLING_INSTRUCTION_MAX_CHARS ? `${flat.slice(0, SIBLING_INSTRUCTION_MAX_CHARS)}…` : flat;
}

/** The block appended to a parallel writer's instruction. Empty when it runs alone. PURE. */
export function parallelSiblingBrief(siblings: readonly SiblingTask[]): string {
  if (!siblings || siblings.length === 0) return '';
  const lines = siblings.map((s) => `- ${s.role}: ${oneLine(s.instruction) || '(no instruction given)'}`);
  return [
    '',
    '',
    `PARALLEL TEAM — ${siblings.length + 1} specialists are working on this app AT THE SAME TIME. The others are doing:`,
    ...lines,
    'Rules while you work beside them:',
    '1. Build ONLY your own task above. The user\'s request describes the WHOLE app; the parts listed here are being written right now by someone else — do not write them, not even a simpler copy.',
    '2. Shared files (types, a store or context, hooks several screens use, icons, theme, utils) are written ONCE. Before you create one, glob for it and import the one that exists. If it is not there yet and your task needs it, create it at the conventional path (src/types/, src/store/ or src/context/, src/hooks/, src/components/Icons.tsx) and say so in your final message.',
    '3. Never create a second copy of something under another name, folder or letter case — `icons.tsx` beside `Icons.tsx`, or the same screen in both src/components/ and src/screens/, breaks the build.',
  ].join('\n');
}

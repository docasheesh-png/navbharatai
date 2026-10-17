/**
 * 🔴 A SIMPLE APP WAS HANDED TO A SECOND AGENT TO BE BUILT (autopsy ca99778e, 2026-10-17).
 *
 * A one-screen-family mock-test app (complexity: not complex, no project mode). The fast lane handed off to the
 * full builder, whose prompt says "MANDATORY DELEGATION … never write application code yourself". So the
 * architect spent 44 s writing a 2,604-character brief, and the frontend sub-agent it spawned re-read every file
 * the architect had just read, ran `ls` on three directories that did not exist, and only then began. On a
 * simple app none of that buys anything: there is one writer's worth of work, and the handoff is pure latency.
 *
 * 🔑 THE CLASS: a coordination rule sized for large apps applied to every app. Structural, not a prompt nudge:
 * on a NEW, non-complex build that is not split into Project Mode modules, the architect is simply not offered
 * the `task` tool (and a `task` call it invents anyway is refused by the runner, which only dispatches a
 * sub-agent from a run that was offered one). One line of the system prompt says why, so the delegation rule it
 * still contains is not read as an instruction it cannot follow. Complex apps, edits and Project Mode are
 * unchanged. Kill switch `AGENTV3_SOLO_SIMPLE=off`. PURE.
 */

export function soloSimpleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SOLO_SIMPLE ?? '').trim().toLowerCase() !== 'off';
}

export interface SoloInput { complex: boolean; projectMode: boolean; newBuild: boolean }

/** Does this build run on ONE agent (no sub-agent spawning)? PURE. */
export function buildsSolo(input: SoloInput, env: NodeJS.ProcessEnv = process.env): boolean {
  return soloSimpleEnabled(env) && input.newBuild && !input.complex && !input.projectMode;
}

/** The architect's tool names for this build — `task` removed on a solo build. PURE. */
export function soloArchitectTools<T extends string>(tools: readonly T[], input: SoloInput, env: NodeJS.ProcessEnv = process.env): T[] {
  return buildsSolo(input, env) ? tools.filter((t) => t !== 'task') : [...tools];
}

/** The system-prompt line a solo architect reads ('' when the build is not solo). PURE. */
export function soloArchitectNote(input: SoloInput, env: NodeJS.ProcessEnv = process.env): string {
  if (!buildsSolo(input, env)) return '';
  return '\n\n# SOLO BUILD (overrides MANDATORY DELEGATION above)\n'
    + 'This is a small app, so YOU build it: the task tool is not available on this build. Write every file yourself '
    + '(write_files_batch for several at once) — the entry src/App.tsx with its screens first, then the rest. '
    + 'Do not write briefs for other agents and do not re-read files you have already read.';
}

/** The refusal a run gets when it calls `task` without having been offered it. */
export const TASK_NOT_OFFERED =
  'The task tool is not available on this build (a small app is built by one agent). Write the files yourself with '
  + 'write_file / write_files_batch — nothing was spawned and nothing was lost.';

/** The route's three facts as one input — a function, so the /build body (at TypeScript's CFA limit) adds no branch. PURE. */
export function soloInputOf(complex: boolean, projectMode: boolean, intent: string, isEditMode: boolean): SoloInput {
  return { complex, projectMode, newBuild: intent === 'new_build' && !isEditMode };
}

/** A filter over the architect's tool DEFINITIONS: drops `task` on a solo build (built-in tools keep their order). PURE. */
export function soloKeeps(input: SoloInput, env: NodeJS.ProcessEnv = process.env): (t: { name: string }) => boolean {
  const solo = buildsSolo(input, env);
  return (t) => !(solo && t.name === 'task');
}

// A writer can inspect a different file or range every turn and still build nothing. The per-call
// repeat guard correctly permits those NEW questions; this guard asks when the inspection becomes work.
// Oct 19 game builds b357f9d4 / 91ad16ba mapped the kit until the ten-minute futility stop, without one
// builder write. The old no-build nudge only runs on a zero-tool turn, so one read made it unreachable.
// This is advice delivered with real tool results, never a ban on a new range or a reason to hide content.

export const EXPLORATION_TURNS = 8;
export const EXPLORATION_PROBES = 16;
export const MAX_EXPLORATION_STEERS = 2;

const PROBES: ReadonlySet<string> = new Set(['read_file', 'grep', 'glob']);

export interface ExplorationProgress {
  changes: number;
  turns: number;
  probes: number;
  stage: number;
  steers: number;
}

export interface ExplorationSteer {
  stage: number;
  message: string;
  observation: string;
}

export function initialExplorationProgress(changes: number): ExplorationProgress {
  return { changes, turns: 0, probes: 0, stage: 0, steers: 0 };
}

/** Count only an artifact writer's exploration; missing change evidence never establishes a stall. */
export function advanceExplorationProgress(
  state: ExplorationProgress,
  input: {
    writingRun: boolean;
    changes: number | null;
    toolNames: readonly string[];
    editingExistingApp: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
): { state: ExplorationProgress; steer: ExplorationSteer | null } {
  const none = { state, steer: null };
  if (!input.writingRun || String(env.AGENTV3_EXPLORATION_STEER ?? '').trim().toLowerCase() === 'off') return none;
  if (input.changes === null || !Number.isFinite(input.changes) || input.changes < 0) return none;
  // Compare actual changes, not tool names: a rejected write is not work, and the seed predates this run.
  if (input.changes !== state.changes) {
    return { state: { ...initialExplorationProgress(input.changes), steers: state.steers }, steer: null };
  }
  const probes = input.toolNames.filter((name) => PROBES.has(name)).length;
  // A plan update may ride with reads. Tests, browser journeys, commands and connected tools are not
  // exploration and are never told they should have been writing instead.
  if (probes === 0 || !input.toolNames.every((name) => PROBES.has(name) || name === 'update_todo')) return none;
  const next = { ...state, turns: state.turns + 1, probes: state.probes + probes };
  const stage = next.stage + 1;
  if (next.steers >= MAX_EXPLORATION_STEERS || stage > 2
    || (next.turns < EXPLORATION_TURNS * stage && next.probes < EXPLORATION_PROBES * stage)) {
    return { state: next, steer: null };
  }
  next.stage = stage;
  next.steers += 1;
  const observation = `Since the last recorded project change, ${next.turns} model turn(s) made ${next.probes} file/search calls without changing the project.`;
  const action = input.editingExistingApp
    ? 'Make the smallest focused change the user requested in the existing app, keeping its current structure and features.'
    : 'Implement the smallest runnable part of the requested app now, using the kit and APIs already established.';
  return {
    state: next,
    steer: {
      stage,
      observation,
      message: `[BUILD PROGRESS${stage === 2 ? ' — STILL EXPLORING' : ''}] ${observation} `
        + (stage === 2 ? 'Exploration continued after the earlier hand-back. ' : '')
        + action + ' Read any still-needed signature alongside that concrete change; a complete map of every helper is not needed first. '
        + 'If you cannot safely make a change, state the exact missing input or blocker instead of continuing to map the project. '
        + 'File reads remain available in full.',
    },
  };
}

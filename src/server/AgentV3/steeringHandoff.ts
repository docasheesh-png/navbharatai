import { SALVAGE_HANDOFF_MARKER } from './handoffRule';

/** Steering is delivered by AgentRunner, never drained merely to detect a lane yield. */
import { STEERING_YIELD_REASON, isSteeringYield } from './steeringYield';
export { STEERING_YIELD_REASON, isSteeringYield } from './steeringYield';
export function createSteeringHandoff<T>(queue: () => T[] | undefined, enabled: () => boolean) {
  let laneOwnsWorkspace = false;
  return {
    beginLane(): void { laneOwnsWorkspace = true; },
    // Called only AFTER the write fence has revoked the old lease and drained accepted writes.
    releaseLane(): void { laneOwnsWorkspace = false; },
    pending(): boolean { return enabled() && !!queue()?.length; },
    take(): T[] {
      if (laneOwnsWorkspace || !enabled()) return [];
      const messages = queue();
      return messages?.splice(0, messages.length) ?? [];
    },
  };
}

/** One-shot has no manifest salvage block: carry only acknowledged files on a scope-change handoff. */
export function steeringSalvage(result: { ok: boolean; reason?: string; salvagedPaths?: string[] }, prompt: string, onSavedPaths: (paths: string[]) => void): string {
  if (result.ok || result.reason !== STEERING_YIELD_REASON || !result.salvagedPaths?.length) return prompt;
  const paths = result.salvagedPaths;
  onSavedPaths(paths);
  return `${SALVAGE_HANDOFF_MARKER} The files below are already saved work of THIS app. Read and continue them under the newly queued user instruction; do not rebuild a parallel module tree:\n${paths.map((path) => `- ${path}`).join('\n')}\n\n${prompt}`;
}

export function plannedHandoffOutcome(reason?: string): string {
  return isSteeringYield(reason)
    ? 'Fast-lane outcome: yielded to a queued user instruction; saved work stays, not a user Stop or an engine failure.'
    : 'Fast-lane outcome: handed its plan to the full builder before a reasoning engine — not a failure.';
}

export function oneShotOutcomeRecord(outcome: string, pendingSteering: boolean) {
  return { phase: 'build' as const, severity: 'info' as const,
    code: pendingSteering ? 'ONESHOT_SCOPE_YIELD' : `OUTCOME_${outcome}`,
    message: pendingSteering ? 'One-shot files are saved; a queued user instruction still requires the full builder, not a terminal success.' : `Build outcome: ${outcome}`,
    autoResolved: true,
  };
}

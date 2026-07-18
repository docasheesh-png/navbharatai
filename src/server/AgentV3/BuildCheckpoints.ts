// Build Checkpoints (Phase B) — Early health validation every N tool calls.
//
// TaskForge autopsy (admin, 2026-07-18): this module ALSO used to emit a "graceful degradation"
// hint — "⚠️ Token budget getting tight (N tool calls so far)… OK to SKIP: <nice features>… Finish
// the core app working, then stop." That behaviour was REMOVED at the root because it violated three
// pillars of the constitution at once:
//   1. HONESTY (rule 3 / no-fake-status): it claimed "token budget getting tight" while measuring NOTHING
//      of the kind — it was a bare `toolCalls > 60` heuristic. It never read wallet balance, real token
//      spend, or the model budget. A fabricated status.
//   2. REAL FEATURES ONLY (rule 2) + THE AIM: it told the builder to DROP user-requested (and paid-for)
//      features and STOP at a fixed 60-call mark. Worse, it was complexity-BLIND — a large full-stack app
//      (TaskForge, a Linear clone) legitimately needs far more than 60 tool calls, so the MORE complex the
//      app, the SOONER it was told to abandon features. Exactly backwards from "big complex apps must
//      struggle as little as small ones."
//   3. WHITE-LABEL / UX: the raw hint was pushed to the user as a `narration` event, so the user watched
//      "the world's best app builder" announce it was giving up on their dark-mode and stopping.
// The genuine "this app is too big for a single turn" case is already owned — honestly and completely — by
// the step-limit AUTO-RESUME (pause, not death → continue next turn → full app delivered across turns) and
// the up-front affordability gate. Dropping requested features was never the right answer, so it is gone.
// This checkpoint now does ONLY deterministic health monitoring.

import type { WorkspaceState, AgentEventStream, AgentEvent } from './index';

export interface CheckpointState {
  toolCalls: number; // total tool calls in this build
  lastCheckpointCall: number; // tool call count at last checkpoint
}

/**
 * Checkpoint manager: monitors build health at regular intervals (every N tool calls).
 * Deterministic — uses only the workspace state + event history, no LLM calls.
 *
 * CHECKPOINT_INTERVAL = 15 tool calls (a balance: early detection without constant checks).
 * When checkpoint fires:
 * 1. Check for errors in recent events
 * 2. Check for stuck calls (pending >> completed)
 * It never drops features and never tells the build to stop (see the file header).
 */
export const CHECKPOINT_INTERVAL = 15;

export class BuildCheckpoint {
  readonly state: CheckpointState;
  readonly workspace: WorkspaceState;

  constructor(workspace: WorkspaceState) {
    this.workspace = workspace;
    this.state = {
      toolCalls: 0,
      lastCheckpointCall: 0,
    };
  }

  /**
   * Record a tool call. When CHECKPOINT_INTERVAL is reached, returns true
   * (caller should run quickCheck()).
   */
  recordToolCall(): boolean {
    this.state.toolCalls++;
    if (this.state.toolCalls - this.state.lastCheckpointCall >= CHECKPOINT_INTERVAL) {
      this.state.lastCheckpointCall = this.state.toolCalls;
      return true; // time to checkpoint
    }
    return false;
  }

  /**
   * Checkpoint validation — called after every CHECKPOINT_INTERVAL tool calls.
   * Returns an object with: ok (build is progressing) and broken (should escalate).
   * Pure signal only — no feature-dropping, no "stop" instruction, no fabricated budget claim.
   */
  quickCheck(events: AgentEventStream): {
    ok: boolean;
    broken: boolean;
  } {
    const recentEvents = events.snapshot().slice(-20); // last 20 events

    // Check 1: Any errors in recent events?
    const hasErrors = recentEvents.some(
      (e: AgentEvent) => e.type === 'tool_result' && (e as any).error
    );

    // Check 2: Any tool_calls without results (stuck)?
    const pendingCalls = recentEvents.filter((e: AgentEvent) => e.type === 'tool_call').length;
    const completedCalls = recentEvents.filter((e: AgentEvent) => e.type === 'tool_result').length;
    const stuckRatio = pendingCalls > completedCalls ? pendingCalls / (completedCalls + 1) : 0;

    // Verdict: broken when there are errors OR stuck (pending >> completed)
    const broken = hasErrors || stuckRatio > 1.5;
    const ok = !broken && completedCalls > 0;

    return { ok, broken };
  }
}

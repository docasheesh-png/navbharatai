// Build Checkpoints (Phase B) — Early validation every N tool calls
// Detects broken builds early, suggests graceful degradation if token budget runs low

import type { WorkspaceState, AgentEventStream, AgentEvent } from './index';
import type { FeatureRanking } from './RequestAnalyser';

export interface CheckpointState {
  toolCalls: number; // total tool calls in this build
  lastCheckpointCall: number; // tool call count at last checkpoint
  suggestedDegradation: boolean; // true if model should drop nice-to-have features
}

/**
 * Checkpoint manager: monitors build health at regular intervals (every N tool calls).
 * Deterministic — uses only the workspace state + event history, no LLM calls.
 *
 * CHECKPOINT_INTERVAL = 15 tool calls (a balance: early detection without constant checks).
 * When checkpoint fires:
 * 1. Check preview (can render?)
 * 2. Check for errors in recent events
 * 3. If degradation needed (tokens running low): suggest dropping NICE features
 * 4. If broken: log for escalation
 */
export const CHECKPOINT_INTERVAL = 15;

export class BuildCheckpoint {
  readonly state: CheckpointState;
  readonly workspace: WorkspaceState;
  readonly features?: FeatureRanking;

  constructor(workspace: WorkspaceState, features?: FeatureRanking) {
    this.workspace = workspace;
    this.features = features;
    this.state = {
      toolCalls: 0,
      lastCheckpointCall: 0,
      suggestedDegradation: false,
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
   * Returns an object with: ok (build is progressing), broken (should escalate),
   * suggestion (hint for the model).
   */
  quickCheck(events: AgentEventStream): {
    ok: boolean;
    broken: boolean;
    suggestion?: string;
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

    // Suggestion: if token budget estimate shows <30% remaining, suggest degradation
    const suggestion = this.shouldSuggestDegradation()
      ? 'Tokens running low. Focus on CORE features only — skip NICE-to-have (analytics, reports, advanced filtering).'
      : undefined;

    if (suggestion) this.state.suggestedDegradation = true;

    return { ok, broken, suggestion };
  }

  /** Estimate: should we suggest dropping NICE features? (deterministic, no LLM) */
  private shouldSuggestDegradation(): boolean {
    // In a real impl, check tokens-used vs. max-budget from workspace + model.
    // For now: heuristic — if tools calls past 60 (est ~2500-3000 tokens on a typical build),
    // suggest degradation. Refine when proper token accounting is in workspace.
    return this.state.toolCalls > 60 && !this.state.suggestedDegradation;
  }

  /**
   * Build a hint for the model when degradation is suggested.
   * Incorporates the actual NICE features so the model knows what to drop.
   */
  degradationHint(): string | undefined {
    if (!this.state.suggestedDegradation || !this.features?.nice.length) {
      return undefined;
    }
    return (
      `⚠️ Token budget getting tight (${this.state.toolCalls} tool calls so far). ` +
      `Prioritize CORE features:\n` +
      `CORE: ${(this.features.core || []).join(', ') || 'auth, CRUD, navigation'}\n` +
      `IMPORTANT: ${(this.features.important || []).join(', ') || 'search, export'}\n\n` +
      `OK to SKIP (will implement after if needed):\n` +
      `NICE: ${this.features.nice.join(', ')}\n\n` +
      `Finish the core app working, then stop.`
    );
  }
}

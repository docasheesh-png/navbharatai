import { describe, it, expect, beforeEach } from 'vitest';
import { BuildCheckpoint, CHECKPOINT_INTERVAL } from './BuildCheckpoints';
import type { WorkspaceState, AgentEventStream } from './index';

// Mock implementations
class MockWorkspaceState implements WorkspaceState {
  fileContents = new Map<string, string>();
  todos = [];
  snapshot() { return { files: [], todos: [], memory: {} }; }
  setTodos() {}
  upsertFile() {}
}

class MockEventStream implements AgentEventStream {
  private events: any[] = [];
  emit(event: any) { this.events.push(event); }
  snapshot() { return [...this.events]; }
}

describe('BuildCheckpoint — Phase B early validation', () => {
  let checkpoint: BuildCheckpoint;
  let workspace: MockWorkspaceState;
  let events: MockEventStream;

  beforeEach(() => {
    workspace = new MockWorkspaceState();
    events = new MockEventStream();
    checkpoint = new BuildCheckpoint(workspace);
  });

  describe('recordToolCall & checkpoint triggering', () => {
    it('tracks tool calls and triggers checkpoint at CHECKPOINT_INTERVAL', () => {
      let checkpoints = 0;
      for (let i = 0; i < CHECKPOINT_INTERVAL + 5; i++) {
        if (checkpoint.recordToolCall()) checkpoints++;
      }
      expect(checkpoints).toBe(1); // triggered once at CHECKPOINT_INTERVAL
    });

    it('continues triggering checkpoints every CHECKPOINT_INTERVAL', () => {
      let checkpoints = 0;
      for (let i = 0; i < CHECKPOINT_INTERVAL * 3; i++) {
        if (checkpoint.recordToolCall()) checkpoints++;
      }
      expect(checkpoints).toBe(3); // triggered 3 times
    });

    it('starts at 0 tool calls', () => {
      expect(checkpoint.state.toolCalls).toBe(0);
    });

    it('increments after each recordToolCall', () => {
      checkpoint.recordToolCall();
      expect(checkpoint.state.toolCalls).toBe(1);
      checkpoint.recordToolCall();
      expect(checkpoint.state.toolCalls).toBe(2);
    });
  });

  describe('quickCheck — build health validation', () => {
    it('returns ok:true when no errors and calls are completing', () => {
      // Simulate healthy progress
      events.emit({ type: 'tool_call' });
      events.emit({ type: 'tool_result', error: null });
      const result = checkpoint.quickCheck(events);
      expect(result.ok).toBe(true);
      expect(result.broken).toBe(false);
    });

    it('detects broken build when errors + stuck calls', () => {
      // Simulate stuck build
      events.emit({ type: 'tool_call' });
      events.emit({ type: 'tool_call' });
      events.emit({ type: 'tool_call' });
      events.emit({ type: 'tool_result', error: 'File not found' });
      const result = checkpoint.quickCheck(events);
      expect(result.broken).toBe(true);
    });

    it('returns ok:false when no calls at all', () => {
      const result = checkpoint.quickCheck(events);
      expect(result.ok).toBe(false);
    });
  });

  // TaskForge autopsy (admin, 2026-07-18): the checkpoint must NEVER drop requested features, emit a
  // fabricated "token budget getting tight" message, or tell the build to stop — no matter how many tool
  // calls a (legitimately complex) app takes. That behaviour was removed at the root; these tests lock it out.
  describe('no feature-dropping / no fabricated budget claim (regression)', () => {
    it('never returns a degradation suggestion, even far past the old 60-call threshold', () => {
      // TaskForge (a Linear clone) legitimately runs many tool calls — the old heuristic bailed at 60.
      for (let i = 0; i < 120; i++) {
        checkpoint.recordToolCall();
      }
      const result = checkpoint.quickCheck(events);
      expect((result as any).suggestion).toBeUndefined();
      expect(result).not.toHaveProperty('suggestion');
    });

    it('exposes no degradation API surface (degradationHint / shouldSuggestDegradation are gone)', () => {
      expect((checkpoint as any).degradationHint).toBeUndefined();
      expect((checkpoint as any).shouldSuggestDegradation).toBeUndefined();
      expect((checkpoint.state as any).suggestedDegradation).toBeUndefined();
    });

    it('still reports honest health on a long build (ok when calls complete, no stop signal)', () => {
      for (let i = 0; i < 80; i++) checkpoint.recordToolCall();
      events.emit({ type: 'tool_call' });
      events.emit({ type: 'tool_result', error: null });
      const result = checkpoint.quickCheck(events);
      expect(result.ok).toBe(true);
      expect(result.broken).toBe(false);
    });
  });
});

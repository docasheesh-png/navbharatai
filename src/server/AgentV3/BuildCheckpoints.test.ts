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

  describe('graceful degradation', () => {
    it('suggests degradation when tool calls exceed threshold', () => {
      // Simulate many tool calls (e.g., complex build progress)
      for (let i = 0; i < 65; i++) {
        checkpoint.recordToolCall();
      }
      const result = checkpoint.quickCheck(events);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('CORE');
    });

    it('only suggests degradation once', () => {
      for (let i = 0; i < 65; i++) {
        checkpoint.recordToolCall();
      }
      checkpoint.quickCheck(events); // first time
      expect(checkpoint.state.suggestedDegradation).toBe(true);

      // Manually advance more tool calls
      for (let i = 0; i < 20; i++) {
        checkpoint.recordToolCall();
      }
      const result2 = checkpoint.quickCheck(events);
      expect(result2.suggestion).toBeUndefined(); // already suggested once
    });

    it('builds degradation hint from feature ranking', () => {
      const features = {
        core: ['auth', 'CRUD'],
        important: ['search'],
        nice: ['analytics', 'reports'],
      };
      const cp = new BuildCheckpoint(workspace, features);
      for (let i = 0; i < 65; i++) {
        cp.recordToolCall();
      }
      cp.quickCheck(events);
      const hint = cp.degradationHint();
      expect(hint).toBeDefined();
      if (hint) {
        expect(hint).toContain('analytics');
        expect(hint).toContain('reports');
        expect(hint).toContain('CORE');
      }
    });

    it('returns undefined degradationHint if not needed', () => {
      const result = checkpoint.degradationHint();
      expect(result).toBeUndefined(); // too few calls, no degradation suggested
    });
  });
});

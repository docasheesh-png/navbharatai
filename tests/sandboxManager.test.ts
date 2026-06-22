/**
 * Tests for SandboxManager — pure in-memory state management.
 * Only tests the no-op / state-query paths that require no actual process spawning.
 */
import { describe, it, expect } from 'vitest';
import { SandboxManager } from '../src/server/PreviewRunner/SandboxManager';

describe('SandboxManager — no-process state operations', () => {
  it('terminate() on a workspace that was never launched is a no-op', () => {
    const mgr = new SandboxManager();
    expect(() => mgr.terminate('ws-unknown')).not.toThrow();
  });

  it('terminate() on already-terminated workspace is a no-op', () => {
    const mgr = new SandboxManager();
    // terminate twice — second call sees empty map, must not throw
    mgr.terminate('ws-never-existed');
    expect(() => mgr.terminate('ws-never-existed')).not.toThrow();
  });

  it('onProcessLifecycle() on unknown workspaceId is a no-op', () => {
    const mgr = new SandboxManager();
    const onExit = () => {};
    const onError = () => {};
    expect(() => mgr.onProcessLifecycle('ws-unknown', onExit, onError)).not.toThrow();
  });
});

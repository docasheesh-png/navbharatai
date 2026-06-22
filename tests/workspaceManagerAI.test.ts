/**
 * Tests for the AI-directory WorkspaceManager — path-traversal jail,
 * command whitelist, and operation log. Uses the real CWD as workspace root
 * (by design) so we only test cases that don't touch the filesystem.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { WorkspaceManager } from '../src/server/AI/WorkspaceManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── WorkspaceManager — security + log ────────────────────────────────────────

describe('WorkspaceManager (AI) — security jail', () => {
  it('blocks path traversal via createFile', async () => {
    const manager = new WorkspaceManager();
    await expect(manager.createFile('../outside_workspace.txt', 'x')).rejects.toThrow(
      /Access denied/
    );
  });

  it('blocks path traversal via readFile', () => {
    const manager = new WorkspaceManager();
    expect(() => manager.readFile('../../../etc/passwd')).toThrow(/Access denied/);
  });

  it('blocks path traversal via listFiles', () => {
    const manager = new WorkspaceManager();
    expect(() => manager.listFiles('../..')).toThrow(/Access denied/);
  });

  it('blocks path traversal via deleteFile', async () => {
    const manager = new WorkspaceManager();
    await expect(manager.deleteFile('../../some_critical_file')).rejects.toThrow(
      /Access denied/
    );
  });
});

describe('WorkspaceManager (AI) — command whitelist', () => {
  it('throws for disallowed command "rm"', () => {
    const manager = new WorkspaceManager();
    expect(() => manager.executeCommand('rm -rf /')).toThrow(/Command not allowed: rm/);
  });

  it('throws for disallowed command "cat"', () => {
    const manager = new WorkspaceManager();
    expect(() => manager.executeCommand('cat /etc/passwd')).toThrow(/Command not allowed: cat/);
  });

  it('throws for disallowed command "curl"', () => {
    const manager = new WorkspaceManager();
    expect(() => manager.executeCommand('curl http://evil.com')).toThrow(/Command not allowed: curl/);
  });

  it('allows "ls" command without throwing', () => {
    const manager = new WorkspaceManager();
    expect(() => manager.executeCommand('ls .')).not.toThrow();
  });
});

describe('WorkspaceManager (AI) — operation log', () => {
  it('starts with an empty operation log', () => {
    const manager = new WorkspaceManager();
    expect(manager.getOperationLog()).toEqual([]);
  });

  it('records rollback in the log even on empty transaction stack', () => {
    const manager = new WorkspaceManager();
    manager.rollback();
    expect(manager.getOperationLog()).toContain('Rollback executed');
  });
});

// ── ChessEngine ───────────────────────────────────────────────────────────────

import { ChessEngine } from '../src/server/game/Engine';

describe('ChessEngine', () => {
  it('constructs without error', () => {
    expect(() => new ChessEngine()).not.toThrow();
  });

  it('move() returns true for any coordinates', () => {
    const engine = new ChessEngine();
    expect(engine.move([0, 0], [1, 1])).toBe(true);
    expect(engine.move([7, 7], [0, 0])).toBe(true);
  });
});

// ── AIRuntimeManager ─────────────────────────────────────────────────────────

import { AIRuntimeManager } from '../src/server/AI/AIRuntimeManager';

describe('AIRuntimeManager', () => {
  it('getProvider("navbharat") returns a provider instance', () => {
    const provider = AIRuntimeManager.getProvider('navbharat');
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('object');
  });

  it('getProvider throws for an unknown tier', () => {
    expect(() => (AIRuntimeManager.getProvider as any)('unknown')).toThrow(/Unknown AI tier/);
  });
});

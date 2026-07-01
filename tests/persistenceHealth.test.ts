import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  notePersistenceFailure,
  persistenceHealth,
  __resetPersistenceHealth,
} from '../src/server/lib/persistenceHealth';

/** C3 — persistence-failure telemetry: counting, snapshot, and throttled logging. */

describe('persistenceHealth', () => {
  beforeEach(() => __resetPersistenceHealth());

  it('starts healthy with no failures', () => {
    const h = persistenceHealth();
    expect(h.healthy).toBe(true);
    expect(h.failures).toBe(0);
    expect(h.lastScope).toBeNull();
    expect(h.lastOp).toBeNull();
    expect(h.lastError).toBeNull();
  });

  it('records a failure and turns unhealthy with the last scope/op/error', () => {
    notePersistenceFailure('workspace_files', 'write', new Error('quota exceeded'), 1000);
    const h = persistenceHealth();
    expect(h.healthy).toBe(false);
    expect(h.failures).toBe(1);
    expect(h.lastScope).toBe('workspace_files');
    expect(h.lastOp).toBe('write');
    expect(h.lastError).toBe('quota exceeded');
    expect(h.firstAt).toBe(1000);
    expect(h.lastAt).toBe(1000);
  });

  it('accumulates failures and keeps the FIRST timestamp but the LATEST details', () => {
    notePersistenceFailure('workspace_files', 'write', new Error('first'), 1000);
    notePersistenceFailure('workspace_memory', 'init', new Error('second'), 5000);
    const h = persistenceHealth();
    expect(h.failures).toBe(2);
    expect(h.firstAt).toBe(1000);
    expect(h.lastAt).toBe(5000);
    expect(h.lastScope).toBe('workspace_memory');
    expect(h.lastOp).toBe('init');
    expect(h.lastError).toBe('second');
  });

  it('coerces a non-Error thrown value to a readable string', () => {
    notePersistenceFailure('conversation_store', 'read', 'boom', 42);
    expect(persistenceHealth().lastError).toBe('boom');
    __resetPersistenceHealth();
    notePersistenceFailure('conversation_store', 'read', null, 42);
    expect(persistenceHealth().lastError).toBe('unknown error');
  });
});

describe('notePersistenceFailure logging throttle', () => {
  beforeEach(() => __resetPersistenceHealth());
  afterEach(() => vi.restoreAllMocks());

  it('logs the first failure, then throttles the same scope+op to once per 30s', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    notePersistenceFailure('workspace_files', 'write', new Error('e'), 0);
    notePersistenceFailure('workspace_files', 'write', new Error('e'), 10_000); // within 30s → throttled
    notePersistenceFailure('workspace_files', 'write', new Error('e'), 40_000); // >30s → logs again
    expect(warn).toHaveBeenCalledTimes(2);
    // Every failure is still COUNTED even when its log line is throttled.
    expect(persistenceHealth().failures).toBe(3);
  });

  it('logs a different scope+op immediately (throttle is per key)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    notePersistenceFailure('workspace_files', 'write', new Error('e'), 1000);
    notePersistenceFailure('workspace_memory', 'write', new Error('e'), 1000);
    notePersistenceFailure('workspace_files', 'init', new Error('e'), 1000);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

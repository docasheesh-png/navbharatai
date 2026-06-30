import { describe, it, expect, vi } from 'vitest';
import { diffChangedFiles, stripEcho, makeWorkspaceSyncer } from '../src/lib/workspaceSync';

/** Phase S1 — IDE↔v3.0 workspace sync (pure cores + debounced syncer). */

describe('diffChangedFiles', () => {
  it('returns new and changed files, skips unchanged', () => {
    const prev = { 'a.ts': '1', 'b.ts': '2' };
    const next = { 'a.ts': '1', 'b.ts': 'CHANGED', 'c.ts': 'new' };
    expect(diffChangedFiles(prev, next)).toEqual({ 'b.ts': 'CHANGED', 'c.ts': 'new' });
  });
  it('treats everything as new when prev is empty/null', () => {
    expect(diffChangedFiles(null, { 'a.ts': '1' })).toEqual({ 'a.ts': '1' });
    expect(diffChangedFiles({}, {})).toEqual({});
  });
});

describe('stripEcho', () => {
  it('drops files whose content equals the remote (echo)', () => {
    const changed = { 'a.ts': 'fromRemote', 'b.ts': 'localEdit' };
    const remote = { 'a.ts': 'fromRemote' };
    expect(stripEcho(changed, remote)).toEqual({ 'b.ts': 'localEdit' });
  });
  it('keeps everything when remote is null', () => {
    expect(stripEcho({ 'a.ts': '1' }, null)).toEqual({ 'a.ts': '1' });
  });
});

describe('makeWorkspaceSyncer', () => {
  it('debounces local changes into a single sync call with the merged diff', async () => {
    vi.useFakeTimers();
    const sync = vi.fn().mockResolvedValue(undefined);
    const s = makeWorkspaceSyncer({ sync, debounceMs: 100 });
    s.onLocalChange({ 'a.ts': '0' }, { 'a.ts': '1' });
    s.onLocalChange({ 'a.ts': '1' }, { 'a.ts': '2', 'b.ts': 'x' });
    expect(sync).not.toHaveBeenCalled(); // still within debounce
    await vi.advanceTimersByTimeAsync(120);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({ 'a.ts': '2', 'b.ts': 'x' });
    vi.useRealTimers();
  });

  it('suppresses echo: a file just received from remote is not synced back', async () => {
    vi.useFakeTimers();
    const sync = vi.fn().mockResolvedValue(undefined);
    const s = makeWorkspaceSyncer({ sync, debounceMs: 50 });
    s.noteRemote({ 'a.ts': 'remoteContent' });
    s.onLocalChange({}, { 'a.ts': 'remoteContent' }); // echo of the remote file
    await vi.advanceTimersByTimeAsync(60);
    expect(sync).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('dispose cancels a pending sync', async () => {
    vi.useFakeTimers();
    const sync = vi.fn().mockResolvedValue(undefined);
    const s = makeWorkspaceSyncer({ sync, debounceMs: 50 });
    s.onLocalChange({}, { 'a.ts': '1' });
    s.dispose();
    await vi.advanceTimersByTimeAsync(60);
    expect(sync).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EMPTY_LIVE_SYNC_QUEUE,
  LIVE_SYNC_BATCH_MAX,
  LIVE_SYNC_WINDOW_MS,
  applyLiveDelete,
  applyLiveFiles,
  diffFileEntries,
  noteChangedPath,
  requeueFailedBatch,
  settleSyncBatch,
  syncablePath,
  takeSyncBatch,
} from '../src/components/agentv3/liveFileSync';
import { collectNamedWorkspaceFiles } from '../src/server/AgentV3/WorkspaceFiles';
import { liveFileSyncEnabled, requestedSyncPaths } from '../src/server/AgentV3/liveFileSync';
import { makeWorkspaceSyncer } from '../src/lib/workspaceSync';

/**
 * THE FILES TAB IS LIVE WHILE THE APP IS BUILT (admin 2026-09-20: "file and code studio runtime par
 * live sync hona chahiye — abhi nahi ho raha").
 *
 * The engine already streamed a `file_changed` event on every write, and two surfaces were live off
 * it because a PATH is all they need: the preview reloaded, and the Files list grew. The two the
 * admin named need the CONTENT, which the event does not carry — so they read it with a
 * whole-workspace load that ran at three moments, none of them "while the build is writing".
 *
 * These cases pin the four things that make the narrow read correct rather than merely cheaper:
 * a repeated write is DETECTED (object identity, not value), a late reply cannot silently win,
 * an unread path is never invented as empty, and a file the user is typing in is not overwritten.
 */

const entry = (path: string) => ({ path });

describe('which paths were just written', () => {
  it('detects a SECOND write to the same path — the case a value comparison misses', () => {
    const first = entry('src/App.tsx');
    const second = entry('src/App.tsx'); // same value, new object: the reducer re-appends the event's own
    expect(diffFileEntries([first], [second]).changed).toEqual(['src/App.tsx']);
  });

  it('a path whose entry object is unchanged is NOT re-read', () => {
    const stable = entry('src/App.tsx');
    const fresh = entry('src/Invoice.tsx');
    const d = diffFileEntries([stable], [stable, fresh]);
    expect(d.changed).toEqual(['src/Invoice.tsx']);
  });

  it('a path that left the list is a deletion', () => {
    const a = entry('src/Old.tsx');
    const b = entry('src/App.tsx');
    const d = diffFileEntries([a, b], [b]);
    expect(d.deleted).toEqual(['src/Old.tsx']);
    expect(d.changed).toEqual([]);
  });

  it('a FIRST render reports everything changed and nothing deleted', () => {
    const d = diffFileEntries(null, [entry('src/App.tsx'), entry('index.html')]);
    expect(d.changed).toEqual(['src/App.tsx', 'index.html']);
    expect(d.deleted).toEqual([]);
  });

  it('never asks for dependency or build output', () => {
    expect(syncablePath('node_modules/react/index.js')).toBe(false);
    expect(syncablePath('dist/bundle.js')).toBe(false);
    expect(syncablePath('.git/HEAD')).toBe(false);
    expect(syncablePath('src/App.tsx')).toBe(true);
    const d = diffFileEntries(null, [entry('node_modules/x/a.js'), entry('src/App.tsx')]);
    expect(d.changed).toEqual(['src/App.tsx']);
  });
});

describe('the queue', () => {
  it('coalesces a burst so one request carries each path once', () => {
    let q = EMPTY_LIVE_SYNC_QUEUE;
    for (const p of ['a.ts', 'b.ts', 'a.ts']) q = noteChangedPath(q, p, 'modify');
    expect(q.pending).toEqual(['a.ts', 'b.ts']);
  });

  it('a delete is never queued for reading, and clears an in-flight read for that path', () => {
    let q = noteChangedPath(EMPTY_LIVE_SYNC_QUEUE, 'gone.ts', 'create');
    ({ queue: q } = takeSyncBatch(q, LIVE_SYNC_BATCH_MAX));
    expect(q.inFlight).toEqual(['gone.ts']);
    q = noteChangedPath(q, 'gone.ts', 'delete');
    expect(q.inFlight).toEqual([]);
    expect(q.pending).toEqual([]);
  });

  it('holds back what does not fit in one batch instead of sending an oversized request', () => {
    let q = EMPTY_LIVE_SYNC_QUEUE;
    for (let i = 0; i < LIVE_SYNC_BATCH_MAX + 5; i += 1) q = noteChangedPath(q, `f${i}.ts`, 'create');
    const { queue, batch } = takeSyncBatch(q, LIVE_SYNC_BATCH_MAX);
    expect(batch).toHaveLength(LIVE_SYNC_BATCH_MAX);
    expect(queue.pending).toHaveLength(5);
  });

  it('🔴 a path written AGAIN while its read is in the air is re-read', () => {
    // The race the whole design turns on: the reply in flight carries the OLD body, and the event
    // that would have asked again has already been consumed.
    let q = noteChangedPath(EMPTY_LIVE_SYNC_QUEUE, 'src/App.tsx', 'modify');
    let batch: string[];
    ({ queue: q, batch } = takeSyncBatch(q, LIVE_SYNC_BATCH_MAX));
    q = noteChangedPath(q, 'src/App.tsx', 'modify');     // the second write, mid-flight
    q = settleSyncBatch(q, batch);                        // the first reply lands
    expect(q.inFlight).toEqual([]);
    expect(q.pending).toEqual(['src/App.tsx']);           // …and it is asked for again
  });

  it('a FAILED read is re-queued, so a blip does not freeze those files for the whole build', () => {
    let q = noteChangedPath(EMPTY_LIVE_SYNC_QUEUE, 'src/App.tsx', 'modify');
    let batch: string[];
    ({ queue: q, batch } = takeSyncBatch(q, LIVE_SYNC_BATCH_MAX));
    q = requeueFailedBatch(q, batch);
    expect(q.pending).toEqual(['src/App.tsx']);
    expect(q.inFlight).toEqual([]);
  });

  it('a failed read does NOT resurrect a path deleted in the meantime', () => {
    let q = noteChangedPath(EMPTY_LIVE_SYNC_QUEUE, 'gone.ts', 'create');
    let batch: string[];
    ({ queue: q, batch } = takeSyncBatch(q, LIVE_SYNC_BATCH_MAX));
    q = noteChangedPath(q, 'gone.ts', 'delete');
    q = requeueFailedBatch(q, batch);
    expect(q.pending).toEqual([]);
  });
});

describe('applying what came back', () => {
  it('UPSERTS — a path the server did not return keeps the body the surface already had', () => {
    const before = { 'src/App.tsx': 'old', 'src/Keep.tsx': 'kept' };
    const after = applyLiveFiles(before, { 'src/App.tsx': 'new' });
    expect(after).toEqual({ 'src/App.tsx': 'new', 'src/Keep.tsx': 'kept' });
  });

  it('never invents an empty file for a path that could not be read', () => {
    const before = { 'src/App.tsx': 'real' };
    // The server reports what it READ; an unread path is simply absent from `files`.
    expect(applyLiveFiles(before, {})).toEqual(before);
  });

  it('holds back a file the user is editing by hand right now', () => {
    const after = applyLiveFiles({ 'a.ts': '1', 'b.ts': '1' }, { 'a.ts': '2', 'b.ts': '2' }, new Set(['a.ts']));
    expect(after).toEqual({ 'a.ts': '1', 'b.ts': '2' });
  });

  it('a delete removes the row; an unknown path leaves the map untouched by identity', () => {
    const before = { 'a.ts': '1' };
    expect(applyLiveDelete(before, 'a.ts')).toEqual({});
    expect(applyLiveDelete(before, 'nope.ts')).toBe(before);
  });
});

describe('the server answers a NARROWER question, with the SAME eligibility rules', () => {
  const source = (files: Record<string, string>) => ({
    readFile: async (_w: string, p: string) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
  });

  it('reads only the paths it was asked for', async () => {
    const { files } = await collectNamedWorkspaceFiles(
      source({ 'a.ts': 'A', 'b.ts': 'B', 'c.ts': 'C' }), 'ws', ['a.ts', 'c.ts'],
    );
    expect(files).toEqual({ 'a.ts': 'A', 'c.ts': 'C' });
  });

  it('a path it could not read is SKIPPED, never returned as an empty file', async () => {
    const { files, skipped } = await collectNamedWorkspaceFiles(source({ 'a.ts': 'A' }), 'ws', ['a.ts', 'gone.ts']);
    expect(files).toEqual({ 'a.ts': 'A' });
    expect(skipped).toContain('gone.ts');
    expect('gone.ts' in files).toBe(false);
  });

  it('refuses a live secret, dependency output and a binary by the whole-workspace rules', async () => {
    const { files, skipped } = await collectNamedWorkspaceFiles(
      source({ '.env': 'KEY=1', 'node_modules/x/i.js': 'x', 'logo.png': 'bin', 'src/App.tsx': 'ok' }),
      'ws',
      ['.env', 'node_modules/x/i.js', 'logo.png', 'src/App.tsx'],
    );
    expect(files).toEqual({ 'src/App.tsx': 'ok' });
    expect(skipped).toHaveLength(3);
  });

  it('cannot be used to pull a whole workspace by naming every path', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 400; i += 1) many[`f${i}.ts`] = 'x';
    const { files } = await collectNamedWorkspaceFiles(source(many), 'ws', Object.keys(many));
    expect(Object.keys(files).length).toBeLessThanOrEqual(200);
  });
});

describe('the request shape, and the kill switch', () => {
  it('🔴 "named no paths" and "named paths, all rejected" are DIFFERENT answers', () => {
    // Collapsing them would send the entire workspace to a client that asked for one bad path.
    expect(requestedSyncPaths(undefined)).toBeNull();
    expect(requestedSyncPaths('src/App.tsx')).toBeNull();
    expect(requestedSyncPaths([42, null])).toEqual([]);
    expect(requestedSyncPaths([' src/App.tsx '])).toEqual(['src/App.tsx']);
  });

  it('is ON by default and off only when the env says so', () => {
    const prev = process.env.AGENTV3_LIVE_FILE_SYNC;
    try {
      delete process.env.AGENTV3_LIVE_FILE_SYNC;
      expect(liveFileSyncEnabled()).toBe(true);
      process.env.AGENTV3_LIVE_FILE_SYNC = 'off';
      expect(liveFileSyncEnabled()).toBe(false);
      process.env.AGENTV3_LIVE_FILE_SYNC = 'nonsense';
      expect(liveFileSyncEnabled()).toBe(true); // an unreadable value takes the documented default
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_LIVE_FILE_SYNC;
      else process.env.AGENTV3_LIVE_FILE_SYNC = prev;
    }
  });
});

describe('the editor is protected by PATH, not by a flag', () => {
  it('names only the paths with un-flushed edits', () => {
    const syncer = makeWorkspaceSyncer({ sync: async () => {}, debounceMs: 10_000 });
    syncer.onLocalChange({}, { 'src/App.tsx': 'typing' });
    expect(syncer.pendingPaths()).toEqual(['src/App.tsx']);
    expect(syncer.pendingPaths()).not.toContain('src/Invoice.tsx');
    syncer.dispose();
  });
});

describe('the wiring — proven from the source, because no behavioural test in this repo reaches it', () => {
  const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the panel syncs only while a build is RUNNING', () => {
    expect(panel).toContain('if (!running || liveSyncOffRef.current) return;');
  });

  it('the panel sends the named paths to the existing route', () => {
    expect(panel).toMatch(/body: JSON\.stringify\(\{ workspaceId: wsId, userId, email, paths: batch \}\)/);
  });

  it('a live push is MARKED live, so the app can protect the file being edited', () => {
    expect(panel).toContain("onFilesSync?.(files, { live: true })");
    expect(app).toContain('workspaceSyncerRef.current?.pendingPaths()');
  });

  it('the end-of-build sync is unchanged — it passes no `live`, so nothing is held back', () => {
    expect(panel).toMatch(/if \(Object\.keys\(source\)\.length > 0\) onFilesSync\(source\);/);
  });

  it('the route branches on named paths BEFORE the whole-workspace read', () => {
    const named = route.indexOf('const namedPaths = requestedSyncPaths(req.body?.paths);');
    const whole = route.indexOf('await collectFilesWithSavedFallback(actuator, workspaceId, { liveTimeoutMs: 2_500 })');
    expect(named).toBeGreaterThan(-1);
    expect(whole).toBeGreaterThan(named);
  });

  it('the request window is a ceiling on rate, not a resetting debounce', () => {
    // A debounce that restarts on every change would never fire during a build that writes
    // continuously — precisely the case this feature exists for.
    expect(panel).toContain('if (liveSyncTimerRef.current || liveSyncOffRef.current) return;');
    expect(LIVE_SYNC_WINDOW_MS).toBeGreaterThan(0);
  });
});

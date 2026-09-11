import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { workspaceContentHash, snapshotConfirmation, snapshotMatchesFiles } from '../src/server/AgentV3/snapshotIdentity';

/**
 * IS THE SAVED COPY THE APP AS IT STANDS NOW? — answered by CONTENT, not by clocks.
 *
 * The bug this locks out (2026-09-11): the build's FINAL durable save runs after the copy is taken and
 * rewrites the workspace's `savedAt`, so every "no write since the copy" rule called the copy stale for
 * the very build that produced it — and the idle-serve path, which checked nothing, framed a copy that
 * a later edit had outdated. Same missing fact, opposite failures.
 */

describe('workspaceContentHash — one hash for one tree, however it was read', () => {
  it('is deterministic and independent of insertion order', () => {
    const a = { 'src/App.tsx': 'x', 'package.json': '{}', 'index.html': '<html>' };
    const b = { 'index.html': '<html>', 'package.json': '{}', 'src/App.tsx': 'x' };
    expect(workspaceContentHash(a)).toBe(workspaceContentHash(b));
  });

  it('changes when any byte of any file changes, or a file is added or removed', () => {
    const base = { 'a.ts': '1', 'b.ts': '2' };
    expect(workspaceContentHash({ ...base, 'a.ts': '1 ' })).not.toBe(workspaceContentHash(base));
    expect(workspaceContentHash({ ...base, 'c.ts': '' })).not.toBe(workspaceContentHash(base));
    expect(workspaceContentHash({ 'a.ts': '1' })).not.toBe(workspaceContentHash(base));
  });

  it('cannot be fooled by a path that contains part of a content, or vice versa (length-prefixed)', () => {
    expect(workspaceContentHash({ 'ab': 'c' })).not.toBe(workspaceContentHash({ 'a': 'bc' }));
    expect(workspaceContentHash({ 'a b': 'c' })).not.toBe(workspaceContentHash({ 'a': ' bc' }));
  });

  it('survives an empty or missing map', () => {
    expect(workspaceContentHash({})).toBe(workspaceContentHash(undefined));
    expect(workspaceContentHash(null)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('snapshotConfirmation — the copy is promoted only on a proven match', () => {
  const url = 'https://app--sn-x.web.app';
  it('restamps when the persisted tree is byte-identical to the one the copy was built from', () => {
    const h = workspaceContentHash({ 'a.ts': '1' });
    expect(snapshotConfirmation({ taken: { url, filesHash: h }, persistedHash: h }).action).toBe('restamp');
  });

  it('is stale when a later pass changed a file', () => {
    const v = snapshotConfirmation({ taken: { url, filesHash: 'aaaa' }, persistedHash: 'bbbb' });
    expect(v.action).toBe('stale');
    expect(v.reason).toMatch(/changed a file/);
  });

  it('🔒 "we could not read the source" is not a match — it is stale', () => {
    const v = snapshotConfirmation({ taken: { url, filesHash: null }, persistedHash: 'bbbb' });
    expect(v.action).toBe('stale');
    expect(v.reason).toMatch(/could not be read/);
  });

  it('no copy this build ⇒ nothing to say', () => {
    expect(snapshotConfirmation({ taken: null, persistedHash: 'x' }).action).toBe('none');
    expect(snapshotConfirmation({ taken: { url: 'not-a-url', filesHash: 'x' }, persistedHash: 'x' }).action).toBe('none');
  });
});

describe('snapshotMatchesFiles — three answers, and "unknown" is one of them', () => {
  it('true / false when both hashes are known', () => {
    expect(snapshotMatchesFiles('h1', 'h1')).toBe(true);
    expect(snapshotMatchesFiles('h1', 'h2')).toBe(false);
  });
  it('undefined when either side is missing — the caller falls back to the clock rule, never to a guess', () => {
    expect(snapshotMatchesFiles(undefined, 'h1')).toBeUndefined();
    expect(snapshotMatchesFiles('h1', null)).toBeUndefined();
    expect(snapshotMatchesFiles('', '')).toBeUndefined();
  });
});

describe('wiring — the build records the identity, the final save confirms it, one helper answers everyone', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/SandboxStore.ts'), 'utf8');

  it('the copy is taken with the hash of the source that produced it, read from the same tree the build consumed', () => {
    const at = route.indexOf("code: 'PREVIEW_SNAPSHOT_SAVED'");
    const block = route.slice(at - 1500, at);
    expect(block).toContain("withTimeout(collectWorkspaceFiles(actuator, workspaceId), 15_000, 'snapshot-identity')");
    expect(block).toContain('workspaceContentHash(c.files)');
    expect(block).toContain('sandboxStore.saveSnapshot(workspaceId, url, at, filesHash)');
  });

  it('the store carries the hash on the same record as the copy, merged', () => {
    expect(store).toContain('snapshotFilesHash?: string;');
    const i = store.indexOf('async saveSnapshot(');
    expect(store.slice(i, i + 700)).toContain("...(filesHash ? { snapshotFilesHash: filesHash } : {})");
  });

  it('🔒 the confirmation compares what was PERSISTED — the green guard may have restored a different tree', () => {
    expect(route).toContain('let persisted: Record<string, string> = toSave;');
    const restore = route.indexOf('await saveWorkspaceFiles(workspaceId, snapshot);');
    expect(route.slice(restore, restore + 120)).toContain('persisted = snapshot;');
    expect(route).toContain('snapshotConfirmation({ taken: snapshotTaken, persistedHash: workspaceContentHash(persisted) })');
  });

  it('the restamp waits for the save it must outdate', () => {
    const i = route.indexOf('if (snapshotTaken) {\n            await finalSave;');
    expect(i).toBeGreaterThan(-1);
    expect(route.slice(i, i + 400)).toContain('const at = Date.now();');
  });

  it('the report says which it was', () => {
    expect(route).toContain("'PREVIEW_SNAPSHOT_CURRENT' : 'PREVIEW_SNAPSHOT_STALE'");
  });

  it('one helper serves the health probe AND the in-browser preview, by content first and clock second', () => {
    expect(route).toContain('const idleServe = await currentSnapshotFor(workspaceId);');
    expect(route).toContain('const copy = await currentSnapshotFor(workspaceId, filesHash);');
    const i = route.indexOf('async function currentSnapshotFor(');
    const helper = route.slice(i, route.indexOf('\n}\n', i));
    expect(helper).toContain('snapshotMatchesFiles(rec.snapshotFilesHash, currentFilesHash)');
    expect(helper).toContain('if (byContent === false) return null;');
    expect(helper).toContain('buildRunning: byContent === true ? false : isBuildRunningFor(workspaceId)');
  });

  it('the in-browser preview hashes the same way the identity was recorded, and answers with explicit nulls', () => {
    expect(route).toContain('const filesHash = workspaceContentHash(files);');
    expect(route).toContain("const copyFields = { snapshotUrl: copy?.url ?? null, snapshotAt: copy?.at ?? null, snapshotNote: copy ? SNAPSHOT_IDLE_NOTE : null };");
    expect((route.match(/, \.\.\.copyFields \}\);/g) || []).length).toBe(2); // the cached AND the fresh render
  });
});

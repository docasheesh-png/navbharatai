// Build d62bf22d (2026-10-17): the import's durable save took ~89 s of a 97 s TIME_TO_FIRST_CALL — four
// DEADLINE_EXCEEDED, 1 of 175 files confirmed — while the project was already in the workspace.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startImportDurableSave, settleImportDurableSave, importNotDurableNarration, type ImportDurableRecord } from '../src/server/AgentV3/importDurableSave';
import { withIndexQueue } from '../src/server/AgentV3/WorkspaceFileStore';
import { createBuildSourcePublication } from '../src/server/AgentV3/BuildSourcePublication';
import { WorkspaceMemory, type MemorySnapshot } from '../src/server/AgentV3/WorkspaceMemory';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('the import save runs beside the turn and reports honestly', () => {
  it('a saved import records a closed info line and says nothing to the user', async () => {
    const recs: ImportDurableRecord[] = []; const said: string[] = [];
    const r = await startImportDurableSave({ save: async () => ({ status: 'saved', indexed: 175, unconfirmed: [] }), total: 175, record: (x) => recs.push(x), narrate: (t) => said.push(t) });
    expect(r.status).toBe('saved');
    expect(recs.map((x) => x.code)).toEqual(['IMPORT_DURABLE_SAVED']);
    expect(said).toEqual([]);
  });

  it('a partial save names the count to the report and the user', async () => {
    const recs: ImportDurableRecord[] = []; const said: string[] = [];
    await startImportDurableSave({ save: async () => ({ status: 'partial', indexed: 170, unconfirmed: ['a', 'b', 'c', 'd', 'e'], error: '4 DEADLINE_EXCEEDED' }), total: 175, record: (x) => recs.push(x), narrate: (t) => said.push(t) });
    expect(recs[0]).toMatchObject({ code: 'IMPORT_NOT_DURABLE', severity: 'warning', autoResolved: false });
    expect(recs[0].message).toContain('170 of 175');
    expect(said).toEqual([importNotDurableNarration(5, 175)]);
  });

  it('a save that throws never rejects: every file is reported unconfirmed', async () => {
    const recs: ImportDurableRecord[] = []; const said: string[] = [];
    const r = await startImportDurableSave({ save: async () => { throw new Error('boom'); }, total: 175, record: (x) => recs.push(x), narrate: (t) => said.push(t) });
    expect(r.status).toBe('failed');
    expect(said[0]).toContain('175 of its 175');
  });

  it('settling: none, settled, or SAID to be still running — never claimed saved', async () => {
    expect(await settleImportDurableSave([], 10)).toBe('none');
    expect(await settleImportDurableSave([Promise.resolve()], 1_000)).toBe('settled');
    const recs: ImportDurableRecord[] = [];
    expect(await settleImportDurableSave([new Promise(() => {})], 5, (x) => recs.push(x))).toBe('pending');
    expect(recs[0].code).toBe('IMPORT_DURABLE_PENDING');
  });

  it('index updates on one workspace queue; other workspaces do not wait', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withIndexQueue('ws', () => new Promise<void>((r) => { release = () => { order.push('first'); r(); }; }));
    const second = withIndexQueue('ws', async () => { order.push('second'); });
    const other = withIndexQueue('other', async () => { order.push('other'); });
    await other;
    expect(order).toEqual(['other']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['other', 'first', 'second']);
    // a failed update never blocks the next one
    await withIndexQueue('ws', async () => { throw new Error('x'); }).catch(() => {});
    await expect(withIndexQueue('ws', async () => 'ok')).resolves.toBe('ok');
  });

  it('the route starts the save without awaiting it, and settles it once before the bill and the report', () => {
    expect(route).toContain('importDurableSaves.push(sourcePublication.track(startImportDurableSave({');
    const settle = route.indexOf('await settleImportDurableSave(importDurableSaves, IMPORT_DURABLE_SETTLE_MS');
    expect(settle).toBeGreaterThan(route.indexOf('importDurableSaves.push('));
    expect(route.match(/await settleImportDurableSave\(importDurableSaves,/g)).toHaveLength(1);
    expect(settle).toBeLessThan(route.indexOf('const appSeenRunningForBill ='));
    expect(settle).toBeLessThan(route.indexOf('buildDiag.finish(result.ok, result.summary)'));
  });

  it('the actual route start lets the turn continue while retirement waits for saved import bytes', async () => {
    const start = route.indexOf('importDurableSaves.push(');
    const statement = route.slice(start, route.indexOf('framework = validation.framework;', start)).trim();
    const launch = new Function('importDurableSaves', 'sourcePublication', 'startImportDurableSave', 'saveImport', 'importedFiles', 'opts', 'emit', statement);
    const importDurableSaves: Promise<unknown>[] = [];
    const sourcePublication = createBuildSourcePublication();
    const importedFiles = { 'src/App.tsx': 'export default function App() { return "Imported"; }', 'README.md': 'Imported project' };
    const stored = new Map<string, string>();
    const records: ImportDurableRecord[] = []; const said: unknown[] = [];
    let releaseSave!: () => void; let saveCalls = 0; let retired = false;
    const held = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveImport = async () => {
      saveCalls++;
      await held;
      for (const [path, content] of Object.entries(importedFiles)) stored.set(path, content);
      return { status: 'saved' as const, indexed: stored.size, unconfirmed: [] };
    };
    let retirement: Promise<boolean> | undefined;
    try {
      // Execute the production statement, including its real tracker and reporting callbacks.
      expect(launch(importDurableSaves, sourcePublication, startImportDurableSave, saveImport, importedFiles,
        { diag: { record: (record: ImportDurableRecord) => records.push(record) } }, (event: unknown) => said.push(event))).toBeUndefined();
      expect(saveCalls).toBe(1);
      expect(importDurableSaves).toHaveLength(1);
      expect(stored.size).toBe(0); // The caller returned before this held durable save finished.
      expect(records).toEqual([]);
      retirement = sourcePublication.join(1_000).then((ready) => { retired = true; return ready; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(retired).toBe(false);
      releaseSave();
      expect(await settleImportDurableSave(importDurableSaves, 1_000)).toBe('settled');
      expect(await retirement).toBe(true);
      expect(Object.fromEntries(stored)).toEqual(importedFiles);
      expect(records.map((record) => record.code)).toEqual(['IMPORT_DURABLE_SAVED']);
      expect(said).toEqual([]);
    } finally {
      releaseSave();
      await Promise.allSettled(importDurableSaves);
      await retirement;
    }
  });

  it.each(['saved', 'skipped-unconfirmed'] as const)('the actual import-memory block keeps first-call liveness and joins its %s job', async (status) => {
    const start = route.indexOf('      try {', route.indexOf('// Project memory: the import is a durable fact'));
    const block = route.slice(start, route.indexOf('      // The AI turn must work WITH the landed app', start));
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const launch = new AsyncFunction('workspaceId', 'getWorkspaceMemory', 'opts', 'written', 'framework', 'importedFiles', 'saveWorkspaceMemoryFor', 'sourcePublication', block);
    const mem = new WorkspaceMemory(); mem.markHydrated(); mem.markHydrationConfirmed();
    const sourcePublication = createBuildSourcePublication();
    let releaseMemory!: () => void;
    const held = new Promise<void>((resolve) => { releaseMemory = resolve; });
    let stored: MemorySnapshot | undefined; let calls = 0; let callerReturned = false; let retired = false;
    let memoryJob: Promise<typeof status> | undefined; let retirement: Promise<boolean> | undefined;
    const saveMemory = (workspaceId: string, liveMemory: WorkspaceMemory) => {
      expect(workspaceId).toBe('import-memory'); expect(liveMemory).toBe(mem); calls++;
      const snapshot = structuredClone(liveMemory.snapshot());
      memoryJob = held.then(() => { if (status === 'saved') stored = snapshot; return status; });
      return memoryJob;
    };
    const landed = launch('import-memory', () => mem, { source: 'fixture.zip' }, ['src/App.tsx'], 'vite-react',
      { 'src/App.tsx': 'export default function Imported() { return "Imported"; }' }, saveMemory, sourcePublication)
      .then(() => { callerReturned = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(calls).toBe(1);
      expect(callerReturned).toBe(true); // Even a previously hydrated memory can have a held durable write.
      expect(mem.graph().files).toEqual(['src/App.tsx']);
      expect(mem.snapshot().episodes).toContainEqual(expect.objectContaining({ kind: 'note', text: 'Imported an existing app from fixture.zip: 1 files, framework vite-react.' }));
      expect(stored).toBeUndefined();
      retirement = sourcePublication.join(1_000).then((ready) => { retired = true; return ready; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(retired).toBe(false);
      releaseMemory();
      expect(await retirement).toBe(status === 'saved');
      if (status === 'saved') expect(stored?.graph.files).toEqual(['src/App.tsx']);
      else expect(stored).toBeUndefined();
    } finally {
      releaseMemory();
      await landed;
      await memoryJob;
      await retirement;
    }
  });
});

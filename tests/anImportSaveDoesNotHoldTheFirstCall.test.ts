// Build d62bf22d (2026-10-17): the import's durable save took ~89 s of a 97 s TIME_TO_FIRST_CALL — four
// DEADLINE_EXCEEDED, 1 of 175 files confirmed — while the project was already in the workspace.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startImportDurableSave, settleImportDurableSave, importNotDurableNarration, type ImportDurableRecord } from '../src/server/AgentV3/importDurableSave';
import { withIndexQueue } from '../src/server/AgentV3/WorkspaceFileStore';

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
    expect(route).toContain('importDurableSaves.push(startImportDurableSave({');
    const settle = route.indexOf('await settleImportDurableSave(importDurableSaves, IMPORT_DURABLE_SETTLE_MS');
    expect(settle).toBeGreaterThan(route.indexOf('importDurableSaves.push('));
    expect(settle).toBeLessThan(route.indexOf('const appSeenRunningForBill ='));
  });
});

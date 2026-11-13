import { describe, it, expect, vi } from 'vitest';
import { runGameRepair, gameAutoRepairEnabled, gameIncompleteReason, gameRepairRecord } from '../src/server/AgentV3/gameRepair';

describe('game repair data preservation suspension', () => {
  it.each(['binary move', 'partial inventory', 'excluded file', 'oversized source', 'failed read'])('preserves exact original bytes for %s without attempting rollback', async scenario => {
    const files = new Map([['src/main.ts', Buffer.from('original')], ['public/model.glb', Buffer.from([0,255,1,9])], ['hidden.txt', Buffer.from('unlisted original')]]);
    const before = [...files].map(([path, bytes]) => [path, bytes.toString('hex')]);
    const repair = vi.fn(async () => { files.set('public/moved.glb', files.get('public/model.glb')!); files.delete('public/model.glb'); files.set('hidden.txt', Buffer.from('modified')); return true; });
    const replay = vi.fn(async () => ({ defects: [{ code: 'GAME_DEFECT_BLANK' as const, evidence: scenario }], scopeMissing: [], proof: null }));
    const revert = vi.fn(async () => { files.delete('public/moved.glb'); files.delete('hidden.txt'); });
    const changedSince = vi.fn(async () => 3);
    const outcome = await runGameRepair([{ code: 'GAME_DEFECT_BLANK', evidence: scenario }], ['levels'], 'repair this game', {
      snapshot: { 'src/main.ts': 'original' }, repairMs: 1000, buildSignal: new AbortController().signal,
      io: { repair, replay, revert, changedSince },
    });
    expect(outcome).toMatchObject({ attempted: false, kept: false, after: null, proof: null, scopeBefore: ['levels'] });
    for (const callback of [repair, replay, revert, changedSince]) expect(callback).not.toHaveBeenCalled();
    expect([...files].map(([path, bytes]) => [path, bytes.toString('hex')])).toEqual(before);
    expect(gameRepairRecord(outcome).message).not.toContain('attempted and undone');
    expect(gameIncompleteReason([{ code: 'GAME_DEFECT_BLANK', evidence: scenario }], ['levels'])).toContain('not playable');
  });
  it('never interprets an environment value as sufficient rollback proof', () => {
    for (const value of [undefined, '', 'on', 'true', '1', 'off', 'ON', 'force']) expect(gameAutoRepairEnabled({ AGENTV3_GAME_AUTO_REPAIR: value })).toBe(false);
  });
});

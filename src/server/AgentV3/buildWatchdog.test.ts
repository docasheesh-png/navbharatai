import { describe, it, expect } from 'vitest';
import { selectZombieBuilds, type ReapableBuild } from './buildWatchdog';

const NOW = 1_000_000_000;
const build = (over: Partial<ReapableBuild> = {}): ReapableBuild => ({ ended: false, startedTs: NOW, ...over });

describe('selectZombieBuilds', () => {
  it('reaps ended builds still lingering in the registry', () => {
    const m = new Map<string, ReapableBuild>([
      ['a', build({ ended: true })],
      ['b', build({ ended: false })],
    ]);
    expect(selectZombieBuilds(m.entries(), NOW, 0)).toEqual(['a']);
  });

  it('reaps a build grossly past the hard max', () => {
    const m = new Map<string, ReapableBuild>([
      ['fresh', build({ startedTs: NOW - 1_000 })],
      ['zombie', build({ startedTs: NOW - 10 * 60_000 })], // 10 min old
    ]);
    expect(selectZombieBuilds(m.entries(), NOW, 5 * 60_000)).toEqual(['zombie']);
  });

  it('does NOT reap a live build within the hard max (conservative — no false kill)', () => {
    const m = new Map<string, ReapableBuild>([['a', build({ startedTs: NOW - 60_000 })]]);
    expect(selectZombieBuilds(m.entries(), NOW, 5 * 60_000)).toEqual([]);
  });

  it('hardMaxMs<=0 disables the age check — only ended builds are swept', () => {
    const m = new Map<string, ReapableBuild>([
      ['old', build({ startedTs: NOW - 60 * 60_000 })], // an hour old but not ended → kept
      ['done', build({ ended: true })],
    ]);
    expect(selectZombieBuilds(m.entries(), NOW, 0)).toEqual(['done']);
  });

  it('empty registry → nothing to reap', () => {
    expect(selectZombieBuilds(new Map().entries(), NOW, 5 * 60_000)).toEqual([]);
  });
});

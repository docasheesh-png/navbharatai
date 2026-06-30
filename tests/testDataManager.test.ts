import { describe, it, expect } from 'vitest';
import { TestDataManager, sampleInputValue } from '../src/server/QualityEvaluationEngine/TestDataManager';
import userFixture from './fixtures/user.json';
import workspaceFixture from './fixtures/workspace.json';
import buildJobFixture from './fixtures/buildJob.json';
import chatMessageFixture from './fixtures/chatMessage.json';

/** P-TQA.9 — dependency-free seeded test data: determinism + fixture-shape parity. */

describe('TestDataManager determinism', () => {
  it('same seed → identical output, different seed → different output', () => {
    const a = new TestDataManager('seed-1');
    const b = new TestDataManager('seed-1');
    const c = new TestDataManager('seed-2');
    expect(a.user()).toEqual(b.user());
    expect(a.email()).toEqual(b.email());
    // Very likely different across seeds (deterministic but seed-dependent).
    expect(new TestDataManager('seed-2').user()).not.toEqual(new TestDataManager('seed-9').user());
    expect(c.id('x')).toMatch(/^x_[0-9a-f]{6}$/);
  });
  it('int respects bounds and list returns N records', () => {
    const m = new TestDataManager('bounds');
    for (let i = 0; i < 50; i++) { const n = m.int(5, 10); expect(n).toBeGreaterThanOrEqual(5); expect(n).toBeLessThanOrEqual(10); }
    expect(m.list(() => m.user(), 4)).toHaveLength(4);
  });
});

describe('factory ↔ fixture shape parity', () => {
  it('generated entities have the same keys as the JSON fixtures', () => {
    const m = new TestDataManager('parity');
    expect(Object.keys(m.user()).sort()).toEqual(Object.keys(userFixture).sort());
    expect(Object.keys(m.workspace()).sort()).toEqual(Object.keys(workspaceFixture).sort());
    expect(Object.keys(m.buildJob()).sort()).toEqual(Object.keys(buildJobFixture).sort());
    expect(Object.keys(m.chatMessage()).sort()).toEqual(Object.keys(chatMessageFixture).sort());
  });
});

describe('sampleInputValue', () => {
  it('is deterministic per label and non-empty', () => {
    expect(sampleInputValue('a')).toBe(sampleInputValue('a'));
    expect(sampleInputValue('a').length).toBeGreaterThan(0);
  });
});

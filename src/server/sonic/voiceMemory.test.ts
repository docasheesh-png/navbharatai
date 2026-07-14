import { describe, it, expect } from 'vitest';
import { dedupeConsecutive, mergeSeed, appendMemory, memoryKey } from './voiceMemory';
import type { SonicTurn } from './SonicBridge';

const u = (content: string): SonicTurn => ({ role: 'user', content });
const a = (content: string): SonicTurn => ({ role: 'assistant', content });

describe('dedupeConsecutive', () => {
  it('drops empties/whitespace and trims', () => {
    expect(dedupeConsecutive([u(' hi '), u('   '), a('')])).toEqual([u('hi')]);
  });

  it('collapses only EXACT consecutive same-role duplicates (not distant repeats)', () => {
    const r = dedupeConsecutive([u('hi'), u('hi'), a('hi'), u('hi')]);
    // consecutive user "hi","hi" collapses; assistant "hi" differs by role; final user "hi" is not
    // adjacent to a user "hi" so it stays.
    expect(r).toEqual([u('hi'), a('hi'), u('hi')]);
  });

  it('normalises an unknown role to user', () => {
    expect(dedupeConsecutive([{ role: 'system' as unknown as 'user', content: 'x' }])).toEqual([u('x')]);
  });
});

describe('mergeSeed — persisted memory first, then live text history, capped to newest', () => {
  it('orders persisted before client history', () => {
    expect(mergeSeed([u('old')], [a('new')])).toEqual([u('old'), a('new')]);
  });

  it('caps to the last N so the NEWEST context survives', () => {
    const persisted = [u('1'), a('2'), u('3')];
    const client = [a('4'), u('5')];
    expect(mergeSeed(persisted, client, 3)).toEqual([u('3'), a('4'), u('5')]);
  });

  it('handles either source empty', () => {
    expect(mergeSeed([], [u('hi')])).toEqual([u('hi')]);
    expect(mergeSeed([a('hi')], [])).toEqual([a('hi')]);
    expect(mergeSeed([], [])).toEqual([]);
  });
});

describe('appendMemory — rolling, bounded', () => {
  it('appends fresh turns after existing and caps to the last N', () => {
    const existing = [u('1'), a('2')];
    const fresh = [u('3'), a('4'), u('5')];
    // merged = [u1, a2, u3, a4, u5] → last 3
    expect(appendMemory(existing, fresh, 3)).toEqual([u('3'), a('4'), u('5')]);
  });

  it('keeps the most recent turns (bound never grows forever)', () => {
    const existing = Array.from({ length: 40 }, (_, i) => u(`e${i}`));
    const fresh = [a('final')];
    const out = appendMemory(existing, fresh, 30);
    expect(out.length).toBe(30);
    expect(out[out.length - 1]).toEqual(a('final'));
  });
});

describe('memoryKey', () => {
  it('combines user + professional and sanitises the professional id', () => {
    expect(memoryKey('user1', 'doctor')).toBe('user1__doctor');
    expect(memoryKey('user1')).toBe('user1__default');
    expect(memoryKey('user1', 'weird/../id')).toBe('user1__weird____id');
  });
});

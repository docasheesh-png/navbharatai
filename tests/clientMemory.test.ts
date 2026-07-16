/**
 * Generic per-user professional memory (admin 2026-07-15) — regression lock.
 *
 * The config-driven memory that turns every professional into a personal AI agent:
 * it takes a domain intake, saves what it learns in a hidden <user_memory> block,
 * and uses the remembered profile on every later visit. These tests encode the exact
 * failure classes: block leaking into the visible reply, malformed/oversized/unknown
 * model JSON poisoning the profile, and per-config field validation.
 */
import { describe, it, expect } from 'vitest';

import {
  extractMemory,
  sanitizeUpdate,
  mergeProfile,
  formatProfileBlock,
  hasFacts,
  memoryLayer,
  profileKey,
  type MemoryField,
  type ProfessionalMemory,
  type ClientProfile,
} from '../src/server/professionals/clientMemory';

const FIELDS: MemoryField[] = [
  { key: 'name', label: 'Name' },
  { key: 'goal', label: 'Goal' },
  { key: 'subjects', label: 'Subjects', list: true },
];

const MEMORY: ProfessionalMemory = {
  subject: 'client',
  intake: 'Learn their name and goal.',
  fields: FIELDS,
};

describe('extractMemory', () => {
  it('strips the <user_memory> block from the visible reply and returns raw JSON', () => {
    const raw = 'Great, Ravi!\n<user_memory>{"name":"Ravi","goal":"fat loss"}</user_memory>';
    const { reply, raw: parsed } = extractMemory(raw);
    expect(reply).toBe('Great, Ravi!');
    expect(reply).not.toMatch(/user_memory/);
    expect(parsed).toEqual({ name: 'Ravi', goal: 'fat loss' });
  });

  it('also strips the legacy <student_memory> tag defensively', () => {
    const { reply, raw } = extractMemory('Hi!\n<student_memory>{"name":"X"}</student_memory>');
    expect(reply).toBe('Hi!');
    expect(raw).toEqual({ name: 'X' });
  });

  it('a reply without a block passes through untouched', () => {
    const { reply, raw } = extractMemory('Just an answer.');
    expect(reply).toBe('Just an answer.');
    expect(raw).toBeNull();
  });

  it('malformed JSON still gets stripped (never leaks) but yields no update', () => {
    const { reply, raw } = extractMemory('Hi!\n<user_memory>{oops</user_memory>');
    expect(reply).toBe('Hi!');
    expect(raw).toBeNull();
  });

  it('multiple blocks: all stripped, last valid one wins', () => {
    const { reply, raw } = extractMemory('A<user_memory>{"name":"Old"}</user_memory>B<user_memory>{"name":"New"}</user_memory>');
    expect(reply).toBe('AB');
    expect(raw).toEqual({ name: 'New' });
  });

  it('a reply that is ONLY a block cleans to empty', () => {
    const { reply, raw } = extractMemory('<user_memory>{"name":"Ravi"}</user_memory>');
    expect(reply).toBe('');
    expect(raw).toEqual({ name: 'Ravi' });
  });
});

describe('sanitizeUpdate (per declared fields)', () => {
  it('drops unknown keys and wrong-typed values', () => {
    expect(sanitizeUpdate({ name: 'Ravi', hacker: 'x', subjects: 'not-an-array', goal: 42 }, FIELDS))
      .toEqual({ name: 'Ravi' });
  });

  it('keeps only declared list/scalar shapes', () => {
    expect(sanitizeUpdate({ subjects: ['Maths', 'maths', ' MATHS '], goal: 'muscle' }, FIELDS))
      .toEqual({ subjects: ['Maths'], goal: 'muscle' });
  });

  it('bounds scalar length and list size', () => {
    const many = Array.from({ length: 60 }, (_, i) => `s${i}`);
    const upd = sanitizeUpdate({ name: 'x'.repeat(800), subjects: many }, FIELDS)!;
    expect(upd.name!.length).toBeLessThanOrEqual(500);
    expect((upd.subjects as string[]).length).toBeLessThanOrEqual(40);
  });

  it('rejects empty / non-object updates', () => {
    expect(sanitizeUpdate({ name: '   ' }, FIELDS)).toBeNull();
    expect(sanitizeUpdate('nope', FIELDS)).toBeNull();
    expect(sanitizeUpdate(null, FIELDS)).toBeNull();
    expect(sanitizeUpdate([1, 2], FIELDS)).toBeNull();
  });
});

describe('mergeProfile', () => {
  it('scalars overwrite, lists union without duplicates, missing keys survive', () => {
    const existing: ClientProfile = { name: 'Ravi', goal: 'maintain', subjects: ['Physics'] };
    const merged = mergeProfile(existing, { name: 'Ravi Kumar', subjects: ['physics', 'Chemistry'] }, FIELDS);
    expect(merged.name).toBe('Ravi Kumar');
    expect(merged.goal).toBe('maintain');
    expect(merged.subjects).toEqual(['physics', 'Chemistry']);
  });

  it('caps keep the NEWEST list facts when full', () => {
    const existing: ClientProfile = { subjects: Array.from({ length: 40 }, (_, i) => `old${i}`) };
    const merged = mergeProfile(existing, { subjects: ['brand new'] }, FIELDS);
    expect((merged.subjects as string[]).length).toBeLessThanOrEqual(40);
    expect(merged.subjects).toContain('brand new');
    expect(merged.subjects).not.toContain('old0');
  });
});

describe('prompt blocks', () => {
  it('formats known facts with the subject heading; empty for an empty profile', () => {
    const block = formatProfileBlock({ name: 'Ravi', subjects: ['Maths'] }, MEMORY);
    expect(block).toMatch(/WHAT YOU ALREADY KNOW ABOUT THIS CLIENT/);
    expect(block).toMatch(/Ravi/);
    expect(block).toMatch(/Maths/);
    expect(formatProfileBlock(null, MEMORY)).toBe('');
    expect(formatProfileBlock({}, MEMORY)).toBe('');
    expect(hasFacts({ subjects: [] }, FIELDS)).toBe(false);
  });

  it('signed-in layer instructs saving with the declared keys; anonymous forbids fake memory', () => {
    const signedIn = memoryLayer(true, MEMORY);
    expect(signedIn).toMatch(/<user_memory>/);
    expect(signedIn).toMatch(/FIRST MEETING/);
    expect(signedIn).toMatch(/"name"/);
    expect(signedIn).toMatch(/Learn their name and goal/);
    const anon = memoryLayer(false, MEMORY);
    expect(anon).toMatch(/NOT signed in/);
    expect(anon).toMatch(/Never claim permanent memory/);
    expect(anon).toMatch(/Do not output any <user_memory> block/);
  });

  it('profileKey is stable and Firestore-safe', () => {
    expect(profileKey('uid123', 'teacher_ai')).toBe('uid123__teacher_ai');
    expect(profileKey('uid123', 'weird/id!')).toBe('uid123__weird_id_');
  });
});

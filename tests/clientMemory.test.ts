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
  effectiveFields,
  splitUpdate,
  combinedProfile,
  isSharedKey,
  SHARED_MEMORY_FIELDS,
  SHARED_PROFILE_ID,
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

// ── THE SHARED IDENTITY — facts cross chats, words do not (admin 2026-09-21) ─────────────────────────
describe('shared identity (SHARED_MEMORY_FIELDS)', () => {
  it('effectiveFields = own fields + the shared ones not declared, deduped by key, own label winning', () => {
    const fields = effectiveFields(MEMORY);
    const keys = fields.map((f) => f.key);
    expect(keys.slice(0, 3)).toEqual(['name', 'goal', 'subjects']);
    expect(keys).toEqual(expect.arrayContaining(['language', 'location', 'occupation', 'remember']));
    // `name` appears ONCE, with the professional's own declaration.
    expect(keys.filter((k) => k === 'name')).toHaveLength(1);
    expect(fields.find((f) => f.key === 'name')?.label).toBe('Name');
  });

  it('splitUpdate: a declared key stays own, a shared key goes to shared, a key in both goes to both', () => {
    const { own, shared } = splitUpdate({ name: 'Ravi', goal: 'fat loss', location: 'Pune', remember: ['call me Ravi ji'] }, MEMORY);
    expect(own).toEqual({ name: 'Ravi', goal: 'fat loss' });
    expect(shared).toEqual({ name: 'Ravi', location: 'Pune', remember: ['call me Ravi ji'] });
  });

  it('splitUpdate: nothing shared → shared is null; nothing own → own is null; null in → both null', () => {
    expect(splitUpdate({ goal: 'x' }, MEMORY)).toEqual({ own: { goal: 'x' }, shared: null });
    expect(splitUpdate({ occupation: 'nurse' }, MEMORY)).toEqual({ own: null, shared: { occupation: 'nurse' } });
    expect(splitUpdate(null, MEMORY)).toEqual({ own: null, shared: null });
  });

  it('sanitizeUpdate against the effective fields accepts shared keys a professional never declared', () => {
    const clean = sanitizeUpdate({ location: '  Lucknow ', remember: ['a', 'A', 'b'], bogus: 'x' }, effectiveFields(MEMORY));
    expect(clean).toEqual({ location: 'Lucknow', remember: ['a', 'b'] });
  });

  it('combinedProfile: the professional\'s own value wins, shared fills the gaps', () => {
    expect(combinedProfile({ name: 'Priya', goal: 'CA' }, { name: 'P. Sharma', location: 'Delhi' }))
      .toEqual({ name: 'Priya', goal: 'CA', location: 'Delhi' });
    expect(combinedProfile(null, null)).toEqual({});
  });

  it('formatProfileBlock renders a shared fact the professional did not declare', () => {
    const block = formatProfileBlock({ name: 'Priya', occupation: 'nurse', remember: ['reply in Hinglish'] }, MEMORY);
    expect(block).toMatch(/• Does: nurse/);
    expect(block).toMatch(/• They asked you to remember: reply in Hinglish/);
  });

  it('the signed-in memory layer names the shared keys and the "remember this" rule; the anonymous one does not save', () => {
    const signedIn = memoryLayer(true, MEMORY);
    expect(signedIn).toMatch(/"remember":\[…\]/);
    expect(signedIn).toMatch(/"occupation"/);
    expect(signedIn).toMatch(/WHO THEY ARE IS SHARED/);
    expect(signedIn).toMatch(/REMEMBER THIS/);
    expect(signedIn).toMatch(/What was SAID in another chat is never shown to you/);
    expect(memoryLayer(false, MEMORY)).not.toMatch(/"remember"/);
  });

  it('the shared profile id can never collide with a professional id, and survives profileKey intact', () => {
    expect(SHARED_PROFILE_ID).toBe('_shared');
    expect(profileKey('uid1', SHARED_PROFILE_ID)).toBe('uid1___shared');
    expect(isSharedKey('remember')).toBe(true);
    expect(isSharedKey('notes')).toBe(false);
    // `remember` is authored by the PERSON — its hint must say so, in the instruction the model reads.
    expect(SHARED_MEMORY_FIELDS.find((f) => f.key === 'remember')?.hint).toMatch(/explicitly/);
  });
});

/**
 * Teacher AI student-profile memory (admin 2026-07-14) — regression lock.
 *
 * The teacher takes a day-one introduction, saves what it learns about the student
 * in a hidden <student_memory> block, and uses the remembered profile on every
 * later visit. These tests encode the exact failure classes: block leaking into
 * the visible reply, malformed/oversized model JSON poisoning the profile, memory
 * keyed to an unverified identity, and the profile not reaching the system prompt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  extractStudentMemory,
  sanitizeProfileUpdate,
  mergeStudentProfile,
  formatStudentProfileBlock,
  hasProfileFacts,
  studentMemoryLayer,
  profileKey,
  type StudentProfile,
} from '../src/server/professionals/studentProfile';

describe('extractStudentMemory', () => {
  it('strips the block from the visible reply and parses the update', () => {
    const raw = 'Great, Ravi! Let\'s begin.\n<student_memory>{"name":"Ravi","targetExams":["NEET"]}</student_memory>';
    const { reply, update } = extractStudentMemory(raw);
    expect(reply).toBe("Great, Ravi! Let's begin.");
    expect(reply).not.toMatch(/student_memory/);
    expect(update).toEqual({ name: 'Ravi', targetExams: ['NEET'] });
  });

  it('a reply without a block passes through untouched', () => {
    const { reply, update } = extractStudentMemory('Just an answer.');
    expect(reply).toBe('Just an answer.');
    expect(update).toBeNull();
  });

  it('malformed JSON still gets stripped (never leaks) but yields no update', () => {
    const { reply, update } = extractStudentMemory('Hi!\n<student_memory>{oops not json</student_memory>');
    expect(reply).toBe('Hi!');
    expect(update).toBeNull();
  });

  it('multiple blocks: all stripped, last valid one wins', () => {
    const raw = 'A<student_memory>{"name":"Old"}</student_memory>B<student_memory>{"name":"New"}</student_memory>';
    const { reply, update } = extractStudentMemory(raw);
    expect(reply).toBe('AB');
    expect(update).toEqual({ name: 'New' });
  });

  it('a reply that is ONLY a block cleans to empty (caller substitutes a safe line)', () => {
    const { reply, update } = extractStudentMemory('<student_memory>{"name":"Ravi"}</student_memory>');
    expect(reply).toBe('');
    expect(update).toEqual({ name: 'Ravi' });
  });
});

describe('sanitizeProfileUpdate', () => {
  it('drops unknown keys and wrong-typed values', () => {
    expect(
      sanitizeProfileUpdate({ name: 'Ravi', hacker: 'x', subjects: 'not-an-array', notes: [42, 'real note'] }),
    ).toEqual({ name: 'Ravi', notes: ['real note'] });
  });

  it('bounds scalar length and array size', () => {
    const upd = sanitizeProfileUpdate({
      name: 'x'.repeat(500),
      subjects: Array.from({ length: 50 }, (_, i) => `sub${i}`),
    })!;
    expect(upd.name!.length).toBeLessThanOrEqual(160);
    expect(upd.subjects!.length).toBeLessThanOrEqual(12);
  });

  it('dedupes array items case-insensitively and rejects empty updates', () => {
    expect(sanitizeProfileUpdate({ subjects: ['Maths', 'maths', ' MATHS '] })).toEqual({ subjects: ['Maths'] });
    expect(sanitizeProfileUpdate({ name: '   ' })).toBeNull();
    expect(sanitizeProfileUpdate('nope')).toBeNull();
    expect(sanitizeProfileUpdate(null)).toBeNull();
    expect(sanitizeProfileUpdate([1, 2])).toBeNull();
  });
});

describe('mergeStudentProfile', () => {
  it('scalars overwrite, arrays union without duplicates, missing keys survive', () => {
    const existing: StudentProfile = { name: 'Ravi', college: 'DAV College', subjects: ['Physics'] };
    const merged = mergeStudentProfile(existing, { name: 'Ravi Kumar', subjects: ['physics', 'Chemistry'] });
    expect(merged.name).toBe('Ravi Kumar');
    expect(merged.college).toBe('DAV College');
    // Newest mention wins the dedup (fresh casing kept) — one entry per subject.
    expect(merged.subjects).toEqual(['physics', 'Chemistry']);
  });

  it('caps keep the NEWEST facts when full', () => {
    const existing: StudentProfile = { notes: Array.from({ length: 20 }, (_, i) => `old note ${i}`) };
    const merged = mergeStudentProfile(existing, { notes: ['brand new note'] });
    expect(merged.notes!.length).toBeLessThanOrEqual(20);
    expect(merged.notes).toContain('brand new note');
    expect(merged.notes).not.toContain('old note 0');
  });
});

describe('profile prompt blocks', () => {
  it('formats known facts and is empty for an empty profile', () => {
    const block = formatStudentProfileBlock({
      name: 'Ravi',
      studying: 'Class 12 PCM',
      targetExams: ['JEE'],
      weakSubjects: ['Organic Chemistry'],
    });
    expect(block).toMatch(/WHAT YOU ALREADY KNOW ABOUT THIS STUDENT/);
    expect(block).toMatch(/Ravi/);
    expect(block).toMatch(/JEE/);
    expect(block).toMatch(/Organic Chemistry/);
    expect(formatStudentProfileBlock(null)).toBe('');
    expect(formatStudentProfileBlock({})).toBe('');
    expect(hasProfileFacts({ subjects: [] })).toBe(false);
  });

  it('signed-in layer instructs saving; anonymous layer forbids fake memory claims', () => {
    const signedIn = studentMemoryLayer(true);
    expect(signedIn).toMatch(/<student_memory>/);
    expect(signedIn).toMatch(/FIRST MEETING/);
    const anon = studentMemoryLayer(false);
    expect(anon).toMatch(/NOT signed in/);
    expect(anon).toMatch(/Never claim permanent memory/);
    expect(anon).toMatch(/Do not output any <student_memory> block/);
  });

  it('profileKey is stable and filesystem/Firestore safe', () => {
    expect(profileKey('uid123', 'teacher_ai')).toBe('uid123__teacher_ai');
    expect(profileKey('uid123', 'weird/id!')).toBe('uid123__weird_id_');
  });
});

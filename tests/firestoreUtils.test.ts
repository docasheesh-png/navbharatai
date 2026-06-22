/**
 * Tests for src/lib/firestoreUtils.ts — pure, no I/O.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeFirestoreData } from '../src/lib/firestoreUtils';

describe('sanitizeFirestoreData', () => {
  it('returns the same object when no undefined values are present', () => {
    const input = { a: 1, b: 'hello', c: true };
    const result = sanitizeFirestoreData(input);
    expect(result).toEqual(input);
  });

  it('replaces top-level undefined values with null', () => {
    const result = sanitizeFirestoreData({ a: undefined, b: 42 });
    expect(result.a).toBeNull();
    expect(result.b).toBe(42);
  });

  it('recursively replaces nested undefined with null', () => {
    const result = sanitizeFirestoreData({ nested: { x: undefined, y: 5 } });
    expect(result.nested.x).toBeNull();
    expect(result.nested.y).toBe(5);
  });

  it('does not modify null values (null stays null)', () => {
    const result = sanitizeFirestoreData({ a: null });
    expect(result.a).toBeNull();
  });

  it('preserves string, number, and boolean primitive values', () => {
    const input = { s: 'hello', n: 123, b: false };
    expect(sanitizeFirestoreData(input)).toEqual(input);
  });

  it('handles empty object without throwing', () => {
    expect(sanitizeFirestoreData({})).toEqual({});
  });

  it('does not mutate the original object', () => {
    const original = { a: undefined };
    sanitizeFirestoreData(original);
    expect(original.a).toBeUndefined();
  });
});

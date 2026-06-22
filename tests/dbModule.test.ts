/**
 * Tests for the shared Firestore handle module (lib/db.ts).
 * Verifies the setter/getter contract without a real Firestore connection.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setDb, getDb } from '../src/server/lib/db';

describe('lib/db', () => {
  afterEach(() => {
    // Reset module state after each test
    setDb(null);
  });

  it('getDb() returns null before setDb is called', () => {
    setDb(null);
    expect(getDb()).toBeNull();
  });

  it('setDb() stores the value returned by getDb()', () => {
    const fakeDb = { fake: true } as any;
    setDb(fakeDb);
    expect(getDb()).toBe(fakeDb);
  });

  it('setDb(null) clears the stored value', () => {
    setDb({ fake: true } as any);
    setDb(null);
    expect(getDb()).toBeNull();
  });

  it('repeated setDb() calls overwrite the previous value', () => {
    const db1 = { id: 1 } as any;
    const db2 = { id: 2 } as any;
    setDb(db1);
    setDb(db2);
    expect(getDb()).toBe(db2);
  });
});

import { describe, it, expect, vi } from 'vitest';

// THE PROD BUG THIS LOCKS DOWN: every server store used to share the ONE default Firestore instance
// (admin.firestore()) and call Firestore.settings() on it — but settings() may only be called ONCE per
// instance. Whichever store initialized first won that call; FirestoreConversationStore's constructor
// then THREW on its own settings() call, and getConversationStore()'s catch silently demoted durable
// chat history to the IN-MEMORY store for the life of the instance. Symptom (admin report, 2026-07-03):
// history opens fine while the tab stays open (same warm instance RAM), but after a reload / restart
// that lands on a fresh or recycled Cloud Run instance, every transcript is gone again.
//
// ROOT FIX (T0-3, 2026-07-12): the store no longer calls admin.firestore().settings() at all. It takes
// the shared, collision-free handle from serverDb.getServerDb() (getFirestore(app, dbId) — a per-database
// cached instance configured exactly ONCE, centrally). So the once-per-instance settings() race can no
// longer demote this store: there is no settings() call left on the store's path to collide. This test
// locks that invariant — construction never throws AND the store never calls settings() itself.

const settingsSpy = vi.fn(() => {
  throw new Error('Firestore has already been initialized. You can only call settings() once.');
});
const fakeDb = {
  settings: settingsSpy,
  collection: vi.fn(() => ({ doc: vi.fn() })),
};

// getServerDb() returns null under VITEST, so the constructor falls back to admin.firestore() (this
// fakeDb) — exercising the exact path that used to call settings() and throw.
vi.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }], // an app already exists — initializeApp must not be needed
  initializeApp: vi.fn(),
  firestore: () => fakeDb,
}));

describe('FirestoreConversationStore init (collision-free shared handle — T0-3)', () => {
  it('constructs successfully and never calls settings() itself (collision impossible by construction)', async () => {
    const { FirestoreConversationStore } = await import('./FirestoreConversationStore');
    // Before the root fix this constructor called settings() and THREW when another store had already
    // claimed it, and the caller fell back to the in-memory store — transcripts became RAM-only.
    expect(() => new FirestoreConversationStore()).not.toThrow();
    // The store must NOT call settings() on the shared instance anymore — that call is what could throw
    // and demote it. Configuration now happens exactly once inside getServerDb(), never here.
    expect(settingsSpy).not.toHaveBeenCalled();
  });
});

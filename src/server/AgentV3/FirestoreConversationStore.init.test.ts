import { describe, it, expect, vi } from 'vitest';

// THE PROD BUG THIS LOCKS DOWN: every server store shares the ONE default Firestore instance,
// and Firestore.settings() may only be called once on it. Whichever store initialized first won
// that call; FirestoreConversationStore's constructor then THREW on its own settings() call, and
// getConversationStore()'s catch silently demoted durable chat history to the IN-MEMORY store
// for the life of the instance. Symptom (admin report, 2026-07-03): history opens fine while the
// tab stays open (same warm instance RAM), but after a reload / browser restart that lands on a
// fresh or recycled Cloud Run instance, every transcript is gone again. The constructor must
// treat "settings already configured" as success — the instance is already pointed at the SAME
// databaseId every store passes.

const settingsSpy = vi.fn(() => {
  throw new Error('Firestore has already been initialized. You can only call settings() once.');
});
const fakeDb = {
  settings: settingsSpy,
  collection: vi.fn(() => ({ doc: vi.fn() })),
};

vi.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }], // an app already exists — initializeApp must not be needed
  initializeApp: vi.fn(),
  firestore: () => fakeDb,
}));

describe('FirestoreConversationStore init (shared-instance settings guard)', () => {
  it('constructs successfully even when settings() was already claimed by another store', async () => {
    const { FirestoreConversationStore } = await import('./FirestoreConversationStore');
    // Before the fix this line THREW, and the caller fell back to the in-memory store —
    // transcripts silently became RAM-only in production.
    expect(() => new FirestoreConversationStore()).not.toThrow();
    expect(settingsSpy).toHaveBeenCalled(); // it did attempt to configure, and survived the throw
  });
});

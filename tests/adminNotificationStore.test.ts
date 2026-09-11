import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { notificationMatchesUser, normalizeTarget } from '../src/server/lib/AdminNotificationStore';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('notificationMatchesUser — who receives a notification', () => {
  it('an "all" broadcast reaches every user', () => {
    expect(notificationMatchesUser({ target: { type: 'all' } }, 'u1', 'a@b.com')).toBe(true);
    expect(notificationMatchesUser({ target: { type: 'all' } }, null, null)).toBe(true);
  });

  it('a user-targeted notification matches by uid', () => {
    expect(notificationMatchesUser({ target: { type: 'user', userId: 'u1' } }, 'u1', 'x@y.com')).toBe(true);
    expect(notificationMatchesUser({ target: { type: 'user', userId: 'u1' } }, 'u2', 'x@y.com')).toBe(false);
  });

  it('a user-targeted notification matches by email, case-insensitively', () => {
    expect(notificationMatchesUser({ target: { type: 'user', email: 'Admin@Test.com' } }, 'u9', 'admin@test.com')).toBe(true);
    expect(notificationMatchesUser({ target: { type: 'user', email: 'a@b.com' } }, 'u9', 'other@b.com')).toBe(false);
  });

  it('a user target with neither uid nor email reaches nobody', () => {
    expect(notificationMatchesUser({ target: { type: 'user' } }, 'u1', 'a@b.com')).toBe(false);
  });
});

describe('normalizeTarget — admin input → clean target', () => {
  it('defaults to an all-broadcast', () => {
    expect(normalizeTarget({})).toEqual({ type: 'all' });
    expect(normalizeTarget({ target: 'all' })).toEqual({ type: 'all' });
    expect(normalizeTarget({ target: '' })).toEqual({ type: 'all' });
  });

  it('a specific-user send carries the email', () => {
    expect(normalizeTarget({ target: 'user', email: 'user@x.com' })).toEqual({ type: 'user', userId: null, email: 'user@x.com' });
  });

  it('an email typed directly into the target field is honoured', () => {
    expect(normalizeTarget({ target: 'someone@x.com' })).toEqual({ type: 'user', userId: null, email: 'someone@x.com' });
  });

  it('carries a userId when provided', () => {
    expect(normalizeTarget({ target: 'user', userId: 'u1' })).toEqual({ type: 'user', userId: 'u1', email: null });
  });
});


/**
 * DELETING A NOTIFICATION (admin 2026-09-11: "delete karne ka bhi to button do — select delete,
 * select all delete").
 *
 * The store is Firestore-backed and skipped under VITEST, so these pin the two invariants that make
 * the feature safe rather than the I/O: it must never delete a shared document, and read state and
 * dismissal must never erase one another.
 */
describe('delete is per-user dismissal, never a document delete', () => {
  const store = src('src/server/lib/AdminNotificationStore.ts');
  const route = src('src/server/routes/notifications.ts');

  it('🔒 dismissal NEVER deletes the notification document', () => {
    // A broadcast is ONE row that every user's list reads. Deleting it because one person pressed
    // delete would empty everybody's inbox — including people who never saw the message.
    const fn = store.slice(store.indexOf('export async function dismissNotifications('));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    expect(body).not.toContain('.delete(');
    expect(body).toContain('updateUserState(uid, { dismissed: ids })');
  });

  it('🔒 read state and dismissal are written by ONE function, so they cannot wipe each other', () => {
    // The read write was `set({ readIds }, { merge: false })` — a FULL replace. A second, independent
    // writer for dismissedIds would have meant opening the bell silently erased every deletion, and
    // deleted messages would reappear with nothing failing to explain it.
    expect(store).toContain('async function updateUserState(');
    // Exactly one place writes the state document.
    expect(store.match(/READS_COLLECTION\)\.doc\(uid\)\.set\(/g) ?? []).toHaveLength(1);
    // And that write carries BOTH fields, every time.
    const writer = store.slice(store.indexOf('async function updateUserState('));
    expect(writer.slice(0, writer.indexOf('\n}') + 2)).toContain('readIds: capIds(state.readIds), dismissedIds: capIds(state.dismissedIds)');
  });

  it('a dismissed notification is filtered out of the list entirely', () => {
    expect(store).toContain('!state.dismissedIds.has(n.id)');
  });

  it('"delete all" is resolved SERVER-side from what this user can see', () => {
    // Never from a list the client sends, and never "every notification in the system".
    const del = route.slice(route.indexOf("app.post('/api/notifications/delete'"));
    expect(del).toContain('listNotificationsForUser(uid, email)');
    expect(del).toContain('verifyFirebaseToken(req)');
    // A caller cannot make us write an unbounded id list.
    expect(del).toContain('.slice(0, 200)');
  });

  it('the bell removes rows only AFTER the server confirms', () => {
    // An optimistic removal would show a message as deleted and have it reappear on the next
    // 90-second poll — which reads as the delete button being broken.
    const bell = src('src/components/NotificationBell.tsx');
    const fn = bell.slice(bell.indexOf('const deleteNotifications ='));
    const body = fn.slice(0, fn.indexOf('\n  };') + 5);
    expect(body.indexOf('if (!res.ok) return;')).toBeLessThan(body.indexOf('setItems((prev) => prev.filter'));
  });

  it('the bell offers select-one, select-all and delete-all', () => {
    const bell = src('src/components/NotificationBell.tsx');
    expect(bell).toContain('Select all');
    expect(bell).toContain('Delete all');
    expect(bell).toContain('type="checkbox"');          // a real, keyboard-reachable control
    expect(bell).toContain('aria-label="Delete this message"');
  });
});

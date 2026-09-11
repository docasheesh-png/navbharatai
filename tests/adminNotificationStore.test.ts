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

  it('🔒 there is NO "delete everything" request — deletion is by EXPLICIT ID only', () => {
    // The first version accepted `{ all: true }` and resolved it server-side into every message the
    // user could see. One call, whole inbox gone — and the admin lost theirs to a single mis-tap on
    // the button that sent it (2026-09-11). The capability is REMOVED, not merely hidden behind a
    // nicer UI: a destructive one-shot endpoint that no screen uses is a loaded gun for the next
    // caller. Clearing an inbox still works — the client ticks the rows and sends their ids.
    const del = route.slice(route.indexOf("app.post('/api/notifications/delete'"));
    expect(del).not.toContain('all === true');
    expect(del).not.toContain('body.all');
    expect(del).toContain('verifyFirebaseToken(req)');
    // A caller cannot make us write an unbounded id list.
    expect(del).toContain('.slice(0, 200)');
  });

  it('the bell removes rows only AFTER the server confirms, and says so when it fails', () => {
    // An optimistic removal would show a message as deleted and have it reappear on the next
    // 90-second poll — which reads as the delete button being broken.
    const bell = src('src/components/NotificationBell.tsx');
    const fn = bell.slice(bell.indexOf('const confirmDelete ='));
    const body = fn.slice(0, fn.indexOf('\n  };') + 5);
    expect(body.indexOf('if (!res.ok) { setFailed(true); return; }')).toBeLessThan(body.indexOf('setItems((prev) => prev.filter'));
    // A failed delete is stated on screen rather than looking like nothing happened.
    expect(bell).toContain('nothing was removed');
  });
});

/**
 * 🔴 DELETING TAKES THREE DELIBERATE STEPS (admin 2026-09-11, after a mis-tap emptied their inbox).
 *
 * The first version put an unconfirmed **Delete all** in the header beside the close button, and a bin
 * icon on every row. Both were single destructive taps in the exact place a thumb lands when trying to
 * dismiss the panel. These tests pin the shape that replaced it, so nobody "simplifies" the friction
 * away later — the friction IS the feature.
 */
describe('the delete flow cannot destroy anything in one tap', () => {
  const bell = src('src/components/NotificationBell.tsx');
  /**
   * Comments are stripped before asserting a pattern is GONE. The file's own header explains WHY the
   * old "Delete all" was removed and therefore has to quote it — and a naive search cannot tell the
   * record of a mistake from the mistake itself. (Third time this exact trap has bitten in this repo;
   * for an ABSENCE claim, always search the code, not the prose.)
   */
  const bellCode = bell
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  it('🔒 the header has NO delete-all, and no row has a one-tap bin', () => {
    expect(bellCode).not.toContain('Delete all');
    expect(bellCode).not.toContain('aria-label="Delete this message"');
    // Nothing anywhere sends the old whole-inbox request.
    expect(bellCode).not.toContain('all: true');
  });

  it('step 1 — the header offers only Select (plus close) until selecting', () => {
    expect(bell).toContain('>\n                      Select\n                    <');
    expect(bell).toContain('setSelecting(true)');
  });

  it('step 2 — checkboxes exist ONLY in select mode, so a normal read cannot mis-tap one', () => {
    expect(bell).toContain('if (!selecting) {');
    expect(bell).toContain('type="checkbox"');   // a real, keyboard-reachable control
    expect(bell).toContain('Select all');        // lives inside select mode, still needs Delete + confirm
  });

  it('step 3 — Delete appears only with a selection, and opens a CONFIRMATION rather than deleting', () => {
    expect(bell).toContain('selected.size > 0 &&');
    expect(bell).toContain('setConfirming(true)');
    // The Delete button must NOT call the delete function directly — that is the mis-tap this fixes.
    const header = bell.slice(bell.indexOf('{selecting && ('), bell.indexOf('{/* Select-all lives'));
    expect(header).not.toContain('confirmDelete');
  });

  it('the confirmation names the exact COUNT and what deleting does not do', () => {
    expect(bell).toContain('Delete {selected.size} message');
    expect(bell).toContain('other\n                      people keep');
    expect(bell).toContain('OK, delete');
    expect(bell).toContain('Cancel');
  });

  it('🔒 confirmDelete is reachable ONLY from the confirmation dialog', () => {
    // Exactly one call site, and it is the OK button inside the confirming block.
    const calls = bell.match(/confirmDelete\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    const dialog = bell.slice(bell.indexOf('{confirming && ('));
    expect(dialog).toContain('void confirmDelete()');
  });

  it('closing the panel drops a half-made selection rather than keeping it armed', () => {
    expect(bell).toContain('else cancelSelection();');
  });
});

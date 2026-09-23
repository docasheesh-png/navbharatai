import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { authJsonHeaders } from '../lib/authHeaders';

/**
 * The app header's own height, restated here because a `fixed` panel cannot inherit it.
 *
 * The header is TopNav's `<nav className="h-10 …">` — 2.5rem, 40px — laid out inside the app root's
 * `--nb-safe-top` padding. A `position: fixed` panel is anchored to the VIEWPORT instead, receives none
 * of the root's padding, and so must add BOTH back itself. Exported so
 * `tests/theNotificationsPanelClearsTheHeader.test.ts` can read TopNav.tsx and fail if the header's
 * height ever moves away from this value.
 *
 * 🔴 CORRECTED 2026-09-23 — this said `3.5rem`, copied from App.tsx's content calc
 * `100vh - 3.5rem - var(--nb-safe-top)`, on the premise that the calc restated the header. It did not:
 * the header has been `h-10` since before that calc was written, and the calc was itself the bug (every
 * full-height screen ended 16px short of the viewport). The calc is gone; this now names the header.
 */
export const HEADER_H = '2.5rem';

/** The gap between the header's bottom edge and the panel's top. Purely visual breathing room. */
export const PANEL_GAP = '0.5rem';

/**
 * Where the panel's top edge sits: below the notch, below the header, plus the gap.
 *
 * Measured in real Chromium against the built stylesheet, with the old `top-12` (48px):
 *   notch 0px  → header 0–56   → 8px of the panel hidden under the header
 *   notch 47px → header 47–103 → 55px hidden
 * and 0px hidden with this value at both.
 */
export const PANEL_TOP = `calc(var(--nb-safe-top, 0px) + ${HEADER_H} + ${PANEL_GAP})`;

/**
 * Notifications inbox (admin 2026-07-30) — delivers admin → user messages in-app. Fetches the signed-in
 * user's notifications (broadcasts + those targeted at them), reports the unread count, and marks them
 * read when the panel is opened. Real end-to-end: no message = empty state, never a fake dot.
 *
 * 🔔 THE BELL LEFT THE HEADER (admin 2026-09-22: *"notifications ko header se hata kar, sidebar menu me
 * karo, dot ke sath … 3-line menu button par dot dikhe, fir notification option par number dikhe"*).
 * The header's one row is where the open chat windows live, and a bell there was width taken from
 * them. So this file is now two halves and no button: `useNotificationInbox` (App owns it — the unread
 * count has to be known while the panel is CLOSED, for the ☰ dot and the sidebar row's number) and
 * `NotificationPanel` (the same list, opened from the sidebar's "Notifications" row). The file keeps
 * its name because the delete flow below is pinned by tests under it.
 *
 * 🔴 THE DELETE FLOW IS DELIBERATELY THREE STEPS, AND THIS IS WHY (admin, 2026-09-11, after losing
 * their whole inbox to a mis-tap):
 *
 * The first version put a one-tap **Delete all** in the header, permanently visible, beside the close
 * button — and a bin icon on every row. Both were single, unconfirmed, destructive taps sitting in the
 * exact place a thumb lands when trying to dismiss the panel. The admin hit Delete all by accident and
 * every message went. That is not a user error; it is a design that made the worst outcome the easiest
 * gesture, which is the opposite of how a destructive action should be built.
 *
 * The flow now:
 *   1. **Select** — the header's only action. Nothing is destroyed by pressing it.
 *   2. **Tick** the messages. Checkboxes exist ONLY in select mode, so a normal read cannot mis-tap one.
 *   3. **Delete (n)** appears only once something is ticked, and asks for confirmation before acting.
 *
 * So reaching a deletion takes three deliberate taps and passes a confirmation naming the exact count.
 * There is no path — not a row bin, not a header button — that deletes anything in one tap.
 *
 * ⚠️ DO NOT "simplify" this back into a single button. The friction IS the feature.
 */

interface NotificationItem {
  id: string;
  message: string;
  createdAt: number;
  read: boolean;
  /**
   * Where tapping it goes, when it goes anywhere.
   *
   * ⚠️ A NAME THIS BUILD KNOWS, NEVER A URL. The server stores a closed set of our own action names
   * (see AdminNotificationStore) precisely so a stored value cannot point somewhere we did not build
   * — a free-form link on a broadcast record would turn the admin's message form into a way to send
   * every user a tappable address. An unrecognised value simply renders as a plain message.
   */
  action?: 'open-reports' | 'open-billing';
}

export interface NotificationInbox {
  items: NotificationItem[];
  unread: number;
  /** Mark every currently-unread message read (optimistic; the badge clears at once). */
  markReadVisible: () => Promise<void>;
  /** Delete these ids from THIS user's inbox. Resolves false when the server refused. */
  deleteIds: (ids: string[]) => Promise<boolean>;
}

/** The inbox itself: fetched on sign-in, polled every 90 s, shared by the ☰ dot, the sidebar row and the panel. */
export function useNotificationInbox(user: FirebaseUser | null): NotificationInbox {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) { setItems([]); setUnread(0); return; }
    try {
      const res = await fetch('/api/notifications', { headers: await authJsonHeaders() });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const list: NotificationItem[] = Array.isArray(data?.notifications) ? data.notifications : [];
      setItems(list);
      setUnread(typeof data?.unread === 'number' ? data.unread : list.filter((n) => !n.read).length);
    } catch { /* best-effort — the count just stays as it was */ }
  }, [user]);

  // Load on sign-in + poll every 90s so an admin message shows up without a reload.
  useEffect(() => {
    void load();
    if (pollRef.current) clearInterval(pollRef.current);
    if (user) pollRef.current = setInterval(() => void load(), 90_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, load]);

  const markReadVisible = useCallback(async () => {
    if (!user) return;
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    // Optimistic: clear the badge immediately.
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { ...(await authJsonHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds }),
      });
    } catch { /* best-effort — a failed mark-read just reappears on next load */ }
  }, [user, items]);

  /**
   * The ONLY code path that deletes anything, reachable only from the panel's confirmation dialog.
   *
   * Deletion is per-user on the server (a broadcast is one shared document), so this empties the
   * caller's own inbox and nobody else's.
   *
   * The rows are removed only AFTER the server confirms. An optimistic removal would show a message as
   * deleted and have it reappear on the next 90-second poll, which reads as the button being broken —
   * and a FAILED delete is reported to the panel rather than looking like nothing happened.
   */
  const deleteIds = useCallback(async (ids: string[]): Promise<boolean> => {
    if (!user || ids.length === 0) return false;
    try {
      const res = await fetch('/api/notifications/delete', {
        method: 'POST',
        headers: { ...(await authJsonHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return false;
      const gone = new Set(ids);
      setItems((prev) => prev.filter((n) => !gone.has(n.id)));
      setUnread((u) => Math.max(0, u - items.filter((n) => gone.has(n.id) && !n.read).length));
      return true;
    } catch {
      return false;
    }
  }, [user, items]);

  return { items, unread, markReadVisible, deleteIds };
}

/** The inbox list — opened from the sidebar's Notifications row. Marks the visible messages read on open. */
export function NotificationPanel({ inbox, onClose, onOpenReports }: {
  inbox: NotificationInbox;
  onClose: () => void;
  /**
   * Open the Report a problem sheet on the conversation list.
   *
   * ADMIN 2026-09-17: *"us par tap karne se report a problem wala hi folder open ho"*. Without this
   * the reply notification could only TELL somebody where to go — three clauses of directions for a
   * journey the tap should have made for them.
   */
  onOpenReports?: () => void;
}) {
  const { items, markReadVisible, deleteIds } = inbox;
  /** Select mode. Checkboxes — and the Delete button — exist only while this is true. */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Set while the confirmation is showing; holds what is about to be deleted. */
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Opening the panel is what marks the messages read — the same moment the old bell did it.
  useEffect(() => { void markReadVisible(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Leave select mode and forget everything about it. Never deletes. */
  const cancelSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
    setFailed(false);
  }, []);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmDelete = async () => {
    if (busy) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      if (await deleteIds(ids)) cancelSelection();
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const close = () => { cancelSelection(); onClose(); }; // closing always drops a half-made selection

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
      {/*
        🔴 POSITIONED AGAINST THE VIEWPORT (fixed 2026-09-16, admin report: "notification screen
        se bahar ja raha hai" — every line clipped on its left edge). An `absolute right-0` inside
        the old bell's wrapper anchored the panel's right edge well short of the screen's, and the
        320px-wide panel ran off the LEFT edge of narrow phones. `fixed` anchors to the viewport,
        so the panel can never overflow an edge, wherever it is opened from (now: the sidebar).

        🔴 AND THE TOP WAS UNDER THE HEADER ON A NOTCHED PHONE (fixed 2026-09-22, admin report:
        "notifications open kare to header me chupp raha hai, crop ho raha hai"). `top-12` is 48px.
        The app header is `h-10` = 40px and it starts BELOW the device notch, because the app root
        pads itself by `--nb-safe-top` (App.tsx). A `fixed` panel is anchored to the VIEWPORT and gets
        none of that padding, so on the admin's phone (notch 47px → header 47–87) it started 39px
        inside the header, and the header's higher z-index painted over it.

        ⚠️ CORRECTED 2026-09-23: this block first said the header was 56px and that the panel was
        therefore "clipped on EVERY screen". Both were wrong — the measurement harness drew a 56px
        header because it trusted the same `3.5rem` this file did. With no notch the old 48px cleared
        the real 40px header; the notch was the whole bug. The offset is DERIVED from the two facts
        that decide it — the notch and the header's own height — so it is right either way.

        ⚠️ `--nb-safe-top` and `HEADER_H` are the header's arithmetic, restated here because a
        `fixed` element cannot inherit it. If the header's height ever changes, this must change
        with it — which is what `tests/theNotificationsPanelClearsTheHeader.test.ts` enforces: it
        reads TopNav.tsx and fails when the two disagree.

        Centred rather than right-aligned (admin: "center me kar do") — the panel is opened from the
        sidebar now, so there is no corner control for it to hang off, and equal margins are what
        stops it clipping either edge.
      */}
      <div
        style={{ top: PANEL_TOP }}
        className="fixed left-1/2 -translate-x-1/2 z-50 w-80 max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-var(--nb-safe-top,0px)-4rem)] supports-[height:100dvh]:max-h-[calc(100dvh-var(--nb-safe-top,0px)-4rem)] overflow-y-auto rounded-2xl border border-line bg-card shadow-2xl"
      >
        <div className="sticky top-0 bg-card border-b border-line">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-sm font-black text-ink truncate">
              {selecting ? `${selected.size} selected` : 'Notifications'}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {/*
                SELECT is the header's only action when not selecting. There is deliberately NO
                delete-all here: a destructive action must never be one tap from the close button.
              */}
              {!selecting && items.length > 0 && (
                <button
                  onClick={() => setSelecting(true)}
                  className="px-2.5 py-1 rounded-lg border border-line text-[11px] font-bold text-muted hover:text-ink hover:bg-raised transition-colors"
                >
                  Select
                </button>
              )}
              {selecting && (
                <>
                  {selected.size > 0 && (
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-[11px] font-bold text-danger hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete ({selected.size})
                    </button>
                  )}
                  <button
                    onClick={cancelSelection}
                    className="px-2.5 py-1 rounded-lg border border-line text-[11px] font-bold text-muted hover:text-ink hover:bg-raised transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
              {!selecting && (
                <button
                  onClick={close}
                  aria-label="Close notifications"
                  className="p-1 text-muted hover:text-ink rounded-lg hover:bg-raised"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Select-all lives INSIDE select mode only, and still has to pass Delete + confirm. */}
          {selecting && items.length > 0 && (
            <div className="px-4 pb-2.5">
              <button
                onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((n) => n.id)))}
                className="flex items-center gap-1.5 text-[11px] font-bold text-muted hover:text-ink transition-colors"
              >
                {allSelected
                  ? <CheckSquare className="w-3.5 h-3.5 text-success" />
                  : <Square className="w-3.5 h-3.5" />}
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
            </div>
          )}
        </div>

        {/*
          THE CONFIRMATION. An in-panel dialog rather than window.confirm: that one is blocked in
          some embedded contexts and cannot say what is about to happen in our own words. It names
          the exact COUNT, and says plainly what deleting does and does not do.
        */}
        {confirming && (
          <div className="px-4 py-3 border-b border-red-500/20 bg-red-500/5 space-y-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-ink">
                  Delete {selected.size} message{selected.size === 1 ? '' : 's'}?
                </p>
                <p className="text-[11px] text-muted leading-relaxed mt-1">
                  {selected.size === 1 ? 'It is' : 'They are'} removed from your inbox only — other
                  people keep {selected.size === 1 ? 'it' : 'them'}. This cannot be undone.
                </p>
              </div>
            </div>
            {failed && (
              <p className="text-[11px] text-warn font-semibold">
                Could not delete just now — nothing was removed. Please try again.
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => void confirmDelete()}
                disabled={busy}
                className="flex-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-on-accent text-[11px] font-black uppercase tracking-wider disabled:opacity-50 transition-colors"
              >
                {busy ? 'Deleting…' : 'OK, delete'}
              </button>
              <button
                onClick={() => { setConfirming(false); setFailed(false); }}
                disabled={busy}
                className="flex-1 px-3 py-1.5 rounded-lg border border-line text-body text-[11px] font-black uppercase tracking-wider hover:bg-raised disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted">No messages yet.</div>
        ) : (
          <div className="divide-y divide-line">
            {items.map((n) => {
              const picked = selected.has(n.id);
              const row = (
                <>
                  <span className="block text-[13px] text-ink leading-relaxed whitespace-pre-wrap break-words">{n.message}</span>
                  <span className="block text-[10px] text-muted mt-1.5">{new Date(n.createdAt).toLocaleString()}</span>
                </>
              );
              // Not selecting: a plain row. It becomes a BUTTON only when the message carries an
              // action this build can perform — a row that looks tappable and does nothing is
              // worse than one that never invited the tap.
              if (!selecting) {
                // Wallet & Billing, through the SAME channel the build panel's Add-credits button
                // uses — a second navigation path would be a second thing to keep working.
                if (n.action === 'open-billing') {
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        close();
                        window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }));
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-raised transition-colors"
                    >
                      {row}
                      <span className="block text-[10px] font-bold text-warn mt-1">Tap to add credit →</span>
                    </button>
                  );
                }
                if (n.action === 'open-reports' && onOpenReports) {
                  return (
                    <button
                      key={n.id}
                      onClick={() => { close(); onOpenReports(); }}
                      className="w-full text-left px-4 py-3 hover:bg-raised transition-colors"
                    >
                      {row}
                      <span className="block text-[10px] font-bold text-success mt-1">Tap to open →</span>
                    </button>
                  );
                }
                return <div key={n.id} className="px-4 py-3">{row}</div>;
              }
              return (
                <label
                  key={n.id}
                  className={`flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors ${picked ? 'bg-emerald-500/5' : 'hover:bg-raised'}`}
                >
                  {/* A real checkbox, so it is keyboard-reachable and announced by screen readers.
                      The whole row is the label, which makes it easy to hit on a phone. */}
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={() => toggleSelected(n.id)}
                    aria-label="Select this message"
                    className="mt-1 w-3.5 h-3.5 shrink-0 accent-emerald-500"
                  />
                  <span className="min-w-0">{row}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

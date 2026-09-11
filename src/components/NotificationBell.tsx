import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { authJsonHeaders } from '../lib/authHeaders';

/**
 * Notification bell (admin 2026-07-30) — delivers admin → user messages in-app. Fetches the signed-in
 * user's notifications (broadcasts + those targeted at them), shows an unread badge, and marks them
 * read when the panel is opened. Real end-to-end: no message = empty state, never a fake dot.
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
}

export function NotificationBell({ user }: { user: FirebaseUser | null }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  /** Select mode. Checkboxes — and the Delete button — exist only while this is true. */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Set while the confirmation is showing; holds what is about to be deleted. */
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
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
    } catch { /* best-effort — the bell just stays as it was */ }
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

  /**
   * The ONLY code path that deletes anything, and it is reachable only from the confirmation dialog.
   *
   * Deletion is per-user on the server (a broadcast is one shared document), so this empties the
   * caller's own inbox and nobody else's.
   *
   * The rows are removed only AFTER the server confirms. An optimistic removal would show a message as
   * deleted and have it reappear on the next 90-second poll, which reads as the button being broken —
   * and a FAILED delete now says so on screen rather than looking like nothing happened.
   */
  const confirmDelete = async () => {
    if (!user || busy) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/notifications/delete', {
        method: 'POST',
        headers: { ...(await authJsonHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) { setFailed(true); return; }
      const gone = new Set(ids);
      setItems((prev) => prev.filter((n) => !gone.has(n.id)));
      setUnread((u) => Math.max(0, u - items.filter((n) => gone.has(n.id) && !n.read).length));
      cancelSelection();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void markReadVisible();
    else cancelSelection(); // closing always drops a half-made selection
  };

  if (!user) return null;

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        title="Messages from NavBharatAI"
        className="relative p-2 rounded-xl text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-11 z-50 w-80 max-w-[92vw] max-h-[70vh] supports-[height:100dvh]:max-h-[70dvh] overflow-y-auto rounded-2xl border border-white/10 bg-[#161b22] shadow-2xl">
            <div className="sticky top-0 bg-[#161b22] border-b border-white/10">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-black text-white truncate">
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
                      className="px-2.5 py-1 rounded-lg border border-white/10 text-[11px] font-bold text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors"
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
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-[11px] font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete ({selected.size})
                        </button>
                      )}
                      <button
                        onClick={cancelSelection}
                        className="px-2.5 py-1 rounded-lg border border-white/10 text-[11px] font-bold text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {!selecting && (
                    <button
                      onClick={() => setOpen(false)}
                      aria-label="Close notifications"
                      className="p-1 text-[#8b949e] hover:text-white rounded-lg hover:bg-white/5"
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
                    className="flex items-center gap-1.5 text-[11px] font-bold text-[#8b949e] hover:text-white transition-colors"
                  >
                    {allSelected
                      ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
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
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-white">
                      Delete {selected.size} message{selected.size === 1 ? '' : 's'}?
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed mt-1">
                      {selected.size === 1 ? 'It is' : 'They are'} removed from your inbox only — other
                      people keep {selected.size === 1 ? 'it' : 'them'}. This cannot be undone.
                    </p>
                  </div>
                </div>
                {failed && (
                  <p className="text-[11px] text-amber-300 font-semibold">
                    Could not delete just now — nothing was removed. Please try again.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void confirmDelete()}
                    disabled={busy}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Deleting…' : 'OK, delete'}
                  </button>
                  <button
                    onClick={() => { setConfirming(false); setFailed(false); }}
                    disabled={busy}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-white/10 text-[#c9d1d9] text-[11px] font-black uppercase tracking-wider hover:bg-white/5 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-[#8b949e]">No messages yet.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {items.map((n) => {
                  const picked = selected.has(n.id);
                  const row = (
                    <>
                      <span className="block text-[13px] text-white leading-relaxed whitespace-pre-wrap break-words">{n.message}</span>
                      <span className="block text-[10px] text-[#8b949e] mt-1.5">{new Date(n.createdAt).toLocaleString()}</span>
                    </>
                  );
                  // Not selecting: a plain, unclickable row. Nothing here can destroy anything.
                  if (!selecting) {
                    return <div key={n.id} className="px-4 py-3">{row}</div>;
                  }
                  return (
                    <label
                      key={n.id}
                      className={`flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors ${picked ? 'bg-emerald-500/5' : 'hover:bg-white/[0.02]'}`}
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
      )}
    </div>
  );
}

export default NotificationBell;

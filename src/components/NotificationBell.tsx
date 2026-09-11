import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, Trash2, CheckSquare, Square } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { authJsonHeaders } from '../lib/authHeaders';

// Notification bell (admin 2026-07-30) — delivers admin → user messages in-app. Fetches the signed-in
// user's notifications (broadcasts + those targeted at them), shows an unread badge, and marks them
// read when the panel is opened. Real end-to-end: no message = empty state, never a fake dot.

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
  /**
   * Ids the user has ticked for deletion. Selection mode is simply "something is selected" — a
   * separate Edit/Done toggle would be a second piece of state to get out of sync for no gain.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
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

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /**
   * Delete — for THIS user only. The server dismisses per-user rather than deleting the document,
   * because a broadcast is one shared row: deleting it would empty everybody's inbox.
   *
   * The rows are removed from the list only AFTER the server confirms. An optimistic removal here
   * would show a message as deleted and have it reappear on the next 90-second poll, which reads as
   * the delete button being broken.
   */
  const deleteNotifications = async (opts: { all?: boolean } = {}) => {
    if (!user || busy) return;
    const ids = opts.all ? items.map((n) => n.id) : Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/notifications/delete', {
        method: 'POST',
        headers: { ...(await authJsonHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.all ? { all: true } : { ids }),
      });
      if (!res.ok) return; // the list stays exactly as it was — nothing is claimed that did not happen
      const gone = new Set(ids);
      setItems((prev) => prev.filter((n) => !gone.has(n.id)));
      setUnread((u) => Math.max(0, u - items.filter((n) => gone.has(n.id) && !n.read).length));
      setSelected(new Set());
    } catch { /* same as above: leave the list untouched rather than lie about a delete */ } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void markReadVisible();
    else setSelected(new Set()); // closing clears a half-made selection
  };

  if (!user) return null;

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
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-black text-white">Notifications</span>
                <button onClick={() => setOpen(false)} className="p-1 text-[#8b949e] hover:text-white rounded-lg hover:bg-white/5"><X className="w-4 h-4" /></button>
              </div>
              {items.length > 0 && (
                <div className="flex items-center gap-2 px-4 pb-2.5">
                  <button
                    onClick={() => setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((n) => n.id))))}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-[#8b949e] hover:text-white transition-colors"
                  >
                    {selected.size === items.length
                      ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                      : <Square className="w-3.5 h-3.5" />}
                    {selected.size === items.length ? 'Clear selection' : 'Select all'}
                  </button>
                  <span className="flex-1" />
                  {selected.size > 0 ? (
                    <button
                      onClick={() => void deleteNotifications()}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-[11px] font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {busy ? 'Deleting…' : `Delete ${selected.size}`}
                    </button>
                  ) : (
                    <button
                      onClick={() => void deleteNotifications({ all: true })}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 text-[11px] font-bold text-[#8b949e] hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {busy ? 'Deleting…' : 'Delete all'}
                    </button>
                  )}
                </div>
              )}
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-[#8b949e]">No messages yet.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {items.map((n) => {
                  const picked = selected.has(n.id);
                  return (
                    <div
                      key={n.id}
                      className={`flex items-start gap-2.5 px-4 py-3 transition-colors ${picked ? 'bg-emerald-500/5' : ''}`}
                    >
                      {/* A real checkbox, not a div — so it is keyboard-reachable and screen readers
                          announce it. The whole row is the label, which makes it easy to hit on a phone. */}
                      <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => toggleSelected(n.id)}
                          aria-label="Select this message"
                          className="mt-1 w-3.5 h-3.5 shrink-0 accent-emerald-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] text-white leading-relaxed whitespace-pre-wrap break-words">{n.message}</span>
                          <span className="block text-[10px] text-[#8b949e] mt-1.5">{new Date(n.createdAt).toLocaleString()}</span>
                        </span>
                      </label>
                      <button
                        onClick={() => { setSelected(new Set([n.id])); void deleteNotifications(); }}
                        disabled={busy}
                        aria-label="Delete this message"
                        title="Delete"
                        className="p-1 shrink-0 rounded-lg text-[#8b949e] hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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

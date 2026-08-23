import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X } from 'lucide-react';
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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void markReadVisible();
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
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-[#161b22]">
              <span className="text-sm font-black text-white">Notifications</span>
              <button onClick={() => setOpen(false)} className="p-1 text-[#8b949e] hover:text-white rounded-lg hover:bg-white/5"><X className="w-4 h-4" /></button>
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-[#8b949e]">No messages yet.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {items.map((n) => (
                  <div key={n.id} className="px-4 py-3">
                    <p className="text-[13px] text-white leading-relaxed whitespace-pre-wrap break-words">{n.message}</p>
                    <p className="text-[10px] text-[#8b949e] mt-1.5">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default NotificationBell;

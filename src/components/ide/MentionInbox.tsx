// T1-mention-inbox (client) — the per-user @mention inbox. Fetches the caller's delivered mention
// notifications (GET /api/mentions), shows an unread badge, and marks them read. Self-contained;
// reuses teamAuthHeader so there is one auth path (no drift). Best-effort — a fetch failure just shows
// an empty inbox, never throws.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, AtSign } from 'lucide-react';
import { teamAuthHeader } from './teamAuth';

interface MentionNotif {
  id: string;
  text: string;
  fromEmail: string;
  teamId: string;
  createdAt: number;
  read: boolean;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const MentionInbox: React.FC = () => {
  const [items, setItems] = useState<MentionNotif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const headers = await teamAuthHeader();
    if (!headers.Authorization) return; // signed out → nothing to show
    try {
      // /api/mentions, NOT /api/notifications: that path belongs to the admin broadcast inbox, which
      // answers `{ notifications }` and never `{ items }`. Asking it for mentions is exactly what kept
      // this popover empty while its badge counted somebody else's messages (fixed 2026-08-21).
      const res = await fetch('/api/mentions', { headers });
      if (!res.ok) return;
      const json = await res.json();
      setItems(Array.isArray(json.items) ? json.items : []);
      setUnread(typeof json.unread === 'number' ? json.unread : 0);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const markAllRead = useCallback(async () => {
    const ids = items.filter((i) => !i.read).map((i) => i.id);
    if (!ids.length) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnread(0);
    const headers = await teamAuthHeader();
    if (!headers.Authorization) return;
    try {
      await fetch('/api/mentions/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ids }),
      });
    } catch { /* the optimistic UI update already stands */ }
  }, [items]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Mentions"
        className="relative inline-flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-zinc-900 shadow-xl z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-xs font-semibold text-zinc-300">Mentions</span>
            {items.some((i) => !i.read) && (
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200">
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-zinc-500">No mentions yet.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {items.map((n) => (
                <li key={n.id} className={`px-3 py-2 ${n.read ? 'opacity-60' : 'bg-white/[0.03]'}`}>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <AtSign className="w-3 h-3 text-blue-400" />
                    <span className="font-medium text-zinc-300">{n.fromEmail || 'A teammate'}</span>
                    <span>mentioned you</span>
                    <span className="ml-auto text-zinc-500">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400 line-clamp-2">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

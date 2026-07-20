// Roadmap "BUILD NOW #10" — in-app notification-center recipe (dependency-free React).
//
// The audit's Feature-Completeness gap listed "notification center": generate_notify wires an outbound
// CHANNEL (email/SMS/push), but there was no IN-APP center — the bell + dropdown + unread badge every real
// product has. This emits a REAL, dependency-free React notification center: a Context provider (add /
// mark-read / mark-all-read / unread count, persisted to localStorage so it survives a reload), a
// useNotifications hook, and a NotificationBell component with an accessible dropdown. Frontend-only, no
// dependency, no env keys. PURE builder → the caller writes the files. Real, complete code — no TODO stubs.

export interface NotificationCenterConfig {
  files: Record<string, string>;
  instructions: string;
}

const PROVIDER = `import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  read: boolean;
  createdAt: number;
}

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  add: (n: { title: string; body?: string }) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
const STORAGE_KEY = 'app.notifications';

// Provider — holds the list, exposes actions, and persists to localStorage so the center survives a reload.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      return raw ? (JSON.parse(raw) as AppNotification[]) : [];
    } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 100))); } catch { /* quota/SSR — ignore */ }
  }, [notifications]);

  const add = useCallback((n: { title: string; body?: string }) => {
    const title = n.title?.trim();
    if (!title) return;
    const item: AppNotification = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      title, body: n.body, read: false, createdAt: Date.now(),
    };
    setNotifications((prev) => [item, ...prev]);
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));
  }, []);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((x) => ({ ...x, read: true }))), []);
  const remove = useCallback((id: string) => setNotifications((prev) => prev.filter((x) => x.id !== id)), []);

  const unreadCount = notifications.reduce((c, x) => c + (x.read ? 0 : 1), 0);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, add, markRead, markAllRead, remove }}>
      {children}
    </NotificationsContext.Provider>
  );
}

// Hook — use inside any component under <NotificationsProvider>. Throws if the provider is missing (a
// clear error beats a confusing undefined at runtime).
export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within a <NotificationsProvider>');
  return ctx;
}
`;

const BELL = `import { useState } from 'react';
import { useNotifications } from './NotificationsProvider';

// A bell button with an unread badge and an accessible dropdown. Drop it in your header/navbar; wrap your
// app in <NotificationsProvider> (usually near the root) so the bell and any code that calls add() share state.
export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label={\`Notifications\${unreadCount ? \`, \${unreadCount} unread\` : ''}\`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            style={{ position: 'absolute', top: -4, right: -6, background: '#e11', color: '#fff', borderRadius: 999, fontSize: 11, minWidth: 16, height: 16, lineHeight: '16px', textAlign: 'center', padding: '0 4px' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{ position: 'absolute', right: 0, top: '100%', width: 320, maxHeight: 400, overflowY: 'auto', background: '#fff', color: '#111', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 1000 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eee' }}>
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#06c', cursor: 'pointer', fontSize: 13 }}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: 16, color: '#777', textAlign: 'center' }}>No notifications</div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                role="menuitem"
                onClick={() => markRead(n.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid #f2f2f2', background: n.read ? '#fff' : '#f0f7ff', cursor: 'pointer' }}
              >
                <div style={{ fontWeight: n.read ? 400 : 600 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 13, color: '#555' }}>{n.body}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
`;

const INSTRUCTIONS =
  'In-app notification center wired at src/notifications/NotificationsProvider.tsx + NotificationBell.tsx ' +
  '(dependency-free React). Wrap your app near the root in <NotificationsProvider> (persists to localStorage, ' +
  'so notifications survive a reload), drop <NotificationBell /> in your header, and anywhere in the app call ' +
  "const { add } = useNotifications(); add({ title: 'Order shipped', body: '#1234 is on its way' }). The bell " +
  'shows an unread badge, the dropdown lists items, click marks one read, "Mark all read" clears the badge. ' +
  'This is the IN-APP center; for OUTBOUND email/SMS/push use generate_notify. No env key.';

export function generateNotificationCenterIntegration(): NotificationCenterConfig {
  return {
    files: {
      'src/notifications/NotificationsProvider.tsx': PROVIDER,
      'src/notifications/NotificationBell.tsx': BELL,
    },
    instructions: INSTRUCTIONS,
  };
}

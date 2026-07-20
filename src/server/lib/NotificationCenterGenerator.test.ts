import { describe, it, expect } from 'vitest';
import { generateNotificationCenterIntegration } from './NotificationCenterGenerator';

describe('generateNotificationCenterIntegration', () => {
  const c = generateNotificationCenterIntegration();
  const provider = c.files['src/notifications/NotificationsProvider.tsx'];
  const bell = c.files['src/notifications/NotificationBell.tsx'];

  it('emits a dependency-free React provider + bell (no npm dep, no env key)', () => {
    expect(provider).toContain("from 'react'");
    expect(provider).toContain('export function NotificationsProvider(');
    expect(provider).toContain('export function useNotifications()');
    expect(bell).toContain('export function NotificationBell()');
    expect((c as { dependencies?: unknown }).dependencies).toBeUndefined();
    expect(c.files['.env.example']).toBeUndefined();
  });

  it('is a real center — add / markRead / markAllRead / unread count, persisted', () => {
    expect(provider).toContain('unreadCount');
    expect(provider).toContain('markAllRead');
    expect(provider).toContain('localStorage.setItem');
    expect(provider).toContain("useNotifications must be used within a <NotificationsProvider>");
    expect(provider).not.toMatch(/TODO|FIXME/);
  });

  it('the bell shows an unread badge and an accessible dropdown', () => {
    expect(bell).toContain('unreadCount > 0');
    expect(bell).toContain("aria-label={`Notifications");
    expect(bell).toContain("role=\"menu\"");
    expect(bell).toContain("No notifications"); // honest empty state
  });

  it('writes only the two src/notifications files and points to generate_notify for outbound', () => {
    expect(Object.keys(c.files).sort()).toEqual([
      'src/notifications/NotificationBell.tsx',
      'src/notifications/NotificationsProvider.tsx',
    ]);
    expect(c.instructions).toContain('generate_notify');
  });
});

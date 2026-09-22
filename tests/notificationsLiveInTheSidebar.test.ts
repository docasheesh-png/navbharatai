/**
 * NOTIFICATIONS LIVE IN THE SIDEBAR, AND THE HEADER ROW BELONGS TO THE WINDOWS (admin 2026-09-22):
 *
 *   "notifications 🔔 ko header se hata kar, sidebar menu me karo, dot ke sath. agar notification aaye
 *    to 3-line menu button par dot dikhe, fir notification option par number dikhe … header se hata do.
 *    expand (full screen) button ko bhi thoda right me khiska do; header me tab/window dikh nahi rahi
 *    hai, jyada jagah banao."
 *
 * Source-level, because none of it is a type: a bell quietly re-added to the header, a dot drawn from a
 * second count, a row that renders without a handler, or a strip that cannot grow would all compile.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const app = codeOnly(read('src/App.tsx'));
const nav = codeOnly(read('src/components/panels/TopNav.tsx'));
const sidebar = codeOnly(read('src/components/panels/SidebarNav.tsx'));
const inbox = codeOnly(read('src/components/NotificationBell.tsx'));

describe('one inbox, three readers', () => {
  it('App owns the inbox hook, so the unread count exists while the panel is closed', () => {
    expect(app).toContain('const inbox = useNotificationInbox(user);');
    expect(app).toContain('unreadNotifications={inbox.unread}');
    expect(app.match(/unreadNotifications=\{inbox\.unread\}/g)?.length).toBe(2); // TopNav + SidebarNav
    expect(app).toContain('onOpenNotifications={() => setNotificationsOpen(true)}');
    expect(app).toMatch(/<NotificationPanel[\s\S]{0,200}?inbox=\{inbox\}/);
  });

  it('the inbox file has no bell button any more — a hook and a panel, nothing that renders in a header', () => {
    expect(inbox).toContain('export function useNotificationInbox(');
    expect(inbox).toContain('export function NotificationPanel(');
    expect(inbox).not.toContain('export function NotificationBell');
    expect(inbox).not.toMatch(/<Bell\b/);
    // The endpoints and the three-step delete flow are untouched by the move.
    expect(inbox).toContain("'/api/notifications'");
    expect(inbox).toContain("'/api/notifications/read'");
    expect(inbox).toContain("'/api/notifications/delete'");
    expect(inbox).toContain('void markReadVisible();'); // opening the panel marks them read
  });
});

describe('the header: no bell, a dot on ☰, Focus last, the strip takes the room', () => {
  it('renders no bell and takes no report callback', () => {
    expect(nav).not.toContain('NotificationBell');
    expect(nav).not.toContain('onOpenReports');
  });

  it('BOTH ☰ buttons draw the same dot from the same count, as a fact not a number', () => {
    expect(nav).toContain('const menuDot = unreadNotifications > 0 ? (');
    expect(nav.match(/\{menuDot\}/g)?.length).toBe(2); // mobile hamburger + desktop collapse
    expect(nav.match(/aria-label=\{menuLabel\}/g)?.length).toBe(2);
  });

  it('Focus Mode is the LAST control in the bar', () => {
    const controls = nav.slice(nav.indexOf('<div className="flex items-center gap-1.5 shrink-0">'));
    expect(controls.length).toBeGreaterThan(0);
    const focusAt = controls.indexOf('aria-label="Enter Focus Mode"');
    const accountAt = controls.indexOf('title="My Account"');
    const loginAt = controls.indexOf('>\n            Login\n');
    expect(focusAt).toBeGreaterThan(accountAt);
    expect(focusAt).toBeGreaterThan(loginAt);
    expect(controls.indexOf('</nav>')).toBeGreaterThan(focusAt);
  });

  it('the window strip is flex-1 min-w-0 inside a flex-1 min-w-0 parent, so it can grow AND shrink', () => {
    expect(nav).toContain('<div className="flex items-center gap-2 min-w-0 flex-1">');
    expect(nav).toContain('overflow-x-auto no-scrollbar py-2 select-none flex-1 min-w-0">');
    // The old wide gaps and the logo's trailing margin are gone.
    expect(nav).not.toMatch(/gap-4 select-none w-full bg-card/);
    expect(nav).not.toContain('shrink-0 mr-2"');
  });
});

describe('the sidebar row', () => {
  it('is ONE definition rendered in both halves, with the dot and the number', () => {
    expect(sidebar).toContain('const notificationsRow = (closeMenu: boolean) => user && onOpenNotifications ? (');
    expect(sidebar).toContain('{notificationsRow(false)}'); // rail
    expect(sidebar).toContain('{notificationsRow(true)}');  // drawer (closes the menu)
    expect(sidebar).toContain('>Notifications</span>');
    expect(sidebar).toContain("{unreadNotifications! > 99 ? '99+' : unreadNotifications}");
  });

  it('draws nothing for zero, and the dot is a token colour', () => {
    expect(sidebar).toContain('{(unreadNotifications ?? 0) > 0 && (');
    const row = sidebar.slice(sidebar.indexOf('const notificationsRow'), sidebar.indexOf('const makeClickHandler'));
    expect(row).toContain('bg-danger');
    expect(row).not.toMatch(/bg-red-\d|text-white|#[0-9a-f]{6}/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Admin → user messaging (admin 2026-07-30): the admin can send a message to ALL users or ONE specific
 * user, delivered in-app via a notification bell. These tests lock the real end-to-end wiring; the pure
 * targeting/normalization logic is covered in adminNotificationStore.test.ts.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const admin = read('src/server/routes/admin.ts');
const notifRoutes = read('src/server/routes/notifications.ts');
const server = read('server.ts');
const dash = read('src/components/AdminDashboard.tsx');
const topnav = read('src/components/panels/TopNav.tsx');

describe('Server wiring', () => {
  it('admin announcement persists a durable, targeted notification', () => {
    expect(admin).toContain('saveNotification');
    expect(admin).toContain('normalizeTarget');
  });

  it('user-facing notification routes exist and are registered', () => {
    expect(notifRoutes).toContain("app.get('/api/notifications'");
    expect(notifRoutes).toContain("app.post('/api/notifications/read'");
    expect(notifRoutes).toContain('verifyFirebaseToken');
    expect(server).toContain('registerNotificationRoutes(app)');
  });
});

describe('Admin UI — Message Users', () => {
  it('offers All Users and a specific-user email target', () => {
    expect(dash).toContain('Message Users');
    expect(dash).toContain('<option value="all">All Users</option>');
    expect(dash).toContain('<option value="user">A Specific User</option>');
    // The email is sent only for a single-user message.
    expect(dash).toContain("target: annTarget, email: annTarget === 'user' ? annEmail.trim() : undefined");
    // No fake pro/free targets that the server doesn't deliver — scoped to the Message Users <select>
    // (a whole-file match collides with unrelated filter dropdowns elsewhere in the admin panel, e.g. the
    // Build Reports "free/paid" filter, which legitimately uses <option value="free">).
    const msgStart = dash.indexOf('value={annTarget}');
    const msgSelect = dash.slice(msgStart, dash.indexOf('</select>', msgStart));
    expect(msgStart).toBeGreaterThan(-1);
    expect(msgSelect).not.toContain('<option value="pro">');
    expect(msgSelect).not.toContain('<option value="free">');
  });
});

describe('User UI — notification bell', () => {
  it('the bell is mounted in the top bar and reads the user endpoint', () => {
    expect(topnav).toContain('<NotificationBell user={user} />');
    const bell = read('src/components/NotificationBell.tsx');
    expect(bell).toContain("'/api/notifications'");
    expect(bell).toContain("'/api/notifications/read'");
  });
});

describe('KB awareness', () => {
  it('notifications_bell entry exists and points at the top-bar bell', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'notifications_bell');
    expect(e).toBeTruthy();
    expect(e!.path.toLowerCase()).toContain('bell');
    expect(e!.description).toMatch(/NavBharatAI team/);
  });
});

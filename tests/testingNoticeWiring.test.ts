/**
 * The wiring, pinned — because every part of this fails silently.
 *
 * Put the popup back and nothing errors: the home screen is simply covered again on every app open,
 * the thing the admin asked to be rid of (2026-09-27). Drop the card from the panel and the app stops
 * telling anyone it is in testing. Drop the `onReport` and the button becomes decoration. Point the
 * badges back at the raw inbox count and a new user is never led to the card. None of it breaks a build.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TESTING_NOTICE_COPY } from '../src/lib/testingNotice';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/** Strip comments: a doc block that MENTIONS a call must not satisfy an assertion about the call. */
const codeOnly = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const app = codeOnly(read('src/App.tsx'));
const card = codeOnly(read('src/components/TestingNotice.tsx'));
const sidebar = read('src/components/panels/SidebarNav.tsx');

describe('🔒 it is no longer a popup', () => {
  it('App renders no floating notice over the home screen', () => {
    // The old render was `<TestingNotice …/>` gated on the home view. The card is the only form left.
    expect(app).not.toMatch(/<TestingNotice[\s/>]/);
    expect(app).not.toMatch(/testingNoticeOpen/);
    expect(app).not.toMatch(/shouldShowTestingNotice/);
  });

  it('the card carries no countdown and no fixed positioning of its own', () => {
    expect(card).not.toMatch(/setTimeout/);
    expect(card).not.toMatch(/\bfixed\b/);
  });

  it('the popup animation left the stylesheet with it', () => {
    expect(read('src/index.css')).not.toContain('nb-testing-notice');
    expect(existsSync(join(process.cwd(), 'tests/testingNoticeCentering.test.ts'))).toBe(false);
  });
});

describe('it lives in the Notifications panel', () => {
  it('pinned inside the panel, after the rewards checklist the admin keeps first', () => {
    const panel = app.slice(app.indexOf('<NotificationPanel'));
    const rewards = panel.indexOf('<RewardsChecklistCard');
    const testing = panel.indexOf('<TestingNoticeCard');
    expect(rewards).toBeGreaterThan(-1);
    expect(testing).toBeGreaterThan(rewards);
  });

  it('🔒 the ☰ dot and the Notifications row both read the count that includes the card', () => {
    expect(app).toMatch(/const notificationUnread = unreadWithTestingNotice\(\{\s*inboxUnread: inbox\.unread,\s*signedIn: !!user,\s*seen: testingSeen\s*\}\)/);
    expect(app.match(/unreadNotifications=\{notificationUnread\}/g)).toHaveLength(2);
    expect(app).not.toMatch(/unreadNotifications=\{inbox\.unread\}/);
  });

  it('opening the panel is what marks the card seen', () => {
    expect(app).toMatch(/if \(notificationsOpen && !testingSeen\) \{ markTestingNoticeSeen\(\); setTestingSeen\(true\); \}/);
    expect(app).toMatch(/useState\(\(\)\s*=>\s*testingNoticeSeen\(\)\)/);
  });
});

describe('the button opens the REAL report sheet', () => {
  it('App wires onReport to the same state the sidebar and the shake gesture open', () => {
    expect(app).toMatch(/onReport=\{\(\)\s*=>\s*\{\s*setNotificationsOpen\(false\);\s*setReportMode\('choose'\);\s*setReportOpen\(true\);\s*\}\}/);
    expect(app).toMatch(/<ReportSheet open=\{reportOpen\}/);
  });

  it('the card calls it', () => {
    expect(card).toMatch(/onClick=\{onReport\}/);
  });

  it('🔒 the label names a menu entry that really exists', () => {
    expect(sidebar).toContain(`>${TESTING_NOTICE_COPY.action}<`);
  });
});

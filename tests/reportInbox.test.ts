import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readNotificationAction, NOTIFICATION_ACTIONS } from '../src/server/lib/AdminNotificationStore';

/**
 * THE REPORT INBOX — two doors, a conversation, and three dots that agree with each other.
 *
 * ADMIN 2026-09-17: *"report a problem par click kare, to popup me 2 option dikhe… old report yeh inbox
 * ke jaisa kam kare… ek dam social media message ke tarah"*, with a green dot on the sidebar entry, on
 * the "Old reports" door and on the conversation itself, all three clearing once the latest message is
 * read — and the reply notification reduced to *"New message from NavBharatAI"* whose TAP opens the
 * conversation list with the newest reply on top.
 *
 * The unread ARITHMETIC is pinned in `reportUnread.test.ts`. This file pins the WIRING: that each dot
 * is computed from that one rule, that the notification can reach the list, and that the security
 * properties the new routes touch are still the ones the old routes had.
 */

const sheet = readFileSync('src/components/ReportSheet.tsx', 'utf8');
const sidebar = readFileSync('src/components/panels/SidebarNav.tsx', 'utf8');
const bell = readFileSync('src/components/NotificationBell.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const routes = readFileSync('src/server/routes/reports.ts', 'utf8');
const store = readFileSync('src/server/lib/userReportStore.ts', 'utf8');

describe('the two doors', () => {
  it('the sheet opens on a chooser, not straight into the form', () => {
    expect(sheet).toContain("type SheetMode = 'choose' | 'new' | 'list';");
    expect(sheet).toContain("setMode(target ? 'new' : (initialMode ?? 'choose'));");
  });

  it('both doors are there, in the admin’s own words', () => {
    expect(sheet).toContain('Report a new problem');
    expect(sheet).toContain('Old reports');
  });

  it('reporting a SPECIFIC app or person skips the chooser — that choice is already made', () => {
    // "Report this app" then offering "report something / read replies" is a step for nobody.
    expect(sheet).toMatch(/setMode\(target \? 'new'/);
  });

  it('there is a way BACK from each inner screen, not just a close button', () => {
    expect(sheet).toContain("if (openThread) setOpenThread(''); else setMode('choose');");
  });
});

describe('the three dots, and why they cannot disagree', () => {
  it('all three are computed from the SAME rule, never a per-screen opinion', () => {
    // Sidebar count and the "Old reports" door:
    expect(sheet).toContain('const unread = unreadReportCount(mine ?? []);');
    // The individual conversation:
    expect(sheet).toContain('const isUnread = hasUnreadAdminReply(r);');
    // The sidebar is handed that same number rather than deriving one of its own.
    expect(app).toContain('unreadReports={unreadReports}');
    expect(sidebar).toContain('unreadReports?: number;');
  });

  it('🔒 the OLD badge is gone — it said "a reply arrived once", never "a reply is new"', () => {
    // `fromUs > 0` could not clear, because nothing recorded that anything had been read.
    //
    // Comments stripped first: the sheet's own comment NAMES the removed expression to explain why it
    // went, and an assertion that cannot tell an explanation from an implementation would fail on the
    // very note documenting the fix. Same trap as `modelPerformance.test.ts` records.
    const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("const fromUs = r.messages.filter((m) => m.from === 'admin').length;");
    expect(code).not.toMatch(/fromUs/);
  });

  it('zero unread draws nothing at all, on every surface', () => {
    expect(sidebar).toContain('{(unreadReports ?? 0) > 0 && (');
    expect(sheet).toContain('{unread > 0 && (');
  });

  it('the dot is not colour alone — the count is spelled out and announced', () => {
    expect(sidebar).toMatch(/sr-only/);
    expect(sidebar).toMatch(/unread \{unreadReports === 1 \? 'reply' : 'replies'\}/);
  });
});

describe('when the dot goes out — and when it must NOT', () => {
  it('reading is recorded when a conversation is OPENED, not when the list is fetched', () => {
    // Clearing on fetch would let a glance at the menu silently "read" a reply never seen.
    expect(sheet).toContain('const openReport = useCallback((reportId: string) => {');
    expect(sheet).toMatch(/\/read`/);
    expect(sheet).toContain("onClick={() => { if (isOpen) setOpenThread(''); else openReport(r.id); }}");
  });

  it('the sidebar re-checks when the sheet CLOSES, so the dot goes out immediately', () => {
    expect(app).toContain('}, [user, reportOpen]);');
    expect(app).toContain("fetch('/api/report/unread'");
  });

  it('🔒 a failed unread poll leaves the last number alone — it neither hides nor invents a reply', () => {
    const at = app.indexOf("fetch('/api/report/unread'");
    expect(at).toBeGreaterThan(0);
    const block = app.slice(at, at + 400);
    expect(block).toMatch(/leave the last known number/);
    expect(block).not.toMatch(/setUnreadReports\(0\)/);
  });
});

describe('the notification: short words, and a tap that arrives somewhere', () => {
  it('says exactly what the admin asked for, and no longer recites directions', () => {
    expect(routes).toContain("message: 'New message from NavBharatAI',");
    expect(routes).not.toContain('Open "Report a problem" to read it and answer.');
  });

  it('carries an action, and tapping it opens the conversation list', () => {
    expect(routes).toContain("action: 'open-reports',");
    expect(bell).toContain("if (n.action === 'open-reports' && onOpenReports) {");
    expect(app).toContain("onOpenReports={() => { setReportMode('list'); setReportOpen(true); }}");
  });

  it('a row only becomes tappable when there is something to open', () => {
    // A row that looks tappable and does nothing is worse than one that never invited the tap.
    expect(bell).toContain('&& onOpenReports) {');
  });

  it('🔒 the action is a NAME from a closed set, never a stored URL', () => {
    // A free-form link on a broadcast record would make the admin message form an open redirect.
    expect(readNotificationAction('open-reports')).toBe('open-reports');
    expect(readNotificationAction('https://evil.example')).toBeUndefined();
    expect(readNotificationAction('javascript:alert(1)')).toBeUndefined();
    expect(readNotificationAction('')).toBeUndefined();
    expect(readNotificationAction(undefined)).toBeUndefined();
    expect(readNotificationAction({ url: 'x' })).toBeUndefined();
    expect(NOTIFICATION_ACTIONS).toEqual(['open-reports']);
  });
});

describe('the list reads like a messaging inbox', () => {
  it('newest conversation first, so a tapped notification lands on the right row', () => {
    // Admin: "sabse upar woh chat ho, jis chat me admin ka latest reply hai".
    expect(routes).toContain('reports: sortReportsByActivity(rows).map((r) => ({');
  });

  it('the read stamp travels with the thread, so the client uses the server’s rule', () => {
    expect(routes).toContain("...(typeof r.reporterReadAt === 'number' ? { reporterReadAt: r.reporterReadAt } : {}),");
  });

  it('an empty inbox says so, and offers the other door', () => {
    expect(sheet).toContain('Nothing here yet');
    expect(sheet).toMatch(/Reports you send will appear here with our replies\./);
  });

  it('“loading” and “empty” are different states — a slow fetch never reads as nothing', () => {
    expect(sheet).toContain('Loading your reports…');
  });
});

describe('🔒 the security properties the new routes must not weaken', () => {
  it('the read stamp is written only by the person who filed the report', () => {
    const at = store.indexOf('export async function markReportReadByReporter');
    expect(at).toBeGreaterThan(0);
    const fn = store.slice(at, at + 1200);
    expect(fn).toContain('if (report.reporterUid !== reporterUid) return false;');
    // …and that check is INSIDE the transaction, against the stored document.
    expect(fn.indexOf('runTransaction')).toBeLessThan(fn.indexOf('reporterUid !== reporterUid'));
  });

  it('the stamp never moves backwards — two open tabs must not un-read a conversation', () => {
    const at = store.indexOf('export async function markReportReadByReporter');
    expect(store.slice(at, at + 1200)).toContain('if (at <= prev) return true;');
  });

  it('the clock is the SERVER’s — a fast device must not silence its own dot for ever', () => {
    expect(routes).toContain('markReportReadByReporter(reportId, me.uid, Date.now())');
  });

  it('“not yours” and “does not exist” give the SAME answer, as every other report route does', () => {
    const at = routes.indexOf("'/api/report/:id/read'");
    expect(at).toBeGreaterThan(0);
    expect(routes.slice(at, at + 900)).toContain("res.status(404).json({ error: 'That report could not be found.' })");
  });

  it('the unread count is scoped to the verified uid, never a parameter', () => {
    const at = routes.indexOf("'/api/report/unread'");
    expect(at).toBeGreaterThan(0);
    const block = routes.slice(at, at + 600);
    expect(block).toContain('await verifyFirebaseIdentity(req)');
    expect(block).toContain('listReportsByReporter(me.uid');
    expect(block).not.toMatch(/req\.(query|params|body)/);
  });

  it('an unreadable store answers 0 rather than erroring — a failed poll must not mark the menu', () => {
    const at = routes.indexOf("'/api/report/unread'");
    expect(routes.slice(at, at + 600)).toContain('res.json({ unread: 0 });');
  });
});

describe('🔒 the White-Label Law still holds inside the conversation', () => {
  it('a reply is always NavBharatAI — never a person, never an email', () => {
    expect(sheet).toContain("{m.from === 'admin' ? 'NavBharatAI' : 'You'}");
  });

  it('the notification names no human either', () => {
    expect(routes).toContain("message: 'New message from NavBharatAI',");
  });
});

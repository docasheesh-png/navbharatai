import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  appendReportMessage, awaitingAdmin, validateReply, REPLY_MAX, THREAD_MAX,
  type ReportMessage,
} from '../src/lib/userReport';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const msg = (from: 'admin' | 'user', text: string, at = 1): ReportMessage => ({ from, text, at });

/**
 * THE OTHER HALF OF "jisse uski help ho sake".
 *
 * Slice 1 made a report legible. Without a way to ASK the reporter anything, the channel is still a
 * suggestion box: nobody can ask "which page?", nobody can say it is fixed, and the person who wrote
 * in learns nothing from having done so — which is how people stop reporting.
 */

describe('the thread is bounded, because the report document is', () => {
  it('keeps messages in order', () => {
    const t = appendReportMessage([msg('user', 'first')], msg('admin', 'second', 2));
    expect(t.map((m) => m.text)).toEqual(['first', 'second']);
  });

  it('starts a thread on a report that never had one', () => {
    expect(appendReportMessage(undefined, msg('admin', 'hello'))).toHaveLength(1);
  });

  it('🔒 drops from the FRONT, never the back', () => {
    // Losing the newest message would lose the one the person is reading right now. Losing the
    // oldest costs the opening line, which the report's own `message` field still holds — so the
    // irreplaceable thing is never what gets dropped.
    const long = Array.from({ length: THREAD_MAX + 5 }, (_, i) => msg('user', `m${i}`, i));
    const out = appendReportMessage(long, msg('admin', 'latest', 999));
    expect(out).toHaveLength(THREAD_MAX);
    expect(out[out.length - 1].text).toBe('latest');
    expect(out.map((m) => m.text)).not.toContain('m0');
  });

  it('never mutates the thread it was given', () => {
    const original = [msg('user', 'only')];
    appendReportMessage(original, msg('admin', 'added', 2));
    expect(original).toHaveLength(1);
  });
});

describe('awaitingAdmin — what stops a conversation dying quietly', () => {
  it('true when the LAST word is the reporter\'s', () => {
    expect(awaitingAdmin([msg('admin', 'which page?'), msg('user', 'the home page', 2)])).toBe(true);
  });

  it('false once we have answered, and false on an empty or missing thread', () => {
    expect(awaitingAdmin([msg('user', 'hi'), msg('admin', 'on it', 2)])).toBe(false);
    expect(awaitingAdmin([])).toBe(false);
    expect(awaitingAdmin(undefined)).toBe(false);
  });
});

describe('validateReply', () => {
  it('refuses an empty reply and anything over the cap', () => {
    expect(validateReply('   ')).toMatchObject({ ok: false });
    expect(validateReply(undefined)).toMatchObject({ ok: false });
    expect(validateReply('x'.repeat(REPLY_MAX + 1))).toMatchObject({ ok: false });
  });

  it('trims, and accepts a one-word answer — most real answers are one word', () => {
    expect(validateReply('  home  ')).toEqual({ ok: true, text: 'home' });
  });
});

describe('🔒 the security properties, which are the ones worth breaking the build over', () => {
  const routes = read('src/server/routes/reports.ts');
  const store = read('src/server/lib/userReportStore.ts');

  it('the reporter\'s own list is scoped to the VERIFIED uid, never a parameter', () => {
    expect(routes).toContain("app.get('/api/report/mine'");
    expect(routes).toContain('listReportsByReporter(me.uid, 20)');
    // A uid taken from the query would hand somebody else's device details and complaint to anyone
    // who could guess one.
    expect(routes).not.toMatch(/listReportsByReporter\(\s*(req\.query|req\.params|req\.body)/);
  });

  it('a reply is checked against the STORED report, inside the transaction', () => {
    // Checking ownership outside the transaction leaves a window, and on the other side of that
    // window is somebody else's conversation.
    expect(routes).toContain('expectReporterUid: me.uid');
    const tx = store.slice(store.indexOf('export async function addReportMessage'));
    const check = tx.indexOf('opts.expectReporterUid && report.reporterUid !== opts.expectReporterUid');
    const txStart = tx.indexOf('runTransaction');
    expect(txStart).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(txStart);
  });

  it('"not yours" and "does not exist" give the SAME answer', () => {
    // Telling them apart lets anyone probe which report ids are real, and a report id is a handle
    // on somebody else's complaint.
    const reply = routes.slice(routes.indexOf("app.post(\n    '/api/report/:id/reply'"));
    expect(reply.slice(0, 2000)).toContain('That report could not be found.');
    expect(reply.slice(0, 2000)).not.toMatch(/not your report|403/);
  });

  it('the message append is a transaction — a lost update would delete a message silently', () => {
    expect(store).toContain('runTransaction');
  });

  it('both reply routes require identity, and the reporter route is rate-limited', () => {
    expect(routes).toContain("rateLimiter({ name: 'report-reply'");
    expect(routes).toContain("app.post('/api/admin/reports/:id/reply', requireAdmin");
  });

  it('the reporter\'s list does not ship screenshots', () => {
    const mine = routes.slice(routes.indexOf("app.get('/api/report/mine'"), routes.indexOf("app.post(\n    '/api/report/:id/reply'"));
    expect(mine).not.toContain('getReportScreenshot');
    expect(mine).not.toContain('screenshot');
  });
});

describe('the reply reaches the person — and we say so honestly when it does not', () => {
  const routes = read('src/server/routes/reports.ts');
  const admin = read('src/components/AdminDashboard.tsx');

  it('an admin reply rings the bell the user already has', () => {
    expect(routes).toContain('saveNotification(');
    expect(routes).toMatch(/target: \{ type: 'user', userId: report\.reporterUid \}/);
  });

  it('⚠️ a failed notification does NOT fail the reply, and is reported rather than hidden', () => {
    // Losing the admin's typed answer to a bell failure would be the worse outcome; a silent ok
    // would leave them believing the user had been told.
    expect(routes).toContain('notified');
    expect(admin).toContain('the user could not be notified');
  });

  it('a user reply REOPENS the report, so an answer is not filed where nobody looks', () => {
    expect(routes).toContain('reopen: true');
    expect(routes).toContain('awaitingReply: awaitingAdmin(r.messages)');
  });

  it('the admin list flags it, and that badge outranks the status badge', () => {
    const row = admin.slice(admin.indexOf('userReports.map'), admin.indexOf('userReports.map') + 2500);
    expect(row).toContain('Replied — needs you');
    expect(row.indexOf('r.awaitingReply')).toBeLessThan(row.indexOf("r.status !== 'open'"));
  });
});

describe('🔒 WHITE-LABEL LAW — the reporter is answered by NavBharatAI, never by a person', () => {
  const sheet = read('src/components/ReportSheet.tsx');

  it('the user-facing thread labels our side NavBharatAI', () => {
    expect(sheet).toContain("m.from === 'admin' ? 'NavBharatAI' : 'You'");
  });

  it('no admin identity is rendered to the reporter', () => {
    const thread = sheet.slice(sheet.indexOf('Your earlier reports'), sheet.indexOf('What kind of problem'));
    expect(thread).not.toMatch(/createdBy|adminEmail|r\.reporter\?\.email/);
  });
});

describe('the user can actually find it', () => {
  const sheet = read('src/components/ReportSheet.tsx');

  it('past reports are loaded when the sheet opens, and sit ABOVE the new-report form', () => {
    expect(sheet).toContain("fetch('/api/report/mine'");
    expect(sheet.indexOf('Your earlier reports')).toBeLessThan(sheet.indexOf('What kind of problem is it?'));
  });

  it('a thread with an answer in it is marked, so it is worth opening', () => {
    expect(sheet).toContain("r.messages.filter((m) => m.from === 'admin').length");
  });

  it('the screen shows what the SERVER stored, not what we hoped it stored', () => {
    expect(sheet).toContain('messages: data.messages as ReportMessage[]');
  });

  it('a failed load renders as empty rather than as a cheerful invented state', () => {
    expect(sheet).toContain('setMine([])');
  });
});

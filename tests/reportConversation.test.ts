import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  appendReportMessage, awaitingAdmin, validateReplyPayload, validateScreenshot,
  isShotId, newShotId, REPLY_MAX, SCREENSHOT_MAX_CHARS, THREAD_MAX,
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

describe('validateReplyPayload — the one rule both reply routes run', () => {
  it('refuses an empty reply and anything over the cap', () => {
    expect(validateReplyPayload('   ', '')).toMatchObject({ ok: false });
    expect(validateReplyPayload(undefined, undefined)).toMatchObject({ ok: false });
    expect(validateReplyPayload('x'.repeat(REPLY_MAX + 1), '')).toMatchObject({ ok: false });
  });

  it('trims, and accepts a one-word answer — most real answers are one word', () => {
    expect(validateReplyPayload('  home  ', '')).toMatchObject({ ok: true, text: 'home' });
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

/**
 * SCREENSHOTS IN A REPLY.
 *
 * Admin 2026-09-12: *"screenshot atach hoga na?"* — the first report always carried one; the
 * conversation did not. On the very complaint that started this work ("content goes outside the
 * mobile") the follow-up screenshot IS the answer, so a text-only thread throws away the evidence at
 * the exact moment somebody is willing to hand it over.
 */
describe('a reply can carry a screenshot', () => {
  it('text alone, image alone, or both — but never neither', () => {
    const img = 'data:image/jpeg;base64,abc';
    expect(validateReplyPayload('the header', '')).toMatchObject({ ok: true, text: 'the header' });
    // A screenshot ALONE is a complete answer on a layout complaint. Demanding a sentence too would
    // be friction placed exactly where the useful evidence was about to arrive.
    expect(validateReplyPayload('', img)).toMatchObject({ ok: true, text: '', screenshot: img });
    expect(validateReplyPayload('  ', '   ')).toMatchObject({ ok: false });
  });

  it('applies the SAME attachment rule as a first report', () => {
    // One rule, extracted rather than copied — a reply that enforced a slightly different ceiling is
    // the drift this repo keeps paying for: one path accepting what the other silently refuses.
    expect(validateScreenshot('https://example.com/x.png')).toMatchObject({ ok: false });
    expect(validateScreenshot('data:image/png;base64,x'.padEnd(SCREENSHOT_MAX_CHARS + 1, 'x'))).toMatchObject({ ok: false });
    expect(validateScreenshot('')).toEqual({ ok: true, screenshot: '' });
    expect(validateReplyPayload('hi', 'not-an-image')).toMatchObject({ ok: false });
  });

  it('🔒 a shot id can never be the ORIGINAL report screenshot\'s document', () => {
    // The first report's image lives at `shot/image` in the same sub-collection. If a message id
    // could be "image", a reply attachment would overwrite the evidence the report was filed with.
    expect(isShotId('image')).toBe(false);
    expect(isShotId(newShotId())).toBe(true);
  });

  it('🔒 rejects anything that is not our own id — this value becomes a document path', () => {
    for (const bad of ['../../admin', 's', '', 'S123456', 'sABC', null, 42, 's/../x']) {
      expect(isShotId(bad)).toBe(false);
    }
  });

  it('ids do not collide when two attachments are made in the same millisecond', () => {
    const a = newShotId(() => 0.1);
    const b = newShotId(() => 0.9);
    expect(a).not.toBe(b);
  });
});

describe('🔒 the image routes authorise on their own, and fail closed', () => {
  const routes = read('src/server/routes/reports.ts');
  const store = read('src/server/lib/userReportStore.ts');
  const shot = read('src/components/ReportShot.tsx');

  it('the reporter route re-checks ownership — report ids are not secrets', () => {
    const r = routes.slice(routes.indexOf("app.get('/api/report/:id/shot/:shotId'"));
    expect(r.slice(0, 1400)).toContain('report.reporterUid !== me.uid');
    // Same single answer for "not yours" and "no such thing" as every other route here.
    expect(r.slice(0, 1400)).toContain("res.status(404).json({ error: 'Not found.' })");
  });

  it('the id is validated at BOTH the route and the store', () => {
    // A check that lives only in today's route is a check tomorrow's route will not have.
    expect(routes).toContain('isShotId(shotId)');
    expect(store).toContain('!isShotId(shotId)');
  });

  it('images are never cached by an intermediary', () => {
    expect(routes).toMatch(/Cache-Control',\s*'private, no-store'/);
  });

  it('⚠️ the image is stored BEFORE the message, so a handle never points at nothing', () => {
    const reply = routes.slice(routes.indexOf("app.post(\n    '/api/report/:id/reply'"), routes.indexOf('// ── Admin'));
    expect(reply.indexOf('saveReportMessageShot')).toBeLessThan(reply.indexOf('addReportMessage'));
  });

  it('a failed attachment is SAID, not swallowed — the text still sends', () => {
    expect(routes).toContain('imageSaved');
    expect(read('src/components/ReportSheet.tsx')).toContain('the screenshot could not be attached');
    expect(read('src/components/AdminDashboard.tsx')).toContain('the screenshot could not be attached');
  });

  it('a picture that will not load is distinguished from no picture at all', () => {
    // Only one of those is a reason to ask the person for it again.
    expect(shot).toContain('The screenshot could not be loaded.');
    expect(shot).toContain('failed: true');
  });

  it('it fetches with credentials rather than exposing a public image URL', () => {
    // A signed public URL would put somebody's screenshot behind a link that leaks when pasted.
    expect(shot).toContain('headers ? await headers() : undefined');
    expect(shot).not.toMatch(/<img[^>]*src=\{src\}/);
  });

  it('both sides compress through the one shared path', () => {
    expect(read('src/components/ReportSheet.tsx')).toContain('compressForReport(file)');
    expect(read('src/components/AdminDashboard.tsx')).toContain('compressForReport(file)');
  });

  it('a screenshot alone is not a dead Send button on either side', () => {
    expect(read('src/components/ReportSheet.tsx')).toContain("reply.trim().length === 0 && !replyShot");
    expect(read('src/components/AdminDashboard.tsx')).toContain("reportReply.trim().length === 0 && !reportReplyShot");
  });
});

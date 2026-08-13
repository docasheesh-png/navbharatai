import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reportStatus, reportStatusLabel, reportStatusHint, applyReportMark, openReportCount } from '../src/server/AgentV3/reportTriage';

/**
 * ADMIN REQUEST 2026-08-12: "jab admin koi build report download kar le, to build report par koi tag lag
 * jaye jisse admin ko pata rahe, is build report ki fix kiya ja chuka hai."
 *
 * The need is real — reports arrive faster than they get fixed, and without a mark the same one gets
 * re-read or re-sent. But "downloaded" and "fixed" are NOT the same fact, and collapsing them would make
 * the dashboard lie in the most ordinary case there is.
 *
 * The proof is the session this was asked in. ONE report was downloaded on 2026-08-12; fixing what was
 * inside it took TEN merged pull requests over several hours. Under a one-state design that report would
 * have read "fixed" from the first minute, while nine of its ten defects were still shipping — and a
 * dashboard that says a thing is done before it is done is worse than no dashboard, because the admin
 * stops checking whatever it has already ticked.
 *
 * So: two marks. SENT is a fact about the admin's action and records itself. FIXED is a fact about the
 * work and is only ever set by a person.
 */

const fmt = (ms: number) => new Date(ms).toISOString();

describe('two marks, because they are two different facts', () => {
  it('an untouched report is NEW', () => {
    expect(reportStatus(undefined)).toBe('new');
    expect(reportStatus({})).toBe('new');
    expect(reportStatusLabel('new')).toBe('🆕 New');
  });

  it('downloading marks it SENT — never fixed', () => {
    const t = applyReportMark({}, { downloaded: true }, 1_000);
    expect(t.downloadedAt).toBe(1_000);
    expect(t.fixedAt).toBeNull();
    expect(reportStatus(t)).toBe('sent');
  });

  it('the SENT badge says what happened, not what we hope is happening', () => {
    // "In progress" would be a claim about someone's intent that a download cannot observe.
    expect(reportStatusLabel('sent')).toBe('📤 Downloaded');
    expect(reportStatusHint({ downloadedAt: 1_000 }, fmt)).toMatch(/not marked fixed yet/);
  });

  it('only an explicit mark makes it FIXED', () => {
    const t = applyReportMark({ downloadedAt: 1_000 }, { fixed: true }, 5_000);
    expect(t.fixedAt).toBe(5_000);
    expect(reportStatus(t)).toBe('fixed');
    expect(reportStatusLabel('fixed')).toBe('✅ Fixed');
  });
});

describe('the rules that stop the marks from lying', () => {
  it('the FIRST download is the one kept — re-downloading rewrites no history', () => {
    // "When did this leave my inbox" is the question the mark answers; a later re-read is not a new
    // answer to it.
    const once = applyReportMark({}, { downloaded: true }, 1_000);
    const twice = applyReportMark(once, { downloaded: true }, 9_000);
    expect(twice.downloadedAt).toBe(1_000);
  });

  it('FIXED is reversible — a mis-click must not bury a real bug forever', () => {
    const fixed = applyReportMark({ downloadedAt: 1_000 }, { fixed: true, note: 'PR #2305' }, 5_000);
    const undone = applyReportMark(fixed, { fixed: false }, 6_000);
    expect(undone.fixedAt).toBeNull();
    expect(reportStatus(undone)).toBe('sent'); // back to sent, not back to new — it WAS downloaded
  });

  it('un-fixing drops the note with it', () => {
    // A note explaining a fix that is no longer claimed is exactly the stale text that misleads later.
    const fixed = applyReportMark({}, { fixed: true, note: 'PR #2305' }, 5_000);
    expect(applyReportMark(fixed, { fixed: false }, 6_000).fixedNote).toBeNull();
  });

  it('marking fixed implies it was seen, so the two can never disagree about order', () => {
    const t = applyReportMark({}, { fixed: true }, 5_000);
    expect(t.downloadedAt).toBe(5_000);
    expect(t.fixedAt).toBe(5_000);
  });

  it('an omitted `fixed` leaves the mark alone — absent is not false', () => {
    const fixed = applyReportMark({}, { fixed: true }, 5_000);
    const later = applyReportMark(fixed, { downloaded: true }, 9_000);
    expect(later.fixedAt).toBe(5_000);
  });

  it('FIXED outranks SENT even on a legacy row that somehow has only one', () => {
    expect(reportStatus({ fixedAt: 5_000 })).toBe('fixed');
  });

  it('junk timestamps read as absent, never as a mark', () => {
    for (const bad of [0, -1, NaN, null, undefined, 'yes' as any]) {
      expect(reportStatus({ downloadedAt: bad as any, fixedAt: bad as any }), String(bad)).toBe('new');
    }
  });

  it('the note is trimmed and bounded', () => {
    const t = applyReportMark({}, { fixed: true, note: `  ${'x'.repeat(500)}  ` }, 1);
    expect(t.fixedNote!.length).toBe(300);
    expect(applyReportMark({}, { fixed: true, note: '   ' }, 1).fixedNote).toBeNull();
  });

  it('a legacy row with NO fields ever reads as fixed', () => {
    // The one direction that must be impossible: a report nobody marked must never look handled.
    expect(reportStatus({} as any)).not.toBe('fixed');
    expect(reportStatus(null)).not.toBe('fixed');
  });
});

describe('the count on the tab', () => {
  it('counts everything not yet fixed — new AND downloaded', () => {
    expect(openReportCount([{}, { downloadedAt: 1 }, { fixedAt: 2 }, null, undefined])).toBe(4);
  });

  it('is zero when every report is marked fixed', () => {
    expect(openReportCount([{ fixedAt: 1 }, { fixedAt: 2 }])).toBe(0);
    expect(openReportCount([])).toBe(0);
  });
});

describe('WIRING — the panel and the server agree, and neither guesses', () => {
  const panel = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/AdminBuildReportStore.ts'), 'utf8');

  it('Download records itself, and records ONLY that', () => {
    expect(panel).toContain("void markReport(selectedReport.meta.id, { downloaded: true })");
  });

  it('the badge is drawn from the SERVER\'s merged answer, never an optimistic guess', () => {
    // An optimistic local update would show "Fixed" on a write that silently failed — the single thing
    // this feature must never do.
    expect(panel).toContain('const { triage } = await r.json()');
    expect(panel).toContain('rows.map((row) => (row.id === id ? { ...row, ...triage } : row))');
  });

  it('the Mark-fixed button toggles, so a mis-click is recoverable in the UI too', () => {
    expect(panel).toContain('void markReport(id, { fixed: !isFixed })');
  });

  it('the route is admin-only and tri-state on `fixed`', () => {
    expect(route).toContain("app.post('/api/admin/build-reports/:id/mark', verifyAdminToken");
    expect(route).toContain("fixed: typeof body.fixed === 'boolean' ? body.fixed : undefined");
  });

  it('a failed write is a 404, not a silent success', () => {
    expect(route).toContain("if (!triage) { res.status(404)");
  });

  it('the store MERGES the marks and cannot damage the report it annotates', () => {
    expect(store).toContain('await ref.set({ meta: next }, { merge: true });');
  });
});

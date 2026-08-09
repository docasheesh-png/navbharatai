import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ordinal, partCount, reportParts, partJson, partsSummary } from '../src/components/adminReportParts';
import { copyTextToClipboard } from '../src/lib/copyText';
import { buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';
import type { BuildDiagnosticsReport } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * ADMIN ASK 2026-08-09 (verbatim): "jab koi user app bana kar report kare, to puri report, sabhi edit
 * sath 0 to 100 admin ko send ho. Admin ke pas option ho kitne part download/copy karne hai — 1st,
 * 2nd, 3rd … all. Aur sirf download ka option aa raha hai, copy bhi add karo! Aur build report JSON
 * me hi copy hi, text me nahi."
 *
 * Three promises are locked here:
 *   1. COMPLETENESS — a reported record carries EVERY build/edit of the session, not just the one the
 *      user happened to be looking at (that was the whole point of "0 to 100").
 *   2. THE PART BOUNDARY — "1st part" must be exactly one build's report and nothing else, and "All"
 *      must be the whole record. A part picker that silently hands over the wrong slice is worse than
 *      no picker at all.
 *   3. JSON, NOT TEXT — every Copy payload parses as JSON (the admin pastes it straight into tooling).
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function rep(startedAt: number, over: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport {
  return {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt,
    endedAt: startedAt + 1_000,
    ok: true,
    prompt: `build ${startedAt}`,
    summary: `summary ${startedAt}`,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [],
    ...over,
  } as BuildDiagnosticsReport;
}

describe('ordinal — the numbering the admin reads', () => {
  it('is correct for the ordinary positions', () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
  });
  it('handles the teens (11th/12th/13th, not 11st/12nd/13rd) and the twenties', () => {
    expect([11, 12, 13, 21, 22, 23, 111, 112].map(ordinal)).toEqual(['11th', '12th', '13th', '21st', '22nd', '23rd', '111th', '112th']);
  });
});

describe('the record CARRIES the whole session (promise 1)', () => {
  const ctx = { userId: 'u1', email: 'a@b.com', name: 'A', workspaceId: 'ws-1', buildId: 'b-3', reportedAt: 9_000 };

  it('stores every build/edit, oldest → newest, and counts them in meta', () => {
    const focused = rep(3_000);
    const rec = buildAdminReportRecord(focused, ctx, [rep(1_000), rep(2_000), focused]);
    expect(rec.session?.builds).toHaveLength(3);
    expect(rec.session?.builds.map((b) => b.startedAt)).toEqual([1_000, 2_000, 3_000]);
    expect(rec.session?.count).toBe(3);
    expect(rec.meta.sessionParts).toBe(3);
  });

  it('a single-build session carries NO session block — "All" and "1st part" would be the same bytes', () => {
    const rec = buildAdminReportRecord(rep(1_000), ctx, [rep(1_000)]);
    expect(rec.session).toBeUndefined();
    expect(rec.meta.sessionParts).toBe(1);
  });

  it('passing no session at all still produces exactly the record it always did', () => {
    const rec = buildAdminReportRecord(rep(1_000), ctx);
    expect(rec.session).toBeUndefined();
    expect(rec.report.startedAt).toBe(1_000);
    expect(rec.meta.sessionParts).toBe(1);
  });

  it('the focused build is ALWAYS present even when the session list is huge (size cap counts, never hides)', () => {
    // A big fake body per build so the byte cap genuinely bites.
    const fat = (t: number) => rep(t, { summary: 'x'.repeat(400_000) });
    const builds = Array.from({ length: 40 }, (_, i) => fat(1_000 + i));
    const rec = buildAdminReportRecord(builds[builds.length - 1], ctx, builds);
    expect(rec.session!.count).toBe(40);
    expect(rec.session!.builds.length).toBeLessThan(40);
    expect(rec.session!.omittedBuilds).toBe(40 - rec.session!.builds.length);
    // Newest kept: the cap drops the OLDEST, never the build the user was looking at.
    expect(rec.session!.builds[rec.session!.builds.length - 1].startedAt).toBe(1_039);
  });
});

describe('the parts list — "1st, 2nd, 3rd … all"', () => {
  const many = { meta: { id: 'rep_1', sessionParts: 3 }, report: {}, session: { builds: [{ a: 1 }, { a: 2 }, { a: 3 }], count: 3, omittedBuilds: 0 } };

  it('offers All first, then one entry per build, numbered from 1', () => {
    expect(reportParts(many).map((p) => p.label)).toEqual(['All 3 parts', '1st part', '2nd part', '3rd part']);
    expect(reportParts(many).map((p) => p.key)).toEqual(['all', '0', '1', '2']);
  });

  it('a single-build record offers ONLY the whole report (no meaningless choice)', () => {
    const one = { meta: { id: 'rep_2' }, report: { a: 1 } };
    expect(reportParts(one).map((p) => p.label)).toEqual(['Full report']);
    expect(partCount(one)).toBe(1);
    expect(partCount(null)).toBe(1);
  });

  it('filenames are filesystem-safe and identify the part', () => {
    const parts = reportParts({ meta: { id: 'rep/../1 evil' }, session: { builds: [{}, {}], count: 2, omittedBuilds: 0 } });
    for (const p of parts) expect(p.filename).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1].filename).toMatch(/part-1$/);
    expect(parts[2].filename).toMatch(/part-2$/);
  });

  it('the summary is honest about builds the size cap dropped', () => {
    expect(partsSummary(many)).toBe('3 parts (every build/edit of this session)');
    expect(partsSummary({ ...many, session: { ...many.session, omittedBuilds: 2 } })).toMatch(/2 older build\(s\) omitted/);
    expect(partsSummary({ meta: { id: 'x' }, report: {} })).toBe('Single build');
  });
});

describe('THE PART BOUNDARY (promise 2) — a chosen part is exactly what it claims', () => {
  const rec = {
    meta: { id: 'rep_1', appLabel: 'Hospital app', sessionParts: 3 },
    report: { startedAt: 3_000 },
    session: { builds: [{ startedAt: 1_000 }, { startedAt: 2_000 }, { startedAt: 3_000 }], count: 3, omittedBuilds: 0 },
  };

  it('"all" is the ENTIRE record — meta, focused report and every build, nothing dropped', () => {
    const parsed = JSON.parse(partJson(rec, 'all'));
    expect(parsed).toEqual(rec);
  });

  it('an index yields THAT build only, tagged with its position and the identifying meta', () => {
    const parsed = JSON.parse(partJson(rec, '1'));
    expect(parsed.report).toEqual({ startedAt: 2_000 });
    expect(parsed.part).toEqual({ index: 2, of: 3, label: '2nd part' });
    expect(parsed.meta.id).toBe('rep_1');
    // The one thing a part must NOT be: the whole session wearing a part label.
    expect(parsed.session).toBeUndefined();
  });

  it('an out-of-range or nonsense key yields "" so the button disables instead of copying junk', () => {
    expect(partJson(rec, '3')).toBe('');
    expect(partJson(rec, '-1')).toBe('');
    expect(partJson(rec, 'nope')).toBe('');
    expect(partJson(null, 'all')).toBe('');
  });

  it('an unserialisable record yields "" — never the string "undefined" on the clipboard', () => {
    const cyclic: any = { meta: { id: 'x' }, report: {} };
    cyclic.report.self = cyclic;
    expect(partJson(cyclic, 'all')).toBe('');
  });

  it('EVERY part parses as JSON (promise 3 — "json me hi copy hi, text me nahi")', () => {
    for (const p of reportParts(rec)) expect(() => JSON.parse(partJson(rec, p.key))).not.toThrow();
  });
});

describe('copyTextToClipboard — honest about whether a copy really happened', () => {
  it('uses the modern clipboard when it works', async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyTextToClipboard('{"a":1}', { clipboard: { writeText } })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('{"a":1}');
  });

  it('falls back to the legacy path when the clipboard API rejects (unfocused / denied)', async () => {
    const legacyCopy = vi.fn(() => true);
    const ok = await copyTextToClipboard('x', { clipboard: { writeText: async () => { throw new Error('denied'); } }, legacyCopy });
    expect(ok).toBe(true);
    expect(legacyCopy).toHaveBeenCalled();
  });

  it('returns FALSE when nothing could copy — the UI must not claim success', async () => {
    expect(await copyTextToClipboard('x', { clipboard: null, legacyCopy: () => false })).toBe(false);
    expect(await copyTextToClipboard('', { clipboard: { writeText: async () => {} } })).toBe(false);
  });

  it('never throws, whatever the environment does', async () => {
    await expect(copyTextToClipboard('x', { clipboard: null, legacyCopy: () => { throw new Error('no dom'); } })).resolves.toBe(false);
  });
});

describe('wiring — the buttons genuinely use these helpers', () => {
  const dash = read('src/components/AdminDashboard.tsx');
  const route = read('src/server/routes/agentv3.ts');

  it('the report modal has BOTH Copy and Download, driven by the SAME chosen part', () => {
    expect(dash).toContain('Copy JSON');
    expect(dash).toContain('Download JSON');
    expect(dash).toContain('const selectedPartJson = useMemo(() => partJson(selectedReport, reportPart)');
    expect(dash).toContain('onClick={copySelectedReport}');
    expect(dash).toContain('onClick={downloadSelectedReport}');
  });

  it('the part picker is rendered from reportParts (no hand-typed second list to drift)', () => {
    expect(dash).toContain('reportParts(selectedReport)');
    expect(dash).toContain('selectedParts.map((p) =>');
  });

  it('the all-builds browser has a Copy beside every Download, session AND single build', () => {
    expect(dash).toContain('copyWorkspaceReport(b.workspaceId)');
    expect(dash).toContain('copyWorkspaceReport(b.workspaceId, h.id)');
    expect(dash).toContain('downloadWorkspaceReport(b.workspaceId, h.id)');
  });

  it('Copy and Download share ONE fetch, so they can never hand over different bytes', () => {
    expect(dash).toContain('const fetchWorkspaceReportJson');
    const copyAt = dash.indexOf('const copyWorkspaceReport');
    expect(dash.slice(copyAt, copyAt + 400)).toContain('fetchWorkspaceReportJson(');
  });

  it('the copy payload is stringified JSON, never a rendered text summary', () => {
    expect(dash).toContain('JSON.stringify(await r.json(), null, 2)');
    expect(dash).toContain('copyTextToClipboard');
  });

  it('the submit route gathers the WHOLE session before building the record', () => {
    expect(route).toContain('listDiagnosticsHistory(wsForSession');
    expect(route).toContain('buildAdminReportRecord(report,');
    expect(route).toContain('sessionBuilds');
  });
});

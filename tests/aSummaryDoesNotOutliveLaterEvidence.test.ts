// A REPLY IS NOT TRUE AFTER THE BUILD HAS PROVEN IT WRONG (build report #2566, 2026-11-27).
//
// The real run: at ~830 s the builder closed its turn with "all four areas build every time. The clean console
// confirms it." At ~955 s the platform's preview check saw `[world] no dry ground was found for "riverside-town"
// anywhere on the map; it was left out.` and started a preview-render repair, which the 25-minute cap stopped at
// 1500 s. The user was handed the 830 s reply, unqualified. 🧬 THE CLASS: a summary's claims outliving a later,
// still-standing finding (or the cap) in the same build. These tests replay that timeline through the real
// BuildDiagnostics and lock the boundaries: an earlier finding, a later clean check, the advisory cap.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { laterEvidence, staleSummaryNote, summaryWrittenAt } from '../src/server/AgentV3/staleSummary';
import { withLaterEvidence } from '../src/server/AgentV3/buildPhases/staleSummaryPhase';

const REPLY = 'Your game is working. Here is what changed to finish it.\n\n**Fixed: five places were silently missing from your map.** '
  + 'Tech City, Riverside Town and Hill Village (plus their joined tiles) were being dropped at load — the map could not find dry ground '
  + 'where they were placed, so you only ever saw Capital City. They are now placed nearer the centre, and all four areas build every '
  + 'time. The clean console confirms it.';
const CONSOLE_LINE = '[world] no dry ground was found for "riverside-town" anywhere on the map; it was left out.';
const STOP = 'Build outcome: STOPPED — the wall-clock cap (25 min) was reached before the build converged. NOT stopped by the user.';

/** A BuildDiagnostics on a fake clock, so the timeline is #2566's own seconds. */
function clockedDiag() {
  let t = 1_000_000;
  const d = new BuildDiagnostics({ now: () => t });
  return { d, at: (seconds: number) => { t = 1_000_000 + seconds * 1000; } };
}

/** #2566 as it ran: reply at 830 s, a console finding at 955 s, the repair cut by the cap at 1500 s. */
function build2566(opts: { cleanCheckAfterRepair?: boolean; stopped?: boolean; findingBeforeReply?: boolean } = {}) {
  const { d, at } = clockedDiag();
  if (opts.findingBeforeReply) {
    at(700);
    d.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: `console: ${CONSOLE_LINE}`, autoResolved: false });
  }
  at(830);
  d.ingestEvent({ type: 'done', ok: true, summary: REPLY, ts: 0 });
  if (!opts.findingBeforeReply) {
    at(955);
    d.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: `console: ${CONSOLE_LINE}`, autoResolved: false });
  }
  if (opts.cleanCheckAfterRepair) { at(1200); d.recordPreviewVerified(); }
  if (opts.stopped !== false) { at(1500); d.record({ phase: 'build', severity: 'error', code: 'OUTCOME_STOPPED', message: STOP, autoResolved: false }); }
  return d;
}

describe('#2566 — the delivered reply predates the finding and the cap', () => {
  it('marks the reply as written before the last check, quotes the console line, and names the stop', () => {
    const d = build2566();
    const out = withLaterEvidence({ ok: true, summary: REPLY }, d);
    expect(out.summary.startsWith(REPLY)).toBe(true);
    expect(out.summary).toContain('Written before the last check');
    expect(out.summary).toContain(CONSOLE_LINE);
    expect(out.summary).toMatch(/25-minute build time limit stopped the build before it finished, so this problem is still in your app/);
    const rec = d.report().issues.find((i) => i.code === 'SUMMARY_SUPERSEDED');
    expect(rec?.severity).toBe('warning');
    expect(rec?.message).toMatch(/wall-clock cap \(25 min\) stopped the build after it/);
  });

  it('the report summary carries the correction too (finish takes the corrected text)', () => {
    const d = build2566();
    const result = withLaterEvidence({ ok: true, summary: REPLY }, d);
    d.finish(result.ok, result.summary);
    expect(d.report().summary).toContain('Written before the last check');
  });

  it('is idempotent: a second pass (watchdog and settle can both arrive) adds nothing', () => {
    const d = build2566();
    const once = withLaterEvidence({ ok: true, summary: REPLY }, d);
    expect(withLaterEvidence(once, d).summary).toBe(once.summary);
  });

  it('platform lines appended around the reply do not hide its date', () => {
    const d = build2566();
    expect(summaryWrittenAt(d.laterEvidenceInput().replies, `⚠️ A note first.\n\n${REPLY}\n\n🟢 Discount 10%`)).toBe(1_000_000 + 830_000);
  });
});

describe('boundaries — only a standing finding AFTER the reply, or the cap, corrects it', () => {
  it('a later clean real-browser check answers the finding: no note when the build also finished in time', () => {
    const d = build2566({ cleanCheckAfterRepair: true, stopped: false });
    expect(withLaterEvidence({ ok: true, summary: REPLY }, d).summary).toBe(REPLY);
  });

  it('a finding the reply came AFTER (and fixed) is never re-raised', () => {
    const d = build2566({ findingBeforeReply: true, stopped: false });
    expect(withLaterEvidence({ ok: true, summary: REPLY }, d).summary).toBe(REPLY);
  });

  it('the cap alone after the reply still says the build was stopped before it was confirmed', () => {
    const d = build2566({ cleanCheckAfterRepair: true });
    const out = withLaterEvidence({ ok: true, summary: REPLY }, d).summary;
    expect(out).toMatch(/Then the 25-minute build time limit stopped the build while the platform was still checking/);
    expect(out).not.toContain(CONSOLE_LINE);
  });

  it('a finding with exhausted repairs (no cap) says the repairs ran out', () => {
    const d = build2566({ stopped: false });
    expect(withLaterEvidence({ ok: true, summary: REPLY }, d).summary).toMatch(/repair attempts ran out before it was fixed/);
  });

  it('the advisory cap (app built, extras cut) is not a stop of the build', () => {
    const e = laterEvidence({ since: 0, issues: [{ ts: 5, code: 'OUTCOME_ADVISORY_CAPPED', severity: 'warning', message: 'STOPPED — the app was built' }] });
    expect(staleSummaryNote(e)).toBe('');
  });

  it('a summary whose reply cannot be dated gets no correction (silence beats a wrong date)', () => {
    const d = build2566();
    expect(withLaterEvidence({ ok: true, summary: 'A wholly different text the runner never emitted as its reply.' }, d).summary)
      .toBe('A wholly different text the runner never emitted as its reply.');
  });

  it('kill switch', () => {
    const d = build2566();
    expect(withLaterEvidence({ ok: true, summary: REPLY }, d, { AGENTV3_STALE_SUMMARY_NOTE: 'off' }).summary).toBe(REPLY);
  });
});

describe('wiring — the route corrects the summary before the report is finished and the reply delivered', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  it('one call, right before buildDiag.finish on the settle path', () => {
    expect(route).toMatch(/result = withLaterEvidence\(result, buildDiag\); buildDiag\.finish\(result\.ok, result\.summary\);/);
  });
  it('a clean preview check dates itself (recordPreviewVerified stamps the time every caller relies on)', () => {
    const { d, at } = clockedDiag();
    at(10); d.recordPreviewVerified();
    expect(d.laterEvidenceInput().lastCleanAt).toBe(1_000_000 + 10_000);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scoreBuildOutcome, complaintInText } from '../src/server/AgentV3/buildOutcomeSignals';

/**
 * OPTION A WIRING — "poochho mat, naapo".
 *
 * The pure scorer and the store helpers have their own tests. These pin the five places the route has
 * to touch for any of it to be real: open a record when a build ends, and record each of the four
 * signals. Drop any one and nothing fails — the admin simply stops hearing about a class of bad build,
 * which is indistinguishable from there being none.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

describe('a record is opened for every build that ends', () => {
  it('startBuild runs in the FINALLY, so every ending is covered', () => {
    const fin = route.indexOf('clearInterval(diagHeartbeatTimer);');
    expect(fin).toBeGreaterThan(-1);
    expect(route.slice(fin, fin + 1400)).toContain('buildOutcomeStore.startBuild(');
  });

  it('it carries whether the build CLAIMED success — only a claimed success can be a silent failure', () => {
    expect(route).toContain('buildResultRef?.ok === true');
  });
});

describe('the four signals are recorded', () => {
  it('preview dwell, from the keep-alive ping', () => {
    const i = route.indexOf("app.post('/api/agentv3/preview-keepalive'");
    const body = route.slice(i, i + 2200);
    expect(body).toContain('previewFirstSeenAt');
    expect(body).toContain('previewLastSeenAt');
    // After the response: this endpoint's only job is to keep a page alive, never to slow it down.
    expect(body.indexOf('res.status(200).json({ ok: true, held })')).toBeLessThan(body.indexOf('noteBuildOutcome'));
  });

  it('a complaint in the user’s next message', () => {
    expect(route).toContain('if (complaintInText(prompt))');
    expect(route).toContain('{ complained: true }');
  });

  it('a PERSON pressing Diagnose — not the watchdog doing its job', () => {
    // The distinction is the whole guard against a false alarm on every routine auto-heal.
    expect(route).toContain("req.body?.userInitiated === true");
    expect(route).toContain('{ askedForRepair: true }');
    expect(surface).toContain('const runDiagnose = useCallback(async (userInitiated = false)');
    expect(surface).toContain('runDiagnose(true)');
  });

  it('publishing the app', () => {
    expect(route).toContain('{ invested: true }');
  });
});

describe('the report cannot be sent twice, or wrongly attributed', () => {
  it('the send is CLAIMED transactionally before the record is built', () => {
    const i = route.indexOf('async function noteBuildOutcome(');
    const body = route.slice(i, i + 4000);
    expect(body.indexOf('claimReport(')).toBeLessThan(body.indexOf('buildAdminReportRecord('));
  });

  it('identity comes from the verified TOKEN, never the request body', () => {
    const i = route.indexOf('async function outcomeIdentity(');
    const body = route.slice(i, i + 700);
    expect(body).toContain('verifyFirebaseToken(req)');
    expect(body).not.toContain('req.body');
  });

  it('the admin can tell an automatic report from a person pressing Report', () => {
    expect(route).toContain('autoReportReason(judgement)');
  });

  it('the whole feature has a kill switch', () => {
    expect(route).toContain('buildOutcomeTrackingEnabled()');
  });
});

describe('the guarantees, executed rather than grepped', () => {
  it('an ordinary follow-up request never triggers a report', () => {
    expect(complaintInText('add a dark mode')).toBe(false);
    expect(scoreBuildOutcome({
      buildOk: true, complained: false, askedForRepair: false, invested: false, previewWatchedMs: null,
    }).verdict).toBe('unclear');
  });

  it('a green build the user says is broken does', () => {
    expect(scoreBuildOutcome({
      buildOk: true, complained: true, askedForRepair: false, invested: false, previewWatchedMs: null,
    }).verdict).toBe('bad');
  });
});

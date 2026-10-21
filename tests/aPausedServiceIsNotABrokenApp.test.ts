// Autopsies 81a0eda5 and 14ea28b8 (2026-10-21): two builds ended on "navbharatai now in Maintenance, please try
// after some time" — the admin's AI pause. It was recorded as an unresolved `BUILD_ERROR` in the BUILD phase,
// so the release gate counted "1 build-breaking blocker", one user was told their app was "still broken" and
// the other got a bare "Error:" with no outcome. CLASS: a fact about the SERVICE recorded as a fact about the
// APP. A pause gets a named outcome, and a named outcome is never a shipping blocker.
import { describe, it, expect } from 'vitest';
import { BuildDiagnostics, isAppFinding, outcomeCodeOf } from '../src/server/AgentV3/BuildDiagnostics';
import { MAINTENANCE_MESSAGE, isMaintenanceMessage } from '../src/server/lib/aiMaintenanceMessage';
import { MAINTENANCE_MESSAGE as FROM_STORE } from '../src/server/lib/aiMaintenance';
import { classifyFailureReason } from '../src/lib/failureReason';

const errorEvent = (message: string) => ({ type: 'error', message, ts: 1 }) as never;

describe('an AI pause during a build is a named outcome, not an app error', () => {
  it('the real report: the maintenance sentence arrives as an error event', () => {
    const d = new BuildDiagnostics();
    d.ingestEvent(errorEvent(MAINTENANCE_MESSAGE));
    const codes = d.report().issues.map((i) => i.code);
    expect(codes).toContain('OUTCOME_AI_PAUSED');
    expect(codes).not.toContain('BUILD_ERROR');
    expect(outcomeCodeOf(d.report().issues)).toBe('OUTCOME_AI_PAUSED');
  });
  it('it is not one of the release gate\'s build-breaking blockers (it was "1 build-breaking blocker")', () => {
    const d = new BuildDiagnostics();
    d.ingestEvent(errorEvent(MAINTENANCE_MESSAGE));
    expect(d.shippingIssueCount('error')).toBe(0);
    expect(isAppFinding({ phase: 'build', code: 'OUTCOME_AI_PAUSED' })).toBe(false);
  });
  it('a real build error is still a BUILD_ERROR and still counts', () => {
    const d = new BuildDiagnostics();
    d.ingestEvent(errorEvent('Build stopped — an unexpected error occurred: x is not defined'));
    expect(d.report().issues.map((i) => i.code)).toContain('BUILD_ERROR');
    expect(d.shippingIssueCount('error')).toBeGreaterThan(0);
  });
  it('the sentence has ONE definition — the store re-exports it, nothing re-types it', () => {
    expect(FROM_STORE).toBe(MAINTENANCE_MESSAGE);
    expect(isMaintenanceMessage(`Error: ${MAINTENANCE_MESSAGE}`)).toBe(true);
    expect(isMaintenanceMessage('Model call failed')).toBe(false);
    expect(isMaintenanceMessage(undefined)).toBe(false);
  });
  it('the admin panel can name it (no "Other (not yet in the known pattern list)")', () => {
    expect(classifyFailureReason('x', 'OUTCOME_AI_PAUSED').key).toBe('ai-paused');
  });
});

// Autopsy 35bd9e17: the user answered YES to our offer and the builder asked the same question again; the turn
// then ended not-ok with OUTCOME_UNEXPLAINED ("an engine hole") although the ending was deliberate.
import { readFileSync } from 'node:fs';
import { offerAcceptedBuilderNote, requestNotesFor } from '../src/server/AgentV3/requestNotes';

describe('a yes to our offer is told to the builder, and a question ending has a name', () => {
  it('the builder is told the user already confirmed (and may not end on a question)', () => {
    const note = offerAcceptedBuilderNote(true);
    expect(note).toMatch(/already offered this exact build and answered yes/);
    expect(note).toMatch(/do not end your turn with a question/);
    expect(offerAcceptedBuilderNote(false)).toBe('');
    expect(offerAcceptedBuilderNote(undefined)).toBe('');
  });
  it('it rides the ONE request-notes list every lane reads — and only when the offer was accepted', () => {
    const base = { prompt: 'Ai video maker', planningText: 'Ai video maker', newBuild: true, editing: false, importTurn: false, framework: 'vite-react' };
    expect(requestNotesFor({ ...base, offerAccepted: true }).notes.some((n) => n.code === 'offer-accepted' && n.text)).toBe(true);
    expect(requestNotesFor(base).notes.find((n) => n.code === 'offer-accepted')?.text).toBe('');
  });
  it('the route threads the fact into that list', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/thirdPartyOwnAds: thirdPartyAdFactsAtStart\.ownAds,\s+offerAccepted,/);
  });
  it('a turn that ended on a question records OUTCOME_ASKED_USER, which is never a shipping blocker and is named for the panel', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/code: 'OUTCOME_ASKED_USER'/);
    expect(isAppFinding({ phase: 'build', code: 'OUTCOME_ASKED_USER' })).toBe(false);
    expect(classifyFailureReason('x', 'OUTCOME_ASKED_USER').key).toBe('asked-user');
  });
});

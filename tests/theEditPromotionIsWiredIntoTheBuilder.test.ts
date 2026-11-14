// Source guards for the wiring (the route is one 28k-line function, so each hook is locked by shape): remove any of
// these and an edit can again replace a project, or run without its instructions, or move the verified head unseen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const at = (needle: string) => { const i = src.indexOf(needle); expect(i, `missing: ${needle}`).toBeGreaterThan(-1); return i; };

describe('the builder\'s entry point uses the edit-promotion system', () => {
  it('🔴 the in-build proof cannot overwrite the last-known-good with a replacement', () => {
    expect(at('candidateReplacesBase(outcome.kind')).toBeLessThan(at("saveWorkspaceFiles(greenWorkspaceKey(workspaceId), files, { mode: 'replace' })"));
    expect(src).toMatch(/else if \(heldReplacement\)/);
    expect(src).toContain("code: 'IN_BUILD_GREEN_HELD'");
  });
  it('🔴 the turn-end settle holds a replacement BEFORE the green guard and before the revision is recorded', () => {
    const hold = at('await holdReplacementIfAny({');
    expect(hold).toBeLessThan(at('if (greenGuardEnabled() && !hold.held)'));
    expect(hold).toBeLessThan(at('await settleEditRevision({'));
    expect(src).toContain('if (!isImportTurn && !hold.held) {');
    expect(src).toContain('persisted = hold.persisted || persisted;');
  });
  it('a held edit is free and tells the user their change was not applied', () => {
    expect(src).toContain('effectiveBilledUsd = billAfterHold(effectiveBilledUsd, editHeldSummary);');
    expect(src).toContain('result = summaryAfterHold(result, editHeldSummary);');
  });
  it('only a fresh start or an approved rebuild may replace a project', () => {
    expect(src).toContain('let userApprovedReplace = wantsFreshStart(prompt);');
    expect(src).toContain('if (rebuildApproved) userApprovedReplace = true;');
    expect(src).toMatch(/if \(!editPromotionEnabled\(\) \|\| userApprovedReplace \|\| isImportTurn \|\| hasImportIntent\) return null;/);
  });
  it('the base is verified against the head revision at turn start, before the sandbox scan', () => {
    expect(at('await checkEditBaseForTurn({')).toBeLessThan(at('const scanT0 = Date.now();'));
  });
  it('🔴 the project memory is loaded before planning and handed to it; an unrecoverable one stops an edit before any write', () => {
    expect(at('await loadProjectMemoryForTurn({')).toBeLessThan(at('const planning = planningRequest({'));
    expect(src).toContain('projectMemory: projectMemory.text });');
    const stop = at('const memoryStop = memoryStopMessage(');
    expect(stop).toBeLessThan(at('if (projectImportNotMerged) {'));
    expect(src.slice(stop, stop + 900)).toContain('return;');
  });
  it('a constraint said in chat is recorded too, and the edit id comes from the client request id', () => {
    expect(src).toContain('await recordUserMessage(chatWsId,');
    expect(src).toContain('const editId = editIdFor(workspaceId, req.body?.requestId, randomUUID());');
  });
  it('the existing history restore records a restore revision (and calls no model)', () => {
    const i = at("app.post('/api/agentv3/restore-version'");
    const block = src.slice(i, src.indexOf("app.post('/api/agentv3/feature-plan'", i));
    expect(block).toContain('await recordRestoreRevision({');
    expect(block).not.toMatch(/\.route\(|aiRouter|callModel|generate\(/);
  });
  it('the Firestore drill runs in CI', () => {
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('scripts/projectRevisions.check.mjs');
  });
});

import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { combineTypecheckEvidence, currentTypecheckProof } from '../src/server/AgentV3/TscGate';
import { refuteReviewByEvidence } from '../src/server/AgentV3/reviewEvidence';
import type { ReviewResult } from '../src/server/AgentV3/ReviewerAgent';

const nativeCommand = './node_modules/.bin/ng build --progress=false';
const nativeFailure = '✘ [ERROR] NG9: Property colour does not exist on type BetTarget.';
const nativeSuccess = 'Application bundle generation complete. [3.417 seconds]';

function fixture() {
  let revision = 1;
  const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => revision });
  const record = (command: string, stdout: string, exitCode: number) => diagnostics.recordCommand({
    command, stdout, stderr: '', exitCode, typecheckProof: { revision, project: true },
  });
  return { diagnostics, record, changeSource: () => ++revision, revision: () => revision };
}

const compileFinding: ReviewResult = {
  passed: false, score: 20, summary: 'The project does not compile.',
  issues: [{ severity: 'critical', message: 'The project does not compile. Angular reports NG9 in the template.' }],
};

describe('integrated native and platform compiler proof', () => {
  it('keeps an Angular failure visible to the gate and reviewer after plain TypeScript passes', () => {
    const { diagnostics, record } = fixture();
    record(nativeCommand, nativeFailure, 1);
    record('./node_modules/.bin/tsc --noEmit', '', 0);

    const commandProof = diagnostics.typecheckEvidenceFromAgentCommands();
    expect(commandProof).toBe('failed');
    expect(diagnostics.evidenceLedger().facts.typecheck?.outcome).toBe(commandProof);
    const combined = combineTypecheckEvidence('passed', commandProof);
    expect(combined).toBe('failed');
    const checked = refuteReviewByEvidence(compileFinding, { typecheck: combined });
    expect(checked.refuted).toEqual([]);
    expect(checked.review.issues).toEqual(compileFinding.issues);
    expect(checked.review.passed).toBe(false);
  });

  it('lets a subsequent completed native build establish current proof', () => {
    const { diagnostics, record } = fixture();
    record(nativeCommand, nativeFailure, 1);
    record(nativeCommand, nativeSuccess, 0);
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(combineTypecheckEvidence('not-run', diagnostics.typecheckEvidenceFromAgentCommands())).toBe('passed');
  });

  it.each([['passed', nativeSuccess, 0], ['failed', nativeFailure, 1]] as const)(
    'invalidates historical native %s and platform proof after a source change', (_outcome, output, exitCode) => {
      const { diagnostics, record, changeSource, revision } = fixture();
      record(nativeCommand, output, exitCode);
      const platform = { outcome: 'passed' as const, revision: revision() };
      changeSource();
      const currentPlatform = currentTypecheckProof(platform, revision());
      expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBeUndefined();
      expect(diagnostics.evidenceLedger().facts.typecheck).toBeUndefined();
      expect(combineTypecheckEvidence(currentPlatform, diagnostics.typecheckEvidenceFromAgentCommands())).toBe('not-run');
    },
  );

  it('keeps a current platform compiler failure after an earlier native success', () => {
    const { diagnostics, record } = fixture();
    record(nativeCommand, nativeSuccess, 0);
    const combined = combineTypecheckEvidence('failed', diagnostics.typecheckEvidenceFromAgentCommands());
    expect(combined).toBe('failed');
    expect(refuteReviewByEvidence(compileFinding, { typecheck: combined }).review.passed).toBe(false);
  });

  it('preserves ordinary TypeScript evidence and leaves absent checks unverified', () => {
    const { diagnostics, record } = fixture();
    expect(combineTypecheckEvidence('not-run', diagnostics.typecheckEvidenceFromAgentCommands())).toBe('not-run');
    record('./node_modules/.bin/tsc --noEmit', '', 0);
    expect(combineTypecheckEvidence('not-run', diagnostics.typecheckEvidenceFromAgentCommands())).toBe('passed');
    record('./node_modules/.bin/tsc --noEmit', 'src/app.ts(1,1): error TS2307: Cannot find module missing.', 1);
    expect(combineTypecheckEvidence('passed', diagnostics.typecheckEvidenceFromAgentCommands())).toBe('failed');
  });
});

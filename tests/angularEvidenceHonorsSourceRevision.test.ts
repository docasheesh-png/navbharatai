import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { agentRunEvidence, type RecordedCommand } from '../src/server/AgentV3/agentRunEvidence';

const native = (typecheckCurrent: boolean | undefined, failed = false): RecordedCommand => ({
  command: './node_modules/.bin/ng build --progress=false', typecheckCurrent,
  exitCode: failed ? 1 : 0,
  stdout: failed ? 'Application bundle generation failed. error NG5002: bad template' : 'Application bundle generation complete.',
});
const tscFailure: RecordedCommand = {
  command: './node_modules/.bin/tsc --noEmit', typecheckCurrent: true, exitCode: 1,
  stdout: 'src/main.ts(1,1): error TS2322: Type mismatch.',
};

describe('Angular and TypeScript obey the same live source-revision boundary', () => {
  it('retains standalone/historical native proof without a live reader', () => {
    expect(agentRunEvidence([native(undefined)]).typecheck).toBe('passed');
  });
  it('accepts a positively current native proof', () => {
    expect(agentRunEvidence([native(true)]).typecheck).toBe('passed');
  });
  it('withholds stale and unknown native proof mapped to false by the live reader', () => {
    expect(agentRunEvidence([native(false)]).typecheck).toBeUndefined();
    expect(agentRunEvidence([native(false, true)]).typecheck).toBeUndefined();
  });
  it('does not let a late stale native pass erase a current TS failure', () => {
    expect(agentRunEvidence([tscFailure, native(false)]).typecheck).toBe('failed');
  });
  it('a current later native build can settle an earlier compiler failure', () => {
    expect(agentRunEvidence([tscFailure, native(true)]).typecheck).toBe('passed');
  });
  it('a current TS failure after native success still matters', () => {
    expect(agentRunEvidence([native(true), tscFailure]).typecheck).toBe('failed');
  });
  it('stale native failure cannot poison a later/current native pass', () => {
    expect(agentRunEvidence([native(true), native(false, true)]).typecheck).toBe('passed');
  });
  it('a later current native failure remains failed', () => {
    expect(agentRunEvidence([native(true), native(true, true)]).typecheck).toBe('failed');
  });
});

describe('integration receipts (source guards, not runtime coverage)', () => {
  it('captures native revision after dependencies but before compiler start and records it', () => {
    const source = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const begin = source.indexOf('if (angularPlan && !syntaxHeader)');
    expect(begin).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('if (syntaxHeader || tscHeader)', begin);
    expect(end).toBeGreaterThan(begin);
    const block = source.slice(begin, end);
    const prepared = block.indexOf('await this.actuator.ensureDependencies');
    const revision = block.indexOf('nativeRevision = getWorkspaceMemory(this.workspaceId).verificationRevision()');
    const command = block.indexOf('this.actuator.runCommand(this.workspaceId, angularPlan.command)');
    expect(prepared).toBeGreaterThanOrEqual(0);
    expect(revision).toBeGreaterThan(prepared);
    expect(command).toBeGreaterThan(revision);
    expect(block).toContain('typecheckProof: { revision: nativeRevision, project: true }');
  });
});

// These exercise #4303's actual live fan-in, not a test reimplementation of revision mapping.
describe('BuildDiagnostics native receipt freshness after #4303 integration', () => {
  const receipt = { command: './node_modules/.bin/ng build --progress=false', exitCode: 0,
    stdout: 'Application bundle generation complete.', stderr: '' };
  it('passes current native proof, then withholds it after source changes', () => {
    let revision = 4;
    const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => revision });
    diagnostics.recordCommand({ ...receipt, typecheckProof: { revision: 4, project: true } });
    expect(diagnostics.agentRunEvidence().typecheck).toBe('passed');
    revision = 5;
    expect(diagnostics.agentRunEvidence().typecheck).toBeUndefined();
  });
  it('does not promote native output without a source proof in live mode', () => {
    const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => 4 });
    diagnostics.recordCommand(receipt);
    expect(diagnostics.agentRunEvidence().typecheck).toBeUndefined();
  });
  it('fails closed when the live source revision cannot be read', () => {
    const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => { throw new Error('unavailable'); } });
    diagnostics.recordCommand({ ...receipt, typecheckProof: { revision: 4, project: true } });
    expect(diagnostics.agentRunEvidence().typecheck).toBeUndefined();
  });
});


describe('named compiler reader agrees with the shared Angular-aware ledger', () => {
  it.each(['current', 'stale', 'missing'] as const)('native receipt: %s', (freshness) => {
    const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => 5 });
    diagnostics.recordCommand({
      command: './node_modules/.bin/ng build --progress=false', exitCode: 1,
      stdout: 'Application bundle generation failed. error NG5002: bad template',
      ...(freshness === 'missing' ? {} : { typecheckProof: { revision: freshness === 'current' ? 5 : 4, project: true } }),
    });
    const expected = freshness === 'current' ? 'failed' : undefined;
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe(expected);
    expect(diagnostics.agentRunEvidence().typecheck).toBe(expected);
  });
  it('plain TypeScript success cannot refute a current Angular template failure', () => {
    const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => 5 });
    diagnostics.recordCommand({ command: './node_modules/.bin/ng build --progress=false',
      exitCode: 1, stdout: 'error NG5002: bad template', typecheckProof: { revision: 5, project: true } });
    diagnostics.recordCommand({ command: './node_modules/.bin/tsc --noEmit',
      exitCode: 0, stdout: '', stderr: '', typecheckProof: { revision: 5, project: true } });
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('failed');
    expect(diagnostics.agentRunEvidence().typecheck).toBe('failed');
  });
  it('both readers accept a current completed native build', () => {
    const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => 5 });
    diagnostics.recordCommand({ command: './node_modules/.bin/ng build --progress=false', exitCode: 0,
      stdout: 'Application bundle generation complete.', typecheckProof: { revision: 5, project: true } });
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(diagnostics.agentRunEvidence().typecheck).toBe('passed');
  });
});

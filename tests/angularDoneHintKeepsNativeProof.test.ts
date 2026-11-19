import { describe, expect, it } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

const nativeCommand = './node_modules/.bin/ng build --progress=false';
const genericCommand = './node_modules/.bin/tsc --noEmit';
type Receipt = { exitCode: number; stdout: string; stderr: string };
const nativePass: Receipt = { exitCode: 0, stdout: 'Application bundle generation complete.', stderr: '' };
const nativeFail: Receipt = { exitCode: 1, stdout: '[ERROR] NG9: Property missing does not exist in the Angular template.', stderr: '' };
const genericPass: Receipt = { exitCode: 0, stdout: '', stderr: '' };
const genericFail: Receipt = { exitCode: 1, stdout: 'src/main.ts(1,1): error TS2322: Type mismatch.', stderr: '' };

class Actuator implements ActuatorPort {
  files = new Map([
    ['tsconfig.json', '{"compilerOptions":{"strict":true}}'],
    ['package.json', '{"dependencies":{"@angular/core":"18.2.21"},"scripts":{"build":"ng build"}}'],
    ['angular.json', '{"projects":{"app":{"architect":{"build":{"options":{"tsConfig":"tsconfig.json"}}}}}}'],
    ['src/main.ts', 'export const answer: number = 1;'],
  ]);
  native: Receipt = nativePass;
  generic: Receipt = genericPass;
  nativeOverride?: () => Promise<Receipt>;
  genericOverride?: () => Promise<Receipt>;
  async readFile(_workspace: string, path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error('ENOENT: ' + path);
    return content;
  }
  async writeFile(_workspace: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_workspace: string, command: string): Promise<Receipt> {
    if (command === nativeCommand) return this.nativeOverride ? this.nativeOverride() : this.native;
    if (/\btsc\b/.test(command)) return this.genericOverride ? this.genericOverride() : this.generic;
    return genericPass;
  }
}

let sequence = 0;
function harness() {
  const id = `angular-done-proof-${++sequence}`;
  const actuator = new Actuator();
  const memory = getWorkspaceMemory(id);
  const diagnostics = new BuildDiagnostics({ currentSourceRevision: () => memory.verificationRevision() });
  const dispatcher = new ToolDispatcher(actuator, id, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'angular',
    receipt => diagnostics.recordCommand(receipt));
  const native = () => dispatcher.dispatch({ id: `native-${++sequence}`, name: 'typecheck', input: {} }, 'architect');
  const shell = (command: string) => dispatcher.dispatch({ id: `shell-${++sequence}`, name: 'bash', input: { command } }, 'architect');
  return { actuator, memory, diagnostics, dispatcher, native, shell };
}

function heldReceipt() {
  let started!: () => void;
  let finish!: (receipt: Receipt) => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const answer = new Promise<Receipt>(resolve => { finish = resolve; });
  return { entered, finish, run: () => { started(); return answer; } };
}

describe('the done/quality compiler hint obeys native scope and source revision', () => {
  it('retains a current Angular failure after plain tsc succeeds, until a native build passes', async () => {
    const { actuator, dispatcher, diagnostics, native, shell } = harness();
    actuator.native = nativeFail;
    await native();
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
    await shell(genericCommand);
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('failed');
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
    actuator.native = nativePass;
    await native();
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
  });

  it('uses the same native scope for literal shell ng builds', async () => {
    const { actuator, dispatcher, diagnostics, shell } = harness();
    actuator.native = nativeFail;
    await shell(nativeCommand);
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
    await shell(genericCommand);
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('failed');
    actuator.native = nativePass;
    await shell(nativeCommand);
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
  });

  it('retains the last decisive native failure when the next native check cannot run', async () => {
    const { actuator, dispatcher, diagnostics, native } = harness();
    actuator.native = nativeFail;
    await native();
    actuator.native = { exitCode: 127, stdout: '', stderr: '/bin/bash: ./node_modules/.bin/ng: No such file or directory' };
    await native();
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('failed');
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
  });

  it('does not let a stale native success erase a newer generic compiler failure', async () => {
    const { actuator, memory, dispatcher, diagnostics, native, shell } = harness();
    const held = heldReceipt();
    actuator.nativeOverride = held.run;
    const pending = native();
    await held.entered;
    memory.indexFile('src/main.ts', 'export const answer: number = "broken";');
    actuator.generic = genericFail;
    await shell(genericCommand);
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
    held.finish(nativePass);
    await pending;
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('failed');
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
  });

  it('does not let a stale native failure poison a newer native success', async () => {
    const { actuator, memory, dispatcher, diagnostics, native } = harness();
    const held = heldReceipt();
    actuator.nativeOverride = held.run;
    const pending = native();
    await held.entered;
    memory.indexFile('src/main.ts', 'export const answer: number = 2;');
    actuator.nativeOverride = undefined;
    await native();
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
    held.finish(nativeFail);
    await pending;
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
  });

  it('does not let a stale generic failure replace newer native proof', async () => {
    const { actuator, memory, dispatcher, diagnostics, native, shell } = harness();
    const held = heldReceipt();
    actuator.genericOverride = held.run;
    const pending = shell(genericCommand);
    await held.entered;
    memory.indexFile('src/main.ts', 'export const answer: number = 2;');
    await native();
    held.finish(genericFail);
    await pending;
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
  });

  it('does not use an old native failure to veto a successful check of changed source', async () => {
    const { actuator, memory, dispatcher, diagnostics, native, shell } = harness();
    actuator.native = nativeFail;
    await native();
    memory.indexFile('src/main.ts', 'export const answer: number = 2;');
    await shell(genericCommand);
    expect(diagnostics.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
  });
});

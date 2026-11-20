// 🔴 THE MODEL'S OWN INSTALL KEEPS THE WRITE-TIME TYPECHECK ON (failedbr #2278 sibling hunt, 2026-11-20).
//
// #2278 (a racing game) shipped `src/game/RacingGameLogic.tsx` importing `Vehicle` and `createVehicle` from the kit,
// neither of which exists; the release gate went RED on it after the app had rendered. The check built to quote
// that error back AT WRITE TIME never ran: "12 TypeScript write(s) skipped — 12 because package.json had changed
// since the last install". The platform's own installs (recipe deps since #4253, TSC_ENSURE) end in
// `touch node_modules` for exactly this; the MODEL'S `npm install -D @types/three` did not, so a scoped or
// already-present package left package.json newer than node_modules and the check stood down for the whole build.
// Reversion: drop the stamp call after `manifestRewrittenBy` in ToolDispatcher and the dispatcher test fails.

import { describe, it, expect } from 'vitest';
import { nodeModulesStampAfterInstall } from '../src/server/AgentV3/tscCommand';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class RecordingActuator implements ActuatorPort {
  files = new Map<string, string>([['package.json', '{"name":"app","dependencies":{}}']]);
  commands: string[] = [];
  exitCode = 0;
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_w: string, c: string) { this.commands.push(c); return { exitCode: this.exitCode, stdout: '', stderr: '' }; }
}

function dispatcherWith(act: RecordingActuator) {
  const stream = new AgentEventStream();
  return new ToolDispatcher(act, 'ws-stamp', new WorkspaceState(stream), stream);
}
const stamped = (act: RecordingActuator) => act.commands.some((c) => /touch 'node_modules'/.test(c));

describe('a successful model install re-stamps node_modules', () => {
  it("#2278's shape: `npm install -D @types/three` is followed by the stamp", async () => {
    const act = new RecordingActuator();
    await dispatcherWith(act).dispatch({ id: 't1', name: 'bash', input: { command: 'npm install -D @types/three' } });
    expect(stamped(act)).toBe(true);
  });
  it('a failed install is not stamped (the tree may really be stale)', async () => {
    const act = new RecordingActuator();
    act.exitCode = 1;
    await dispatcherWith(act).dispatch({ id: 't1', name: 'bash', input: { command: 'npm install three' } });
    expect(stamped(act)).toBe(false);
  });
  it('a command that installs nothing is not stamped', async () => {
    const act = new RecordingActuator();
    await dispatcherWith(act).dispatch({ id: 't1', name: 'bash', input: { command: 'ls -la src' } });
    expect(stamped(act)).toBe(false);
  });
});

describe('the stamp command is a safe plain path or nothing', () => {
  it('root and sub-directory manifests', () => {
    expect(nodeModulesStampAfterInstall('package.json')).toBe("[ -d 'node_modules' ] && touch 'node_modules'; true");
    expect(nodeModulesStampAfterInstall('frontend/package.json')).toBe("[ -d 'frontend/node_modules' ] && touch 'frontend/node_modules'; true");
  });
  it('anything that is not a plain relative path gets no command', () => {
    for (const bad of [null, '', '../package.json', 'a/../package.json', '$(rm -rf x)/package.json', "x'y/package.json", 'package.jsonx', '/abs/package.json']) {
      expect(nodeModulesStampAfterInstall(bad), String(bad)).toBeNull();
    }
  });
});

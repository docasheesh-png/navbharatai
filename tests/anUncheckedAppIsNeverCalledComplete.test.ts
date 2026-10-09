/**
 * TD-2 — a readiness check that does not finish is not a perfect score, and it is not "the app is done".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { appIsDone, doneSteer, unassessedFailsBuild } from '../src/server/AgentV3/doneSignal';
import { weakCheckpointSteer } from '../src/server/AgentV3/weakBuildCheckpoint';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

class HangListActuator implements ActuatorPort {
  hang = false;
  files = new Map<string, string>();
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listFiles(): Promise<string[]> {
    if (this.hang) return new Promise(() => {});
    return [...this.files.keys()];
  }
  async runCommand() {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

const savedTimeout = process.env.AGENTV3_READINESS_TIMEOUT_MS;

afterEach(() => {
  if (savedTimeout === undefined) delete process.env.AGENTV3_READINESS_TIMEOUT_MS;
  else process.env.AGENTV3_READINESS_TIMEOUT_MS = savedTimeout;
});

function dispatcher(act: HangListActuator): ToolDispatcher {
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  return new ToolDispatcher(act, 'ws-unassessed', state, stream);
}

const UNASSESSED: ReadinessReport = {
  score: 0, ready: false, blockers: [], warnings: [], tier: 'prototype', unassessed: true,
};

describe('a readiness check that does not finish is not called complete (TD-2)', () => {
  it('a listing that never returns is unassessed, not 100/100', async () => {
    process.env.AGENTV3_READINESS_TIMEOUT_MS = '50';
    const act = new HangListActuator();
    act.hang = true;
    const report = await dispatcher(act).assessBuildReadiness();
    expect(report.ready).toBe(false);
    expect(report.unassessed).toBe(true);
    expect(report.score).not.toBe(100);
  }, 15_000);

  it('a later timeout does not reuse the previous verdict', async () => {
    const act = new HangListActuator();
    const d = dispatcher(act);
    delete process.env.AGENTV3_READINESS_TIMEOUT_MS;
    const first = await d.assessBuildReadiness();
    expect(first.unassessed).not.toBe(true);
    act.hang = true;
    process.env.AGENTV3_READINESS_TIMEOUT_MS = '50';
    const second = await d.assessBuildReadiness();
    expect(second.unassessed).toBe(true);
    expect(second.ready).toBe(false);
    expect(second).not.toEqual(first);
  }, 30_000);

  it('an unassessed report is not done and gets no steer', () => {
    expect(appIsDone(UNASSESSED)).toBe(false);
    expect(doneSteer(UNASSESSED)).toBeNull();
    expect(weakCheckpointSteer(UNASSESSED)).toBeNull();
    const prev = process.env.AGENTV3_UNASSESSED_FAILS;
    delete process.env.AGENTV3_UNASSESSED_FAILS;
    expect(unassessedFailsBuild()).toBe(false);
    if (prev === undefined) delete process.env.AGENTV3_UNASSESSED_FAILS;
    else process.env.AGENTV3_UNASSESSED_FAILS = prev;
  });

  it('the step-cap looks at unassessed before it claims ready', () => {
    const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    const cap = runner.indexOf('Step cap — judge by EVIDENCE');
    expect(cap).toBeGreaterThan(-1);
    const slice = runner.slice(cap, cap + 4000);
    const unassessedAt = slice.indexOf('readiness.unassessed');
    const readyAt = slice.indexOf('if (readiness.ready)');
    expect(unassessedAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(unassessedAt);
  });

  it('the health card says the check timed out and does not print a score there', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    const at = panel.indexOf('if (health.unassessed)');
    expect(at).toBeGreaterThan(-1);
    const branch = panel.slice(at, panel.indexOf('const ready = health.ready', at));
    expect(branch).toContain('Not checked — the readiness check timed out');
    expect(branch).not.toContain('health.score');
  });
});

/**
 * Q-273 (autopsy 241215d1): `python3 --version && which python3 → exit 0 (11s)`, and the report could not
 * say whether the 11 seconds were ours, the machine waking, or the command. A slow command now carries
 * the split in its own report line; a fast one is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { commandTimingText, SLOW_COMMAND_SPLIT_MS } from '../src/server/AgentV3/commandTiming';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const REAL = 'python3 --version && which python3';

function lastCommandLine(d: BuildDiagnostics): string {
  const issues = (d as unknown as { issues: Array<{ code: string; message: string }> }).issues;
  const row = [...issues].reverse().find((i) => i.code === 'SANDBOX_CMD');
  return row?.message ?? '';
}

describe('a slow command says where its time went', () => {
  it('splits the real 11-second command into its four parts', () => {
    const text = commandTimingText({ setupMs: 200, sandboxMs: 9_400, runMs: 1_300 }, 11_000);
    expect(text).toBe(' — our setup 0.2s · sandbox 9.4s · command 1.3s · our checks after 0.1s');
  });

  it('says nothing for a fast command, a missing timing, or an unreadable part', () => {
    expect(commandTimingText({ setupMs: 0, sandboxMs: 100, runMs: 800 }, 1_000)).toBe('');
    expect(commandTimingText({ setupMs: 0, sandboxMs: 0, runMs: 0 }, SLOW_COMMAND_SPLIT_MS - 1)).toBe('');
    expect(commandTimingText(undefined, 11_000)).toBe('');
    expect(commandTimingText({ setupMs: 0, sandboxMs: Number.NaN, runMs: 1 }, 11_000)).toBe('');
    expect(commandTimingText({ setupMs: 0, sandboxMs: 1, runMs: 1 }, undefined)).toBe('');
  });

  it('never shows a negative remainder', () => {
    expect(commandTimingText({ setupMs: 3_000, sandboxMs: 3_000, runMs: 3_000 }, 6_000)).toContain('our checks after 0.0s');
  });

  it('the report line carries the split for a slow command and is unchanged for a fast one', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: REAL, exitCode: 0, stdout: 'Python 3.12', durationMs: 11_000, timing: { setupMs: 200, sandboxMs: 9_400, runMs: 1_300 } });
    expect(lastCommandLine(d)).toContain('(11s) — our setup 0.2s · sandbox 9.4s · command 1.3s');
    d.recordCommand({ command: 'ls', exitCode: 0, stdout: '', durationMs: 900, timing: { setupMs: 0, sandboxMs: 10, runMs: 880 } });
    expect(lastCommandLine(d)).toMatch(/\(1s\)$/);
  });

  it('the actuator times reaching the machine apart from the command, and the bash tool passes it on', () => {
    const actuator = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    expect(actuator).toMatch(/const reachStartedAt = Date\.now\(\);\s*const sandbox = await this\.getSandbox\(workspaceId\);\s*let sandboxMs = Date\.now\(\) - reachStartedAt;/);
    expect(actuator.match(/timing: \{ sandboxMs, runMs: priorRunMs \+ Date\.now\(\) - t0 \}/g)?.length).toBe(2);
    const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(dispatcher).toContain('durationMs: Date.now() - cmdStartedAt, timing });');
    expect(dispatcher).toContain('setupMs: runStartedAt - cmdStartedAt');
  });
});

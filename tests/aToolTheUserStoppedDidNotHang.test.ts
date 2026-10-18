// Autopsy 53ee45b9 (2026-10-18): the user stopped at 21 s while the platform's update_preview was 17 s in flight;
// the report filed it as STUCK_TOOL, severity error, unresolved. A Stop that cut a tool off is not a hang.
import { describe, it, expect, afterEach } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import type { AgentEvent } from '../src/server/AgentV3/types';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

const make = (userStopped: boolean) => {
  const d = new BuildDiagnostics({ now: () => 30_000, buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'AI image generator', model: 'x', framework: 'vite-react' });
  d.ingestEvent({ type: 'tool_call', agent: 'architect', tool: 'update_preview', input: {}, callId: 'c1', ts: 1000 } as AgentEvent);
  if (userStopped) d.record({ phase: 'build', severity: 'info', code: 'USER_STOPPED_BUILD', message: 'The user asked for this build to stop, and it was stopped.', autoResolved: true });
  d.finish(false, 'Stopped, as you asked.');
  return d.report().issues.find((i) => i.code === 'STUCK_TOOL')!;
};

describe('a tool the user Stop cut off is not stuck', () => {
  it('user-stopped build → info, resolved, says the Stop ended it', () => {
    const s = make(true);
    expect(s.severity).toBe('info');
    expect(s.autoResolved).toBe(true);
    expect(s.message).toMatch(/update_preview.*user stopped the build/);
  });
  it('any other not-ok end still names the hang as an error', () => {
    const s = make(false);
    expect(s.severity).toBe('error');
    expect(s.autoResolved).toBe(false);
  });
  it('an engine-initiated stop ("not by the user") is still an error', () => {
    const d = new BuildDiagnostics({ now: () => 30_000, buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'AI image generator', model: 'x', framework: 'vite-react' });
    d.ingestEvent({ type: 'tool_call', agent: 'architect', tool: 'bash', input: {}, callId: 'c1', ts: 1000 } as AgentEvent);
    d.record({ phase: 'build', severity: 'info', code: 'USER_STOPPED_BUILD', message: 'Stopped by the engine, not by the user.', autoResolved: true });
    d.finish(false);
    expect(d.report().issues.find((i) => i.code === 'STUCK_TOOL')!.severity).toBe('error');
  });
  it('kill switch restores the old record', () => {
    process.env['AGENTV3_STUCK_TOOL_STOP_INFO'] = 'off';
    expect(make(true).severity).toBe('error');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from 'e2b';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import type { SandboxSession } from '../src/server/AgentV3/sandboxSessions';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
interface Internals {
  getSandbox(workspaceId: string): Promise<Sandbox>;
  _restoreFreshSandbox(workspaceId: string): Promise<void>;
  _dropSandbox(workspaceId: string): void;
  _session: Map<string, SandboxSession>;
  _sessionStartWrites: WeakMap<SandboxSession, Promise<void>>;
}
function fixture() {
  const touchPending = deferred();
  const touch = vi.spyOn(sandboxStore, 'touch').mockReturnValue(touchPending.promise);
  vi.spyOn(sandboxStore, 'lookupRecoveryIdentity').mockResolvedValue({ state: 'missing' });
  const machine = { sandboxId: 'vm', setTimeout: vi.fn().mockResolvedValue(undefined) } as unknown as Sandbox;
  const create = vi.spyOn(Sandbox, 'create').mockResolvedValue(machine);
  vi.spyOn(Sandbox, 'connect').mockRejectedValue(Error('Unexpected connection'));
  const starts: SandboxSession[] = [];
  const start = vi.spyOn(sandboxStore, 'recordSessionStart').mockImplementation(async (_ws, session, identityTouch) => {
    await identityTouch;
    starts.push({ ...session });
  });
  const end = vi.spyOn(sandboxStore, 'recordSessionEnd').mockResolvedValue(undefined);
  const actuator = new E2BActuator('unit-test-key');
  const internal = actuator as unknown as Internals;
  const restore = vi.spyOn(internal, '_restoreFreshSandbox').mockResolvedValue(undefined);
  return { actuator, internal, machine, create, restore, touchPending, touch, start, starts, end };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'on');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('Network forbidden')));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('observation sequencing never gates app work or adds identity touches', () => {
  it('fresh creation and restoration finish while the original touch remains pending', async () => {
    const f = fixture();
    expect(await f.internal.getSandbox('ws')).toBe(f.machine);
    expect(f.restore).toHaveBeenCalledOnce(); expect(f.touch).toHaveBeenCalledOnce();
    expect(f.start).toHaveBeenCalledOnce(); expect(f.starts).toEqual([]);
    const session = f.internal._session.get('ws')!;
    expect(session.observationId).toMatch(/^[0-9a-f-]{36}$/);
    const writing = f.internal._sessionStartWrites.get(session)!;
    session.ops = 7; session.busyMs = 25;
    f.internal._dropSandbox('ws');
    expect(f.end).not.toHaveBeenCalled(); expect(f.internal._sessionStartWrites.has(session)).toBe(false);
    f.touchPending.resolve(); await writing; await Promise.resolve();
    expect(f.starts[0]).toMatchObject({ ops: 0, busyMs: 0, observationId: session.observationId });
    expect(f.end).toHaveBeenCalledWith('ws', expect.objectContaining({ observationId: session.observationId, ops: 7, busyMs: 25, endedBy: 'dropped' }));
    expect(f.touch).toHaveBeenCalledOnce();
  });
  it('touch failure is caught, not retried, and still permits observation CAS to decide', async () => {
    const f = fixture(); await f.internal.getSandbox('ws');
    const session = f.internal._session.get('ws')!;
    const writing = f.internal._sessionStartWrites.get(session)!;
    f.touchPending.reject(Error('touch failed or ACK lost'));
    await writing;
    expect(f.starts).toHaveLength(1); expect(f.touch).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledOnce();
  });
  it('two observations for one workspace retain distinct IDs and their own start promises', async () => {
    const f = fixture(); await f.internal.getSandbox('ws');
    const old = f.internal._session.get('ws')!;
    const oldWrite = f.internal._sessionStartWrites.get(old)!;
    f.internal._dropSandbox('ws');
    const secondTouch = deferred(); f.touch.mockReturnValueOnce(secondTouch.promise);
    vi.setSystemTime(Date.now() + 1);
    await f.internal.getSandbox('ws');
    const newer = f.internal._session.get('ws')!;
    const newWrite = f.internal._sessionStartWrites.get(newer)!;
    expect(newer.observationId).not.toBe(old.observationId);
    secondTouch.resolve(); await newWrite; await Promise.resolve();
    expect(f.end).not.toHaveBeenCalled();
    f.internal._dropSandbox('ws'); await Promise.resolve(); await Promise.resolve();
    expect(f.end).toHaveBeenCalledWith('ws', expect.objectContaining({ observationId: newer.observationId }));
    f.touchPending.resolve(); await oldWrite; await Promise.resolve();
    expect(f.end).toHaveBeenLastCalledWith('ws', expect.objectContaining({ observationId: old.observationId }));
    expect(f.touch).toHaveBeenCalledTimes(2);
  });
  it('warm operations keep the existing throttle and never create another observation', async () => {
    const f = fixture(); await f.internal.getSandbox('ws');
    await f.internal.getSandbox('ws');
    expect(f.touch).toHaveBeenCalledOnce(); expect(f.start).toHaveBeenCalledOnce();
    f.touchPending.resolve();
  });
  it('resume-off retains its existing no-touch/no-persisted-start behavior', async () => {
    const f = fixture(); vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'off');
    await f.internal.getSandbox('ws');
    expect(f.touch).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(f.internal._session.get('ws')?.observationId).toBeTruthy();
  });
});

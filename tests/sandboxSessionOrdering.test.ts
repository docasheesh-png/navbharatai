import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from 'e2b';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import type { SandboxSession } from '../src/server/AgentV3/sandboxSessions';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
interface Internals {
  getSandbox(workspaceId: string): Promise<Sandbox>;
  _dropSandbox(workspaceId: string): void;
  _session: Map<string, SandboxSession>;
  _sessionStartWrites: WeakMap<SandboxSession, Promise<void>>;
}
function machine(sandboxId: string) {
  return {
    sandboxId,
    setTimeout: vi.fn().mockResolvedValue(undefined),
    files: { read: vi.fn().mockResolvedValue('data') },
    commands: { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
  } as unknown as Sandbox;
}
function fixture() {
  const first = machine('vm-1');
  const create = vi.spyOn(Sandbox, 'create').mockResolvedValue(first);
  const connect = vi.spyOn(Sandbox, 'connect').mockRejectedValue(Error('Unexpected connection'));
  const lookup = vi.spyOn(sandboxStore, 'lookupRecoveryIdentity').mockResolvedValue({ state: 'missing' });
  const allocation = vi.spyOn(sandboxStore, 'recordAllocation').mockResolvedValue(true);
  const touch = vi.spyOn(sandboxStore, 'touch').mockResolvedValue(undefined);
  const starts: SandboxSession[] = [];
  const start = vi.spyOn(sandboxStore, 'recordSessionStart').mockImplementation(async (_ws, session) => {
    starts.push({ ...session });
  });
  const end = vi.spyOn(sandboxStore, 'recordSessionEnd').mockResolvedValue(undefined);
  const actuator = new E2BActuator('unit-test-key');
  const internal = actuator as unknown as Internals;
  const restore = vi.spyOn(internal as any, '_restoreFreshSandbox').mockResolvedValue(undefined);
  vi.spyOn(internal as any, '_kickoffPlaywright').mockImplementation(() => {});
  return { actuator, internal, first, create, connect, lookup, allocation, touch, start, starts, end, restore };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'on');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('Network forbidden')));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('allocation identity is durable before session observation; telemetry stays best-effort', () => {
  it('does not publish, restore, or record a session until the initial allocation CAS succeeds', async () => {
    const f = fixture();
    const allocationGate = deferred<boolean>();
    f.allocation.mockReturnValueOnce(allocationGate.promise);

    const creating = f.internal.getSandbox('ws');
    await Promise.resolve(); await Promise.resolve();
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.allocation).toHaveBeenCalledWith('ws', null, 'vm-1', null);
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();

    allocationGate.resolve(true);
    await expect(creating).resolves.toBe(f.first);
    expect(f.restore).toHaveBeenCalledOnce();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.start.mock.calls[0]).toHaveLength(2);
    const session = f.internal._session.get('ws')!;
    expect(session.observationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.starts[0]).toMatchObject({ sandboxId: 'vm-1', observationId: session.observationId });
  });

  it('a failed session observation is swallowed after allocation and does not retry the allocation', async () => {
    const f = fixture();
    f.start.mockRejectedValueOnce(new Error('session write failed'));
    await expect(f.internal.getSandbox('ws')).resolves.toBe(f.first);
    const session = f.internal._session.get('ws')!;
    await f.internal._sessionStartWrites.get(session);
    expect(f.allocation).toHaveBeenCalledOnce();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.restore).toHaveBeenCalledOnce();
    expect(f.starts).toEqual([]);
  });

  it('two observations keep distinct IDs and each end waits for its own start write', async () => {
    const f = fixture();
    const firstGate = deferred();
    const secondGate = deferred();
    const gates = [firstGate, secondGate];
    f.start.mockImplementation(async (_ws, session) => {
      const gate = gates.shift();
      await gate?.promise;
      f.starts.push({ ...session });
    });
    await f.internal.getSandbox('ws');
    const old = f.internal._session.get('ws')!;
    const oldWrite = f.internal._sessionStartWrites.get(old)!;
    f.internal._dropSandbox('ws');
    f.create.mockResolvedValueOnce(machine('vm-2'));
    vi.setSystemTime(Date.now() + 1);
    await f.internal.getSandbox('ws');
    const newer = f.internal._session.get('ws')!;
    const newWrite = f.internal._sessionStartWrites.get(newer)!;
    expect(newer.observationId).not.toBe(old.observationId);

    f.internal._dropSandbox('ws');
    expect(f.end).not.toHaveBeenCalled();
    secondGate.resolve();
    await newWrite; await Promise.resolve();
    expect(f.end).toHaveBeenCalledWith('ws', expect.objectContaining({ observationId: newer.observationId }));
    expect(f.end).not.toHaveBeenCalledWith('ws', expect.objectContaining({ observationId: old.observationId }));
    firstGate.resolve();
    await oldWrite; await Promise.resolve();
    expect(f.end).toHaveBeenLastCalledWith('ws', expect.objectContaining({ observationId: old.observationId }));
    expect(f.allocation).toHaveBeenCalledTimes(2);
  });

  it('warm operations keep the conditional touch throttle and never create another observation', async () => {
    const f = fixture();
    await f.internal.getSandbox('ws');
    expect(f.touch).not.toHaveBeenCalled();
    await f.internal.getSandbox('ws');
    expect(f.touch).toHaveBeenCalledOnce();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.allocation).toHaveBeenCalledOnce();
  });

  it('resume-off retains its existing no-touch/no-persisted-start behavior', async () => {
    const f = fixture(); vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'off');
    await f.internal.getSandbox('ws');
    expect(f.allocation).not.toHaveBeenCalled();
    expect(f.touch).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(f.internal._session.get('ws')?.observationId).toBeTruthy();
  });
});

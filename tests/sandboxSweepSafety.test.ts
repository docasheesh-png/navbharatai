import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from 'e2b';
import { PAUSE_FAILURE_WARNING_THRESHOLD } from '../src/server/AgentV3/sandboxReaper';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore, type SandboxRecord } from '../src/server/AgentV3/SandboxStore';

const WS = 'agentv3-test-sweep';
const NOW = 1_800_000_000_000;
const stale: SandboxRecord = { workspaceId: WS, userId: 'test', sandboxId: 'old-machine', updatedAt: NOW - 60 * 60_000 };
interface Internals {
  _heartbeatLifetimes(): Promise<void>;
  _notePauseFailure(sandboxId: string): number;
  _pauseFailures: Map<string, number>;
  _sweepIdleSandboxes(): Promise<void>;
  _sweepOrphanSandboxes(): Promise<void>;
  sandboxes: Map<string, Sandbox>;
  _activeBuilds: Map<string, number>;
  _opsInFlight: Map<string, number>;
  _lastActivity: Map<string, number>;
  _lastDurableTouch: Map<string, number>;
  _sandboxStartedAt: Map<string, number>;
  _fileCache: Map<string, Map<string, string>>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function handle(id = stale.sandboxId): Sandbox { return { sandboxId: id } as Sandbox; }
function fixture() {
  const pause = vi.spyOn(Sandbox, 'pause').mockResolvedValue(true);
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(false);
  vi.spyOn(Sandbox, 'create').mockRejectedValue(new Error('Unexpected sandbox creation in offline sweep test'));
  vi.spyOn(Sandbox, 'connect').mockRejectedValue(new Error('Unexpected sandbox connection in offline sweep test'));
  const list = vi.spyOn(sandboxStore, 'listStale').mockResolvedValue([{ ...stale }]);
  const current = vi.spyOn(sandboxStore, 'getRecord').mockResolvedValue({ ...stale });
  const settle = vi.spyOn(sandboxStore, 'markPausedIfUnchanged').mockResolvedValue(true);
  const legacySettle = vi.spyOn(sandboxStore, 'markPaused').mockResolvedValue(undefined);
  vi.spyOn(sandboxStore, 'recordSessionEnd').mockResolvedValue(undefined);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const touch = vi.spyOn(sandboxStore, 'touch').mockResolvedValue(undefined);
  const touchCurrent = vi.spyOn(sandboxStore, 'touchIfCurrent').mockResolvedValue(true);
  const act = new E2BActuator('unit-test-key');
  const internal = act as unknown as Internals;
  return { act, internal, pause, kill, list, current, settle, legacySettle, warning, touch, touchCurrent };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'on');
  vi.stubEnv('AGENTV3_SANDBOX_IDLE_MINUTES', '5');
  vi.stubEnv('AGENTV3_SANDBOX_TOUCH_MINUTES', '5');
  vi.stubEnv('AGENTV3_SANDBOX_LIFETIME_MINUTES', '6');
  vi.stubEnv('AGENTV3_MAX_BUILD_SECONDS', '1800');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network is forbidden in sweep safety tests')));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sandbox sweeps preserve active work without provider traffic', () => {
  it.each(['build', 'operation', 'handle'] as const)('rechecks a %s appearing during the durable read', async (kind) => {
    const f = fixture();
    const read = deferred<SandboxRecord | null>();
    const entered = deferred<void>();
    f.current.mockImplementationOnce(() => { entered.resolve(); return read.promise; });
    const sweep = f.internal._sweepOrphanSandboxes();
    await entered.promise;
    if (kind === 'build') f.internal._activeBuilds.set(WS, NOW);
    if (kind === 'operation') f.internal._opsInFlight.set(WS, 1);
    if (kind === 'handle') f.internal.sandboxes.set(WS, handle());
    read.resolve({ ...stale });
    await sweep;
    expect(f.pause).not.toHaveBeenCalled();
    expect(f.settle).not.toHaveBeenCalled();
  });

  it.each(['replacement', 'fresh', 'missing', 'unavailable'] as const)('does not pause a %s durable candidate', async (kind) => {
    const f = fixture();
    if (kind === 'replacement') f.current.mockResolvedValue({ ...stale, sandboxId: 'replacement' });
    if (kind === 'fresh') f.current.mockResolvedValue({ ...stale, updatedAt: NOW });
    if (kind === 'missing') f.current.mockResolvedValue(null);
    if (kind === 'unavailable') f.current.mockRejectedValue(new Error('store unavailable'));
    await f.internal._sweepOrphanSandboxes();
    expect(f.pause).not.toHaveBeenCalled();
    expect(f.settle).not.toHaveBeenCalled();
  });

  it('allows only one whole sweep and releases the guard after completion', async () => {
    const f = fixture();
    const page = deferred<SandboxRecord[]>();
    f.list.mockReturnValueOnce(page.promise).mockResolvedValue([]);
    const first = f.internal._sweepIdleSandboxes();
    await f.internal._sweepIdleSandboxes();
    expect(f.list).toHaveBeenCalledTimes(1);
    page.resolve([]);
    await first;
    await f.internal._sweepIdleSandboxes();
    expect(f.list).toHaveBeenCalledTimes(2);
  });

  it('releases the whole-sweep guard after a failed page read', async () => {
    const f = fixture();
    f.list.mockRejectedValueOnce(new Error('store unavailable')).mockResolvedValue([]);
    await f.internal._sweepIdleSandboxes();
    await f.internal._sweepIdleSandboxes();
    expect(f.list).toHaveBeenCalledTimes(2);
  });

  it.each(['false', 'rejection'] as const)('keeps repeated pause %s retryable without kill or settlement', async (failure) => {
    const f = fixture();
    if (failure === 'false') f.pause.mockResolvedValue(false);
    else f.pause.mockRejectedValue(new Error('provider unavailable'));
    for (let attempt = 0; attempt < 4; attempt++) await f.internal._sweepOrphanSandboxes();
    expect(f.pause).toHaveBeenCalledTimes(4);
    expect(f.kill).not.toHaveBeenCalled();
    expect(f.settle).not.toHaveBeenCalled();
    expect(f.legacySettle).not.toHaveBeenCalled();
  });

  it('does not drop a replacement object with the same sandbox id after an awaited pause', async () => {
    const f = fixture();
    const result = deferred<boolean>();
    f.pause.mockReturnValueOnce(result.promise);
    f.internal.sandboxes.set(WS, handle());
    const pending = f.act.pauseSandbox(stale.sandboxId);
    const replacement = handle();
    f.internal.sandboxes.set(WS, replacement);
    result.resolve(true);
    await pending;
    expect(f.internal.sandboxes.get(WS)).toBe(replacement);
  });

  it('preserves replacement allocation activity and cached files during idle pause', async () => {
    const f = fixture();
    f.list.mockResolvedValue([]);
    const result = deferred<boolean>();
    const entered = deferred<void>();
    f.pause.mockImplementationOnce(() => { entered.resolve(); return result.promise; });
    f.internal.sandboxes.set(WS, handle());
    f.internal._lastActivity.set(WS, stale.updatedAt);
    const sweep = f.internal._sweepIdleSandboxes();
    await entered.promise;
    const replacement = handle('new-machine');
    const files = new Map([['important.txt', 'new work']]);
    f.internal.sandboxes.set(WS, replacement);
    f.internal._lastActivity.set(WS, NOW);
    f.internal._lastDurableTouch.set(WS, NOW);
    f.internal._sandboxStartedAt.set(WS, NOW);
    f.internal._fileCache.set(WS, files);
    f.settle.mockResolvedValue(false);
    result.resolve(true);
    await sweep;
    expect(f.internal.sandboxes.get(WS)).toBe(replacement);
    expect(f.internal._lastActivity.get(WS)).toBe(NOW);
    expect(f.internal._lastDurableTouch.get(WS)).toBe(NOW);
    expect(f.internal._sandboxStartedAt.get(WS)).toBe(NOW);
    expect(f.internal._fileCache.get(WS)).toBe(files);
  });

  it('preserves activity and files for a pending replacement before its handle is installed', async () => {
    const f = fixture();
    f.list.mockResolvedValue([]);
    const result = deferred<boolean>();
    const entered = deferred<void>();
    f.pause.mockImplementationOnce(() => { entered.resolve(); return result.promise; });
    f.internal.sandboxes.set(WS, handle());
    f.internal._lastActivity.set(WS, stale.updatedAt);
    const sweep = f.internal._sweepIdleSandboxes();
    await entered.promise;
    // Recovery dropped the old handle; getSandbox has recorded new activity but is still awaiting connect.
    f.internal.sandboxes.delete(WS);
    const files = new Map([['important.txt', 'pending work']]);
    f.internal._lastActivity.set(WS, NOW);
    f.internal._fileCache.set(WS, files);
    f.settle.mockResolvedValue(false);
    result.resolve(true);
    await sweep;
    expect(f.internal._lastActivity.get(WS)).toBe(NOW);
    expect(f.internal._fileCache.get(WS)).toBe(files);
  });

  it('settles the observed orphan conditionally and preserves newer state on mismatch', async () => {
    const f = fixture();
    const settlement = deferred<boolean>();
    const entered = deferred<void>();
    f.settle.mockImplementationOnce(() => { entered.resolve(); return settlement.promise; });
    const sweep = f.internal._sweepOrphanSandboxes();
    await entered.promise;
    const files = new Map([['important.txt', 'new work']]);
    f.internal._lastActivity.set(WS, NOW);
    f.internal._lastDurableTouch.set(WS, NOW);
    f.internal._sandboxStartedAt.set(WS, NOW);
    f.internal._fileCache.set(WS, files);
    settlement.resolve(false);
    await sweep;
    expect(f.settle).toHaveBeenCalledWith(stale, 'orphan-sweep');
    expect(f.legacySettle).not.toHaveBeenCalled();
    expect(f.internal._lastActivity.get(WS)).toBe(NOW);
    expect(f.internal._lastDurableTouch.get(WS)).toBe(NOW);
    expect(f.internal._sandboxStartedAt.get(WS)).toBe(NOW);
    expect(f.internal._fileCache.get(WS)).toBe(files);
  });
});


describe('busy heartbeat makes liveness visible across instances', () => {
  it.each(['build', 'operation'] as const)('refreshes durable activity for a quiet %s, throttled across ticks', async (kind) => {
    const f = fixture();
    const setTimeout = vi.fn().mockResolvedValue(undefined);
    f.internal.sandboxes.set(WS, { sandboxId: stale.sandboxId, setTimeout } as unknown as Sandbox);
    if (kind === 'build') f.internal._activeBuilds.set(WS, NOW);
    else f.internal._opsInFlight.set(WS, 1);
    await f.internal._heartbeatLifetimes();
    expect(f.touchCurrent).toHaveBeenCalledExactlyOnceWith(WS, stale.sandboxId);
    expect(f.touch).not.toHaveBeenCalled();
    // Move the clock without firing constructor intervals; invoke only the heartbeat under test.
    for (const minutes of [2, 4]) {
      vi.setSystemTime(NOW + minutes * 60_000);
      await f.internal._heartbeatLifetimes();
    }
    expect(f.touchCurrent).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 6 * 60_000);
    await f.internal._heartbeatLifetimes();
    expect(f.touchCurrent).toHaveBeenCalledTimes(2);
    expect(f.touch).not.toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalledTimes(4);
    expect(f.pause).not.toHaveBeenCalled();
  });

  it.each(['idle', 'expired-build'] as const)('does not keep an %s sandbox alive or fresh', async (kind) => {
    const f = fixture();
    const setTimeout = vi.fn().mockResolvedValue(undefined);
    f.internal.sandboxes.set(WS, { sandboxId: stale.sandboxId, setTimeout } as unknown as Sandbox);
    if (kind === 'expired-build') f.internal._activeBuilds.set(WS, NOW - 60 * 60_000);
    await f.internal._heartbeatLifetimes();
    expect(f.touchCurrent).not.toHaveBeenCalled();
    expect(f.touch).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it('still records live work when provider extension rejects', async () => {
    const f = fixture();
    const setTimeout = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    f.internal.sandboxes.set(WS, { sandboxId: stale.sandboxId, setTimeout } as unknown as Sandbox);
    f.internal._activeBuilds.set(WS, NOW);
    await f.internal._heartbeatLifetimes();
    expect(f.touchCurrent).toHaveBeenCalledExactlyOnceWith(WS, stale.sandboxId);
    expect(f.touch).not.toHaveBeenCalled();
  });
  it('does not fall back to an identity-overwriting touch when conditional refresh refuses', async () => {
    const f = fixture();
    f.touchCurrent.mockResolvedValue(false);
    const setTimeout = vi.fn().mockResolvedValue(undefined);
    f.internal.sandboxes.set(WS, { sandboxId: stale.sandboxId, setTimeout } as unknown as Sandbox);
    f.internal._activeBuilds.set(WS, NOW);
    await f.internal._heartbeatLifetimes();
    expect(f.touchCurrent).toHaveBeenCalledExactlyOnceWith(WS, stale.sandboxId);
    expect(f.touch).not.toHaveBeenCalled();
  });
});

describe('unconfirmed pause diagnostics stay bounded and allocation-specific', () => {
  it('warns once at the threshold and saturates without retiring the machine', () => {
    const f = fixture();
    for (let n = 1; n <= PAUSE_FAILURE_WARNING_THRESHOLD + 20; n++) f.internal._notePauseFailure('old-machine');
    expect(f.warning).toHaveBeenCalledTimes(1);
    expect(f.warning.mock.calls[0]?.[0]).toContain('SANDBOX_PAUSE_UNCONFIRMED old-machine');
    expect(f.internal._pauseFailures.get('old-machine')).toBe(PAUSE_FAILURE_WARNING_THRESHOLD + 1);
    expect(f.kill).not.toHaveBeenCalled();
    expect(f.settle).not.toHaveBeenCalled();
    expect(f.legacySettle).not.toHaveBeenCalled();
  });

  it('does not transfer failure history between sandbox identities', () => {
    const f = fixture();
    for (let n = 0; n < PAUSE_FAILURE_WARNING_THRESHOLD; n++) f.internal._notePauseFailure('old-machine');
    expect(f.internal._notePauseFailure('replacement-machine')).toBe(1);
    expect(f.internal._pauseFailures.get('old-machine')).toBe(PAUSE_FAILURE_WARNING_THRESHOLD);
    expect(f.warning).toHaveBeenCalledTimes(1);
  });

  it('retains at most 1000 sandbox diagnostics and evicts oldest insertion first', () => {
    const f = fixture();
    for (let n = 0; n < 1001; n++) f.internal._notePauseFailure(`sandbox-${n}`);
    expect(f.internal._pauseFailures.size).toBe(1000);
    expect(f.internal._pauseFailures.has('sandbox-0')).toBe(false);
    expect(f.internal._pauseFailures.has('sandbox-1')).toBe(true);
    expect(f.internal._pauseFailures.get('sandbox-1000')).toBe(1);
    expect(f.warning).not.toHaveBeenCalled();
  });
});

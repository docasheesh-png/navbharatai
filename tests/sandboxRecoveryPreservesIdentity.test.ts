import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Sandbox, SandboxNotFoundError, FileNotFoundError, AuthenticationError, RateLimitError } from 'e2b';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import { SandboxRecoveryUnavailableError, isSandboxRecoveryUnavailable, rethrowSandboxRecoveryUnavailable } from '../src/server/AgentV3/SandboxRecoveryError';

const WS = 'agentv3-owner-stateful';
const OLD = 'existing-machine';

function machine(sandboxId = OLD) {
  return {
    sandboxId,
    setTimeout: vi.fn().mockResolvedValue(undefined),
    files: { read: vi.fn().mockResolvedValue('existing data'), exists: vi.fn().mockResolvedValue(true) },
    commands: { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    pty: { kill: vi.fn().mockResolvedValue(true) },
  };
}

function fixture() {
  const old = machine();
  const fresh = machine('new-machine');
  const lookup = vi.spyOn(sandboxStore, 'lookupRecoveryIdentity').mockResolvedValue({ state: 'found', sandboxId: OLD });
  const connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(old as unknown as Sandbox);
  const create = vi.spyOn(Sandbox, 'create').mockResolvedValue(fresh as unknown as Sandbox);
  const session = vi.spyOn(sandboxStore, 'recordSessionStart').mockResolvedValue(undefined);
  const touch = vi.spyOn(sandboxStore, 'touch').mockResolvedValue(undefined);
  const act = new E2BActuator('unit-test-key');
  const internal = act as unknown as {
    _restoreFreshSandbox(workspaceId: string): Promise<void>;
    _kickoffPlaywright(): void;
    sandboxes: Map<string, Sandbox>;
    _creating: Map<string, unknown>;
  };
  const restore = vi.spyOn(internal, '_restoreFreshSandbox').mockResolvedValue(undefined);
  vi.spyOn(internal, '_kickoffPlaywright').mockImplementation(() => {});
  return { act, internal, lookup, connect, create, session, touch, restore, old, fresh };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'on'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('unknown workspace recovery preserves its recorded machine', () => {
  it('store unavailability refuses before any SDK, session, touch or restore effect', async () => {
    const f = fixture();
    f.lookup.mockResolvedValue({ state: 'unavailable' });
    await expect(f.act.ensureWorkspace(WS, 'import')).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.lookup).toHaveBeenCalledTimes(1); // setup must not classify uncertainty as a dead handle and retry
    for (const effect of [f.connect, f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
    expect(f.internal.sandboxes.size).toBe(0);
    expect(f.internal._creating.size).toBe(0);
  });

  it('a hanging lookup refuses at three seconds and ignores its late result', async () => {
    const f = fixture();
    let release!: (value: { state: 'found'; sandboxId: string }) => void;
    f.lookup.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const refused = expect(f.act.readFile(WS, 'data.db')).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    await vi.advanceTimersByTimeAsync(3_000);
    await refused;
    release({ state: 'found', sandboxId: OLD });
    await vi.advanceTimersByTimeAsync(0);
    for (const effect of [f.connect, f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
  });

  it.each([
    new Error('fetch failed'), new Error('Sandbox.connect timed out after 45000ms'),
    new AuthenticationError('secret SDK details'), new RateLimitError('429'),
    new Error('503 gateway unavailable'), new Error('Sandbox not found'), new FileNotFoundError('missing file'),
  ])('a nonterminal reconnect rejection %s cannot replace a possibly live machine', async (error) => {
    const f = fixture();
    f.connect.mockRejectedValue(error);
    const caught = await f.act.ensureWorkspace(WS, 'import').catch((value: unknown) => value);
    expect(caught).toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect((caught as Error).message).toBe('Your workspace could not be safely reconnected. Please retry shortly.');
    expect(f.connect).toHaveBeenCalledTimes(1);
    for (const effect of [f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
  });

  it('a connect deadline does not publish a late handle; a later retry reconnects the same id', async () => {
    const f = fixture();
    let release!: (value: Sandbox) => void;
    f.connect.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refused = expect(f.act.readFile(WS, 'data.db')).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    await vi.advanceTimersByTimeAsync(45_000);
    await refused;
    release(f.old as unknown as Sandbox);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.internal.sandboxes.size).toBe(0);
    for (const effect of [f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
    await expect(f.act.readFile(WS, 'data.db')).resolves.toBe('existing data');
    expect(f.connect.mock.calls.map(([id]) => id)).toEqual([OLD, OLD]);
    expect(f.create).not.toHaveBeenCalled();
  });

  it('concurrent callers share the refusal, clear their lock and can retry later', async () => {
    const f = fixture();
    f.connect.mockRejectedValueOnce(new Error('fetch failed'));
    const outcomes = await Promise.allSettled([f.act.readFile(WS, 'a'), f.act.readFile(WS, 'b'), f.act.readFile(WS, 'c')]);
    expect(outcomes.every((r) => r.status === 'rejected' && isSandboxRecoveryUnavailable(r.reason))).toBe(true);
    expect(f.lookup).toHaveBeenCalledTimes(1);
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.internal._creating.size).toBe(0);
    await expect(f.act.readFile(WS, 'a')).resolves.toBe('existing data');
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each(['listFiles', 'ensureDependencies'] as const)('%s propagates uncertain identity instead of a misleading empty/ordinary failure', async (method) => {
    const f = fixture();
    f.lookup.mockResolvedValue({ state: 'unavailable' });
    await expect(f.act[method](WS)).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.lookup).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled();
  });

  it('a dead command-handle retry does not flatten recovery uncertainty into the original command error', async () => {
    const f = fixture();
    f.lookup.mockResolvedValueOnce({ state: 'found', sandboxId: OLD }).mockResolvedValue({ state: 'unavailable' });
    f.old.commands.run.mockRejectedValue(new Error('fetch failed'));
    await expect(f.act.runCommand(WS, 'echo probe')).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.old.commands.run).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled();
  });

  it('an unknown terminal machine does not report a successful or ordinary completed kill', async () => {
    const f = fixture();
    f.lookup.mockResolvedValue({ state: 'unavailable' });
    await expect(f.act.killPty(WS, 123)).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.old.pty.kill).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it('dev-server database recovery stops if reconnecting its evicted machine becomes uncertain', async () => {
    const f = fixture();
    vi.stubEnv('AGENTV3_DEVSERVER_FASTPATH', 'off');
    f.old.files.exists.mockResolvedValue(false);
    f.old.files.read.mockResolvedValue(JSON.stringify({ scripts: { dev: 'vite' } }));
    const launch = vi.fn();
    f.old.commands.run.mockImplementation(async (command: string, options?: { background?: boolean }) => {
      if (options?.background) {
        launch();
        return { exitCode: 0, stdout: '', stderr: '', disconnect: vi.fn().mockResolvedValue(undefined) };
      }
      if (command.startsWith('cat ')) {
        // Model a concurrent lifecycle eviction between launch and the nested provision operation.
        f.internal.sandboxes.delete(WS);
        f.lookup.mockResolvedValue({ state: 'unavailable' });
        return { exitCode: 0, stdout: "P1001: Can't reach database server at localhost:5432", stderr: '' };
      }
      return { exitCode: 0, stdout: 'PORT_DOWN', stderr: '' };
    });
    await expect(f.act.runCommand(WS, 'npm run dev')).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(f.lookup).toHaveBeenCalledTimes(2);
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe('known recovery behavior remains available', () => {
  it('a recorded live machine keeps its id and existing file contents', async () => {
    const f = fixture();
    await expect(f.act.readFile(WS, 'data.db')).resolves.toBe('existing data');
    expect(f.connect).toHaveBeenCalledWith(OLD, expect.any(Object));
    expect(f.act.sandboxOrigin(WS)).toBe('resumed');
    expect(f.create).not.toHaveBeenCalled();
    expect(f.restore).not.toHaveBeenCalled();
  });

  it('an explicit id bypasses an unavailable store even with automatic resume disabled', async () => {
    const f = fixture();
    vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'off');
    f.lookup.mockResolvedValue({ state: 'unavailable' });
    await f.act.ensureWorkspace(WS, 'import', ` ${OLD}\n`);
    expect(f.lookup).not.toHaveBeenCalled();
    expect(f.connect).toHaveBeenCalledWith(OLD, expect.any(Object));
    expect(f.create).not.toHaveBeenCalled();
  });

  it('a blank explicit id does not hide the durable id', async () => {
    const f = fixture();
    await f.act.ensureWorkspace(WS, 'import', ' \n');
    expect(f.lookup).toHaveBeenCalledTimes(1);
    expect(f.connect).toHaveBeenCalledWith(OLD, expect.any(Object));
  });

  it.each(['missing', 'disabled'] as const)('successful no-id lookup or explicit resume rollback (%s) retains fresh creation', async (mode) => {
    const f = fixture();
    f.lookup.mockResolvedValue({ state: 'missing' });
    if (mode === 'disabled') vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'off');
    await expect(f.act.readFile(WS, 'a')).resolves.toBe('existing data');
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(WS);
    expect(f.act.sandboxOrigin(WS)).toBe('created-fresh');
    expect(f.lookup).toHaveBeenCalledTimes(mode === 'disabled' ? 0 : 1);
  });

  it('a typed connect-not-found retains the established days-later source restore', async () => {
    const f = fixture();
    f.connect.mockRejectedValue(new SandboxNotFoundError('Paused sandbox not found'));
    await expect(f.act.readFile(WS, 'a')).resolves.toBe('existing data');
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(WS);
    expect(f.act.sandboxOrigin(WS)).toBe('created-after-failed-resume');
    expect(f.session).toHaveBeenCalledWith(WS, expect.objectContaining({ sandboxId: 'new-machine', origin: 'created-after-failed-resume' }));
  });
});

describe('the installed SDK connect boundary supplies the terminal classification', () => {
  it.each([404, 401, 429, 503])('HTTP %i is classified by the real Sandbox.connect implementation', async (status) => {
    // Exercise the installed SDK's own HTTP/undici transport, never a real provider.
    vi.useRealTimers();
    const requests = vi.fn();
    const server = createServer((request, response) => {
      requests(request.method, request.url);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: status, message: 'test refusal' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const error = await Sandbox.connect(OLD, { apiKey: 'unit-test-key', apiUrl: `http://127.0.0.1:${port}`, retries: 0 }).catch((value: unknown) => value);
      expect(requests).toHaveBeenCalledExactlyOnceWith('POST', `/sandboxes/${OLD}/connect`);
      expect(error instanceof SandboxNotFoundError).toBe(status === 404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('the shared error guard is nominal and preserves the same typed refusal', () => {
    const error = new SandboxRecoveryUnavailableError();
    expect(error.code).toBe('SANDBOX_RECOVERY_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(isSandboxRecoveryUnavailable({ code: error.code })).toBe(false);
    expect(() => rethrowSandboxRecoveryUnavailable(error)).toThrow(error);
    expect(() => rethrowSandboxRecoveryUnavailable(new Error('ordinary failure'))).not.toThrow();
  });
});

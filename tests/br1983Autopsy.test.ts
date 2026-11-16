/**
 * BR1983 (a short follow-up to make an existing app comfortable on a phone,
 * failed, not charged) — retained evidence, not a replay.
 *
 * Setup died in under a second with SANDBOX_RECOVERY_UNAVAILABLE / "Your
 * workspace could not be safely reconnected. Please retry shortly." The
 * retained report has no underlying reason, so this autopsy cannot prove the
 * vendor message. The same class of refusal aborts the build before the
 * tool-capable builder can wait, and the goodbye invites a second Start.
 *
 * Already closed on main, locked here against neighbouring shapes:
 *   • BR1961 F2 (#4146) — sandboxUnavailableNotice does not invite a second Start.
 *   • BR1952 (#4124) — a text-only fast lane is not started when setup failed.
 *   • A proven E2B concurrent-cap refusal on a *fresh create* is recorded as
 *     SANDBOX_UNAVAILABLE and the builder can still wait for a slot.
 *
 * Shipped in this PR:
 *   • A proven concurrent-cap refusal during resume/reconnect is rethrown as
 *     that cap error. The recorded machine is not replaced. Setup and the
 *     admission budget keep their existing cap path instead of aborting with
 *     "please retry shortly".
 *   • Any other non-404 reconnect failure still refuses without replacement
 *     (reason recorded for the admin report only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RateLimitError, Sandbox, SandboxNotFoundError } from 'e2b';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import { SandboxRecoveryUnavailableError } from '../src/server/AgentV3/SandboxRecoveryError';
import { buildExceptionDetails, publishBuildException, rethrowBuildSetupRecoveryUnavailable } from '../src/server/AgentV3/BuildRequestCoordination';
import { isDeadSandboxError } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/sandboxHealth';
import {
  isE2BConcurrentCapacityError,
  isE2BConcurrentCapacityMessage,
} from '../src/server/AgentV3/e2bConcurrentCapacity';

const CAP = 'Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes (20)';
const CAP_PREFIX = `Error: ${CAP}.`;
const WS = 'agentv3-owner-br1983';
const OLD = 'existing-machine';

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const ACTUATOR = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
const ADMISSION = readFileSync('src/server/AgentV3/sandboxAdmissionBudget.ts', 'utf8');

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
  const allocation = vi.spyOn(sandboxStore, 'recordAllocation').mockResolvedValue(true);
  const touch = vi.spyOn(sandboxStore, 'touch').mockResolvedValue(undefined);
  const act = new E2BActuator('unit-test-key');
  const internal = act as unknown as {
    _restoreFreshSandbox(workspaceId: string): Promise<void>;
    _kickoffPlaywright(): void;
    sandboxes: Map<string, Sandbox>;
  };
  const restore = vi.spyOn(internal, '_restoreFreshSandbox').mockResolvedValue(undefined);
  vi.spyOn(internal, '_kickoffPlaywright').mockImplementation(() => {});
  return { act, internal, lookup, connect, create, session, allocation, touch, restore, old, fresh };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'on'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('BR1983: already-closed neighbours stay closed', () => {
  it('the F2 sandbox notice still does not invite a second Start', () => {
    const notice = sandboxUnavailableNotice();
    expect(notice).toContain("You don't need to start the build again");
    expect(notice.toLowerCase()).not.toMatch(/try (building )?again|retry shortly|please retry/);
  });

  it('a recovery refusal still stops setup; an ordinary setup error still continues as SANDBOX_UNAVAILABLE', () => {
    expect(ROUTE).toContain('rethrowBuildSetupRecoveryUnavailable(setupErr)');
    const setupCatch = ROUTE.slice(ROUTE.indexOf('} catch (setupErr) {'));
    expect(setupCatch.indexOf('rethrowBuildSetupRecoveryUnavailable(setupErr)'))
      .toBeLessThan(setupCatch.indexOf("sandboxUnavailable = true"));
    expect(setupCatch).toContain("code: 'SANDBOX_UNAVAILABLE'");
    expect(setupCatch).toContain('sandboxUnavailableNotice()');
  });

  it('a text-only fast lane is still not started when setup failed', () => {
    expect(ROUTE).toContain('const fastLaneWouldRun = !sandboxUnavailable &&');
  });
});

describe('BR1983: the concurrent-cap matcher stays exact', () => {
  it('accepts only the proven E2B concurrent-cap wording', () => {
    expect(isE2BConcurrentCapacityMessage(CAP)).toBe(true);
    expect(isE2BConcurrentCapacityMessage(CAP_PREFIX)).toBe(true);
    expect(isE2BConcurrentCapacityError(new Error(CAP))).toBe(true);
    expect(isE2BConcurrentCapacityError(new RateLimitError(CAP))).toBe(true);
  });

  it('rejects neighbouring rate-limit and quoted-cap wording (do not widen)', () => {
    const neighbours = [
      '429',
      'Rate limit exceeded',
      'Rate limit exceeded — maximum number of concurrent E2B sandboxes (20)',
      'You have reached the maximum number of concurrent E2B sandboxes (20)',
      'the maximum number of concurrent E2B sandboxes (20) was reached, please try again later',
      'fetch failed',
      'Sandbox not found',
      'Sandbox.connect timed out after 45000ms',
      '503 gateway unavailable',
      'Please retry shortly',
      '',
    ];
    for (const message of neighbours) {
      expect(isE2BConcurrentCapacityMessage(message), message).toBe(false);
      expect(isE2BConcurrentCapacityError(new Error(message)), message).toBe(false);
    }
    expect(isE2BConcurrentCapacityError(new RateLimitError('429'))).toBe(false);
    expect(isDeadSandboxError(CAP)).toBe(false);
  });
});

describe('BR1983: a proven cap on reconnect does not replace the machine or abort as recovery-unavailable', () => {
  it('rethrows the cap error from ensureWorkspace and does not create, restore, or session-start', async () => {
    const f = fixture();
    const cap = new RateLimitError(CAP);
    f.connect.mockRejectedValue(cap);
    const caught = await f.act.ensureWorkspace(WS, 'import').catch((value: unknown) => value);
    expect(caught).toBe(cap);
    expect(caught).not.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.connect).toHaveBeenCalledWith(OLD, expect.any(Object));
    for (const effect of [f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
    expect(f.internal.sandboxes.size).toBe(0);
  });

  it('a later retry still reconnects the same recorded id once a slot is free', async () => {
    const f = fixture();
    f.connect.mockRejectedValueOnce(new Error(CAP)).mockResolvedValue(f.old as unknown as Sandbox);
    await expect(f.act.ensureWorkspace(WS, 'import')).rejects.toThrow(CAP);
    expect(f.create).not.toHaveBeenCalled();
    await expect(f.act.readFile(WS, 'data.db')).resolves.toBe('existing data');
    expect(f.connect.mock.calls.map(([id]) => id)).toEqual([OLD, OLD]);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.restore).not.toHaveBeenCalled();
  });

  it('a cap on the winning-allocation reconnect also refuses without inventing a third machine', async () => {
    const f = fixture();
    f.lookup.mockResolvedValueOnce({ state: 'missing' }).mockResolvedValue({ state: 'found', sandboxId: OLD });
    f.allocation.mockResolvedValueOnce(false);
    const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
    f.connect.mockRejectedValue(new Error(CAP));
    const caught = await f.act.readFile(WS, 'data.db').catch((value: unknown) => value);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(CAP);
    expect(caught).not.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('new-machine');
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.internal.sandboxes.size).toBe(0);
  });
});

describe('BR1983: uncertain reconnects still never replace a possibly live machine', () => {
  it.each([
    new Error('fetch failed'),
    new Error('Sandbox.connect timed out after 45000ms'),
    new RateLimitError('429'),
    new Error('503 gateway unavailable'),
    new Error('Sandbox not found'),
  ])('non-cap non-404 %s is still a recovery refusal with no create', async (error) => {
    const f = fixture();
    f.connect.mockRejectedValue(error);
    const caught = await f.act.ensureWorkspace(WS, 'import').catch((value: unknown) => value);
    expect(caught).toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect((caught as SandboxRecoveryUnavailableError).reason).toBe('connect-unknown');
    expect((caught as Error).message).toBe('Your workspace could not be safely reconnected. Please retry shortly.');
    expect(f.connect).toHaveBeenCalledTimes(1);
    for (const effect of [f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
  });

  it('a typed connect-not-found still restores into a replacement machine', async () => {
    const f = fixture();
    f.connect.mockRejectedValue(new SandboxNotFoundError('Paused sandbox not found'));
    await expect(f.act.readFile(WS, 'a')).resolves.toBe('existing data');
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(WS);
  });

  it('store unavailability is still a recovery refusal, with an admin-only reason', async () => {
    const f = fixture();
    f.lookup.mockResolvedValue({ state: 'unavailable' });
    const caught = await f.act.ensureWorkspace(WS, 'import').catch((value: unknown) => value);
    expect(caught).toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect((caught as SandboxRecoveryUnavailableError).reason).toBe('identity-unavailable');
    expect((caught as Error).message).toBe('Your workspace could not be safely reconnected. Please retry shortly.');
    for (const effect of [f.connect, f.create, f.session, f.touch, f.restore]) expect(effect).not.toHaveBeenCalled();
  });

  it('the admin report may record the reason; the user-facing event does not', () => {
    const error = new SandboxRecoveryUnavailableError('connect-unknown');
    expect(buildExceptionDetails(error)).toEqual({
      message: error.message,
      phase: 'sandbox',
      code: error.code,
      summary: error.message,
      detail: 'connect-unknown',
    });
    const emit = vi.fn();
    try {
      rethrowBuildSetupRecoveryUnavailable(error);
      throw new Error('setup unexpectedly continued');
    } catch (thrown) {
      publishBuildException(thrown, null, emit);
    }
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: 'error', code: 'SANDBOX_RECOVERY_UNAVAILABLE', retryable: true, message: expect.stringContaining('safely reconnected'), ts: expect.any(Number) },
      { type: 'result', ok: false, summary: expect.stringContaining('safely reconnected'), steps: 0, billedUsd: 0, billedInr: 0 },
    ]);
    const published = JSON.stringify(emit.mock.calls);
    expect(published).not.toContain('connect-unknown');
    expect(published).not.toContain('identity-unavailable');
  });
});

describe('BR1983: source census for the shared matcher', () => {
  it('both reconnect refusal sites consult the shared cap helper before wrapping', () => {
    expect(ACTUATOR).toContain("import { isE2BConcurrentCapacityError } from '../../../e2bConcurrentCapacity'");
    expect(ACTUATOR).toContain('if (isE2BConcurrentCapacityError(error)) throw error;');
    expect(ACTUATOR.split('if (isE2BConcurrentCapacityError(error)) throw error;')).toHaveLength(3);
    expect(ADMISSION).toContain("import { isE2BConcurrentCapacityError, isE2BConcurrentCapacityMessage } from './e2bConcurrentCapacity'");
    expect(ADMISSION).not.toContain('const CAPACITY =');
    expect(ADMISSION).toContain('isE2BConcurrentCapacityMessage(result.content)');
    expect(ADMISSION).toContain('if (isE2BConcurrentCapacityError(error))');
  });
});

/** Synthetic reconnect-classification regression cases. No customer report payload.
 * Verify recorded-machine preservation, bounded capacity handling, and private
 * diagnostic reason propagation without changing public event shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RateLimitError, Sandbox, SandboxNotFoundError } from 'e2b';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import { SandboxRecoveryUnavailableError } from '../src/server/AgentV3/SandboxRecoveryError';
import { buildExceptionDetails, publishBuildException, rethrowBuildSetupRecoveryUnavailable } from '../src/server/AgentV3/BuildRequestCoordination';
import { BuildDiagnostics, renderDiagnosticsText, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import { compactReportForRecord, trimReportForStorage } from '../src/server/AgentV3/DiagnosticsStore';
import { conversationToEvents } from '../src/components/agentv3/agentV3History';
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
    expect(ROUTE).toContain('rethrowBuildSetupRecoveryUnavailable(setupErr,');
    const setupCatch = ROUTE.slice(ROUTE.indexOf('} catch (setupErr) {'));
    expect(setupCatch.indexOf('rethrowBuildSetupRecoveryUnavailable(setupErr,'))
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

  it('the classified reason is an adminDetail, not a user-facing detail', () => {
    const error = new SandboxRecoveryUnavailableError('connect-unknown');
    expect(buildExceptionDetails(error)).toEqual({
      message: error.message,
      phase: 'sandbox',
      code: error.code,
      summary: error.message,
      adminDetail: 'connect-unknown',
    });
    expect(buildExceptionDetails(error)).not.toHaveProperty('detail');
    const emit = vi.fn();
    try {
      rethrowBuildSetupRecoveryUnavailable(error);
      throw new Error('setup unexpectedly continued');
    } catch (thrown) {
      expect(buildExceptionDetails(thrown).adminDetail).toBe('connect-unknown');
      expect(buildExceptionDetails(thrown)).not.toHaveProperty('detail');
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

const RECOVERY_REASONS = [
  'connect-unknown',
  'identity-lookup',
  'identity-unavailable',
  'allocation-unrecorded',
  'allocation-lost',
  'winner-reconnect',
] as const;

/** Same shape the crash path records for a setup recovery refusal. */
function recordedSetupRefusal(reason: (typeof RECOVERY_REASONS)[number]) {
  const error = new SandboxRecoveryUnavailableError(reason);
  try {
    rethrowBuildSetupRecoveryUnavailable(error);
    throw new Error('setup unexpectedly continued');
  } catch (thrown) {
    const crash = buildExceptionDetails(thrown);
    const diag = new BuildDiagnostics({ now: () => 1 });
    const recorded = crash as { adminDetail?: string; detail?: string };
    diag.record({
      phase: crash.phase,
      severity: 'error',
      code: crash.code,
      message: crash.message,
      autoResolved: false,
      ...(recorded.adminDetail ? { adminDetail: recorded.adminDetail } : {}),
      ...(recorded.detail ? { detail: recorded.detail } : {}),
    });
    diag.finish(false, crash.summary);
    return { thrown, crash, report: diag.report() };
  }
}

function assertNoReasonToken(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const reason of RECOVERY_REASONS) {
    expect(text, `leaked reason ${reason}`).not.toContain(reason);
  }
}

describe('BR1983: recovery reasons stay off the user-facing report and the crash diagnostics event', () => {
  it.each(RECOVERY_REASONS)('userFacingReport of a recorded %s setup refusal contains no reason token', (reason) => {
    const { report } = recordedSetupRefusal(reason);
    const user = userFacingReport(report);
    expect(user.issues.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    expect(user.problems.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    assertNoReasonToken(user);
  });

  it.each(RECOVERY_REASONS)('publishBuildException with that user-facing report as diagnostics contains no %s token', (reason) => {
    const { thrown, report } = recordedSetupRefusal(reason);
    const emit = vi.fn();
    publishBuildException(thrown, userFacingReport(report), emit);
    assertNoReasonToken(emit.mock.calls);
    const errorEvent = emit.mock.calls.map(([event]) => event).find((event) => event.type === 'error') as { diagnostics?: unknown };
    expect(errorEvent?.diagnostics).toBeDefined();
  });

  it('the admin report and admin text view still show the reason', () => {
    const { report } = recordedSetupRefusal('connect-unknown');
    const recorded = report.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE');
    expect(recorded?.adminDetail).toBe('connect-unknown');
    expect(recorded?.detail).toBeUndefined();
    const adminText = renderDiagnosticsText(report);
    expect(adminText).toContain('connect-unknown');
    expect(adminText).toContain('safely reconnected');
    assertNoReasonToken(userFacingReport(report));
    expect(renderDiagnosticsText(userFacingReport(report))).not.toContain('connect-unknown');
  });

  it("a different code's user-facing detail is still kept (t311u)", () => {
    const diag = new BuildDiagnostics({ now: () => 1 });
    diag.record({
      phase: 'sandbox',
      severity: 'error',
      code: 'SANDBOX_UNAVAILABLE',
      message: 'The build sandbox could not be set up — the build cannot create files.',
      autoResolved: false,
      detail: 'the compiler said TS2307',
    });
    const user = userFacingReport(diag.report());
    const issue = user.issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE') ?? user.problems.find((i) => i.code === 'SANDBOX_UNAVAILABLE');
    expect(issue?.detail).toBe('the compiler said TS2307');
  });

  it('the crash path records adminDetail, and userFacingReport does not copy that field', () => {
    expect(ROUTE).toContain('...(crash.adminDetail ? { adminDetail: crash.adminDetail } : {})');
    expect(ROUTE).not.toContain('...(crash.detail ? { detail: crash.detail } : {})');
    const facing = readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');
    const scrub = facing.slice(facing.indexOf('const scrubIssue'), facing.indexOf('const out: BuildDiagnosticsReport'));
    expect(scrub).toContain('adminDetail');
    expect(scrub).toContain('deliberately omitted');
    expect(scrub).not.toMatch(/adminDetail: /);
  });
});

/** Same shape persistSessionTimeline writes, and GET /conversations/:id returns unsanitized. */
function persistedConversationRecord(report: ReturnType<typeof recordedSetupRefusal>['report']) {
  return {
    id: 'agentv3-owner-br1983',
    status: 'error' as const,
    finalState: { ok: false, report: compactReportForRecord(report) },
  };
}

describe('BR1983: recovery reasons stay off the persisted conversation record and the GET response', () => {
  it.each(RECOVERY_REASONS)('the persisted conversation record of a %s setup refusal contains no reason token', (reason) => {
    const { report } = recordedSetupRefusal(reason);
    const rec = persistedConversationRecord(report);
    assertNoReasonToken(rec);
    const embedded = rec.finalState.report;
    expect(embedded.issues.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    expect(embedded.problems.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
  });

  it.each(RECOVERY_REASONS)('the GET conversation response of a %s setup refusal contains no reason token', (reason) => {
    const { report } = recordedSetupRefusal(reason);
    const rec = persistedConversationRecord(report);
    // GET /api/agentv3/conversations/:id returns the record unsanitized.
    const response = { conversation: rec, workspaceState: undefined };
    assertNoReasonToken(response);
    const events = conversationToEvents(rec);
    assertNoReasonToken(events);
    const result = events.find((e) => e.type === 'result') as { diagnostics?: unknown };
    expect(result?.diagnostics).toBeDefined();
  });

  it('the admin-gated stores and admin text view still show the reason', () => {
    const { report } = recordedSetupRefusal('connect-unknown');
    expect(report.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBe('connect-unknown');
    const stored = trimReportForStorage(report);
    expect(stored.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBe('connect-unknown');
    expect(renderDiagnosticsText(stored)).toContain('connect-unknown');
    expect(renderDiagnosticsText(report)).toContain('connect-unknown');
  });

  it("a different code's user-facing detail is still kept in the persisted record (t311u)", () => {
    const diag = new BuildDiagnostics({ now: () => 1 });
    diag.record({
      phase: 'sandbox',
      severity: 'error',
      code: 'SANDBOX_UNAVAILABLE',
      message: 'The build sandbox could not be set up — the build cannot create files.',
      autoResolved: false,
      detail: 'the compiler said TS2307',
    });
    const compact = compactReportForRecord(diag.report());
    const issue = compact.issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE')
      ?? compact.problems.find((i) => i.code === 'SANDBOX_UNAVAILABLE');
    expect(issue?.detail).toBe('the compiler said TS2307');
  });

  it('persist embeds the compact copy, and GET returns that record unsanitized', () => {
    expect(ROUTE).toContain('report: compactReportForRecord(settledReport)');
    expect(ROUTE).toContain('res.json({ conversation: rec, workspaceState })');
    const store = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    const compact = store.slice(store.indexOf('export function compactReportForRecord'), store.indexOf('export async function deleteDiagnostics'));
    expect(compact).toContain('adminDetail');
    expect(compact).toContain('adminDetail: _adminOnly');
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


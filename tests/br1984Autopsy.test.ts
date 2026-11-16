/** Synthetic reconnect-retry regression cases. No customer report payload.
 * A second reconnect refusal must not invite an immediate retry, must not
 * show a long estimate before setup fails again, and must keep admin-only
 * recovery reasons off every user-facing client path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RateLimitError, Sandbox, SandboxNotFoundError } from 'e2b';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import {
  SANDBOX_RECOVERY_FIRST_MESSAGE,
  SANDBOX_RECOVERY_REPEAT_MESSAGE,
  SandboxRecoveryUnavailableError,
  isSandboxRecoveryUnavailableRecord,
  latestSettledAttemptWasSandboxRecoveryUnavailable,
} from '../src/server/AgentV3/SandboxRecoveryError';
import { buildExceptionDetails, publishBuildException, rethrowBuildSetupRecoveryUnavailable } from '../src/server/AgentV3/BuildRequestCoordination';
import { BuildDiagnostics, renderDiagnosticsText, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import { compactReportForRecord, trimReportForStorage } from '../src/server/AgentV3/DiagnosticsStore';
import { conversationToEvents } from '../src/components/agentv3/agentV3History';
import { openingEtaShownNote, recordOrEmitOpeningEta, emitPendingOpeningEta, sandboxRecoveryRepeatOpts } from '../src/server/AgentV3/sandboxOpeningEta';
import { isE2BConcurrentCapacityError } from '../src/server/AgentV3/e2bConcurrentCapacity';

const CAP = 'Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes (20)';
const WS = 'agentv3-owner-br1984';
const OLD = 'existing-machine';
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const COORD = readFileSync('src/server/AgentV3/BuildRequestCoordination.ts', 'utf8');
const RECOVERY_REASONS = [
  'identity-lookup',
  'identity-unavailable',
  'connect-unknown',
  'allocation-unrecorded',
  'allocation-lost',
  'winner-reconnect',
] as const;

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
  vi.spyOn(sandboxStore, 'touch').mockResolvedValue(undefined);
  const act = new E2BActuator('unit-test-key');
  const internal = act as unknown as {
    _restoreFreshSandbox(workspaceId: string): Promise<void>;
    _kickoffPlaywright(): void;
    sandboxes: Map<string, Sandbox>;
  };
  const restore = vi.spyOn(internal, '_restoreFreshSandbox').mockResolvedValue(undefined);
  vi.spyOn(internal, '_kickoffPlaywright').mockImplementation(() => {});
  return { act, internal, lookup, connect, create, session, allocation, restore, old, fresh };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('AGENTV3_SANDBOX_RESUME', 'on'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('BR1984: detecting a prior reconnect refusal stays narrow', () => {
  const refusal = {
    ok: false,
    endedAt: 20,
    summary: SANDBOX_RECOVERY_FIRST_MESSAGE,
    issues: [{ code: 'SANDBOX_RECOVERY_UNAVAILABLE' }],
  };

  it('matches a settled failed attempt by issue code or the reconnect goodbye', () => {
    expect(isSandboxRecoveryUnavailableRecord(refusal)).toBe(true);
    expect(isSandboxRecoveryUnavailableRecord({
      ok: false, endedAt: 20, summary: SANDBOX_RECOVERY_FIRST_MESSAGE,
    })).toBe(true);
    expect(isSandboxRecoveryUnavailableRecord({
      ok: false, endedAt: 20, issues: [{ code: 'SANDBOX_RECOVERY_UNAVAILABLE' }],
    })).toBe(true);
    expect(isSandboxRecoveryUnavailableRecord({
      ok: false, endedAt: 20, summary: SANDBOX_RECOVERY_REPEAT_MESSAGE,
    })).toBe(true);
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([refusal])).toBe(true);
  });

  it('skips an in-progress row and still sees the settled refusal behind it', () => {
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([
      { ok: undefined, summary: 'in progress' },
      refusal,
    ])).toBe(true);
  });

  it('does not match neighbours (t311u)', () => {
    const neighbours = [
      undefined,
      null,
      [],
      [{ ok: true, endedAt: 20, summary: SANDBOX_RECOVERY_FIRST_MESSAGE }],
      [{ ok: false, endedAt: 20, userStopped: true, summary: SANDBOX_RECOVERY_FIRST_MESSAGE }],
      [{ ok: false, endedAt: 20, summary: "You don't need to start the build again. The workspace is busy." }],
      [{ ok: false, endedAt: 20, summary: 'Please retry shortly.' }],
      [{ ok: false, endedAt: 20, rootCause: 'Build outcome: SANDBOX_UNAVAILABLE', summary: 'The build sandbox could not be set up — the build cannot create files.' }],
      [{ ok: false, endedAt: 20, issues: [{ code: 'SANDBOX_UNAVAILABLE' }, { code: 'OUTCOME_SANDBOX_UNAVAILABLE' }] }],
      [{ ok: false, endedAt: 20, issues: [{ code: 'SANDBOX_RECOVERED' }] }],
      [{ ok: false, summary: SANDBOX_RECOVERY_FIRST_MESSAGE }], // no endedAt: still in flight
    ];
    for (const entries of neighbours) {
      expect(latestSettledAttemptWasSandboxRecoveryUnavailable(entries as never), JSON.stringify(entries)).toBe(false);
    }
    expect(isSandboxRecoveryUnavailableRecord(undefined)).toBe(false);
    expect(isSandboxRecoveryUnavailableRecord({ ok: false, endedAt: 20, summary: 'Please retry shortly.' })).toBe(false);
  });
});

describe('BR1984: the first refusal is unchanged; a repeat does not invite an immediate retry', () => {
  it('the first refusal keeps the existing goodbye and stays retryable', () => {
    const error = new SandboxRecoveryUnavailableError('connect-unknown');
    expect(error.message).toBe(SANDBOX_RECOVERY_FIRST_MESSAGE);
    expect(error.retryable).toBe(true);
    expect(error.repeated).toBe(false);
    expect(error.reason).toBe('connect-unknown');
  });

  it('a repeated refusal changes the goodbye and is not retryable', () => {
    const error = new SandboxRecoveryUnavailableError('connect-unknown', { repeated: true });
    expect(error.message).toBe(SANDBOX_RECOVERY_REPEAT_MESSAGE);
    expect(error.message.toLowerCase()).not.toMatch(/retry shortly/);
    expect(error.retryable).toBe(false);
    expect(error.repeated).toBe(true);
    expect(error.reason).toBe('connect-unknown');
  });

  it('setup wrapping forwards the repeated flag and keeps the admin reason', () => {
    try {
      rethrowBuildSetupRecoveryUnavailable(new SandboxRecoveryUnavailableError('connect-unknown'), { repeated: true });
      throw new Error('expected rethrow');
    } catch (caught) {
      expect(caught).toBeInstanceOf(SandboxRecoveryUnavailableError);
      expect((caught as SandboxRecoveryUnavailableError).message).toBe(SANDBOX_RECOVERY_REPEAT_MESSAGE);
      expect((caught as SandboxRecoveryUnavailableError).retryable).toBe(false);
      expect((caught as SandboxRecoveryUnavailableError).reason).toBe('connect-unknown');
      expect(buildExceptionDetails(caught).adminDetail).toBe('connect-unknown');
      expect(buildExceptionDetails(caught).summary).toBe(SANDBOX_RECOVERY_REPEAT_MESSAGE);
    }
  });

  it('publishBuildException uses the error retryable flag and still bills 0', () => {
    const wrap = (error: SandboxRecoveryUnavailableError, repeated = false) => {
      try { rethrowBuildSetupRecoveryUnavailable(error, { repeated }); } catch (caught) { return caught; }
    };
    const first = vi.fn();
    publishBuildException(wrap(new SandboxRecoveryUnavailableError('connect-unknown')), undefined, first);
    expect(first.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'SANDBOX_RECOVERY_UNAVAILABLE', retryable: true, message: SANDBOX_RECOVERY_FIRST_MESSAGE }),
      expect.objectContaining({ type: 'result', ok: false, billedUsd: 0, billedInr: 0, summary: SANDBOX_RECOVERY_FIRST_MESSAGE }),
    ]));

    const repeat = vi.fn();
    publishBuildException(wrap(new SandboxRecoveryUnavailableError('connect-unknown'), true), undefined, repeat);
    expect(repeat.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'SANDBOX_RECOVERY_UNAVAILABLE', retryable: false, message: SANDBOX_RECOVERY_REPEAT_MESSAGE }),
      expect.objectContaining({ type: 'result', ok: false, billedUsd: 0, billedInr: 0, summary: SANDBOX_RECOVERY_REPEAT_MESSAGE }),
    ]));
  });

  it('the F2 sandbox notice still does not invite a second Start', () => {
    const notice = sandboxUnavailableNotice();
    expect(notice).toContain("You don't need to start the build again");
    expect(notice.toLowerCase()).not.toMatch(/try (building )?again|retry shortly|please retry/);
  });
});

describe('BR1984: a later attempt still reconnects the same machine', () => {
  it('a non-404 reconnect refusal still does not replace the recorded identity', async () => {
    const f = fixture();
    f.connect.mockRejectedValue(new Error('fetch failed'));
    await expect(f.act.ensureWorkspace(WS, 'vite-react')).rejects.toBeInstanceOf(SandboxRecoveryUnavailableError);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.session).not.toHaveBeenCalled();
    f.connect.mockResolvedValue(f.old as unknown as Sandbox);
    await f.act.ensureWorkspace(WS, 'vite-react');
    expect(f.connect).toHaveBeenLastCalledWith(OLD, expect.anything());
    expect(f.create).not.toHaveBeenCalled();
    expect(f.internal.sandboxes.get(WS)).toBe(f.old);
  });

  it('a proven cap on reconnect is still not a recovery refusal or a replacement', async () => {
    const f = fixture();
    f.connect.mockRejectedValue(new RateLimitError(CAP));
    try {
      await f.act.ensureWorkspace(WS, 'vite-react');
      throw new Error('expected cap');
    } catch (caught) {
      expect(isE2BConcurrentCapacityError(caught)).toBe(true);
      expect(caught).not.toBeInstanceOf(SandboxRecoveryUnavailableError);
    }
    expect(f.create).not.toHaveBeenCalled();
    expect(f.restore).not.toHaveBeenCalled();
  });

  it('a typed 404 still restores into a replacement', async () => {
    const f = fixture();
    f.connect.mockRejectedValue(new SandboxNotFoundError('Paused sandbox not found'));
    await f.act.ensureWorkspace(WS, 'vite-react');
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.restore).toHaveBeenCalledTimes(1);
    expect(f.internal.sandboxes.get(WS)).toBe(f.fresh);
  });
});

function recordedSetupRefusal(reason: typeof RECOVERY_REASONS[number], repeated = false) {
  const thrown = new SandboxRecoveryUnavailableError(reason, repeated ? { repeated: true } : undefined);
  let wrapped: unknown;
  try {
    rethrowBuildSetupRecoveryUnavailable(thrown, { repeated });
  } catch (error) {
    wrapped = error;
  }
  const crash = buildExceptionDetails(wrapped);
  const diag = new BuildDiagnostics({ now: () => 1 });
  diag.record({
    phase: 'sandbox',
    severity: 'error',
    code: 'SANDBOX_RECOVERY_UNAVAILABLE',
    message: crash.message,
    autoResolved: false,
    ...(crash.adminDetail ? { adminDetail: crash.adminDetail } : {}),
  });
  diag.finish(false, crash.summary);
  return { thrown: wrapped, crash, report: diag.report() };
}

function assertNoReasonToken(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const reason of RECOVERY_REASONS) {
    expect(text, `leaked reason ${reason}`).not.toContain(reason);
  }
}

function persistedConversationRecord(report: ReturnType<typeof recordedSetupRefusal>['report']) {
  return {
    id: 'agentv3-owner-br1984',
    status: 'error' as const,
    finalState: { ok: false, report: compactReportForRecord(report) },
  };
}

describe('BR1984: recovery reasons stay off every user-facing client path, including a repeated refusal', () => {
  it.each(RECOVERY_REASONS)('userFacingReport and the SSE diagnostics event contain no %s token', (reason) => {
    const { thrown, report } = recordedSetupRefusal(reason, true);
    const user = userFacingReport(report);
    expect(user.issues.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    expect(user.problems.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    assertNoReasonToken(user);
    const emit = vi.fn();
    publishBuildException(thrown, userFacingReport(report), emit);
    assertNoReasonToken(emit.mock.calls);
    expect(JSON.stringify(emit.mock.calls)).toContain(SANDBOX_RECOVERY_REPEAT_MESSAGE);
    expect(JSON.stringify(emit.mock.calls)).not.toContain('retry shortly');
  });

  it.each(RECOVERY_REASONS)('compactReportForRecord and the GET conversation reopen contain no %s token', (reason) => {
    const { report } = recordedSetupRefusal(reason, true);
    const rec = persistedConversationRecord(report);
    assertNoReasonToken(rec);
    const embedded = rec.finalState.report;
    expect(embedded.issues.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    expect(embedded.problems.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    const response = { conversation: rec, workspaceState: undefined };
    assertNoReasonToken(response);
    assertNoReasonToken(conversationToEvents(rec));
  });

  it('the admin-gated stores and admin text view still show the reason after a repeated refusal', () => {
    const { report } = recordedSetupRefusal('connect-unknown', true);
    expect(report.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBe('connect-unknown');
    const stored = trimReportForStorage(report);
    expect(stored.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBe('connect-unknown');
    expect(renderDiagnosticsText(stored)).toContain('connect-unknown');
    expect(renderDiagnosticsText(userFacingReport(report))).not.toContain('connect-unknown');
  });

  it("a different code's user-facing detail is still kept on the live and persisted paths (t311u)", () => {
    const diag = new BuildDiagnostics({ now: () => 1 });
    diag.record({
      phase: 'sandbox',
      severity: 'error',
      code: 'SANDBOX_UNAVAILABLE',
      message: 'The build sandbox could not be set up — the build cannot create files.',
      autoResolved: false,
      detail: 'the compiler said TS2307',
    });
    const issue = userFacingReport(diag.report()).issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE');
    expect(issue?.detail).toBe('the compiler said TS2307');
    const compact = compactReportForRecord(diag.report());
    expect((compact.issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE') ?? compact.problems.find((i) => i.code === 'SANDBOX_UNAVAILABLE'))?.detail).toBe('the compiler said TS2307');
  });
});

describe('BR1984: a pre-timer Surplus scope call is not reported as a zero-second first call', () => {
  it('a 4774ms call recorded 4ms after the timer starts is a window mismatch, not 0s', () => {
    let t = 1000;
    const d = new BuildDiagnostics({ now: () => t });
    t += 4;
    d.recordLlmCall({
      model: 'qwen3-coder',
      provider: 'SURPLUS',
      promptPreview: 'Build scope admission classification',
      latencyMs: 4774,
      inputTokens: 386,
      outputTokens: 2,
      ok: true,
    });
    const note = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(note).toContain('4.8s latency');
    expect(note).toContain('cannot be separated');
    expect(note).not.toContain('first call itself then took 0s');
    expect(note).not.toContain('0s of preparation');
    expect(d.report().llmCalls?.[0].latencyMs).toBe(4774);
  });

  it('a compatible in-window call still reports preparation and model time normally', () => {
    let t = 1000;
    const d = new BuildDiagnostics({ now: () => t });
    t += 8000;
    d.recordLlmCall({ model: 'fixture', latencyMs: 2000, ok: true });
    const note = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(note).toContain('6s of preparation');
    expect(note).toContain('then took 2s');
  });
});

describe('BR1984: route census for the repeat goodbye and held estimate', () => {
  it('setup rethrows a recovery refusal with the repeated flag from settled history', () => {
    expect(ROUTE).toContain('rethrowBuildSetupRecoveryUnavailable(setupErr, sandboxRecoveryRepeatOpts(priorHistoryEntries))');
  });

  it('a previous reconnect refusal withholds the opening estimate until the workspace is up', () => {
    const helper = readFileSync('src/server/AgentV3/sandboxOpeningEta.ts', 'utf8');
    expect(helper).toContain('Not shown to the user before workspace setup (the previous attempt failed to reconnect).');
    expect(ROUTE).toContain('openingEtaShownNote(etaSkippedForModule, latestSettledAttemptWasSandboxRecoveryUnavailable(priorHistoryEntries), etaShown)');
    expect(ROUTE).toContain('pendingEtaShown = recordOrEmitOpeningEta(etaShown, priorHistoryEntries');
    const ensure = ROUTE.slice(ROUTE.indexOf('await actuator.ensureWorkspace(workspaceId, framework, resumeSandboxId'));
    expect(ensure.indexOf('pendingEtaShown = emitPendingOpeningEta(pendingEtaShown')).toBeGreaterThan(-1);
    expect(ensure.indexOf('pendingEtaShown = emitPendingOpeningEta(pendingEtaShown')).toBeLessThan(ensure.indexOf("} catch (setupErr) {"));
  });

  it('the crash event uses the error retryable flag rather than a hardcoded true', () => {
    expect(COORD).toContain('retryable: error.retryable');
    expect(COORD).not.toContain("isSandboxRecoveryUnavailable(error) ? { code: error.code, retryable: true }");
  });
});

describe('BR1984: opening-estimate helpers keep new branches out of the chat handler', () => {
  const refusal = [{ ok: false, endedAt: 20, summary: SANDBOX_RECOVERY_FIRST_MESSAGE }];

  it('holds the estimate only after a settled reconnect refusal, and emits otherwise', () => {
    const emitted: string[] = [];
    expect(recordOrEmitOpeningEta('⏱️ ~6–10 min', refusal, (text) => emitted.push(text))).toBe('⏱️ ~6–10 min');
    expect(emitted).toEqual([]);
    expect(recordOrEmitOpeningEta('⏱️ ~6–10 min', [{ ok: false, endedAt: 20, summary: 'Please retry shortly.' }], (text) => emitted.push(text))).toBeNull();
    expect(emitted).toEqual(['⏱️ ~6–10 min']);
    expect(recordOrEmitOpeningEta('⏱️ ~6–10 min', undefined, (text) => emitted.push(text))).toBeNull();
  });

  it('the basis line stays honest about whether the estimate was shown', () => {
    expect(openingEtaShownNote(true, false, '⏱️ ~6–10 min')).toContain('continue');
    expect(openingEtaShownNote(false, true, '⏱️ ~6–10 min')).toContain('Not shown to the user before workspace setup');
    expect(openingEtaShownNote(false, false, '⏱️ ~6–10 min')).toBe('Shown to the user: "~6–10 min"');
  });

  it('a held estimate is emitted only after the workspace is up', () => {
    const emitted: string[] = [];
    expect(emitPendingOpeningEta('⏱️ ~6–10 min', (text) => emitted.push(text))).toBeNull();
    expect(emitted).toEqual(['⏱️ ~6–10 min']);
    expect(emitPendingOpeningEta(null, (text) => emitted.push(text))).toBeNull();
    expect(emitted).toEqual(['⏱️ ~6–10 min']);
  });

  it('sandboxRecoveryRepeatOpts is true only for a settled reconnect refusal', () => {
    expect(sandboxRecoveryRepeatOpts(refusal)).toEqual({ repeated: true });
    expect(sandboxRecoveryRepeatOpts([])).toEqual({ repeated: false });
  });
});

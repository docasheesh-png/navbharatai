import { describe, expect, it, vi } from 'vitest';
import { buildExceptionDetails, createBuildRequestCoordination, publishBuildException, rethrowBuildSetupRecoveryUnavailable } from '../src/server/AgentV3/BuildRequestCoordination';
import { SandboxRecoveryUnavailableError } from '../src/server/AgentV3/SandboxRecoveryError';
import { type BuildRequestReceipt, type BuildRequestStore } from '../src/server/lib/buildRequestReceipt';

vi.mock('../src/server/AgentV3/BuildQueueStore', () => ({
  bindQueuedBuild: async () => ({ result: null }),
  loadQueue: async () => ({ items: [] }),
  settleQueuedBuild: vi.fn(),
  QueueClaimConflictError: class extends Error {},
}));

describe('uncertain sandbox recovery stops setup without inventing a later build outcome', () => {
  it('keeps ordinary build crashes and their diagnostic payload unchanged', () => {
    const error = new Error('ordinary application failure');
    const diagnostics = { workspaceId: 'workspace', findings: [] };
    const emit = vi.fn();
    expect(() => rethrowBuildSetupRecoveryUnavailable(error)).not.toThrow();
    expect(buildExceptionDetails(error)).toEqual({ message: error.message, phase: 'build', code: 'BUILD_EXCEPTION', summary: `Build stopped — an unexpected error occurred: ${error.message}` });
    publishBuildException(error, diagnostics, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ type: 'error', message: error.message, ts: expect.any(Number), diagnostics });
  });

  it('classifies a recovery refusal as infrastructure and leaves a later build outcome unknown', () => {
    const error = new SandboxRecoveryUnavailableError();
    const emit = vi.fn();
    expect(buildExceptionDetails(error)).toEqual({ message: error.message, phase: 'sandbox', code: error.code, summary: error.message });
    publishBuildException(error, null, emit);
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{ type: 'error', code: error.code, retryable: true, message: error.message, ts: expect.any(Number) }]);
  });

  it('terminates a known pre-builder setup refusal with a failed, unbilled result', () => {
    const emit = vi.fn();
    try {
      rethrowBuildSetupRecoveryUnavailable(new SandboxRecoveryUnavailableError());
      throw new Error('setup unexpectedly continued');
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxRecoveryUnavailableError);
      publishBuildException(error, null, emit);
    }
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: 'error', code: 'SANDBOX_RECOVERY_UNAVAILABLE', retryable: true, message: expect.stringContaining('safely reconnected'), ts: expect.any(Number) },
      { type: 'result', ok: false, summary: expect.stringContaining('safely reconnected'), steps: 0, billedUsd: 0, billedInr: 0 },
    ]);
  });

  it.each([false, true])('settles the actual accepted receipt as failed only for a definite setup exit (setup=%s)', async (setup) => {
    const rows = new Map<string, BuildRequestReceipt>();
    const store: BuildRequestStore = {
      collection: (name) => ({ doc: (id) => `${name}/${id}` }),
      runTransaction: async (body) => body({
        get: async (ref) => ({ exists: rows.has(String(ref)), data: () => rows.get(String(ref)) }),
        set: (ref, row) => { rows.set(String(ref), structuredClone(row)); },
      }),
    };
    const input = { requestId: '12345678-1234-4123-8123-123456789abc', prompt: 'Edit the app' };
    const options = { workspaceId: 'agentv3-owner-session123', ownerId: 'owner', attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input, prompt: () => input.prompt, store: () => store };
    const request = createBuildRequestCoordination(options);
    expect(await request.admit()).toBeNull();
    let error: unknown = new SandboxRecoveryUnavailableError();
    if (setup) {
      try { rethrowBuildSetupRecoveryUnavailable(error); } catch (wrapped) { error = wrapped; }
    }
    const client = vi.fn();
    publishBuildException(error, null, (event) => request.publish(event, client));
    await request.release();
    expect([...rows.values()]).toMatchObject([{ state: 'terminal', outcome: setup ? 'failed' : 'unknown' }]);
    const replay = createBuildRequestCoordination({ ...options, attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(await replay.admit()).toMatchObject({ status: 409, payload: { code: 'BUILD_REQUEST_TERMINAL' } });
    expect(client.mock.calls.filter(([event]) => event.type === 'result')).toHaveLength(setup ? 1 : 0);
  });
});

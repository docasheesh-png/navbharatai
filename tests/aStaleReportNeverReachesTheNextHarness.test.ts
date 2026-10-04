import { describe, it, expect } from 'vitest';
import { initializeObservability, setUserContext, __resetObservability, type ObservabilityDeps, type CrashlyticsSink } from '../src/lib/observability';

/**
 * Found as an order-dependent CI failure on 2026-10-04 (#3531, #3532): `setUserContext` hashes the uid
 * (async) and then loads the Crashlytics sink (async). A reset between those steps installed a NEW harness,
 * and the stale continuation delivered `setUserId` into it — so "sends nothing at all from a non-production
 * build" saw a `{ kind: 'user' }` call it never made. The reporter now carries a generation token: work
 * begun before a reset does nothing after it. Reversion: drop the `state.generation !== gen` check in
 * `setUserContext` and this test fails.
 */
function sink(calls: string[]): CrashlyticsSink {
  return {
    recordException: async () => { calls.push('record'); },
    setUserId: async () => { calls.push('user'); },
    setCustomKey: async () => { calls.push('key'); },
    log: async () => { calls.push('log'); },
    crash: async () => { calls.push('crash'); },
  };
}
const deps = (over: Partial<ObservabilityDeps>): ObservabilityDeps => ({ enabled: true, postLog: () => {}, now: () => 1, loadCrashlytics: async () => null, ...over });

describe('a report begun before a reset never reaches the sink installed after it', () => {
  it('a user-context chain in flight across a reset is dropped, not delivered to the next harness', async () => {
    const callsA: string[] = []; const callsB: string[] = [];
    __resetObservability();
    initializeObservability(deps({ loadCrashlytics: () => new Promise((r) => setTimeout(() => r(sink(callsA)), 30)) }));
    setUserContext('uid-1'); // the uid hash and the SDK load are now in flight
    __resetObservability();
    initializeObservability(deps({ enabled: false, loadCrashlytics: async () => sink(callsB) }));
    await new Promise((r) => setTimeout(r, 120));
    expect(callsB).toEqual([]);
    expect(callsA).toEqual([]);
    __resetObservability();
  });

  it('without a reset the same chain still reaches its own sink', async () => {
    const calls: string[] = [];
    __resetObservability();
    initializeObservability(deps({ loadCrashlytics: () => new Promise((r) => setTimeout(() => r(sink(calls)), 10)) }));
    setUserContext('uid-2');
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toContain('user');
    __resetObservability();
  });
});

/**
 * 🔒 THE ORPHAN WINDOW ENDS AT THE PROVIDER, NOT IN OUR SWEEP (admin's E2B dashboards, 2026-09-11).
 *
 * A sandbox averaged 28.8 minutes of wall-clock per start with ~5 of real build. The rest was a
 * machine nobody used, mostly waiting out the 20-minute durable orphan window — a window that had to
 * be twenty because the signal it trusted (a timestamp refreshed only by SANDBOX OPERATIONS) cannot
 * tell a build inside a long model call from an abandoned VM.
 *
 * The fix makes E2B's own per-sandbox timer the dead-man switch: six minutes, extended by every
 * operation and viewer ping (throttled) and by a TIMER-driven heartbeat while a build or operation is
 * in flight. When nothing extends it, the provider pauses the machine — whichever instance made it,
 * and even if our whole service is down. These are the rules that keep that safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  sandboxLifetimeMs,
  heartbeatIntervalMs,
  extendThrottleMs,
  shouldExtendLifetime,
  heartbeatTargets,
  tallyPauseCauses,
  snapshotIdleLimitMs,
  idleLimitFor,
  SNAPSHOT_IDLE_MIN_MINUTES,
  DEFAULT_SNAPSHOT_IDLE_MINUTES,
  LIFETIME_MIN_MINUTES,
  LIFETIME_MAX_MINUTES,
  DEFAULT_LIFETIME_MINUTES,
} from '../src/server/AgentV3/sandboxLifetime';
import { idleLimitMs, buildFlagExpiryMs } from '../src/server/AgentV3/sandboxReaper';
import { KEEPALIVE_INTERVAL_MS } from '../src/server/AgentV3/previewKeepAlive';

const env = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv;
const MIN = 60_000;

describe('the lifetime', () => {
  it('defaults to six minutes — just above the idle limit, so a healthy instance still pauses first', () => {
    expect(sandboxLifetimeMs(env())).toBe(DEFAULT_LIFETIME_MINUTES * MIN);
    expect(sandboxLifetimeMs(env())).toBeGreaterThan(idleLimitMs(env()));
  });

  it('is env-tunable, and junk falls back to the default rather than to zero', () => {
    expect(sandboxLifetimeMs(env({ AGENTV3_SANDBOX_LIFETIME_MINUTES: '10' }))).toBe(10 * MIN);
    for (const junk of ['', 'six', '0', '-4', 'NaN']) {
      expect(sandboxLifetimeMs(env({ AGENTV3_SANDBOX_LIFETIME_MINUTES: junk })), junk).toBe(DEFAULT_LIFETIME_MINUTES * MIN);
    }
  });

  it('🔒 clamps: a typo cannot make a machine un-pausable for a day, or pause it under a viewer', () => {
    expect(sandboxLifetimeMs(env({ AGENTV3_SANDBOX_LIFETIME_MINUTES: '9999' }))).toBe(LIFETIME_MAX_MINUTES * MIN);
    expect(sandboxLifetimeMs(env({ AGENTV3_SANDBOX_LIFETIME_MINUTES: '0.1' }))).toBe(LIFETIME_MIN_MINUTES * MIN);
  });

  it('🔒 even at its floor, two viewer keep-alive pings fit inside one lifetime', () => {
    // The shell pings once a minute; a lifetime shorter than two pings would pause a watched app on a
    // single dropped request.
    expect(LIFETIME_MIN_MINUTES * MIN).toBeGreaterThanOrEqual(2 * KEEPALIVE_INTERVAL_MS);
  });
});

describe('the heartbeat cadence', () => {
  it('ticks at a third of the lifetime, so two missed ticks still leave slack', () => {
    const life = sandboxLifetimeMs(env());
    expect(heartbeatIntervalMs(env())).toBe(Math.floor(life / 3));
    expect(heartbeatIntervalMs(env()) * 2).toBeLessThan(life);
  });

  it('the hot-path throttle is looser than the heartbeat and never below ten seconds', () => {
    expect(extendThrottleMs(env())).toBeLessThan(heartbeatIntervalMs(env()));
    expect(extendThrottleMs(env({ AGENTV3_SANDBOX_LIFETIME_MINUTES: '2' }))).toBeGreaterThanOrEqual(10_000);
  });

  it('shouldExtendLifetime: unknown ⇒ yes, recent ⇒ no, backwards clock ⇒ yes', () => {
    const now = 1_000_000;
    expect(shouldExtendLifetime(undefined, now)).toBe(true);
    expect(shouldExtendLifetime(0, now)).toBe(true);
    expect(shouldExtendLifetime(now - 1_000, now)).toBe(false);
    expect(shouldExtendLifetime(now - extendThrottleMs(env()), now)).toBe(true);
    expect(shouldExtendLifetime(now + 5_000, now)).toBe(true);
  });
});

describe('🔒 which sandboxes the heartbeat keeps alive', () => {
  const now = 10 * 60 * MIN;

  it('a build in flight is extended — a model call is silence, not abandonment', () => {
    expect(heartbeatTargets([{ workspaceId: 'a', buildStartedAt: now - 3 * MIN }], now)).toEqual(['a']);
  });

  it('an operation in flight is extended even with no build flag (a wake-path npm install)', () => {
    expect(heartbeatTargets([{ workspaceId: 'w', opsInFlight: 1 }], now)).toEqual(['w']);
  });

  it('🔒 an IDLE sandbox is NOT extended — its timer is meant to run out', () => {
    expect(heartbeatTargets([{ workspaceId: 'idle', opsInFlight: 0, buildStartedAt: null }], now)).toEqual([]);
  });

  it('🔒 a build flag past its expiry no longer keeps the machine alive (a crashed build cannot pin a VM)', () => {
    const stale = now - buildFlagExpiryMs(env()) - 1;
    expect(heartbeatTargets([{ workspaceId: 'crashed', buildStartedAt: stale }], now)).toEqual([]);
    const fresh = now - buildFlagExpiryMs(env()) + 1_000;
    expect(heartbeatTargets([{ workspaceId: 'ok', buildStartedAt: fresh }], now)).toEqual(['ok']);
  });

  it('a machine extended within the last tick by another path is skipped — no redundant call', () => {
    const justNow = now - 5_000;
    expect(heartbeatTargets([{ workspaceId: 'b', buildStartedAt: now - MIN, lastExtendAt: justNow }], now)).toEqual([]);
    const aWhileAgo = now - heartbeatIntervalMs(env());
    expect(heartbeatTargets([{ workspaceId: 'b', buildStartedAt: now - MIN, lastExtendAt: aWhileAgo }], now)).toEqual(['b']);
  });

  it('survives garbage candidates', () => {
    expect(heartbeatTargets([null as never, { workspaceId: '' }, { workspaceId: 'x', buildStartedAt: NaN, opsInFlight: NaN }], now)).toEqual([]);
  });
});

describe('the measurement — which mechanism ends machines', () => {
  it('buckets each record honestly, with no cause invented for a provider-side pause', () => {
    const t = tallyPauseCauses([
      { pausedAt: 1, pausedBy: 'idle-sweep' },
      { pausedAt: 1, pausedBy: 'orphan-sweep' },
      { pausedAt: 1, pausedBy: 'orphan-sweep' },
      { pausedAt: 1 },                 // paused before the cause existed
      { pausedAt: 0 },                 // never stamped by us
      {},                              // never stamped by us
      null as never,
    ]);
    expect(t).toEqual({ idleSweep: 1, orphanSweep: 2, sweepUnattributed: 1, providerOrUnknown: 2, total: 6 });
  });
});

describe('the snapshot idle window — a machine whose app lives on a CURRENT saved copy may sleep sooner', () => {
  it('defaults to three minutes, shorter than the ordinary idle limit', () => {
    expect(snapshotIdleLimitMs(env())).toBe(DEFAULT_SNAPSHOT_IDLE_MINUTES * MIN);
    expect(snapshotIdleLimitMs(env())).toBeLessThan(idleLimitMs(env()));
  });

  it('🔒 the floor outlasts one health poll (150 s) plus margin — the frame must have left the machine first', () => {
    expect(SNAPSHOT_IDLE_MIN_MINUTES * MIN).toBeGreaterThan(150_000);
    expect(snapshotIdleLimitMs(env({ AGENTV3_SNAPSHOT_IDLE_MINUTES: '0.5' }))).toBe(SNAPSHOT_IDLE_MIN_MINUTES * MIN);
  });

  it('🔒 can never be LONGER than the ordinary idle limit — a current copy is a reason to sleep sooner, never later', () => {
    expect(snapshotIdleLimitMs(env({ AGENTV3_SNAPSHOT_IDLE_MINUTES: '45' }))).toBe(idleLimitMs(env()));
    const tight = env({ AGENTV3_SANDBOX_IDLE_MINUTES: '2' });
    expect(snapshotIdleLimitMs(tight)).toBeLessThanOrEqual(idleLimitMs(tight));
  });

  it('junk falls back to the default', () => {
    for (const junk of ['', 'three', '-1', 'NaN']) {
      expect(snapshotIdleLimitMs(env({ AGENTV3_SNAPSHOT_IDLE_MINUTES: junk })), junk).toBe(DEFAULT_SNAPSHOT_IDLE_MINUTES * MIN);
    }
  });

  it('idleLimitFor picks the window per workspace', () => {
    expect(idleLimitFor(true, env())).toBe(snapshotIdleLimitMs(env()));
    expect(idleLimitFor(false, env())).toBe(idleLimitMs(env()));
  });
});

describe('wiring — the saved copy is raised by the route, cleared by every write, framed by the surface', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const actuator = codeOnly(read('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'));
  const routes = codeOnly(read('../src/server/routes/agentv3.ts'));
  const surface = codeOnly(read('../src/components/agentv3/PreviewSurface.tsx'));
  const panel = codeOnly(read('../src/components/agentv3/AgentV3Panel.tsx'));
  const reducer = codeOnly(read('../src/components/agentv3/agentV3Reducer.ts'));

  it('the idle sweep uses the per-workspace window, and no longer a single limit for all', () => {
    const at = actuator.indexOf('private async _sweepIdleSandboxes(');
    const sweep = actuator.slice(at, at + 1200);
    expect(sweep).toContain('idleLimitFor(this._snapshotCurrent.has(workspaceId))');
    expect(sweep).not.toContain('const limit = idleLimitMs();');
    // Still AFTER the build/op guard — a current copy never lets a busy machine be paused.
    expect(sweep.indexOf('this._opInFlight(workspaceId)')).toBeLessThan(sweep.indexOf('idleLimitFor('));
  });

  it('🔒 every path that changes the tree clears the flag: text write, binary write, restore, and a starting build', () => {
    const writeAt = actuator.indexOf('async writeFile(');
    expect(actuator.slice(writeAt, writeAt + 700)).toContain('this._snapshotCurrent.delete(workspaceId)');
    const binAt = actuator.indexOf('async writeBinaryFile(');
    expect(actuator.slice(binAt, binAt + 900)).toContain('this._snapshotCurrent.delete(workspaceId)');
    const restoreAt = actuator.indexOf('async restore(workspaceId: string, checkpointId: string)');
    expect(actuator.slice(restoreAt, restoreAt + 600)).toContain('this._snapshotCurrent.delete(workspaceId)');
    const flagAt = actuator.indexOf('setBuildActive(workspaceId: string, active: boolean): void {');
    const flag = actuator.slice(flagAt, actuator.indexOf('noteSnapshotCurrent(', flagAt));
    expect(flag).toContain('this._snapshotCurrent.delete(workspaceId)');
    // And dropping the sandbox forgets it, like every other per-sandbox stamp.
    const drop = actuator.slice(actuator.indexOf('private _dropSandbox('), actuator.indexOf('private _notePauseFailure('));
    expect(drop).toContain('this._snapshotCurrent.delete(workspaceId)');
  });

  it('the route raises the flag right where the copy is saved, and records what the copy was built from', () => {
    const at = routes.indexOf("code: 'PREVIEW_SNAPSHOT_SAVED'");
    const block = routes.slice(at - 1500, at);
    expect(block).toContain('actuator.noteSnapshotCurrent?.(workspaceId, true)');
    expect(block).toContain('sandboxStore.saveSnapshot(workspaceId, url, at, filesHash)');
    expect(block).toContain('snapshotTaken = { url, filesHash }');
  });

  it('🔒 the snapshot event is emitted at the FINAL durable save, only once the copy is proven current (snapshotIdentity.ts)', () => {
    // MOVED (2026-09-11), not dropped. The build's final save runs AFTER the copy is taken and
    // rewrites the workspace's durable stamp, so announcing the copy at save time — before knowing
    // whether a later pass changed a file — could frame a stale copy as the app. The surface only
    // applies the event after the build ends anyway, so emitting it here costs nothing.
    const at = routes.indexOf("code: verdict.action === 'restamp' ? 'PREVIEW_SNAPSHOT_CURRENT' : 'PREVIEW_SNAPSHOT_STALE'");
    expect(at).toBeGreaterThan(-1);
    const block = routes.slice(at - 1400, at);
    expect(block).toContain('await finalSave;');
    expect(block).toContain('snapshotConfirmation({ taken: snapshotTaken, persistedHash: workspaceContentHash(persisted) })');
    // The durable stamp and the event carry the SAME instant, so the door and the frame agree.
    expect(block).toContain('sandboxStore.saveSnapshot(workspaceId, snapshotTaken.url, at, snapshotTaken.filesHash)');
    expect(block).toContain("events.emit({ type: 'snapshot', url: snapshotTaken.url, at, note: SNAPSHOT_IDLE_NOTE, ts: at })");
    // The event is inside the restamp branch — never announced on a stale verdict.
    expect(block.indexOf("if (verdict.action === 'restamp') {")).toBeLessThan(block.indexOf("events.emit({ type: 'snapshot'"));
  });

  it('the panel hands the copy to the surface, which mirrors it into the SAME state the health poll writes', () => {
    expect(panel).toContain('snapshotUrl={state.snapshotUrl}');
    expect(panel).toContain('snapshotIdleNote={state.snapshotNote}');
    const at = surface.indexOf('[snapshotUrl, snapshotIdleNote, autoResume]');
    const effect = surface.slice(at - 700, at);
    expect(effect).toContain('if (!autoResume) return;');          // never during a build
    expect(effect).toContain('setIdleSnapshotUrl(snapshotUrl)');     // same state as the poll
    expect(effect).toContain("setIdleSnapshotUrl((prev) => (prev ? '' : prev))"); // and un-frames on clear
  });

  it('the reducer clears the copy when a NEW build starts, and only then', () => {
    expect(reducer).toContain("case 'snapshot':");
    expect(reducer).toMatch(/isNewBuild \? \{ todos: \[\], agents: \{\}, snapshotUrl: undefined, snapshotNote: undefined \}/);
  });
});

describe('wiring — the actuator applies the decisions and nothing else decides', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const actuator = codeOnly(read('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'));
  const store = codeOnly(read('../src/server/AgentV3/SandboxStore.ts'));
  const admin = codeOnly(read('../src/server/routes/admin.ts'));

  it('🔒 the hour-long constant is gone; every lifetime comes from the module', () => {
    expect(actuator).not.toMatch(/const SANDBOX_TIMEOUT_MS/);
    expect(actuator).not.toMatch(/SANDBOX_TIMEOUT_MS/);
    expect(actuator).toContain('timeoutMs: sandboxLifetimeMs()');
    // No raw setTimeout with a literal — every extension carries the module's number.
    expect(actuator).not.toMatch(/\.setTimeout\(\s*\d/);
  });

  it('🔒 the heartbeat is a TIMER, unref’d, driven by the pure decision', () => {
    const ctor = actuator.slice(actuator.indexOf('constructor(private apiKey?: string)'), actuator.indexOf('private _opts('));
    expect(ctor).toContain('this._heartbeatLifetimes()');
    expect(ctor).toContain('heartbeatIntervalMs()');
    expect(ctor).toMatch(/heartbeat\.unref/);
    const hb = actuator.slice(actuator.indexOf('private async _heartbeatLifetimes('), actuator.indexOf('private async getSandbox('));
    expect(hb).toContain('heartbeatTargets(candidates, now)');
    expect(hb).toContain('this._activeBuilds.get(workspaceId)');
    expect(hb).toContain('this._opsInFlight.get(workspaceId)');
    expect(hb).toContain('this._extendLifetime(workspaceId, sandbox, true)');
  });

  it('every activity path extends through ONE throttled helper', () => {
    const calls = actuator.match(/this\._extendLifetime\(/g) ?? [];
    // getSandbox (warm), noteActivity, noteUserActivity (held), heartbeat (forced).
    expect(calls.length).toBeGreaterThanOrEqual(4);
    const helper = actuator.slice(actuator.indexOf('private _extendLifetime('), actuator.indexOf('private async _heartbeatLifetimes('));
    expect(helper).toContain('shouldExtendLifetime(this._lastLifetimeExtend.get(workspaceId), now)');
    expect(helper).toContain('sandbox.setTimeout(sandboxLifetimeMs())');
  });

  it('🔒 a viewer on an instance that does NOT hold the machine still extends it — by id, never a paused one', () => {
    const at = actuator.indexOf('noteUserActivity(workspaceId: string): boolean');
    const body = actuator.slice(at, actuator.indexOf('private _lastUserActivityWrite', at));
    expect(body).toContain('Sandbox.setTimeout(rec.sandboxId, sandboxLifetimeMs())');
    // The guard: a record we believe paused is left alone.
    expect(body).toMatch(/pausedAt >= Number\(rec\.updatedAt\)\) return;/);
    // And it is bounded like every other cloud call.
    expect(body).toContain('withTimeout(Sandbox.setTimeout(rec.sandboxId, sandboxLifetimeMs()), 5_000');
  });

  it('a resumed machine starts a fresh clock, and dropping a sandbox forgets its stamp', () => {
    const connect = actuator.slice(actuator.indexOf('Sandbox.connect(resumeId'), actuator.indexOf('Sandbox.connect(resumeId') + 600);
    expect(connect).toContain('sandbox.setTimeout(sandboxLifetimeMs())');
    expect(connect).toContain('this._lastLifetimeExtend.set(workspaceId, Date.now())');
    const drop = actuator.slice(actuator.indexOf('private _dropSandbox('), actuator.indexOf('private _notePauseFailure('));
    expect(drop).toContain('this._lastLifetimeExtend.delete(workspaceId)');
  });

  it('🔒 the two sweeps still exist and now say WHICH one paused a machine', () => {
    expect(actuator).toContain("markPaused(workspaceId, 'idle-sweep')");
    expect((actuator.match(/markPaused\(rec\.workspaceId, 'orphan-sweep'\)/g) ?? []).length).toBe(2);
    expect(store).toContain('pausedBy?: PauseCause');
    expect(store).toMatch(/pausedAt: Date\.now\(\), \.\.\.\(by \? \{ pausedBy: by \} : \{\}\)/);
    expect(admin).toContain('tallyPauseCauses(sandboxes)');
  });
});

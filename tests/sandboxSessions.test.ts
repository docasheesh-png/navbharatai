/**
 * 🔒 MEASURE FIRST — the two numbers the E2B bill implied for a month and nothing recorded.
 *
 * (1) ~29 min of billed wall-clock per session against ~5-7 min of work: is the rest IDLE (a sweep /
 *     window problem) or SLOW COMMANDS (a machine / workload problem)? Different fixes.
 * (2) 1,110 starts a month for one tester (~37/day): WHO starts machines — a build, the preview door's
 *     port sweep, a wake, a publish, a file read?
 * (3) Peak memory of a real build with the browser gates running — the only thing that makes a RAM
 *     change safe, because RAM is billed per wall-clock hour and a slower build is a dearer one.
 *
 * These rules keep each measurement honest. None of them changes behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  summarizeSession, describeSession, tallyMinutes, tallyStarts, dayKey,
  PEAK_MEMORY_PROBE, parsePeakMemory, describePeakMemory, type SandboxSession,
} from '../src/server/AgentV3/sandboxSessions';
import { reasonForPath, currentSandboxReason, inSandboxReasonZone } from '../src/server/AgentV3/sandboxSessionZone';

const MIN = 60_000;
const base: SandboxSession = { sandboxId: 'sb', origin: 'created-fresh', reason: 'build', startedAt: 1_000_000, busyMs: 0, ops: 0 };

describe('where the minutes go', () => {
  it('splits a session into wall, busy and idle', () => {
    const s = { ...base, busyMs: 5 * MIN, ops: 40, endedAt: base.startedAt + 29 * MIN };
    const sum = summarizeSession(s, 0)!;
    expect(sum.wallMs).toBe(29 * MIN);
    expect(sum.busyMs).toBe(5 * MIN);
    expect(sum.idleMs).toBe(24 * MIN);
    expect(sum.idleShare).toBeCloseTo(24 / 29, 3);
    expect(sum.ops).toBe(40);
  });

  it('a LIVE session uses `now` for its end; busy can never exceed wall', () => {
    const sum = summarizeSession({ ...base, busyMs: 99 * MIN }, base.startedAt + 3 * MIN)!;
    expect(sum.wallMs).toBe(3 * MIN);
    expect(sum.busyMs).toBe(3 * MIN);
    expect(sum.idleMs).toBe(0);
  });

  it('garbage is null, not a number', () => {
    expect(summarizeSession(null, 0)).toBeNull();
    expect(summarizeSession({ ...base, startedAt: NaN }, 0)).toBeNull();
    expect(summarizeSession({ ...base, endedAt: base.startedAt - 1 }, 0)).toBeNull();
  });

  it('the report line names the cause and the origin and no vendor', () => {
    const line = describeSession({ ...base, reason: 'preview-door', origin: 'resumed', busyMs: 2 * MIN, ops: 3, endedAt: base.startedAt + 10 * MIN }, 0);
    expect(line).toMatch(/10\.0 min up/);
    expect(line).toMatch(/2\.0 min running our operations \(3\)/);
    expect(line).toMatch(/8\.0 min idle \(80%\)/);
    expect(line).toContain('started by preview-door');
    expect(line).toContain('came up resumed');
    expect(line).not.toMatch(/e2b|firecracker/i);
    expect(describeSession(null, 0)).toMatch(/not measured/);
  });

  it('tallyMinutes averages ENDED sessions only — a live one has no final wall', () => {
    const t = tallyMinutes([
      { ...base, busyMs: 5 * MIN, endedAt: base.startedAt + 25 * MIN },
      { ...base, busyMs: 3 * MIN, endedAt: base.startedAt + 15 * MIN },
      { ...base, busyMs: 1 * MIN },           // live
      null,
    ]);
    expect(t.sessions).toBe(2);
    expect(t.avgWallMin).toBe(20);
    expect(t.avgBusyMin).toBe(4);
    expect(t.avgIdleMin).toBe(16);
    expect(t.idleShare).toBeCloseTo(32 / 40, 3);
  });
});

describe('why machines start', () => {
  it('maps every route that can reach a machine to its cause; the first, most specific match wins', () => {
    expect(reasonForPath('/preview-door')).toBe('preview-door');
    expect(reasonForPath('/preview-door?ws=x')).toBe('preview-door');
    expect(reasonForPath('/preview-diagnose')).toBe('preview-diagnose');
    expect(reasonForPath('/preview-health')).toBe('preview-health');
    expect(reasonForPath('/publish')).toBe('publish');
    expect(reasonForPath('/ship')).toBe('publish');
    expect(reasonForPath('/workspace-files')).toBe('files');
    expect(reasonForPath('/import-files')).toBe('files');
    expect(reasonForPath('/restore')).toBe('files');
    expect(reasonForPath('/exec')).toBe('exec');
    expect(reasonForPath('/version-preview')).toBe('version-preview');
    expect(reasonForPath('/visual-edit')).toBe('visual-edit');
    expect(reasonForPath('/chat')).toBe('build');
    expect(reasonForPath('/respond')).toBe('build');
  });

  it('🔒 an unclassified request is `other`, and NO request at all is `unattributed` — different facts', () => {
    expect(reasonForPath('/something-new')).toBe('other');
    expect(reasonForPath('')).toBe('other');
    expect(currentSandboxReason()).toBe('unattributed');
  });

  it('the zone carries the reason through awaits', async () => {
    const seen = await inSandboxReasonZone('publish', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentSandboxReason();
    });
    expect(seen).toBe('publish');
    expect(currentSandboxReason()).toBe('unattributed');
  });

  it('tallyStarts sums per-day counters into a per-reason table', () => {
    const t = tallyStarts([
      { day: '2026-09-11', counts: { 'preview-door': 20, build: 4 } },
      { day: '2026-09-10', counts: { 'preview-door': 15, files: 2, junk: -3 } },
      null,
    ]);
    expect(t).toEqual({ total: 41, byReason: { 'preview-door': 35, build: 4, files: 2 }, days: 2 });
  });

  it('dayKey files a start under its UTC day', () => {
    expect(dayKey(Date.UTC(2026, 8, 11, 23, 59))).toBe('2026-09-11');
    expect(dayKey(Date.UTC(2026, 8, 12, 0, 1))).toBe('2026-09-12');
  });
});

describe('peak memory — asked of the machine, never invented', () => {
  it('the probe is read-only and tries v2 then v1 then says so', () => {
    expect(PEAK_MEMORY_PROBE).toContain('/sys/fs/cgroup/memory.peak');
    expect(PEAK_MEMORY_PROBE).toContain('/sys/fs/cgroup/memory/memory.max_usage_in_bytes');
    expect(PEAK_MEMORY_PROBE).toContain('echo unavailable');
    expect(PEAK_MEMORY_PROBE).not.toMatch(/\brm\b|>\s*\//);
  });

  it('parses both accountings and rejects everything else', () => {
    expect(parsePeakMemory('v2 1610612736\n')).toEqual({ bytes: 1_610_612_736, source: 'cgroup-v2' });
    expect(parsePeakMemory('v1 734003200')).toEqual({ bytes: 734_003_200, source: 'cgroup-v1' });
    for (const bad of ['unavailable', '', null, 'v2 0', 'v3 12', 'v2 abc']) {
      expect(parsePeakMemory(bad as never), String(bad)).toBeNull();
    }
  });

  it('the report line shows headroom against the template, and admits when it cannot', () => {
    expect(describePeakMemory({ bytes: 1.5 * 1024 ** 3, source: 'cgroup-v2' }, 4)).toBe('Peak memory: 1.50 GB of 4 GB (38%, cgroup-v2)');
    expect(describePeakMemory(null, 4)).toMatch(/not available/);
  });
});

describe('wiring — measurement is recorded where the facts are, and changes nothing', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const actuator = codeOnly(read('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'));
  const routes = codeOnly(read('../src/server/routes/agentv3.ts'));
  const admin = codeOnly(read('../src/server/routes/admin.ts'));
  const toml = read('../infra/e2b/e2b.toml');

  it('🔒 the zone middleware is registered BEFORE the first route', () => {
    const reg = routes.indexOf('export function registerAgentV3Routes(');
    const mw = routes.indexOf("app.use('/api/agentv3', sandboxReasonMiddleware)", reg);
    const firstRoute = routes.indexOf("app.get('/api/agentv3/status'", reg);
    expect(mw).toBeGreaterThan(reg);
    expect(mw).toBeLessThan(firstRoute);
  });

  it('a create or resume opens a session that names its cause from the zone', () => {
    const at = actuator.indexOf("usageTracker.record(workspaceId, 'sandbox')");
    const after = actuator.slice(at, at + 900);
    expect(after).toContain('reason: currentSandboxReason()');
    expect(after).toContain('sandboxStore.recordSessionStart(workspaceId, session)');
  });

  it('busy time is the UNION of overlapping operations — clocked on the 0→1 and 1→0 edges only', () => {
    const at = actuator.indexOf('private _holdSandboxOp(');
    const body = actuator.slice(at, actuator.indexOf('sandboxSession(workspaceId: string)', at));
    expect(body).toContain('if (before === 0) this._busySince.set(workspaceId, now)');
    expect(body).toContain('if (n <= 0 && since !== undefined)');
  });

  it('🔒 the idle sweep closes the session BEFORE the pause, so the cause is not overwritten by the drop', () => {
    const at = actuator.indexOf('private async _sweepIdleSandboxes(');
    const end = actuator.indexOf('private async _sweepOrphanSandboxes(', at);
    const sweep = actuator.slice(at, end);
    const endAt = sweep.indexOf("this._endSession(workspaceId, 'idle-sweep')");
    const pauseAt = sweep.indexOf('await this.pauseSandbox(sandbox.sandboxId)');
    expect(endAt).toBeGreaterThan(-1);
    expect(endAt).toBeLessThan(pauseAt);
    const drop = actuator.slice(actuator.indexOf('private _dropSandbox('), actuator.indexOf('private _notePauseFailure('));
    expect(drop).toContain("this._endSession(workspaceId, 'dropped')");
  });

  it('the build report records the session and the peak memory LAST, just before the release gate', () => {
    const sess = routes.indexOf("code: 'SANDBOX_SESSION'");
    const peak = routes.indexOf("code: 'SANDBOX_PEAK_MEMORY'");
    const gate = routes.indexOf("code: 'RELEASE_GATE'");
    expect(sess).toBeGreaterThan(-1);
    expect(peak).toBeGreaterThan(sess);
    expect(gate).toBeGreaterThan(peak);
    // Bounded, so a slow machine cannot delay the verdict.
    expect(routes).toContain("withTimeout(actuator.runCommand(workspaceId, PEAK_MEMORY_PROBE), 5_000, 'peak-memory')");
    // And the setup line now says WHO started the machine.
    expect(routes).toContain('started-by=${sandboxSessionOf(actuator, workspaceId)?.reason');
  });

  it('the admin card gets both tallies from the same endpoint', () => {
    expect(admin).toContain('tallyMinutes(sandboxes.map((s) => s.session))');
    expect(admin).toContain('tallyStarts(dailyStarts)');
    expect(admin).toContain('sandboxStore.listDailyStarts(14)');
  });

  it('🔒 the legacy template file can no longer describe a bigger machine than the one we run', () => {
    expect(toml).toMatch(/^cpu_count = 2$/m);
    expect(toml).toMatch(/^memory_mb = 4096$/m);
    expect(toml).toContain('$0.1656/h');
  });
});

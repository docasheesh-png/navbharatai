/**
 * A LIVE BUILD MUST NEVER BE PAUSED — which is the only reason 5 minutes is safe.
 *
 * ADMIN DECISION 2026-08-13: drop the idle window 15 → 5 minutes, worth ~₹1,500/month against the
 * measured E2B bill (~315 billed hours of pure idle across 1,260 sandboxes at 15 minutes).
 *
 * 🔒 WHY THE NUMBER ALONE WOULD HAVE BEEN A BUG. Idle is measured from the last SANDBOX operation, and
 * a long model call is not one: while the AI is thinking, nothing touches the sandbox at all. At 15
 * minutes that silence was too short to matter; at 5 it is ordinary — and pausing a sandbox mid-build
 * leaves the build holding a dead handle, which is a broken app for a real user. No amount of saved
 * compute is worth that, so the sweep learned to skip a workspace with a build in flight FIRST, and
 * the window came down only after.
 *
 * These tests hold the two halves together: if the hold is ever removed, the short window becomes
 * dangerous again, and this file is what says so.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { idleLimitMs, reapAfterMs, buildFlagExpiryMs, maxBuildMs } from '../src/server/AgentV3/sandboxReaper';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const actuator = codeOnly(read('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'));
const dispatcher = codeOnly(read('../src/server/AgentV3/ToolDispatcher.ts'));
const routes = codeOnly(read('../src/server/routes/agentv3.ts'));

describe('the idle window', () => {
  it('defaults to 5 minutes', () => {
    expect(idleLimitMs({} as NodeJS.ProcessEnv)).toBe(5 * 60_000);
  });

  it('is still env-tunable, and junk falls back to the default', () => {
    expect(idleLimitMs({ AGENTV3_SANDBOX_IDLE_MINUTES: '20' } as never)).toBe(20 * 60_000);
    for (const bad of ['0', '-5', 'abc', '']) {
      expect(idleLimitMs({ AGENTV3_SANDBOX_IDLE_MINUTES: bad } as never), bad).toBe(5 * 60_000);
    }
  });

  it('🔒 does NOT shorten the durable reaper — that window is decided independently', () => {
    // THE GUARANTEE IS UNCHANGED; ITS MEASURING STICK MOVED. This asserted `> maxBuildMs`, because the
    // orphan window used to BE `maxBuildMs + margin`. It no longer is (2026-08-24): a live build now
    // stamps its durable record, so the window is derived from that stamp instead — see reapAfterMs.
    // What this test protects is that lowering the IDLE window cannot drag the orphan window down with
    // it, and that is still true and still worth pinning.
    expect(reapAfterMs({} as NodeJS.ProcessEnv)).toBeGreaterThan(idleLimitMs({} as NodeJS.ProcessEnv));
    expect(reapAfterMs({} as NodeJS.ProcessEnv)).toBe(20 * 60_000);
    // And the thing that DOES still have to clear a whole build is the in-memory hold, which is now its
    // own function precisely so this reduction could not touch it.
    expect(buildFlagExpiryMs({} as NodeJS.ProcessEnv)).toBeGreaterThan(maxBuildMs({} as NodeJS.ProcessEnv));
  });
});

describe('🔒 the sweep skips a live build', () => {
  it('checks the build hold BEFORE the idle comparison', () => {
    // Order matters: the point is that a build is never even considered for pausing.
    // Slice from the METHOD DEFINITION, not the first mention — the first is the setInterval that
    // schedules it, and a window anchored there covers the wrong code entirely.
    const at = actuator.indexOf('private async _sweepIdleSandboxes(');
    expect(at, 'the sweep method must exist').toBeGreaterThan(-1);
    const sweep = actuator.slice(at, at + 900);
    const holdAt = sweep.indexOf('_buildInFlight');
    const idleAt = sweep.indexOf('now - last > limit');
    expect(holdAt).toBeGreaterThan(-1);
    expect(idleAt).toBeGreaterThan(holdAt);
    expect(sweep).toContain('continue');
  });

  it('exposes the hold on the actuator', () => {
    expect(actuator).toContain('setBuildActive(workspaceId: string, active: boolean): void');
    expect(actuator).toContain('_activeBuilds');
  });

  it('🔒 the hold EXPIRES, so a crashed build cannot keep a sandbox alive for ever', () => {
    // A leaked flag would be the opposite of this whole change: an immortal VM costs far more than
    // the sweep saves, and nobody would notice for weeks.
    expect(actuator).toContain('_buildInFlight');
    expect(actuator).toContain('this._activeBuilds.delete(workspaceId)');
    // `buildFlagExpiryMs`, not `reapAfterMs` — the two were one function until 2026-08-24, and this
    // assertion is where a future re-merge would be caught: the hold must expire on the BUILD ceiling,
    // never on the orphan window, or a long build gets paused mid-run by the 5-minute sweep.
    expect(actuator).toMatch(/now - startedAt > buildFlagExpiryMs\(\)/);
  });
});

describe('🔒 the hold is actually raised and released', () => {
  it('the dispatcher can mark a build active, and never throws doing it', () => {
    expect(dispatcher).toContain('markBuildActive(active: boolean): void');
    expect(dispatcher).toContain('this.actuator.setBuildActive?.(this.workspaceId, active)');
    // A guard that can throw would take down the build it exists to protect.
    expect(dispatcher).toMatch(/try \{ this\.actuator\.setBuildActive/);
  });

  it('the build raises it at the start', () => {
    expect(routes).toContain('dispatcher.markBuildActive(true)');
  });

  it('🔒 and releases it in the FINALLY, so a crash or timeout still frees the sandbox', () => {
    // Released only on the success path, an errored build would hold its sandbox until the flag aged
    // out — paying for the very idle time this change exists to stop.
    const fin = routes.slice(routes.lastIndexOf('} finally {'));
    expect(fin).toContain('markBuildActive(false)');
  });
});

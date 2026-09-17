// "AI ENGINE WALE PAGE KO BHI UPDATE KARO, WOH FAKE HAI ABHI" — admin, 2026-09-17.
//
// They were right, and the page was wrong in three separate ways. Each one is pinned here, because
// each is the kind of defect that looks fine on screen and is only visible by reading the code:
//
//   1. The engines it listed were the CHAT router's, not the ones that build apps. GLM and KIMI lead
//      the first rung of ALL THREE tiers and appeared nowhere on a page called "AI Engines".
//   2. A provider with zero traffic showed a green "Healthy" badge. That is the most misleading state
//      a status light can have: it reads as "checked and fine" when nothing was ever checked.
//   3. 🔴 THE KILL SWITCHES DID NOTHING. The panel said *"Disable a provider to prevent new requests
//      from routing to it. Changes take effect immediately on next request."* `providerEnabled` is
//      read by exactly two places in the repo — the settings route that echoes it back and the health
//      check that COUNTS it — and by not one routing decision. A button that does not do what it says
//      is the second absolute rule's forbidden state, so it was removed rather than recaptioned.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';
import { engineKey, engineUseDayKey } from '../src/server/AgentV3/engineUseStore';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Source with its COMMENTS REMOVED.
 *
 * ⚠️ Every "this is gone" assertion below must be made against code, not against prose. The comment
 * that replaced each removed panel NAMES it — deliberately, so a later session reads why the button
 * went instead of rediscovering that it did nothing — and an assertion that cannot tell an
 * explanation from the thing it explains would fail on the very record that documents the fix. That
 * is a test punishing clarity, which is how comments quietly stop being written.
 */
const codeOf = (p: string) =>
  read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const dash = read('src/components/AdminDashboard.tsx');
const dashCode = codeOf('src/components/AdminDashboard.tsx');
const adminRoute = read('src/server/routes/admin.ts');

describe('🔴 the control that did nothing is gone', () => {
  it('the "Provider Kill Switches" panel and its false promise are removed', () => {
    expect(dashCode).not.toContain('Provider Kill Switches');
    expect(dashCode).not.toContain('prevent new requests from routing to it');
    // The button itself, not just its caption. Anchored on the toggle's own handler rather than on
    // the icon it used — `ToggleRight` also draws the MAINTENANCE-MODE switch, which genuinely works.
    expect(dashCode).not.toContain('setProviderEnabledState(newVal)');
  });

  it('🔒 …and it is still true that NOTHING routes on providerEnabled', () => {
    // The reason the panel was removed rather than wired. If a future change makes this map decide a
    // route, this assertion is the place to come back to — the honest options are then to wire the
    // control properly or leave it gone, never to restore a button on a map nothing reads.
    const routers = [
      'src/server/AI/Router/AIRouter.ts',
      'src/server/AI/AIRouterManager.ts',
      'src/server/routes/agentv3.ts',
      'src/server/routes/chat.ts',
    ];
    for (const f of routers) {
      let src = '';
      try { src = codeOf(f); } catch { continue; }
      expect(src).not.toContain('providerEnabled');
    }
  });
});

describe('the page now shows the engines that actually build apps', () => {
  it('reads the REAL ladders from the table the build chain is constructed from', () => {
    expect(adminRoute).toContain("app.get('/api/admin/engines'");
    expect(adminRoute).toContain('tierLadder(level).rungs');
    // Never re-typed into the route: a second copy of the ladder is a second thing to keep in sync,
    // and the first time it drifts the panel starts describing an engine that does not run.
    for (const rung of TIER_LADDERS.weak) expect(adminRoute).not.toContain(`'${rung.model}'`);
  });

  it('every rung says whether its key is actually present here', () => {
    expect(adminRoute).toContain('keyed: rungHasKey(r)');
    expect(adminRoute).toContain('available: tierEngineAvailable(level)');
    expect(dash).toContain('No engine — builds refused');
  });

  it('the client renders all three tiers from the server, not a hardcoded list', () => {
    expect(dash).toContain('engines.tiers.map');
    expect(dash).toContain('Build Engines');
  });
});

describe('🔒 "could not read" and "nothing ran" never render the same', () => {
  it('the store returns null for unreadable and {} for a genuinely empty day', () => {
    // Pinned as the contract the screen depends on — see engineUseStore, whose own doc comment says
    // the caller MUST be able to tell the two apart.
    const store = read('src/server/AgentV3/engineUseStore.ts');
    expect(store).toContain('Returns `null` — NOT an empty object — when the day cannot be read');
  });

  it('the route carries the readable flag rather than flattening it away', () => {
    expect(adminRoute).toContain('readable: counts !== null');
  });

  it('the screen says so in words when the day could not be read', () => {
    expect(dash).toContain('engines.today?.readable');
    expect(dash).toContain('could not be read');
  });
});

describe('a provider that never ran is not "Healthy"', () => {
  it('the status is derived from whether it has ever served a request', () => {
    expect(dash).toContain('const everRan = Number(stat.requestCount) > 0;');
    expect(dash).toContain('Not used yet');
  });

  it('the chat counters are labelled for what they are — one instance, since boot', () => {
    expect(dash).toContain('Chat Router — Live');
    expect(adminRoute).toContain("scope: 'this server instance, since it started'");
  });
});

describe('counting engines counts VENDORS, not keys', () => {
  it('a key pool is one engine', () => {
    // A 50-key GLM pool reports GLM, GLM#2, GLM#17. Counting those as 50 engines would make "engines
    // used today" a measure of our key list, and the number would jump the day somebody buys keys.
    expect(engineKey('GLM#17')).toBe('GLM');
    expect(engineKey('GLM')).toBe('GLM');
    expect(engineKey(' kimi#3 ')).toBe('KIMI');
  });

  it('an unusable name is null, never a blank engine', () => {
    expect(engineKey('')).toBeNull();
    expect(engineKey(null)).toBeNull();
    expect(engineKey('   ')).toBeNull();
    expect(engineKey('#4')).toBeNull();
  });

  it('the day is UTC and comes from the SERVER clock', () => {
    expect(engineUseDayKey(Date.UTC(2026, 8, 17, 23, 59))).toBe('2026-09-17');
    expect(engineUseDayKey(Date.UTC(2026, 8, 18, 0, 1))).toBe('2026-09-18');
  });
});

describe('the build path is what records the use — nothing else can', () => {
  it('a finished build records its engine deliveries', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('recordEngineUse(providerTurns)');
    // Fire-and-forget on purpose: an observation must never be able to fail a build.
    expect(route).toContain('void recordEngineUse(');
  });
});

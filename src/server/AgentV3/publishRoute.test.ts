import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { choosePublishRoute, planDeployment } from './deployPlan';
import { NAVBHARAT_CLOUD_PROVIDER } from './hostedDeploymentRecord';
import { liveAppCount } from '../lib/HostingQuota';

/**
 * ONE BUTTON (ROADMAP §11 slice 5 / §13 item 2.4).
 *
 * An app with a server used to be refused by publish and sent on a five-step tour of two other
 * websites. These tests pin the three things that make the replacement safe rather than merely
 * shorter: static still wins when static works, the old path is untouched when hosting is off, and a
 * hosted app is recorded — because the "Take offline" button needs something to act on.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function codeOf(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

const EXPRESS_APP = {
  'package.json': JSON.stringify({ dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }),
  'server.js': "const express = require('express'); express().listen(3000);",
};

const PLAIN_SITE = { 'index.html': '<!doctype html><html><body>hi</body></html>' };

describe('which route a publish takes', () => {
  it('🔒 static wins whenever static genuinely works — even with hosting available', () => {
    // A plain website on a CDN is faster, cached at the edge and effectively free. Putting it in a
    // container because we CAN would be a real downgrade paid for with our own money.
    const plan = planDeployment(PLAIN_SITE);
    expect(plan.staticHostingSufficient).toBe(true);
    expect(choosePublishRoute(plan, { containerHostingAvailable: true })).toBe('static');
    expect(choosePublishRoute(plan, { containerHostingAvailable: false })).toBe('static');
  });

  it('an app that needs a server goes to the container when hosting can run it', () => {
    const plan = planDeployment(EXPRESS_APP);
    expect(plan.staticHostingSufficient).toBe(false);
    expect(choosePublishRoute(plan, { containerHostingAvailable: true })).toBe('container');
  });

  it('🔒 with hosting off it still REFUSES — the old Render path is unchanged, not silently skipped', () => {
    // Hosting is off by default and admin-only until metering ships. A one-button publish that did
    // nothing when the button could not work would be the worse half of this trade.
    expect(choosePublishRoute(planDeployment(EXPRESS_APP), { containerHostingAvailable: false })).toBe('refuse');
  });
});

describe('the publish handler’s container branch', () => {
  const route = codeOf(read('src/server/routes/agentv3.ts'));
  /**
   * The container branch ALONE. Both ends are anchored on real code — comments are stripped before
   * this runs, so anchoring on prose would silently widen the slice to the rest of the file and the
   * assertions below would then be counting the whole route. (That is not hypothetical: the first
   * version of this test did exactly that and passed the wrong thing.) The end anchor is the first
   * line of the Render path that follows.
   */
  const start = route.indexOf('choosePublishRoute(plan, { containerHostingAvailable })');
  const end = route.indexOf('const vault = userId ? await loadUserVaultSecrets', start);
  const branch = route.slice(start, end);

  it('is one branch, anchored where this suite thinks it is', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // Small enough to be one branch, not a slice that ran away over the rest of the handler.
    expect(branch.length).toBeLessThan(4000);
  });

  it('🔒 uses the VERIFIED identity for the admin check, never the body’s claimed email', () => {
    // This handler takes its user from req.body — fine for the feature gate it was written for, and a
    // one-line bypass of an admin-only gate. No token must mean not an admin.
    const before = route.slice(0, route.indexOf('choosePublishRoute(plan, { containerHostingAvailable })'));
    const decl = before.slice(before.lastIndexOf('let containerHostingAvailable'));
    expect(decl).toContain('verifyFirebaseIdentity(req)');
    expect(decl).not.toContain('resolveReadIdentity');
    expect(decl).toMatch(/hostingAvailability\(\{\s*isAdmin: isReportAdmin\(identity\?\.email/);
  });

  it('🔒 always responds and always returns — it can never fall through to the static publish', () => {
    // The planner sits inside a catch that deliberately falls through to the ordinary static publish.
    // That is right for a classifier that failed and WRONG here: falling through would upload a Node
    // server to a CDN and report success — the exact bug the planner was written to end.
    // Every response in the branch is matched by a return, and the branch has its OWN catch — so a
    // throw inside it produces an honest error rather than a silent fall-through.
    const responses = branch.match(/res\.(json|status)\(/g) ?? [];
    expect(responses.length).toBeGreaterThanOrEqual(4);
    expect(branch.match(/\n\s+return;/g)?.length ?? 0).toBeGreaterThanOrEqual(responses.length);
    expect(branch).toContain('} catch (e) {');
  });

  it('🔒 records the deployment before reporting success', () => {
    const ok = branch.indexOf('recordHostedDeployment({');
    const reply = branch.indexOf('ok: true,');
    expect(ok).toBeGreaterThan(-1);
    expect(ok).toBeLessThan(reply);
  });

  it('🔒 never puts the provider’s own words in the response body', () => {
    // hosted.detail is a build log. The white-label law keeps it admin-side.
    expect(branch).toContain('console.error(`[publish→host]');
    expect(branch).not.toMatch(/res\.[a-z]+\([^)]*hosted\.detail/);
  });

  it('reports Cloud Run’s own readiness rather than inferring it from a URL', () => {
    expect(branch).toContain('hosted.ready');
  });
});

describe('a hosted app is a published app', () => {
  it('🔒 counts as first-party, so "Take offline" and the slot count both see it', () => {
    // NavBharatAI pays the Cloud Run bill, so it occupies a free publish slot exactly like a Firebase
    // one — and liveAppCount honours an explicit firstParty over the provider allow-list, which is
    // what lets this be true without adding a container host to a set named for static CDNs.
    const rows = [{ workspaceId: 'w1', status: 'active', providerId: NAVBHARAT_CLOUD_PROVIDER, firstParty: true }];
    expect(liveAppCount(rows)).toBe(1);
  });

  it('🔒 both hosting routes record through the SAME helper', () => {
    // Two routes now host an app. A registry write copied into both is the drift this codebase has
    // paid for repeatedly.
    const route = read('src/server/routes/agentv3.ts');
    expect(route.split('recordHostedDeployment({').length - 1).toBe(2);
    expect(route).not.toMatch(/deploymentStore\.record\([^)]*navbharat-cloud/s);
  });

  it('the record is best-effort and says so in the log when it fails', () => {
    const helper = read('src/server/AgentV3/hostedDeploymentRecord.ts');
    expect(helper).toContain('firstParty: true');
    expect(helper).toContain('but was NOT recorded');
  });
});

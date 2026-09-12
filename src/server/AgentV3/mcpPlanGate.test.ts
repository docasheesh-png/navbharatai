import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canUseConnectedServices, canRunConnectedServices, skippedServicesNotice, type McpPlanFacts,
} from './mcpPlanGate';
// Shared anchor — see its own doc comment for why an indexOf on the read is not enough.
import { buildLoopStart } from './mcpClient.test';

/**
 * THE PAID-PLAN GATE ON CONNECTED SERVICES (MCP), admin-mandated 2026-09-12:
 * *"only for 149₹ subscription wale ke liye rakho, baaki ke liye disable kar do"*.
 *
 * Everything here turns on ONE distinction: "not paid" and "we could not find out" are different
 * answers. The tests exist because collapsing them is cheap to do and expensive both ways.
 */

const facts = (o: Partial<McpPlanFacts> = {}): McpPlanFacts => ({
  signedIn: true, hasActivePlan: false, planKnown: true, isFreeListed: false, ...o,
});

describe('connecting a NEW service', () => {
  it('a paying user may connect', () => {
    expect(canUseConnectedServices(facts({ hasActivePlan: true }))).toEqual({ allowed: true, reason: 'active-plan' });
  });

  it('a free user is refused, and told what unlocks it', () => {
    const d = canUseConnectedServices(facts());
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('requires-plan');
      expect(d.message).toMatch(/paid plan/i);
    }
  });

  it('a signed-out visitor is asked to sign in, not to pay', () => {
    // They may already have a plan — we cannot know, so the honest ask is the sign-in, not the upsell.
    const d = canUseConnectedServices(facts({ signedIn: false }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('signed-out');
      expect(d.message).not.toMatch(/upgrade|paid plan/i);
    }
  });

  it('🔒 an UNREADABLE plan refuses a NEW connection — new spend never starts on a guess', () => {
    const d = canUseConnectedServices(facts({ planKnown: false }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('plan-unreadable');
  });

  it('🔒 and it says RETRY, not UPGRADE — we do not know that they need to buy anything', () => {
    const d = canUseConnectedServices(facts({ planKnown: false }));
    if (!d.allowed) {
      expect(d.message).toMatch(/try again/i);
      expect(d.message).not.toMatch(/upgrade|paid plan/i);
    }
  });

  it('the admin free-list is allowed without any plan record at all', () => {
    // So the feature can be tested before a single plan is ever sold.
    expect(canUseConnectedServices(facts({ isFreeListed: true, planKnown: false })).allowed).toBe(true);
    expect(canUseConnectedServices(facts({ isFreeListed: true, signedIn: false })).allowed).toBe(true);
  });
});

describe('RUNNING services that are already connected', () => {
  it('a paying user’s services run', () => {
    expect(canRunConnectedServices(facts({ hasActivePlan: true }))).toBe(true);
  });

  it('a free user’s services do not run — the gate is a gate', () => {
    // A plan READ as inactive is evidence, not a blip: the tools stop.
    expect(canRunConnectedServices(facts())).toBe(false);
  });

  it('🔒 an UNREADABLE plan keeps an EXISTING integration working', () => {
    // The asymmetry is the whole point. A Firestore hiccup must not silently switch off a paying
    // customer's working app mid-build; the connect gate has already stopped anything NEW.
    expect(canRunConnectedServices(facts({ planKnown: false }))).toBe(true);
    expect(canUseConnectedServices(facts({ planKnown: false })).allowed).toBe(false);
  });

  it('🔒 the two gates differ ONLY on the unreadable case', () => {
    // Anything looser than that would be a hole; anything stricter would break a paying user.
    for (const f of [facts(), facts({ hasActivePlan: true }), facts({ signedIn: false }), facts({ isFreeListed: true })]) {
      expect(canRunConnectedServices(f), JSON.stringify(f)).toBe(canUseConnectedServices(f).allowed);
    }
  });
});

describe('🔒 the build never goes silent about it', () => {
  it('says plainly when connected services were skipped', () => {
    // Silently dropping a tool the user set up looks like the AI forgetting — worse than a sentence.
    const msg = skippedServicesNotice(2, facts());
    expect(msg).toContain('2');
    expect(msg).toMatch(/paid plan/i);
  });

  it('says nothing when there was nothing to skip, or nothing was skipped', () => {
    expect(skippedServicesNotice(0, facts())).toBe('');
    expect(skippedServicesNotice(3, facts({ hasActivePlan: true }))).toBe('');
    expect(skippedServicesNotice(3, facts({ planKnown: false }))).toBe('');
  });

  it('a signed-out user is told to sign in rather than to pay', () => {
    expect(skippedServicesNotice(1, facts({ signedIn: false }))).toMatch(/sign in/i);
  });
});

describe('🔒 the wiring — a gate that is not applied is not a gate', () => {
  const routes = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const ui = readFileSync(join(process.cwd(), 'src/components/agentv3/ConnectedServices.tsx'), 'utf8');

  it('CONNECT is gated BEFORE the URL is fetched', () => {
    // A user who may not connect must not be able to make our server fetch a URL of their choosing —
    // so the plan check has to sit ahead of the SSRF probe, not beside it.
    const at = routes.indexOf("app.post('/api/agentv3/mcp/connect'");
    expect(at).toBeGreaterThan(-1);
    const body = routes.slice(at, at + 2600);
    const gateAt = body.indexOf('canUseConnectedServices');
    const fetchAt = body.indexOf('assertPublicHttpUrl');
    expect(gateAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(fetchAt);
  });

  it('the BUILD loop checks before contacting any service', () => {
    const at = buildLoopStart(routes);
    expect(at).toBeGreaterThan(-1);
    const body = routes.slice(at, at + 1800);
    expect(body).toContain('canRunConnectedServices');
    const gateAt = body.indexOf('canRunConnectedServices');
    const callAt = body.indexOf('listRemoteTools');
    expect(gateAt).toBeLessThan(callAt);
  });

  it('🔒 the build SAYS when it skipped them', () => {
    const at = buildLoopStart(routes);
    expect(at).toBeGreaterThan(-1);
    expect(routes.slice(at, at + 1800)).toContain('skippedServicesNotice');
  });

  it('the LIST route carries the entitlement, so the form is never a dead end', () => {
    const at = routes.indexOf("app.post('/api/agentv3/mcp/list'");
    const body = routes.slice(at, at + 1400);
    expect(body).toContain('canUseConnectedServices');
    expect(body).toContain('canConnect');
  });

  it('🔒 REMOVE is deliberately NOT gated — a lapsed plan must not trap a user’s key with us', () => {
    const at = routes.indexOf("app.post('/api/agentv3/mcp/remove'");
    expect(at).toBeGreaterThan(-1);
    expect(routes.slice(at, at + 1200)).not.toContain('canUseConnectedServices');
  });

  it('the screen renders a locked state instead of a form it would refuse', () => {
    expect(ui).toContain('canConnect === false');
    expect(ui).toContain('lockedMessage');
  });

  it('🔒 an UNANSWERED entitlement is not rendered as locked', () => {
    // A screen that guesses "locked" while the list is still loading would upsell a paying customer.
    expect(ui).toContain('useState<boolean | null>(null)');
    expect(ui).not.toContain('canConnect !== true');
  });
});

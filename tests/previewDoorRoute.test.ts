/**
 * THE PREVIEW DOOR's route-level invariants (admin 2026-08-22).
 *
 * The door ends the stored-address class: the iframe points at our origin, and "which machine, which
 * port" is resolved per request. These assertions pin the properties that make it SAFE to be in the
 * middle of every preview load — each one is a way the class could sneak back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const door = route.slice(
  route.indexOf("app.get('/api/agentv3/preview-door'"),
  route.indexOf("app.post('/api/agentv3/preview-health'"),
);
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

describe('the door route', () => {
  it('exists, and sits behind the poll rate limiter', () => {
    expect(door.length).toBeGreaterThan(500);
    expect(door).toContain('previewPollRateLimiter()');
  });

  it('never lets a redirect be cached — a cached 302 would BE the stale-url bug', () => {
    expect(door).toContain("res.setHeader('Cache-Control', 'no-store')");
  });

  it('verifies the HMAC token before touching any sandbox', () => {
    const verifyAt = door.indexOf('verifyDoorToken(');
    const sandboxAt = door.indexOf('getSandboxId');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(sandboxAt).toBeGreaterThan(verifyAt);
  });

  it('only redirects to a port a probe just saw serving — no url is ever believed about a port', () => {
    // The 302 must be reachable only AFTER parsePortSweep produced a hit.
    const sweepAt = door.indexOf('parsePortSweep(');
    const redirectAt = door.indexOf('res.redirect(302');
    expect(sweepAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(sweepAt);
    expect(door).toContain("if (found === null) return page(200, 'starting')");
  });

  it('the PROVEN port leads the sweep — the revival recipe outranks every guess', () => {
    expect(door).toContain('sandboxStore.getRecipe(');
    expect(door).toContain('portCandidates(recipe?.port)');
  });

  it('every await is time-bounded — the frame must never hang on us', () => {
    const awaits = (door.match(/await /g) || []).length;
    const bounded = (door.match(/raceTimeout\(/g) || []).length;
    expect(awaits).toBeGreaterThan(0);
    expect(bounded).toBe(awaits);
  });

  it('the branded redirect target goes through applyPreviewDomain like every other preview url', () => {
    expect(door).toContain('applyPreviewDomain(');
  });

  it('every non-redirect exit is OUR page — the vendor edge is never the fallback, even on a throw', () => {
    expect(door).toContain("return page(200, 'starting');\n    }\n  });");
    expect(door).not.toMatch(/res\.status\(5\d\d\)/);
  });

  it('has a kill switch that stops minting AND answering without a deploy', () => {
    expect(door).toContain('if (!previewDoorEnabled()) return page(404');
    expect(route).toContain("previewDoorEnabled() ? { doorUrl: makeDoorPath(");
  });
});

describe('the client side of the door', () => {
  it('the live iframe prefers the door and falls back to the stored address for an older server', () => {
    expect(surface).toContain('src={doorUrl || effectiveUrl}');
  });

  it('only accepts a door url that is genuinely ours — a spoofed health payload cannot move the frame', () => {
    expect(surface).toContain("health.doorUrl.startsWith('/api/agentv3/preview-door?')");
  });

  it('the door url resets when the workspace changes — one app never frames another', () => {
    expect(surface).toMatch(/setFoundUrl\(''\); setDoorUrl\(''\);/);
  });
});

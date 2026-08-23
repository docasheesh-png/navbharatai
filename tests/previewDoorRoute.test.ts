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
// Ends at the route registered immediately AFTER the door. It used to end at `preview-health`, which
// silently began including the keep-alive route added between them (2026-08-23) — so the "every await
// is bounded" assertion started measuring a different route's awaits. A slice that quietly grows is a
// test that quietly stops testing what it names.
const door = route.slice(
  route.indexOf("app.get('/api/agentv3/preview-door'"),
  route.indexOf("app.post('/api/agentv3/preview-keepalive'"),
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
    // Anchored on the PORT redirect specifically. The door also has an earlier redirect — the VM-free
    // snapshot, served when there is no sandbox at all — and that one has no port to verify, so
    // "the first redirect in the file" stopped being a way to find this one.
    const redirectAt = door.indexOf('res.redirect(302, target)');
    expect(sweepAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(sweepAt);
    expect(door).toContain("if (found === null) return page(200, 'starting')");
  });

  it('the PROVEN port leads the sweep — the revival recipe outranks every guess', () => {
    expect(door).toContain('sandboxStore.getRecipe(');
    expect(door).toContain('portCandidates(recipe?.port, hint)');
  });

  it('the slice really is just the door — a widened window would silently stop testing it', () => {
    expect(door).toContain("app.get('/api/agentv3/preview-door'");
    expect(door).not.toContain("app.post('/api/agentv3/preview-keepalive'");
    expect(door).not.toContain("app.post('/api/agentv3/preview-health'");
  });

  it('every await is time-bounded — the frame must never hang on us', () => {
    const awaits = (door.match(/await /g) || []).length;
    const bounded = (door.match(/raceTimeout\(/g) || []).length;
    expect(awaits).toBeGreaterThan(0);
    expect(bounded).toBe(awaits);
  });

  it('the snapshot fallback fires only when there is NO sandbox, and never to a probed port', () => {
    // It is reached inside `if (!sandboxId)`, i.e. the machine is gone rather than starting — and it
    // redirects to a stored permanent url, not to anything the port sweep produced.
    const gone = door.indexOf('if (!sandboxId) {');
    const snap = door.indexOf('shouldServeSnapshot({');
    const sweep = door.indexOf('buildPortSweepCommand(');
    expect(gone).toBeGreaterThan(-1);
    expect(snap).toBeGreaterThan(gone);
    expect(snap).toBeLessThan(sweep); // decided before a port is ever probed
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
    expect(route).toMatch(/previewDoorEnabled\(\)\s*\n?\s*\? \{ doorUrl: makeDoorPath\(/);
  });
});

describe('the client side of the door', () => {
  it('the live iframe prefers the door and falls back to the stored address for an older server', () => {
    expect(surface).toContain('src={doorUrl ? resolveApiHref(doorUrl, window as never) : effectiveUrl}');
  });

  it('NATIVE SHELL: the src goes through resolveApiHref — an iframe is a navigation the fetch patch never sees', () => {
    // The bundled Play Store app serves the UI from a local origin; a bare relative src would resolve
    // against the shell and kill the live preview on every phone. apiBase's own header calls this
    // "the same hole" — this is its fourth instance, caught in review before shipping.
    expect(surface).toContain("import { resolveApiHref } from '../../lib/apiBase';");
  });

  it('only accepts a door url that is genuinely ours — a spoofed health payload cannot move the frame', () => {
    expect(surface).toContain("health.doorUrl.startsWith('/api/agentv3/preview-door?')");
  });

  it('adopts once, keeps while fresh, DROPS when the server stops offering — via the pure rule', () => {
    // Adopting every mint remounted the iframe each poll: the framed app reloaded every 150 seconds.
    // Keeping a link the server stopped minting stranded the frame on a refused page after the kill
    // switch. Both live in nextDoorUrl, tested on its own; this pins that the surface actually uses it.
    expect(surface).toContain('setDoorUrl((prev) => nextDoorUrl(prev, offered, Date.now()));');
  });

  it('the door url resets when the workspace changes — one app never frames another', () => {
    expect(surface).toMatch(/setFoundUrl\(''\); setDoorUrl\(''\);/);
  });
});

describe('the port hint', () => {
  it('the minter passes the DISPLAYED port and the door adds it to the sweep — an unusual port with no recipe must not mean an eternal "starting" page', () => {
    expect(route).toMatch(/makeDoorPath\(workspaceId, Date\.now\(\), doorSecret\(\), undefined,\s*\n\s*previewUrlPort/);
    expect(door).toContain('portCandidates(recipe?.port, hint)');
  });

  it('the hint is clamped to a real port — rubbish in the query cannot reach the sweep command', () => {
    expect(door).toContain('Number.isInteger(hintRaw) && hintRaw > 0 && hintRaw < 65536');
  });
});

/**
 * NEVER FRAME A HOST THAT IS NOT SERVING (admin screenshot 2026-08-23).
 *
 * The frame showed "Closed Port Error — The sandbox … is running but there's no service running on
 * port 3000" as though it were the user's app, while our own banner above it correctly reported the
 * problem. The health probe curls the port from INSIDE the machine, so when it says the port is down,
 * whatever the BROWSER fetches from that host is the provider's error page by definition — there is
 * nothing else it could be.
 *
 * `unreachable` could not carry this: that means the origin did not answer at all, and here it answers
 * perfectly well, with a stranger's page.
 */
describe('a host with nothing on its port is never framed', () => {
  it('the server reports livePortUp explicitly, not only folded into a status string', () => {
    expect(route).toContain('livePortUp: describesUserView ? livePortUp : null,');
  });

  it('the client refuses to frame on portDown, and only on an EXPLICIT false', () => {
    // An older server sends no field; `=== false` keeps that case on today's behaviour rather than
    // blanking the preview for everyone the moment the field is missing.
    expect(surface).toContain('setPortDown(res.ok && health?.livePortUp === false);');
    expect(surface).toContain('{unreachable || (portDown && !diagnosing) ? (');
  });

  it('it stands down while a wake/diagnose is in flight — that is when the port is MEANT to be down', () => {
    // Without the guard, pressing Wake up would replace the app with the not-serving panel for the
    // whole reboot, which reads as "it broke" at exactly the moment it is being fixed.
    expect(surface).toContain('portDown && !diagnosing');
  });

  it('a reading from ANOTHER machine can never trigger it', () => {
    // Same rule as `serving`: a port that is up (or down) on a machine the user is not looking at is
    // not a statement about their view.
    const line = route.split('\n').find((l) => l.includes('livePortUp: describesUserView')) || '';
    expect(line).toContain('describesUserView ?');
  });
});

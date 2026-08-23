import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * KEEP-ALIVE WIRING — the four connections behind "a finished app must not die under its user".
 *
 * The pure decisions have their own tests. These pin the parts that live inside the 12,000-line route
 * and a 1,200-line component, where a dropped line produces NO error and NO failing build — just a
 * sandbox quietly paused under somebody's working app five minutes later, reported weeks after.
 *
 * Source-level, for the same reason `cachePrefixWiring.test.ts` is: a weaker check than execution,
 * chosen honestly over no check at all.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
const actuator = readFileSync(join(process.cwd(), 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

describe('1. the popout goes through the door', () => {
  it('no longer hands out the raw sandbox url', () => {
    // The whole reported failure started here: a popped-out tab bypassed the door, so it got the
    // vendor's error page instead of ours AND carried none of our keep-alive.
    expect(surface).not.toContain('<a href={effectiveUrl} target="_blank"');
    expect(surface).toContain('<a href={popoutHref} target="_blank"');
  });

  it('uses the SAME precedence as the iframe, so the two cannot disagree', () => {
    expect(surface).toContain('const popoutHref = doorUrl ? resolveApiHref(doorUrl, window as never) : effectiveUrl;');
  });
});

describe('2. the door serves the shell only for a popped-out tab', () => {
  it('decides with the shared pure rule, reading the browser’s own signal', () => {
    expect(route).toContain('shouldServeKeepAliveShell({');
    expect(route).toContain("isTopLevelNavigation(req.headers['sec-fetch-dest']");
  });

  it('the in-app iframe still gets the plain 302', () => {
    expect(route).toContain('return res.redirect(302, target);');
  });

  it('passes the SAME signed token through, so the shell can prove who it is', () => {
    const i = route.indexOf('keepAliveShellPage({');
    expect(i).toBeGreaterThan(-1);
    const block = route.slice(i - 500, i + 300);
    expect(block).toContain('exp: String(req.query?.exp');
    expect(block).toContain('sig: String(req.query?.sig');
  });
});

describe('3. the keep-alive endpoint is cheap and verified', () => {
  it('exists and checks the door token before doing anything', () => {
    const i = route.indexOf("app.post('/api/agentv3/preview-keepalive'");
    expect(i).toBeGreaterThan(-1);
    const body = route.slice(i, i + 1400);
    expect(body).toContain('verifyDoorToken(');
    expect(body).toContain('res.status(403)');
  });

  it('runs NO sandbox command — it only stamps clocks', () => {
    const i = route.indexOf("app.post('/api/agentv3/preview-keepalive'");
    const body = route.slice(i, i + 1400);
    expect(body).toContain('actuator.noteUserActivity');
    expect(body).not.toContain('runCommand');
    expect(body).not.toContain('getPortUrl');
  });
});

describe('4. the sweep respects activity it did not see itself', () => {
  it('reads the durable record before pausing', () => {
    // A ping can land on ANY Cloud Run instance; the sweep runs on whichever holds the sandbox. Without
    // this read, a keep-alive that landed elsewhere protects nothing and the app still dies.
    const i = actuator.indexOf('private async _sweepIdleSandboxes');
    expect(i).toBeGreaterThan(-1);
    const body = actuator.slice(i, i + 1800);
    expect(body).toContain('sandboxStore.getRecord(workspaceId)');
    const check = body.indexOf('sandboxStore.getRecord');
    const pause = body.indexOf('await this.pauseSandbox');
    expect(check).toBeLessThan(pause); // the check must come BEFORE the pause, not after it
  });

  it('user activity writes durably on its own throttle, not the build hot path’s', () => {
    // `_touchDurable` is throttled to 5 minutes — exactly the idle limit it would have to beat.
    expect(actuator).toContain('const USER_ACTIVITY_WRITE_MS = 60_000;');
    const i = actuator.indexOf('noteUserActivity(workspaceId: string): boolean');
    const body = actuator.slice(i, i + 900);
    expect(body).toContain('USER_ACTIVITY_WRITE_MS');
    expect(body).not.toContain('this._touchDurable(');
  });

  it('the build-in-flight skip still comes first, so a live build is never reached', () => {
    const i = actuator.indexOf('private async _sweepIdleSandboxes');
    const body = actuator.slice(i, i + 1800);
    expect(body.indexOf('_buildInFlight')).toBeLessThan(body.indexOf('sandboxStore.getRecord'));
  });
});

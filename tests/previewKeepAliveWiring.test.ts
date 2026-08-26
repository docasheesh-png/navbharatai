import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * PREVIEW ACCESS + KEEP-ALIVE WIRING.
 *
 * ⚠️ THIS FILE CHANGED SIDES ON 2026-08-25, and the reason matters more than the assertions.
 *
 * It used to pin that a POPPED-OUT preview tab was served a keep-alive shell so the machine stayed up
 * while somebody watched their app. That was right for the problem it was written for (an app dying
 * under its own user after five idle minutes) and wrong about who might be watching: a preview url can
 * be forwarded, and the shell held a per-minute-billed machine awake for as long as ANY tab stayed
 * open — NavBharatAI's bill, someone else's audience.
 *
 * ADMIN 2026-08-25, after asking what a published game costs us: "ham, band karo! share link hi hata
 * do!!" So the popout is gone and the door refuses top-level navigation. The keep-alive machinery is
 * deliberately KEPT INTACT and unwired — the sweep-side protections below are still load-bearing for
 * the in-app preview, and the shell can be restored for an app's OWNER in one change.
 *
 * Source-level, for the same reason `cachePrefixWiring.test.ts` is: a weaker check than execution,
 * chosen honestly over no check at all.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
const actuator = readFileSync(join(process.cwd(), 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

describe('1. NavBharatAI no longer hands out a shareable preview link', () => {
  it('the preview toolbar offers no way to open the app outside the app', () => {
    expect(surface).not.toContain('target="_blank"');
    expect(surface).not.toContain('popoutHref');
  });

  it('the raw machine url was not left behind as a fallback either', () => {
    // The original bug this file was written for. Re-asserted because deleting the door-based popout
    // must never be "fixed" later by restoring the RAW-url one that came before it.
    expect(surface).not.toContain('<a href={effectiveUrl} target="_blank"');
  });

  it('the iframe — the one legitimate consumer — still goes through the door', () => {
    expect(surface).toContain('src={doorUrl ? resolveApiHref(doorUrl, window as never) : effectiveUrl}');
  });
});

describe('1b. …and the door itself refuses an outside open, which is the actual lock', () => {
  it('refuses a top-level navigation', () => {
    expect(route).toContain("isTopLevelNavigation(req.headers['sec-fetch-dest']");
    expect(route).toContain("return page(403, 'in-app-only');");
  });

  it('🔒 refuses BEFORE touching the machine — otherwise the refusal itself costs money', () => {
    // Connecting RESUMES a paused sandbox and the port sweep is billed activity. A check placed after
    // either one would still say "no" and still spend, which is the whole point missed.
    const at = route.indexOf("return page(403, 'in-app-only');");
    expect(at).toBeGreaterThan(-1);
    const doorAt = route.indexOf("app.get('/api/agentv3/preview-door'");
    const actuatorAt = route.indexOf('const actuator = buildActuator();', doorAt);
    expect(at).toBeLessThan(actuatorAt);
  });

  it('has a kill switch, because a rule that locks a door needs a key', () => {
    expect(route).toContain('previewInAppOnly()');
    const door = readFileSync(join(process.cwd(), 'src/server/AgentV3/previewDoor.ts'), 'utf8');
    expect(door).toContain('AGENTV3_PREVIEW_IN_APP_ONLY');
  });

  it('the refusal page never retries — a self-refreshing refusal would resume a machine forever', () => {
    const door = readFileSync(join(process.cwd(), 'src/server/AgentV3/previewDoor.ts'), 'utf8');
    expect(door).toContain("(kind === 'refused' || kind === 'in-app-only') ? '' : `<script>");
  });

  it('tells the user what to do INSTEAD, and names no vendor', () => {
    const door = readFileSync(join(process.cwd(), 'src/server/AgentV3/previewDoor.ts'), 'utf8');
    const at = door.indexOf("'Previews open inside NavBharatAI'");
    expect(at).toBeGreaterThan(-1);
    const body = door.slice(at, at + 900).toLowerCase();
    expect(body).toContain('publish');
    expect(body).not.toMatch(/e2b|sandbox|vercel|firebase/);
  });
});

describe('2. the keep-alive shell is no longer served — the unbounded half of the cost', () => {
  it('the door does not serve it at all', () => {
    // It held a per-minute-billed machine awake for as long as ANY tab stayed open. Its only consumer
    // was the popout, which no longer exists, so serving it would be dead code pretending to be live.
    expect(route).not.toContain('keepAliveShellPage(');
    expect(route).not.toContain('shouldServeKeepAliveShell(');
  });

  it('the in-app iframe still gets the plain 302', () => {
    expect(route).toContain('return res.redirect(302, target);');
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

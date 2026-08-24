import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ⚠️ WHAT FIVE REAL BUILD REPORTS SAID, AND WHY IT COULD NOT BE TRUE (2026-08-24).
 *
 * Every one of them recorded `resumed=yes` with workspace setup finishing in about 200ms. Three of the
 * five ALSO recorded that the durable store held 22-24 files while the live sandbox read exactly ONE,
 * and four of the five had to restart a dev server that had stopped. A successful resume comes back
 * with its files and its processes; those sentences describe two different machines.
 *
 * The report gave no way to tell which was wrong, because `resumed=yes` never meant "we resumed". It
 * was `resumeSandboxId ? 'yes' : 'no (cold)'` — a report on whether an ID EXISTED, printed in the
 * position where a reader expects the OUTCOME. `getSandbox` falls through a REFUSED `Sandbox.connect`
 * to a brand-new empty `Sandbox.create`, and nothing above it could see the difference.
 *
 * The same bug class as the rest of this month: an artifact standing in for the thing it was meant to
 * prove. This pins the fix — the outcome is recorded where it happens, and reported as the outcome.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const actuator = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
const route = read('src/server/routes/agentv3.ts');

describe('the sandbox reports how it was really obtained', () => {
  it('names every way a sandbox can arrive — including the one that used to be invisible', () => {
    expect(actuator).toContain("export type SandboxOrigin = 'warm' | 'resumed' | 'created-after-failed-resume' | 'created-fresh';");
  });

  it('stamps the outcome at each of the four exits, not once at the top', () => {
    // Stamping in one place would mean guessing again. Each branch knows its own answer.
    for (const origin of ['warm', 'resumed', 'created-after-failed-resume', 'created-fresh']) {
      expect(actuator).toContain(`this._sandboxOrigin.set(workspaceId, '${origin}');`);
    }
  });

  it('records the failed resume INSIDE the catch, where the reason still exists', () => {
    // By the time the File Guardian sees an empty sandbox, why it is empty is gone. This is the only
    // place that knows we asked for a specific machine and were refused.
    const at = actuator.indexOf("} catch {\n        sandbox = await withTimeout(Sandbox.create(");
    expect(at).toBeGreaterThan(-1);
    const block = actuator.slice(at, at + 900);
    expect(block).toContain("this._sandboxOrigin.set(workspaceId, 'created-after-failed-resume');");
  });
});

describe('the setup line reports the outcome, not the intent', () => {
  it('no longer prints an ID check as though it were a resume result', () => {
    expect(route).not.toContain("resumed=${resumeSandboxId ? 'yes' : 'no (cold)'}");
  });

  it('reports the real origin, and keeps "we had an id" as a separate fact', () => {
    // Both halves matter: "had an id and STILL came up cold" is the interesting case, and it is only
    // visible when the two are reported separately rather than conflated into one word.
    expect(route).toContain('had-resume-id=${resumeSandboxId ? ');
    expect(route).toContain("sandbox=${sandboxOriginOf(actuator, workspaceId) ?? 'unreported'}");
  });

  it('an actuator that cannot answer says "unreported" rather than guessing', () => {
    // The LOCAL actuator used in dev and CI has no sandbox to have an origin. Duck-typed like
    // sandboxHeldSeconds, so an observability line can never be a reason the route fails to load —
    // and silence is reported as silence, which is the word the old line refused to use.
    const at = route.indexOf('function sandboxOriginOf(');
    expect(at).toBeGreaterThan(-1);
    const body = route.slice(at, route.indexOf('\n}', at));
    expect(body).toContain("if (typeof fn !== 'function'");
    expect(body).toContain('return null;');
  });
});

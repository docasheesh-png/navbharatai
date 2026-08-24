import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A RESUMED SANDBOX WAS BILLING ZERO — permanently, and only the admin's own paired build reports made
 * it visible.
 *
 * `_sandboxStartedAt` was stamped ONLY on the create/connect path. The idle sweep DELETES it when it
 * pauses a sandbox but leaves the sandbox in `this.sandboxes`, so every later build for that workspace
 * returns from the warm early-exit and never re-stamps. `sandboxHeldSeconds` then returns null —
 * honestly reported as "not measured" — and `sandboxCost` bills ZERO.
 *
 * The evidence is exactly that shape: 2026-08-23's build was a fresh create and recorded
 * `443s ≈ $0.0102`; every build on the 24th came back to a paused-then-resumed sandbox and recorded no
 * sandbox cost at all, while E2B billed $124.05 for the month regardless.
 */
const actuator = readFileSync(
  join(process.cwd(), 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'),
  'utf8',
);

const warmBranch = (() => {
  const at = actuator.indexOf('const existing = this.sandboxes.get(workspaceId);');
  return actuator.slice(at, actuator.indexOf('return existing;', at) + 20);
})();

describe('both paths stamp the clock', () => {
  it('the WARM early-exit stamps it — the path that was missing one', () => {
    expect(warmBranch).toContain("this._sandboxStartedAt.set(workspaceId, Date.now())");
  });

  it('it is guarded, so a sandbox that was never paused keeps its ORIGINAL start time', () => {
    // Without the guard every build would reset the clock and under-bill in a different way — the same
    // mistake, wearing the opposite sign.
    expect(warmBranch).toContain('if (!this._sandboxStartedAt.has(workspaceId))');
  });

  it('the create/connect path still stamps it too', () => {
    expect(actuator).toContain('if (!this._sandboxStartedAt.has(workspaceId)) this._sandboxStartedAt.set(workspaceId, Date.now());');
    expect((actuator.match(/_sandboxStartedAt\.set\(workspaceId, Date\.now\(\)\)/g) || []).length).toBe(2);
  });
});

describe('the sweep still clears it, and that is correct', () => {
  it('a paused machine is not being held, so its clock is cleared', () => {
    const sweep = actuator.slice(actuator.indexOf('private async _sweepIdleSandboxes'), actuator.indexOf('_sweepOrphanSandboxes().catch'));
    expect(sweep).toContain('this._sandboxStartedAt.delete(workspaceId);');
  });

  it('and the reader still says "not measured" rather than zero when there is no clock', () => {
    // Null and 0 are different facts: one is ignorance, the other is a claim that no time passed.
    const reader = actuator.slice(actuator.indexOf('sandboxHeldSeconds(workspaceId: string): number | null'));
    expect(reader.slice(0, 200)).toContain('if (!started) return null;');
  });
});

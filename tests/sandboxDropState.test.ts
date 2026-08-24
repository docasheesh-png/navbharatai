import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ⚠️ AN INTERACTION BUG BETWEEN TWO SAME-DAY CHANGES, found by auditing them against each other rather
 * than by waiting for a report (2026-08-24).
 *
 * #2643 made `getSandbox` re-stamp `_sandboxStartedAt` on the warm path, because a resumed sandbox was
 * billing ZERO. It re-stamps only when the map has NO entry — correct, so a running sandbox keeps its
 * original clock. #2648 then added `_sandboxOrigin` beside it, on the same lifecycle.
 *
 * But THREE separate sites drop a dead or degraded sandbox so the next `getSandbox` builds a fresh
 * one, and every one of them deleted from `this.sandboxes` ALONE. So a replacement machine inherited
 * the DEAD one's start time, and `sandboxHeldSeconds` counted minutes on a VM that no longer existed.
 *
 * The user's bill was protected by an unrelated cap — a build is never charged more sandbox time than
 * its own duration — so this was not an overcharge. The ADMIN's cost figure is uncapped by design, and
 * it is the number the whole E2B analysis is built on. A cost investigation reading inflated seconds
 * is worse than one reading none.
 *
 * The fix is the CLASS: this state lives in several maps, so any site that forgets one is a silent
 * drift. One function to drop a sandbox means one place to keep correct.
 */
const src = readFileSync(
  join(__dirname, '..', 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

describe('dropping a sandbox drops everything derived from it', () => {
  it('clears the billing clock and the origin, not just the reference', () => {
    const at = src.indexOf('private _dropSandbox(workspaceId: string): void {');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).toContain('this.sandboxes.delete(workspaceId);');
    expect(body).toContain('this._sandboxStartedAt.delete(workspaceId);');
    expect(body).toContain('this._sandboxOrigin.delete(workspaceId);');
  });

  it('does NOT clear the file cache — that replay is what saves the build', () => {
    // A fresh sandbox comes back empty, and the cached source files are replayed into it. Dropping
    // them here would turn a recoverable dead sandbox into lost work, which is a far worse bug than
    // the one being fixed. Only the sweeps clear it, and only for a workspace going idle.
    const at = src.indexOf('private _dropSandbox(workspaceId: string): void {');
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).not.toContain('_fileCache');
  });

  it('every site that drops a sandbox goes through it', () => {
    // The regression this guards is a FOURTH drop site added later that deletes from the map directly
    // and silently reintroduces the drift. `sandboxes.delete` should now appear only inside the helper.
    const direct = src.match(/this\.sandboxes\.delete\(/g) ?? [];
    expect(direct).toHaveLength(1);
  });

  it('the re-stamp is still guarded, so a LIVE sandbox keeps its original clock', () => {
    // The other half of the same invariant: dropping must clear, and getSandbox must not overwrite.
    // Together they mean the clock always describes the machine currently in hand.
    expect(src.split('if (!this._sandboxStartedAt.has(workspaceId)) this._sandboxStartedAt.set(workspaceId, Date.now());').length - 1).toBe(2);
  });

  it('pauseSandbox iterates a COPY while dropping from the map', () => {
    // It now mutates inside the loop through the helper. Iterating a Map while deleting from it is the
    // classic way to skip an entry, and here a skipped entry is a sandbox whose clock never resets.
    expect(src).toContain('for (const [wid, sb] of [...this.sandboxes]) {');
  });
});

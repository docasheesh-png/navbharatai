import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  shouldMarkPausedAfterFailure,
  PAUSE_ATTEMPTS_BEFORE_GIVING_UP,
  sandboxesToReap,
} from '../src/server/AgentV3/sandboxReaper';

/**
 * THE BUG (found 2026-08-24, reading the sweeps against the E2B bill). Both sweeps asked E2B to pause a
 * sandbox and then wrote the durable `pausedAt` flag regardless of the answer. That flag is the orphan
 * reaper's off switch. So a pause that failed against a machine which was still running produced a VM
 * that nothing could ever stop again — invisible to the in-memory sweep (its reference was kept but its
 * activity stamp deleted) and invisible to the reaper (its record said "already paused"). It billed
 * until E2B's own 60-minute lifetime, and the logs recorded a success.
 *
 * That is the shape of the month's unexplained number: an average billed life near an hour, on a service
 * whose idle window is five minutes and whose orphan window is twenty.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('a pause we could not confirm is a retry, not a success', () => {
  it('does not retire the record on the first failure — that is the expensive mistake', () => {
    expect(shouldMarkPausedAfterFailure(1)).toBe(false);
    expect(shouldMarkPausedAfterFailure(2)).toBe(false);
  });

  it('gives up once retrying has stopped being worth it', () => {
    expect(shouldMarkPausedAfterFailure(PAUSE_ATTEMPTS_BEFORE_GIVING_UP)).toBe(true);
    expect(shouldMarkPausedAfterFailure(PAUSE_ATTEMPTS_BEFORE_GIVING_UP + 10)).toBe(true);
  });

  it('an unreadable count keeps trying — it must never resolve to "done"', () => {
    // Same direction as every other unknown in this file: the cheap side of the trade. Being wrong
    // costs one API call per sweep; the other way costs an hour of compute nobody is watching.
    expect(shouldMarkPausedAfterFailure(NaN)).toBe(false);
    expect(shouldMarkPausedAfterFailure(undefined as unknown as number)).toBe(false);
  });

  it('the flag really is the reaper\'s off switch — the premise of the whole fix', () => {
    // If this stopped being true, marking early would be harmless and this test should be deleted
    // rather than quietly kept. Asserted so whoever changes sandboxesToReap sees the dependency.
    const now = 10_000_000;
    const stale = { workspaceId: 'w', sandboxId: 's', updatedAt: now - 60 * 60_000 };
    expect(sandboxesToReap([stale], now)).toHaveLength(1);
    expect(sandboxesToReap([{ ...stale, pausedAt: now - 30 * 60_000 }], now)).toHaveLength(0);
  });
});

describe('both sweeps are wired to the answer', () => {
  const src = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');

  it('the idle sweep captures the result instead of swallowing it', () => {
    // The original was `await this.pauseSandbox(...).catch(() => {})` — a void. There is no way to
    // honour a boolean you never took.
    expect(src).toContain('const paused = await this.pauseSandbox(sandbox.sandboxId).catch(() => false);');
    expect(src).toContain('if (paused) await sandboxStore.markPaused(workspaceId).catch(() => {});');
  });

  it('the orphan sweep marks only on success or after enough failures', () => {
    expect(src).toContain('} else if (shouldMarkPausedAfterFailure(this._notePauseFailure(rec.workspaceId))) {');
    // And a confirmed pause clears the counter, so a workspace that fails twice and then succeeds does
    // not carry its history into the next time it is swept.
    expect(src).toContain('this._pauseFailures.delete(rec.workspaceId);');
  });

  it('no markPaused call remains outside a success or give-up branch', () => {
    // The regression this guards is a THIRD call site added later that stamps unconditionally, which
    // would reopen the hole without touching either line asserted above.
    const calls = src.match(/markPaused\(/g) ?? [];
    expect(calls).toHaveLength(3); // idle (on success), orphan (on success), orphan (after giving up)
  });

  it('pauseSandbox lets go of the reference whatever happened', () => {
    // The dropped reference is what makes the failure path RECOVERABLE: getSandbox then reconnects by
    // durable id, which auto-resumes. Keeping an unconfirmed handle was the one outcome with no way
    // back — every later build would return it warm and every command against it would fail.
    const at = src.indexOf('async pauseSandbox(');
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).toContain('} finally {');
    const fin = body.slice(body.indexOf('} finally {'));
    // REPOINTED (same day): the drop now goes through `_dropSandbox`, which also clears the billing
    // clock and the origin — see sandboxDropState.test.ts. The guarantee asserted here is unchanged
    // and stronger: the reference is let go whatever happened, and nothing derived from it survives.
    expect(fin).toContain('this._dropSandbox(wid);');
  });
});

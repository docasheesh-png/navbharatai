/**
 * REPORT cc8c9075 (2026-09-17) — the guard asked for the identical thing that had just failed.
 *
 * `src/App.tsx` was cut off mid-`content` at **exactly 9,833 output tokens**, the whole authorised
 * ceiling. The guard replied *"rewrite each listed file COMPLETELY … write ONE file per response if a
 * file is large"* — advice the model was ALREADY following, since it was writing one file, and that
 * one file does not fit. Identical request, identical bound, identical failure: **two calls, 158
 * seconds each — 5.3 minutes of a 13-minute build.** Then the user stopped it.
 *
 * A second attempt under a fixed ceiling cannot succeed by trying harder. It succeeds by writing less.
 */
import { describe, it, expect } from 'vitest';
import { truncationRecoverySteer, truncationSteeredPaths } from '../src/server/AgentV3/TruncationRecovery';

describe('a SECOND cut-off on the same file gets different advice', () => {
  const first = { truncatedToolPaths: ['src/App.tsx'] };

  it('the first cut-off is unchanged — rewrite it whole', () => {
    const steer = truncationRecoverySteer(first)!;
    expect(steer).toMatch(/\[TRUNCATION GUARD\]/);
    expect(steer).toMatch(/Rewrite each listed file COMPLETELY/);
  });

  it('THE SECOND stops asking for the thing that just failed', () => {
    const steer = truncationRecoverySteer({ ...first, previouslyTruncatedPaths: ['src/App.tsx'] })!;
    expect(steer).toMatch(/SECOND CUT-OFF/);
    expect(steer, 'repeating the first advice is a guaranteed third failure')
      .not.toMatch(/Rewrite each listed file COMPLETELY/);
    // The only strategy that fits under a fixed ceiling: a smaller working file now, the rest later.
    expect(steer).toMatch(/SMALLER but WORKING first version/);
    expect(steer).toMatch(/edit_file/);
    expect(steer).toMatch(/do NOT try it a third time/);
    expect(steer).toContain('src/App.tsx');
  });

  it('a DIFFERENT file cut off after one is still a first attempt', () => {
    const steer = truncationRecoverySteer({
      truncatedToolPaths: ['src/Home.tsx'], previouslyTruncatedPaths: ['src/App.tsx'],
    })!;
    expect(steer).toMatch(/Rewrite each listed file COMPLETELY/);
    expect(steer).not.toMatch(/SECOND CUT-OFF/);
  });

  it('nothing lost still means no steer at all', () => {
    expect(truncationRecoverySteer({ previouslyTruncatedPaths: ['src/App.tsx'] })).toBeNull();
  });

  it('the caller can collect exactly the paths a steer named, for the next turn', () => {
    expect(truncationSteeredPaths({
      brokenJs: [{ path: 'a.ts', message: 'x', line: 1 } as never],
      textMarkerPaths: ['b.css'], truncatedToolPaths: ['c.tsx'],
    })).toEqual(['a.ts', 'b.css', 'c.tsx']);
  });

  it('the runner really remembers across turns — a per-turn set would never see a second time', () => {
    const src = require('fs').readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    expect(src).toMatch(/private readonly _truncationSteered = new Set<string>\(\)/);
    expect(src).toMatch(/previouslyTruncatedPaths: \[\.\.\.this\._truncationSteered\]/);
    expect(src).toMatch(/for \(const p of truncationSteeredPaths\(steerInput\)\) this\._truncationSteered\.add\(p\)/);
  });
});

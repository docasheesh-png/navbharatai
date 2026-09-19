/**
 * THE REPORT SAID NOTHING WAS WRITTEN, OVER A BUILD THAT WROTE FOUR TYPESCRIPT FILES
 * (autopsy 3ce8459b, 2026-09-19).
 *
 * `WRITE_TIME_TYPECHECK` read: *"no TypeScript source was written this build (0 write(s) skipped as
 * not TypeScript)"*. In the same report, a sub-agent's own `edit_file` result carries
 * *"⛔ TYPECHECK after this write: 1 error(s) in src/useVideoGenerator.ts … TS2367"* — so the check
 * ran, caught a real error, and the model fixed it. **Both counters at zero is the tell**: that stats
 * object was never touched, not that nothing happened.
 *
 * WHY: the Architect delegates all app code to sub-agents by design, and each sub-agent gets its OWN
 * `ToolDispatcher` with its own fresh stats. The report reads the ARCHITECT's.
 *
 * 🔴 AND THIS IS THE FOURTH TIME THE CHILD DISPATCHER HAS MISSED SOMETHING THE PARENT HAD —
 * `onFileWrite`, `framework` and `onCommand` came before it. `subAgentGetsTheWholeWiring.test.ts` was
 * written after the third and compares the child call's ARGUMENT COUNT against the constructor's real
 * arity. This state is an INSTANCE FIELD, not a constructor parameter, so it was invisible to that
 * guard by construction. **Per-build accounting is the door the arity test does not watch, and this
 * suite is the one that watches it.**
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { emptyWriteTypecheckStats, writeTypecheckSummary } from '../src/server/AgentV3/writeTimeTypecheck';

const root = join(__dirname, '..');
const dispatcher = readFileSync(join(root, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
const subAgent = readFileSync(join(root, 'src/server/AgentV3/SubAgent.ts'), 'utf8');
const route = readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8');

describe('the architect cannot see what it delegated', () => {
  it('shares ONE stats object by reference, so a child increment lands in the parent', () => {
    // The mechanism, exercised rather than described: `shareWriteTypecheckStats` must REPLACE the
    // reference. A copy would count nothing, which is the bug.
    expect(dispatcher).toContain('shareWriteTypecheckStats(stats: WriteTypecheckStats): void {');
    expect(dispatcher).toContain('this._writeTypecheckStats = stats;');
    // And the live object must be reachable — `writeTypecheckStats()` returns a COPY on purpose, so a
    // second accessor is required and must not be "simplified" into the copy one.
    expect(dispatcher).toContain('sharedWriteTypecheckStats(): WriteTypecheckStats {');
    expect(dispatcher).toContain('return this._writeTypecheckStats;');
    // A readonly field cannot be replaced; if it is ever restored, sharing silently stops working.
    expect(dispatcher).not.toContain('private readonly _writeTypecheckStats');
  });

  it('the sub-agent adopts the parent object at spawn', () => {
    expect(subAgent).toContain('const shared = deps.writeTypecheckStats?.();');
    expect(subAgent).toContain('if (shared) childDispatcher.shareWriteTypecheckStats(shared);');
  });

  it('🔒 the dep is a THUNK, because the parent dispatcher does not exist when the spawn is built', () => {
    // A value here would capture `undefined` and share nothing — the feature would look present and
    // count nothing, which is exactly the failure being fixed. Same reasoning as `ignoreRules`.
    expect(subAgent).toMatch(/writeTypecheckStats\?: \(\) =>/);
    expect(route).toContain('writeTypecheckStats: () => dispatcherForSubAgents?.sharedWriteTypecheckStats(),');
  });

  it('the route actually assigns the holder — a thunk over nothing is the same bug again', () => {
    expect(route).toContain('dispatcherForSubAgents = dispatcher;');
    // And it must be assigned AFTER the dispatcher exists but BEFORE the build runs.
    const decl = route.indexOf('let dispatcherForSubAgents: ToolDispatcher | undefined;');
    const made = route.indexOf('const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent');
    const set = route.indexOf('dispatcherForSubAgents = dispatcher;');
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(made);
    expect(set).toBeGreaterThan(made);
  });

  it('absent means today\'s behaviour exactly — a child keeps its own object', () => {
    // Every field on SubAgentDeps is optional by that file's own rule; this one must not break it.
    expect(subAgent).toContain('writeTypecheckStats?:');
  });

  it('the wording that lied is only reachable when nothing really ran', () => {
    // The summary itself was honest about what it was told; it was told nothing. Pin the three cases
    // so a future edit cannot make "never ran" the message for a build that did run.
    const off = writeTypecheckSummary(emptyWriteTypecheckStats(), false);
    expect(off).toContain('OFF');

    const nothingWritten = writeTypecheckSummary(emptyWriteTypecheckStats(), true);
    expect(nothingWritten).toContain('no TypeScript source was written');

    const ran = writeTypecheckSummary(
      { ...emptyWriteTypecheckStats(), runs: 3, cleanRuns: 2, ownErrorsSurfaced: 1, elapsedMs: 4500 },
      true,
    );
    expect(ran).toContain('3 run(s)');
    expect(ran).toContain('1 error(s) quoted back');
    expect(ran).not.toContain('no TypeScript source was written');
  });
});

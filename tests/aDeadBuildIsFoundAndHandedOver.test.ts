// A DEAD BUILD IS FOUND WITHOUT WAITING FOR THE NEXT ONE, AND THE NEXT ONE IS TOLD WHAT IT DID (Q-3463, Q-3470).
//
// failedbr #2523: heartbeats stopped at minute 2 and nothing noticed for 922 s, until the user started another build
// (orphanedBuildReport.ts settled only on admission). failedbr #2525: that next build spent 8 reads (40 s,
// EXPLORATION_WITHOUT_CHANGE) learning what the dead one had done — all of it already in the dead build's saved report.
// Class (both): the durable report + the lapsed lease are proof enough, and nothing read them. The fixture is #2525's
// own saved report (it died too), trimmed to the issues and commands this code reads.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABANDONED_AFTER_MS, isAbandonedReport, settleOrphanedReport, BUILD_ENDED_UNRECORDED_CODE } from '../src/server/AgentV3/orphanedBuildReport';
import { buildEndedUnrecorded, deadBuildHandoff, deadBuildLastTypecheck, deadBuildWrites, DEAD_BUILD_HANDOFF_MAX_AGE_MS } from '../src/server/AgentV3/deadBuildHandoff';

type Fixture = { startedAt: number; endedAt?: number; ok?: boolean; issues: Array<{ ts: number; code: string; message: string; detail?: string }>; commands: Array<{ ts: number; command: string; stdout: string; typecheckProof?: unknown }> };
const settled: Fixture = JSON.parse(readFileSync('tests/fixtures/failedbr2525-dead-build-report.json', 'utf8'));
/** The report as it was stored while the build was still "running": no end, no settle issue. */
const asStored = (): Fixture => ({ ...settled, endedAt: undefined, ok: undefined, issues: settled.issues.filter((i) => i.code !== BUILD_ENDED_UNRECORDED_CODE) });
const lastSign = (r: Fixture) => Math.max(...r.issues.map((i) => i.ts));

describe('Q-3463: a dead build is settled once its heartbeat stopped and its lease lapsed', () => {
  const r = asStored();
  const dead = lastSign(r);

  it('silent for two heartbeat intervals and the lease lapsed ⇒ abandoned', () => {
    expect(isAbandonedReport(r, dead + ABANDONED_AFTER_MS + 1, false)).toBe(true);
  });
  it('a lease that cannot be read (null) or is live never settles a report', () => {
    expect(isAbandonedReport(r, dead + 60 * 60_000, null)).toBe(false);
    expect(isAbandonedReport(r, dead + 60 * 60_000, true)).toBe(false);
  });
  it('a report that recorded something within two intervals is not abandoned', () => {
    expect(isAbandonedReport(r, dead + ABANDONED_AFTER_MS - 1, false)).toBe(false);
  });
  it('an ended report is never re-settled', () => {
    expect(isAbandonedReport(settled, dead + 60 * 60_000, false)).toBe(false);
  });
  it('the sweep says it found the build, not that a next build did', () => {
    const out = settleOrphanedReport(r, { newBuildStartedAt: dead + 150_000, foundBy: 'sweep' }) as Fixture & { summary: string };
    expect(out.endedAt).toBe(dead);
    expect(out.summary).toContain("found by the platform's liveness check 150 s later");
    expect(out.summary).not.toContain('next build');
  });
  it('the admission wording is unchanged', () => {
    const out = settleOrphanedReport(r, { newBuildStartedAt: dead + 922_000 }) as Fixture & { summary: string };
    expect(out.summary).toContain('It was found when the next build for this app started, 922 s later.');
  });
  it('wired: the sweep is scheduled, the status poll settles, and the collection-group index ships', () => {
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/id: 'abandoned-build-reports', exclusive: true/);
    expect(server).toContain('sweepAbandonedBuildReports()');
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('settleAbandonedReportsOnStatus(workspaceId, leaseLive);');
    const idx = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as { fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; indexes: Array<{ queryScope: string }> }> };
    const o = idx.fieldOverrides.find((f) => f.collectionGroup === 'history' && f.fieldPath === 'inProgress');
    expect(o?.indexes.map((i) => i.queryScope)).toEqual(expect.arrayContaining(['COLLECTION', 'COLLECTION_GROUP']));
  });
});

describe('Q-3470: the next build is handed the dead build\'s writes and last typecheck', () => {
  it('failedbr #2525: the writes, in order, each once', () => {
    expect(deadBuildWrites(settled)).toEqual(['src/game/gameRules.ts', 'src/game/setup.ts', 'src/game/fps.ts', 'src/App.tsx']);
  });
  it('failedbr #2525: its last typecheck is the last tsc command it ran', () => {
    const tsc = deadBuildLastTypecheck(settled)!;
    expect(tsc).not.toBeNull();
    expect(tsc.ts).toBe(settled.commands[settled.commands.length - 1].ts);
  });
  it('the hand-off names every file and the errors, and tells the builder not to re-read to rediscover them', () => {
    const block = deadBuildHandoff(settled, { nowMs: settled.startedAt + 49_408_000 });
    expect(block).toContain('WAS CUT OFF');
    for (const f of ['src/game/gameRules.ts', 'src/game/setup.ts', 'src/game/fps.ts', 'src/App.tsx']) expect(block).toContain(f);
    expect(block).toMatch(/do not re-read the project/);
    const errs = deadBuildLastTypecheck(settled)!.stdout.split('\n').filter((l) => /error TS\d+/.test(l));
    if (errs.length) expect(block).toContain(errs[0].trim().slice(0, 80));
  });
  it('a report still marked running (not yet settled) is handed over too', () => {
    expect(buildEndedUnrecorded(asStored())).toBe(true);
    expect(deadBuildHandoff(asStored(), { nowMs: settled.startedAt + 1_000_000 })).toContain('WAS CUT OFF');
  });
  it('a build that ended on its own, or one older than a day, hands nothing over', () => {
    const finished = { ...asStored(), endedAt: settled.startedAt + 100_000, ok: true };
    expect(deadBuildHandoff(finished, { nowMs: settled.startedAt + 200_000 })).toBe('');
    expect(deadBuildHandoff(settled, { nowMs: settled.startedAt + DEAD_BUILD_HANDOFF_MAX_AGE_MS + 1 })).toBe('');
  });
  it('wired: the route hands it over before the conversation recap', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = route.indexOf('loadDeadBuildHandoff(workspaceId, buildStartedAt)');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(route.indexOf("promptSteps.step('conversation recap'"));
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  handoverSample, tallyHandover, projectHandover, handoverHeadline, sandboxUsdPerHour,
  type HandoverInput,
} from '../src/server/AgentV3/sandboxHandover';

/**
 * PHASE 0 of IN_BROWSER_PREVIEW_PLAN.md.
 *
 * The plan opens by correcting my own framing — "the in-browser preview will kill most of the E2B bill"
 * does not survive the arithmetic in CLAUDE.md, because AGENTV3_SANDBOX_IDLE_MINUTES is already 15 and
 * caps total idle at ~$26/month. That correction came from arithmetic on a monthly total. This module
 * replaces it with a per-build measurement, because this project has now twice acted on a remembered
 * number instead of a read one.
 *
 * The tests below exist mostly to protect ONE property: an unmeasurable build must never be counted as
 * a zero-length hold. That single silent default would turn a measurement into a flattering estimate,
 * and the whole point of measuring first is to be able to hear "do not build Phase 3".
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

/** A build that ran 10 minutes and whose sandbox was paused 15 minutes later. Frontend-only. */
const clean: HandoverInput = {
  workspaceId: 'ws-1',
  startedAt: T0,
  endedAt: T0 + 10 * MIN,
  paths: ['src/App.tsx', 'src/main.tsx', 'package.json'],
  sandboxUpdatedAt: T0 + 10 * MIN,
  sandboxPausedAt: T0 + 25 * MIN,
};

describe('measuring one build', () => {
  it('splits the billed life into build work and post-build holding', () => {
    const s = handoverSample(clean);
    expect(s).toMatchObject({ known: true, buildMs: 10 * MIN, heldAfterMs: 15 * MIN, frontendOnly: true });
  });

  it('an app that wrote server code is NOT reclaimable', () => {
    // The distinction the whole plan turns on: a sandbox answering the app's own API calls cannot be
    // handed to a browser, however long it was held.
    const s = handoverSample({ ...clean, paths: ['server/index.js', 'src/App.tsx'] });
    expect(s).toMatchObject({ known: true, frontendOnly: false });
  });

  it('`src/api/…` is a fetch helper, not a server', () => {
    // Reuses serverNecessity's rule rather than a second opinion about what a server is — two
    // definitions of "has a backend" is how two measurements start disagreeing about one build.
    expect(handoverSample({ ...clean, paths: ['src/api/client.ts'] })).toMatchObject({ frontendOnly: true });
  });
});

describe('UNKNOWN is an answer, never a zero', () => {
  /**
   * Every case here would produce a plausible-looking number if it silently defaulted to 0, and every
   * one of those numbers would make Phase 3 look less worthwhile than it is — or more. Both directions
   * are wrong; the honest output is "excluded".
   */
  it('no settled build window', () => {
    expect(handoverSample({ ...clean, endedAt: undefined })).toEqual({ known: false, why: 'no-build-window' });
    expect(handoverSample({ ...clean, startedAt: 0 })).toEqual({ known: false, why: 'no-build-window' });
  });

  it('an end BEFORE the start is refused rather than measured as negative work', () => {
    expect(handoverSample({ ...clean, endedAt: T0 - MIN })).toEqual({ known: false, why: 'no-build-window' });
  });

  it('no durable sandbox record (warm resume off, or the record was cleared)', () => {
    expect(handoverSample({ ...clean, sandboxUpdatedAt: undefined })).toEqual({ known: false, why: 'no-sandbox-record' });
  });

  it('never paused — the hold is real but we cannot see how long it was', () => {
    // The process died, or E2B's own lifetime expired. This is the case that most tempts a zero.
    expect(handoverSample({ ...clean, sandboxPausedAt: undefined })).toEqual({ known: false, why: 'never-paused' });
  });

  it('a pause stamped BEFORE the build ended describes an earlier sandbox, not this build', () => {
    // The record is per-workspace and last-write-wins, so an older pairing is normal. Treating it as a
    // zero-length hold would drag the average down with data about something else entirely.
    expect(handoverSample({ ...clean, sandboxPausedAt: T0 + 5 * MIN })).toEqual({ known: false, why: 'stale-pairing' });
  });

  it('the build window is checked FIRST, so the reader is pointed at the real missing thing', () => {
    // A build that never settled AND has no sandbox record is reported as the former: telling someone
    // "no sandbox record" about a build that never finished sends them looking in the wrong place.
    expect(handoverSample({ workspaceId: 'x' })).toEqual({ known: false, why: 'no-build-window' });
  });
});

describe('the tally', () => {
  const rows: HandoverInput[] = [
    clean,                                                        // 10m build, 15m held, frontend
    { ...clean, workspaceId: 'ws-2', paths: ['server/app.js'] },   // 10m build, 15m held, HAS a server
    { ...clean, workspaceId: 'ws-3', sandboxPausedAt: undefined }, // unmeasurable
    { ...clean, workspaceId: 'ws-4', endedAt: undefined },         // unmeasurable
  ];

  it('counts only what it could measure, and says what it could not', () => {
    const t = tallyHandover(rows);
    expect(t.examined).toBe(4);
    expect(t.measured).toBe(2);
    expect(t.unknown['never-paused']).toBe(1);
    expect(t.unknown['no-build-window']).toBe(1);
  });

  it('recoverable hours EXCLUDE the app that has a server', () => {
    const t = tallyHandover(rows);
    expect(t.heldAfterHours).toBe(0.5);      // two builds × 15 minutes
    expect(t.recoverableHours).toBe(0.25);   // only the frontend-only one
    expect(t.frontendOnlyCount).toBe(1);
  });

  it('build work is totalled separately from holding', () => {
    expect(tallyHandover(rows).buildHours).toBeCloseTo(0.33, 2);
  });

  it('an empty set measures nothing and claims nothing', () => {
    const t = tallyHandover([]);
    expect(t.examined).toBe(0);
    expect(t.measured).toBe(0);
    expect(t.recoverableHours).toBe(0);
  });
});

describe('the extrapolation is kept apart from the measurement', () => {
  it('one build produces NO rate — a single point spans no time', () => {
    // Dividing by a zero span would emit an enormous confident number from one data point.
    expect(projectHandover(tallyHandover([clean]))).toEqual({ spanDays: 0, recoverableHoursPerDay: 0, monthlyUsdEstimate: 0 });
  });

  it('a real span produces a rate and a 30-day figure', () => {
    const day2 = { ...clean, workspaceId: 'ws-b', startedAt: T0 + 24 * HOUR, endedAt: T0 + 24 * HOUR + 10 * MIN, sandboxUpdatedAt: T0 + 24 * HOUR + 10 * MIN, sandboxPausedAt: T0 + 24 * HOUR + 25 * MIN };
    const p = projectHandover(tallyHandover([clean, day2]));
    expect(p.spanDays).toBe(1);
    expect(p.recoverableHoursPerDay).toBe(0.5);       // 2 × 15 minutes over one day
    expect(p.monthlyUsdEstimate).toBeCloseTo(0.5 * 30 * 0.083, 2);
  });

  it('the rate is the MEASURED one, and stays env-tunable', () => {
    // $0.083 is derived in CLAUDE.md from the admin's own dashboard, not invented. A hardcoded price
    // is a future lie, so the env wins.
    expect(sandboxUsdPerHour({} as NodeJS.ProcessEnv)).toBe(0.083);
    expect(sandboxUsdPerHour({ E2B_USD_PER_HOUR: '0.26' } as unknown as NodeJS.ProcessEnv)).toBe(0.26);
    expect(sandboxUsdPerHour({ E2B_USD_PER_HOUR: 'free' } as unknown as NodeJS.ProcessEnv)).toBe(0.083);
  });
});

describe('the headline tells the truth even when the truth is "do not build this"', () => {
  it('states the post-build share of billed life', () => {
    const h = handoverHeadline(tallyHandover([clean]));
    expect(h).toContain('post-build holding is 60% of billed sandbox life');
    expect(h).toContain('0.25h of that belongs to frontend-only apps');
  });

  it('names the excluded builds instead of quietly dropping them', () => {
    const h = handoverHeadline(tallyHandover([clean, { ...clean, workspaceId: 'ws-z', sandboxPausedAt: undefined }]));
    expect(h).toContain('1 of 2 builds could not be measured and are excluded, never counted as zero');
  });

  it('says plainly when nothing could be measured', () => {
    const h = handoverHeadline(tallyHandover([{ workspaceId: 'a' }]));
    expect(h).toContain('No builds could be measured yet (1 looked at)');
  });

  it('labels the monthly figure as an extrapolation, right where it is stated', () => {
    const day2 = { ...clean, workspaceId: 'ws-b', startedAt: T0 + 24 * HOUR, endedAt: T0 + 24 * HOUR + 10 * MIN, sandboxUpdatedAt: T0 + 24 * HOUR + 10 * MIN, sandboxPausedAt: T0 + 24 * HOUR + 25 * MIN };
    expect(handoverHeadline(tallyHandover([clean, day2]))).toMatch(/an EXTRAPOLATION from this window, not a bill/);
  });
});

describe('the wiring', () => {
  const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');

  it('ONE reader carries prompt, paths AND the build window', () => {
    /**
     * `listPromptsAndPaths` was renamed to `listBuildFacts` and given the window, rather than a third
     * near-identical projection being added beside it. Two readers over the same documents is how two
     * measurements quietly start disagreeing about the same builds.
     */
    expect(store).toContain('export async function listBuildFacts');
    expect(store).not.toContain('export async function listPromptsAndPaths');
    expect(store).toContain('startedAt: typeof r.startedAt === \'number\'');
  });

  it('the endpoint joins the two records that already exist', () => {
    const at = route.indexOf("app.get('/api/admin/sandbox-handover'");
    expect(at).toBeGreaterThan(0);
    const fn = route.slice(at, at + 2500);
    expect(fn).toContain('listBuildFacts(limit)');
    expect(fn).toContain('sandboxStore.listRecent(limit)');
    expect(fn).toContain('byWorkspace.get(b.workspaceId)');
  });

  it('it is admin-gated and read-only', () => {
    const at = route.indexOf("app.get('/api/admin/sandbox-handover'");
    expect(route.slice(at, at + 120)).toContain('verifyAdminToken');
    // A measurement that can change what it measures is not a measurement.
    expect(route.slice(at, at + 2500)).not.toMatch(/\b(set|delete|update|markPaused|record)\(/);
  });

  it('the durable read is bounded and cannot need a composite index', () => {
    const sb = readFileSync(join(process.cwd(), 'src/server/AgentV3/SandboxStore.ts'), 'utf8');
    const at = sb.indexOf('async listRecent(');
    expect(at).toBeGreaterThan(0);
    const fn = sb.slice(at, at + 700);
    expect(fn).toContain("orderBy('updatedAt', 'desc')");   // same single field listStale orders by
    expect(fn).toContain('Math.min(500, limit)');
    expect(fn).not.toContain('.where(');                     // orderBy alone → no composite index
  });
});

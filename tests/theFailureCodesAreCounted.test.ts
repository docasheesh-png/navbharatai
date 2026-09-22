import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildLane, countedDocId, cureFamily, cureSplit, outcomeDayKey, summariseBuildOutcomes,
  MOBILE_BUILD_COUNTED_COLLECTION, MOBILE_BUILD_OUTCOME_COLLECTION,
  type DailyBuildOutcomes,
} from '../src/server/lib/mobileBuildOutcomeStore';
import { RETENTION_POLICIES } from '../src/server/lib/DataRetentionManager';
import { SHIP_WORKFLOWS } from '../src/lib/shipWorkflows';

/**
 * STEP 0 OF "MAKE THE PHONE BUILD AS RELIABLE AS CLAUDE'S" (admin 2026-09-22: *"user jab apni app ka
 * APK banata hai to 80% baar fail hoti hai"*).
 *
 * 🔴 THE IRONY THAT STARTED THIS: the server already classifies every real failure and already writes
 * the class down — `setOutcome(uid, owner, repo, 'failure', diag.code)` — and `failureCode` appears in
 * this repository at exactly four places, **all four inside `AppBuildStore.ts` itself**: the field, its
 * comment, the parameter, the write. Nothing has ever read it. The one number that could answer "why do
 * they fail?" was being produced on every real build and thrown away.
 *
 * 🔑 AND THAT RECORD COULD NOT HAVE ANSWERED IT ANYWAY. `setOutcome` holds the LATEST outcome for one
 * (user, owner, repo), and a SUCCESS explicitly clears the previous failure's code — so an app that
 * failed nine times and then worked contributes ZERO failures to any scan of those rows. A biased sample
 * reads as an absence of the problem, which is worse than no measurement because nobody doubts it.
 *
 * These cases lock the counter that replaces it, and the honesty it is required to keep.
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Comments carry the code names while EXPLAINING them; a source pin must not match its own docs. */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('every failure class the classifier can emit is deliberately filed', () => {
  /** Read out of the real classifier, so this can never drift from what production can produce. */
  const emitted = (): string[] => {
    const src = read('src/server/lib/mobileBuildRepair.ts');
    const found = [...src.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]);
    return [...new Set(found)].sort();
  };

  /**
   * 🔒 THE RATCHET. A 22nd class must not quietly inherit `repairable` and become the biggest number on
   * the admin's card without anyone deciding that it IS repairable. Adding a code to the classifier
   * fails here until it is added to this list — which is the moment somebody has to answer the question.
   */
  const KNOWN = [
    'ANDROID_PLATFORM_MISSING', 'ANDROID_RESOURCE_LINKING', 'APP_CODE_BUILD_FAILED',
    'BUILD_SCRIPT_MISSING', 'GOOGLE_SERVICES_MISSING', 'GRADLEW_NOT_EXECUTABLE',
    'JAVA_VERSION_TOO_OLD', 'MISSING_SIGNING_SECRET', 'NODE_OUT_OF_MEMORY', 'NPM_CI_NO_LOCK',
    'NPM_LOCK_CACHE', 'NPM_PACKAGE_NOT_FOUND', 'NPM_PEER_CONFLICT', 'NPM_REGISTRY_AUTH',
    'NPM_VERSION_NOT_FOUND', 'SDK_LICENSE_NOT_ACCEPTED', 'SIGNING_CREDENTIALS_WRONG',
    'STALE_WORKFLOW', 'TYPE_GATE_BLOCKED_PACKAGING', 'UNKNOWN', 'WEB_DIR_MISSING',
  ].sort();

  it('🔴 the classifier emits exactly the classes this card knows how to file', () => {
    expect(emitted()).toEqual(KNOWN);
  });

  it('the four that NO repair loop can ever fix are named as such', () => {
    // These are the user's own credentials, not a file with a mistake in it. Spending attempts on them
    // spends somebody's time on a certainty; the cure is the button, which already exists.
    expect(cureFamily('MISSING_SIGNING_SECRET')).toBe('user-credentials');
    expect(cureFamily('SIGNING_CREDENTIALS_WRONG')).toBe('user-credentials');
    expect(cureFamily('GOOGLE_SERVICES_MISSING')).toBe('user-credentials');
    expect(cureFamily('NPM_REGISTRY_AUTH')).toBe('user-credentials');
  });

  it('a blind classifier is its own answer, never "repairable"', () => {
    // Prescribing a better repair loop for UNKNOWN would be prescribing for a diagnosis nobody made.
    expect(cureFamily('UNKNOWN')).toBe('unclassified');
    expect(cureFamily('')).toBe('unclassified');
  });

  it('the classes a loop genuinely can fix are the rest', () => {
    for (const code of ['APP_CODE_BUILD_FAILED', 'WEB_DIR_MISSING', 'JAVA_VERSION_TOO_OLD', 'NPM_PEER_CONFLICT']) {
      expect(cureFamily(code), code).toBe('repairable');
    }
  });
});

describe('the lane comes from the one workflow registry, never a second copy', () => {
  it('maps each shipped workflow, and is honest about anything else', () => {
    expect(buildLane(SHIP_WORKFLOWS.androidApk)).toBe('apk');
    expect(buildLane(SHIP_WORKFLOWS.androidAab)).toBe('aab');
    expect(buildLane(SHIP_WORKFLOWS.iosIpa)).toBe('ipa');
    expect(buildLane('something-else.yml')).toBe('other');
    expect(buildLane('')).toBe('other');
    expect(buildLane(null)).toBe('other');
  });

  it('the day key is UTC and comes from the given instant, never a hidden clock', () => {
    expect(outcomeDayKey(Date.parse('2026-09-22T23:59:59Z'))).toBe('2026-09-22');
    expect(outcomeDayKey(Date.parse('2026-09-23T00:00:01Z'))).toBe('2026-09-23');
  });
});

describe('the summary is a count of what happened, and says what it does NOT know', () => {
  const rows: DailyBuildOutcomes[] = [
    {
      day: '2026-09-22',
      outcomes: { apk: { success: 2, failure: 8, cancelled: 3 }, aab: { failure: 5 } },
      codes: { apk: { APP_CODE_BUILD_FAILED: 4, UNKNOWN: 1 }, aab: { MISSING_SIGNING_SECRET: 5 } },
    },
    {
      day: '2026-09-21',
      outcomes: { apk: { success: 3, failure: 2 } },
      codes: { apk: { APP_CODE_BUILD_FAILED: 1 } },
    },
  ];

  it('adds the days up and states the rate out of FINISHED runs', () => {
    const s = summariseBuildOutcomes(rows);
    expect(s.success).toBe(5);
    expect(s.failure).toBe(15);
    expect(s.finished).toBe(20);
    expect(s.failureRatePct).toBe(75);
  });

  it('🔒 a CANCELLED run is in neither side of the rate', () => {
    // A user who pressed Stop did not meet a broken build. Counting them would make this number move
    // with impatience rather than with reliability, which is the one thing it exists to measure.
    const s = summariseBuildOutcomes(rows);
    expect(s.cancelled).toBe(3);
    expect(s.finished).toBe(s.success + s.failure);
    // apk across both days: 2+3 success, 8+2 failure — the 3 cancelled are in neither.
    const apk = s.byLane.find((l) => l.lane === 'apk');
    expect(apk?.cancelled).toBe(3);
    expect(apk?.finished).toBe(15);
    expect(apk?.failureRatePct).toBe(66.7);
  });

  it('🔴 the DIAGNOSIS GAP is reported, because the class list is a SUBSET of the failures', () => {
    // A class is recorded when the automatic failure report lands, which needs a client still polling.
    // 15 failures, 11 classified — presenting the breakdown without the other 4 would invite reading a
    // partial tally as the whole picture, which is the mistake this whole module exists to prevent.
    const s = summariseBuildOutcomes(rows);
    expect(s.diagnosed).toBe(11);
    expect(s.diagnosisGap).toBe(4);
  });

  it('the gap is never negative — a repeat that slipped a guard must stay visible', () => {
    const s = summariseBuildOutcomes([
      { day: '2026-09-22', outcomes: { apk: { failure: 1 } }, codes: { apk: { UNKNOWN: 9 } } },
    ]);
    expect(s.diagnosisGap).toBe(0);
  });

  it('ranks the classes and shares them against the DIAGNOSED total, not the failure total', () => {
    const s = summariseBuildOutcomes(rows);
    expect(s.topCodes[0]).toMatchObject({ code: 'APP_CODE_BUILD_FAILED', count: 5 });
    expect(s.topCodes[1]).toMatchObject({ code: 'MISSING_SIGNING_SECRET', count: 5 });
    // 5 of 11 diagnosed, never 5 of 15 — a share of a number it was not measured against is a wrong number.
    expect(s.topCodes[0].sharePct).toBe(45.5);
    expect(s.topCodes.reduce((n, c) => n + c.count, 0)).toBe(s.diagnosed);
  });

  it('🔑 the cure split is what stops the biggest number being read as the wrong instruction', () => {
    // 5 of these 11 are a missing signing key. However good the repair loop becomes, those 5 do not move.
    const s = summariseBuildOutcomes(rows);
    expect(cureSplit(s)).toEqual({ repairable: 5, 'user-credentials': 5, unclassified: 1 });
  });

  it('is PURE — the same rows answer the same way, and empty is empty rather than zero-percent', () => {
    expect(summariseBuildOutcomes(rows)).toEqual(summariseBuildOutcomes(rows));
    const none = summariseBuildOutcomes([]);
    expect(none.finished).toBe(0);
    // Null, never 0: "nothing has been counted" and "nothing failed" are opposite statements.
    expect(none.failureRatePct).toBeNull();
    expect(none.byLane).toEqual([]);
  });
});

describe('the wiring: counted once per run, and never on a path that repeats', () => {
  const route = codeOnly(read('src/server/routes/mobileShip.ts'));

  it('🔴 the DENOMINATOR is keyed by the run id, because the status endpoint is POLLED', () => {
    // `setOutcome` beside it survives a repeat because it overwrites one document. An INCREMENT does
    // not: without the run id in the claim, one build being watched for two minutes would be counted
    // dozens of times and the rate this card exists for would be fiction.
    expect(route).toContain('void recordBuildOutcome(String(owner), String(repo), String(done.id), String(workflow), concl);');
  });

  it('🔴 the NUMERATOR rides the failure report\'s OWN claim, never a second guard', () => {
    // saveApkFailureReport writes with create() on a doc keyed to owner/repo/runId, so it returns true
    // exactly once per run. A second idempotency guard here would be a second thing to keep in step.
    expect(route).toContain('const claimed = await saveApkFailureReport({');
    expect(route).toContain('if (claimed) void recordBuildFailureCode(workflow, full.failure.code);');
  });

  it('the class really travels on the report now — it was computed and dropped before', () => {
    const report = codeOnly(read('src/server/lib/mobileBuildReport.ts'));
    expect(report).toContain('code: diag.code,');
  });

  it('🔒 telemetry never blocks the build the user is watching', () => {
    // Both counters are fire-and-forget. An awaited counter would put a Firestore round trip in front of
    // the status a user is refreshing, to measure a thing that does not matter to them at all.
    expect(route).toContain('void recordBuildOutcome(');
    expect(route).toContain('void recordBuildFailureCode(');
  });
});

describe('measuring the pipeline does not mean keeping a file on the people using it', () => {
  it('🔴 the per-run marker is a DIGEST — the owner login never becomes a document id', () => {
    // `owner` is a person's GitHub login, and this marker grows with every build while being keyed by
    // nothing a user owns — so `deleteUserData` could never reach it. The id was
    // `${owner}_${repo}_${runId}`. Removing the data beats promising to erase it later.
    const id = countedDocId('nagpurcity16', 'gif-bharat-alpha', '35709280304');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('nagpurcity16');
    expect(id).not.toContain('gif-bharat');
  });

  it('it is STABLE and it separates the fields, so two different runs cannot collide', () => {
    // Stability is the whole contract: a poll minutes later must find the same claim. And the parts are
    // separated, so `a_b` + `c` and `a` + `b_c` are different runs rather than one silently-merged claim.
    expect(countedDocId('o', 'r', '1')).toBe(countedDocId('o', 'r', '1'));
    expect(countedDocId('o', 'r', '1')).not.toBe(countedDocId('o', 'r', '2'));
    expect(countedDocId('a_b', 'c', '1')).not.toBe(countedDocId('a', 'b_c', '1'));
  });

  it('🔒 the stored body says what a count IS, and nothing about who ran it', () => {
    const src = codeOnly(read('src/server/lib/mobileBuildOutcomeStore.ts'));
    expect(src).toContain('.create({ lane, outcome, countedAt: atMs });');
    expect(src).not.toContain('.create({ owner, repo');
  });

  it('🔴 both collections are on a retention clock — the growing one especially', () => {
    // The day rollup is one document a day and could sit for ever without hurting anything; the MARKER
    // is one document per finished build and is exactly the shape that made `site_analytics` outlive a
    // published 30-day promise with nothing anywhere failing.
    const byName = new Map(RETENTION_POLICIES.map((p) => [p.collection, p]));
    expect(byName.get(MOBILE_BUILD_OUTCOME_COLLECTION)).toMatchObject({ timestampField: 'day', timestampKind: 'iso' });
    expect(byName.get(MOBILE_BUILD_COUNTED_COLLECTION)).toMatchObject({ timestampField: 'countedAt', timestampKind: 'epochMs' });
    // The marker's window must outlast any real poll by a wide margin: purging it early would count a
    // run a second time, which inflates the very rate this module exists to measure.
    expect(byName.get(MOBILE_BUILD_COUNTED_COLLECTION)!.ttlDays).toBeGreaterThanOrEqual(7);
  });

  it('the purge field really is the field the write stores — a wrong name deletes nothing, for ever', () => {
    // `retentionBound` compares against a named field; a policy naming a field the write never sets is a
    // silent no-op, which is the defect that made `timestampKind` a required part of a policy at all.
    const src = codeOnly(read('src/server/lib/mobileBuildOutcomeStore.ts'));
    expect(src).toContain('countedAt: atMs');
    expect(src).toContain('{ day, outcomes:');
  });
});

// AN ESTIMATE BAND REACHES ITS OWN EVIDENCE (autopsy 303e8a6f, Q-967, 2026-10-12).
//
// `estimateBuildTime` blends measured builds with a prompt-word prior and sets its band around the BLENDED
// midpoint and nothing else. With fewer than five entries the midpoint still leans on the prior, so the band could
// lie wholly outside every build it said it learned from:
//   • six template builds of ~3 min were shown as "4.6–6.1 min — how long 6 recent builds of this kind took";
//   • three of a workspace's own 10-minute builds were promised as "6.4–8.6 min — based on your last 3 builds".
// Q-536 (autopsy 68f0a486) bounded the band's WIDTH, from 5 entries only, and never its POSITION — that fix was
// incomplete. And a sparse slice taught nothing: a day with one finished build was dropped, so a quiet template
// slice was priced from the chip's wording for a whole week.
//
// The class lock is a CENSUS: every seeded starter chip × every history density × builds above and below the
// prior, for the platform's slice and for the workspace's own history. Any band that misses its evidence fails.
import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { goldenScaffoldForPrompt } from '../src/server/AgentV3/goldenScaffolds/registry';
import { estimateBuildTime, complexityFromPrompt, measuredEvidenceSpan, complexityScore, type HistoricalBuild } from '../src/server/lib/BuildTimeEstimator';
import { fleetHistoryFromTelemetry, historyFromRecords, SCAFFOLD_TASK_KEY } from '../src/server/AgentV3/etaHistory';
import { etaEvidenceNote } from '../src/server/AgentV3/etaEvidence';

const MIN = 60_000;
const CHIPS = STARTER_TEMPLATES.filter((t) => !!goldenScaffoldForPrompt(t.prompt));

/** A week of telemetry: `perDay` finished builds a day at `meanMin`, with their squared seconds recorded. */
function week(days: number, perDay: number, meanMin: number, spreadMin = 0.3) {
  return Array.from({ length: days }, (_, i) => {
    const each = Array.from({ length: perDay }, (_, k) => (meanMin + (k % 2 === 0 ? -spreadMin : spreadMin) * (perDay > 1 ? 1 : 0)) * MIN);
    const okDurationMs = each.reduce((a, b) => a + b, 0);
    const okDurationSqSec = each.reduce((a, b) => a + (b / 1000) ** 2, 0);
    return { date: `2026-10-${String(10 - i).padStart(2, '0')}`, byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: perDay, durationMs: okDurationMs, okBuilds: perDay, okDurationMs, okDurationSqSec } } };
  });
}

/** The two promises the band makes: it contains the mean of what it learned from, and at least one build. */
function expectBandReaches(est: { lowMs: number; highMs: number }, history: HistoricalBuild[], label: string) {
  const ms = history.map((h) => h.durationMs);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  expect(est.lowMs, `${label}: low ${est.lowMs} vs mean ${mean}`).toBeLessThanOrEqual(Math.round(mean) + 1);
  expect(est.highMs, `${label}: high ${est.highMs} vs mean ${mean}`).toBeGreaterThanOrEqual(Math.round(mean) - 1);
  expect(ms.some((d) => est.lowMs <= d + 1 && d - 1 <= est.highMs), `${label}: no build inside ${est.lowMs}–${est.highMs}`).toBe(true);
}

describe('1 · 🔒 census — no band misses the builds it learned from', () => {
  it('the census reads something', () => {
    expect(CHIPS.length).toBeGreaterThanOrEqual(20);
  });

  it('the platform slice: every chip × 1–7 days × 1–3 builds a day × builds far below and far above the prior', () => {
    let checked = 0;
    for (const t of CHIPS) {
      const c = complexityFromPrompt(t.prompt);
      for (let days = 1; days <= 7; days++) {
        for (const perDay of [1, 2, 3]) {
          for (const meanMin of [1.5, 3, 4, 8, 20]) {
            const f = fleetHistoryFromTelemetry(week(days, perDay, meanMin), SCAFFOLD_TASK_KEY, c);
            if (f.history.length === 0) continue;
            expectBandReaches(estimateBuildTime(c, f.history), f.history, `${t.id} ${days}d×${perDay} @${meanMin}m`);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('the workspace\'s own history: 1–6 own builds above and below the prior, and a bimodal set', () => {
    for (const t of CHIPS) {
      const c = complexityFromPrompt(t.prompt);
      for (let n = 1; n <= 6; n++) {
        for (const each of [1.2, 10, 25]) {
          const records = Array.from({ length: n }, (_, i) => ({ ok: true, startedAt: 1_000 + i, endedAt: 1_000 + i + (each + i * 0.2) * MIN }));
          const h = historyFromRecords(records as never, c);
          if (h.length === 0) continue;
          expectBandReaches(estimateBuildTime(c, h), h, `${t.id} own×${n} @${each}m`);
        }
      }
      const bimodal: HistoricalBuild[] = [2, 10, 2, 10].map((m) => ({ complexity: c, durationMs: m * MIN }));
      expectBandReaches(estimateBuildTime(c, bimodal), bimodal, `${t.id} bimodal`);
    }
  });
});

describe('2 · the report\'s real shapes', () => {
  it('the login-page chip: three days of two ~3-minute template builds — the band reaches 3 minutes (was 4.6–6.1)', () => {
    const chip = CHIPS.find((t) => t.id === 'login-page');
    expect(chip).toBeDefined();
    const c = complexityFromPrompt(chip!.prompt);
    const f = fleetHistoryFromTelemetry(week(3, 2, 3, 0.3), SCAFFOLD_TASK_KEY, c);
    expect(f.history.length).toBe(3);
    const est = estimateBuildTime(c, f.history);
    expect(est.lowMs).toBeLessThanOrEqual(3 * MIN);
    expect(est.evidenceMeanMs).toBe(3 * MIN);
  });

  it('three own builds of ~10 minutes on a todo-sized app: the band reaches 10 minutes (was 6.4–8.6)', () => {
    const c = complexityFromPrompt('make a todo app');
    const h: HistoricalBuild[] = [10, 10.4, 10].map((m) => ({ complexity: c, durationMs: m * MIN }));
    expect(estimateBuildTime(c, h).highMs).toBeGreaterThanOrEqual(10 * MIN);
  });
});

describe('3 · it never lowers an unmeasured chip, and stays in its own size class', () => {
  it('no history: every chip\'s estimate is exactly the prior (the review that removed the constant stands)', () => {
    for (const t of CHIPS) {
      const c = complexityFromPrompt(t.prompt);
      const est = estimateBuildTime(c, []);
      expect(est.historyWeight, t.id).toBe(0);
      expect(est.evidenceMeanMs, t.id).toBeUndefined();
    }
  });

  it('one distant 40-minute build of a different size does not stretch a small app\'s band', () => {
    const small = { moduleCount: 4, featureCount: 6 };
    const big = { moduleCount: 40, featureCount: 40 };
    expect(complexityScore(small)).not.toBe(complexityScore(big));
    expect(measuredEvidenceSpan([{ complexity: big, durationMs: 40 * MIN }], complexityScore(small))).toBeNull();
    expect(estimateBuildTime(small, [{ complexity: big, durationMs: 40 * MIN }]).highMs).toBeLessThan(40 * MIN);
  });
});

describe('4 · it only WIDENS — the midpoint, confidence and history weight are untouched', () => {
  it('the span never moves estimateMs, and always contains the mean and a build', () => {
    const c = complexityFromPrompt('make a todo app');
    for (const set of [[3], [3, 3.6], [1, 9], [2, 2, 2, 20]]) {
      const h: HistoricalBuild[] = set.map((m) => ({ complexity: c, durationMs: m * MIN }));
      const span = measuredEvidenceSpan(h, complexityScore(c))!;
      const mean = h.reduce((a, x) => a + x.durationMs, 0) / h.length;
      expect(span.lowMs).toBeLessThanOrEqual(mean);
      expect(span.highMs).toBeGreaterThanOrEqual(mean);
      expect(h.some((x) => span.lowMs <= x.durationMs && x.durationMs <= span.highMs)).toBe(true);
      const est = estimateBuildTime(c, h);
      // The midpoint is still exactly the history/prior blend (same-size entries weigh 1, so trust is n/5).
      const prior = estimateBuildTime(c, []).estimateMs;
      const trust = Math.min(h.length / 5, 1);
      expect(est.estimateMs).toBe(Math.round(mean * trust + prior * (1 - trust)));
      expect(est.historyWeight).toBe(Math.round(trust * 100) / 100);
    }
  });
});

describe('5 · sparse days are pooled, never dropped', () => {
  it('a week mixing a 3-build day and one-build days gives the 3-build day plus one pooled entry', () => {
    const days = [
      { date: '2026-10-10', byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: 3, okBuilds: 3, okDurationMs: 9 * MIN, durationMs: 9 * MIN } } },
      { date: '2026-10-09', byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: 1, okBuilds: 1, okDurationMs: 4 * MIN, durationMs: 4 * MIN } } },
      { date: '2026-10-08', byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: 1, okBuilds: 1, okDurationMs: 2 * MIN, durationMs: 2 * MIN } } },
    ];
    const f = fleetHistoryFromTelemetry(days, SCAFFOLD_TASK_KEY, { moduleCount: 1, featureCount: 5 });
    expect(f.history.map((h) => h.durationMs)).toEqual([3 * MIN, 3 * MIN]);
    expect(f.builds).toBe(5);
    expect(f.days).toBe(3);
  });

  it('a pooled entry carries a spread only when every pooled day recorded one', () => {
    const withSq = fleetHistoryFromTelemetry(week(2, 1, 3), SCAFFOLD_TASK_KEY, { moduleCount: 1, featureCount: 5 });
    expect(withSq.history).toHaveLength(1);
    const noSq = fleetHistoryFromTelemetry(
      week(2, 1, 3).map((d, i) => (i === 0 ? { ...d, byTaskType: { [SCAFFOLD_TASK_KEY]: { ...d.byTaskType[SCAFFOLD_TASK_KEY], okDurationSqSec: undefined } } } : d)),
      SCAFFOLD_TASK_KEY, { moduleCount: 1, featureCount: 5 },
    );
    expect(noSq.history[0].sdMs).toBeUndefined();
  });

  it('a window with ONE finished build gives no history — one build is not an average', () => {
    const f = fleetHistoryFromTelemetry(week(1, 1, 3), SCAFFOLD_TASK_KEY, { moduleCount: 1, featureCount: 5 });
    expect(f.history).toEqual([]);
    expect(f.seenOk).toBe(1);
  });

  it('a legacy day (no successful-build fields) is never pooled — its old rule stands', () => {
    const legacy = [1, 2, 3].map((i) => ({ date: `2026-10-0${i}`, byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: 1, durationMs: 3 * MIN } } }));
    expect(fleetHistoryFromTelemetry(legacy, SCAFFOLD_TASK_KEY, { moduleCount: 1, featureCount: 5 }).history).toEqual([]);
  });
});

describe('6 · the admin line says the measured mean beside the band', () => {
  it('present when the estimate learned from same-size builds, absent otherwise', () => {
    const c = complexityFromPrompt('make a todo app');
    const est = estimateBuildTime(c, [3, 3.4].map((m) => ({ complexity: c, durationMs: m * MIN })));
    expect(etaEvidenceNote(est, 'platform')).toContain('the band shown reaches them');
    expect(etaEvidenceNote(estimateBuildTime(c, []), 'platform')).not.toContain('reaches them');
  });
});

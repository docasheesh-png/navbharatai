import { describe, it, expect } from 'vitest';
import {
  estimateIsEvidenced, unevidencedFirstEtaLine, unevidencedEtaTickLine, etaEvidenceNote,
  MIN_HISTORY_WEIGHT_TO_SHOW_A_NUMBER, LONG_RUN_BUDGET_SHARE,
} from '../src/server/AgentV3/etaEvidence';
import { estimateBuildTime, complexityFromPrompt, type HistoricalBuild } from '../src/server/lib/BuildTimeEstimator';

const MIN = 60_000;

/**
 * THE REPORTED DEFECT, three autopsies running (d11ad529 12 min · 1ef27cd7 26.6 min · 909d13c6 26.6
 * min): the build opened with "~2–4 min" and could not keep it. The number came from
 * `complexityFromPrompt`, whose own module header records that it runs BACKWARDS — a short, ambitious
 * prompt has no page-words and no feature-words, so it scores the floor of every formula.
 */
describe('a cold estimate is not evidence, whatever it looks like', () => {
  it('THE BUG: the prompt heuristic gives a short ambitious prompt the smallest estimate in the system', () => {
    const vpn = estimateBuildTime(complexityFromPrompt('Make an VPN App'));
    const wordy = estimateBuildTime(complexityFromPrompt('a dashboard with 3 pages and search and filter and export'));
    expect(vpn.estimateMs).toBeLessThan(wordy.estimateMs);
    // …and neither is backed by anything, so neither may put a number in front of the user.
    expect(vpn.historyWeight).toBe(0);
    expect(estimateIsEvidenced(vpn)).toBe(false);
    expect(estimateIsEvidenced(wordy)).toBe(false);
  });

  it('a workspace with no history never reaches the bar', () => {
    const est = estimateBuildTime({ moduleCount: 4, featureCount: 6 }, []);
    expect(est.basis).toBe('heuristic');
    expect(estimateIsEvidenced(est)).toBe(false);
  });
});

describe('real past builds ARE a measurement, and keep their number', () => {
  const like = (durationMs: number): HistoricalBuild => ({ complexity: { moduleCount: 4, featureCount: 6 }, durationMs });

  it('history of the same size dominates the blend and is shown', () => {
    const est = estimateBuildTime({ moduleCount: 4, featureCount: 6 }, [like(20 * MIN), like(22 * MIN), like(19 * MIN), like(21 * MIN), like(23 * MIN)]);
    expect(est.historyWeight).toBeGreaterThan(MIN_HISTORY_WEIGHT_TO_SHOW_A_NUMBER);
    expect(estimateIsEvidenced(est)).toBe(true);
    // And it learns the real duration rather than the heuristic's ~7 min for this shape.
    expect(est.estimateMs).toBeGreaterThan(15 * MIN);
  });

  it('🔴 `basis` alone would have been the wrong discriminator — one distant build already says "blended"', () => {
    const est = estimateBuildTime({ moduleCount: 4, featureCount: 6 }, [{ complexity: { moduleCount: 40, featureCount: 40 }, durationMs: 40 * MIN }]);
    expect(est.basis).toBe('blended');          // reads as if history were involved…
    expect(est.historyWeight).toBeLessThan(0.5); // …while contributing a fraction of the figure
    expect(estimateIsEvidenced(est)).toBe(false);
  });

  it('the threshold is the boundary itself, not a value near it', () => {
    expect(estimateIsEvidenced({ historyWeight: MIN_HISTORY_WEIGHT_TO_SHOW_A_NUMBER })).toBe(true);
    expect(estimateIsEvidenced({ historyWeight: MIN_HISTORY_WEIGHT_TO_SHOW_A_NUMBER - 0.01 })).toBe(false);
  });

  it('a malformed or missing estimate withholds the claim rather than making one', () => {
    expect(estimateIsEvidenced(null)).toBe(false);
    expect(estimateIsEvidenced(undefined)).toBe(false);
    expect(estimateIsEvidenced({ historyWeight: Number.NaN })).toBe(false);
    expect(estimateIsEvidenced({} as never)).toBe(false);
  });
});

describe('what the user reads when there is no evidence', () => {
  it('names the phase and carries no time claim at all', () => {
    const line = unevidencedFirstEtaLine();
    expect(line).toContain('Planning your app');
    // The whole point: not one minute/second figure anywhere in it.
    expect(line).not.toMatch(/\d/);
  });

  it('the live line shows ELAPSED time — which has already happened — and never a countdown', () => {
    const line = unevidencedEtaTickLine(4 * MIN);
    expect(line).toContain('4 min in');
    expect(line).not.toMatch(/to go/i);
    expect(line).not.toMatch(/more to go/i);
  });

  it('a broken clock degrades to zero elapsed rather than throwing or printing junk', () => {
    for (const bad of [Number.NaN, -1, undefined as never, 'x' as never]) {
      expect(() => unevidencedEtaTickLine(bad)).not.toThrow();
      expect(unevidencedEtaTickLine(bad)).toContain('0s in');
    }
  });

  it('promises a real figure, because that promise is now keepable on every path', () => {
    // progressEta measures from the file manifest where there is one and from the architect's own
    // plan otherwise, so a build that reaches either produces the number this sentence undertakes to
    // produce. The line it replaced made the same promise from a path where nothing could keep it.
    expect(unevidencedFirstEtaLine()).toMatch(/real figure/i);
    expect(unevidencedFirstEtaLine()).toMatch(/measure/i);
  });
});

describe("the admin's report is never less honest than the screen", () => {
  it('says why no number was shown when there is no history', () => {
    const note = etaEvidenceNote({ historyWeight: 0, basis: 'heuristic' });
    // Admin 2026-09-26: an unevidenced estimate is SHOWN as a labelled rough estimate when a band
    // exists; a bare historyWeight fixture has none, so the phase-only wording still applies here.
    expect(note).toMatch(/No number shown|ROUGH ESTIMATE/);
    expect(note).toMatch(/no past builds/i);
  });

  it('distinguishes "no history" from "history too thin to dominate"', () => {
    const none = etaEvidenceNote({ historyWeight: 0, basis: 'heuristic' });
    const thin = etaEvidenceNote({ historyWeight: 0.2, basis: 'blended' });
    expect(thin).not.toBe(none);
    expect(thin).toContain('20%');
  });

  it('states the share when a number WAS shown', () => {
    const note = etaEvidenceNote({ historyWeight: 0.9, basis: 'historical' });
    expect(note).toContain('Shown as a number');
    expect(note).toContain('90%');
  });

  it('carries no provider or model name — the White-Label Law covers the report text too', () => {
    const all = [
      unevidencedFirstEtaLine(), unevidencedEtaTickLine(60_000),
      etaEvidenceNote({ historyWeight: 0, basis: 'heuristic' }),
      etaEvidenceNote({ historyWeight: 0.9, basis: 'historical' }),
    ].join(' ').toLowerCase();
    for (const vendor of ['glm', 'kimi', 'claude', 'anthropic', 'sonnet', 'opus', 'gemini', 'vertex', 'grok', 'moonshot']) {
      expect(all).not.toContain(vendor);
    }
  });
});

/**
 * AUTOPSY dd1f5f60 (2026-09-16) — the twelve identical ticks.
 *
 * A 29-minute build that failed printed this line TWELVE times, word for word, because it was a pure
 * function of elapsed time and the elapsed figure was buried mid-sentence. The user pressed the
 * button three times and filed a ticket saying the app "is not responding". The build's own time
 * limit is a FIXED configured number — arithmetic, not a prediction — and it was already known.
 */
describe('the live tick knows the build\'s own time limit (autopsy dd1f5f60)', () => {
  const CAP = 29 * MIN; // the real cap in that report: AGENTV3_MAX_BUILD_SECONDS scaled to 1740s

  it('THE REGRESSION ITSELF: two far-apart ticks of one build must not read the same', () => {
    const early = unevidencedEtaTickLine(2 * MIN, CAP);
    const late = unevidencedEtaTickLine(24 * MIN, CAP);
    expect(early).not.toBe(late);
    // …and not merely by the elapsed figure — the late one has to SAY something different.
    expect(late).toMatch(/taking longer than most/i);
    expect(early).not.toMatch(/taking longer than most/i);
  });

  it('early in the budget it reports the cap as a cap, never as a finish time', () => {
    const line = unevidencedEtaTickLine(5 * MIN, CAP);
    expect(line).toContain('5 min in');
    expect(line).toContain('24 min left');
    // The whole law of this module: no countdown to a FINISH for an unmeasured build.
    expect(line).not.toMatch(/to go/i);
  });

  it('past the long-run share it says so, and every clause it promises is one the engine really does', () => {
    const line = unevidencedEtaTickLine(20 * MIN, CAP);
    expect(line).toMatch(/taking longer than most/i);
    expect(line).toContain('9 min more');
    expect(line).toMatch(/save whatever is finished/i);
    expect(line).toMatch(/nothing you have is lost/i);
    // It must never claim the build WILL finish — that is the promise this module exists to refuse.
    expect(line).not.toMatch(/will finish|will be (done|ready)/i);
  });

  it('a HEALTHY build never sees the long-run wording', () => {
    for (const m of [0, 1, 4, 10, 17]) {
      expect(unevidencedEtaTickLine(m * MIN, CAP)).not.toMatch(/taking longer than most/i);
    }
    expect(unevidencedEtaTickLine(Math.ceil(CAP * LONG_RUN_BUDGET_SHARE), CAP)).toMatch(/taking longer than most/i);
  });

  it('NO CAP means no limit is mentioned — the effectiveBuildSeconds === 0 convention', () => {
    const plain = unevidencedEtaTickLine(4 * MIN);
    for (const noCap of [undefined, 0, -1, Number.NaN, 'x' as never]) {
      const line = unevidencedEtaTickLine(4 * MIN, noCap as never);
      expect(line).toBe(plain); // byte-identical to the pre-2026-09-16 sentence
      expect(line).not.toMatch(/left for this one|taking longer than most/i);
    }
  });

  it('past the cap it falls back rather than inventing a negative remainder', () => {
    const line = unevidencedEtaTickLine(CAP + 5 * MIN, CAP);
    expect(line).toBe(unevidencedEtaTickLine(CAP + 5 * MIN));
    expect(line).not.toMatch(/-\d/);
  });

  it('still carries no provider or model name at any point in the budget', () => {
    const all = [0.1, 0.5, 0.7, 0.95].map((f) => unevidencedEtaTickLine(CAP * f, CAP)).join(' ').toLowerCase();
    for (const vendor of ['glm', 'kimi', 'claude', 'anthropic', 'sonnet', 'opus', 'gemini', 'vertex', 'grok', 'moonshot']) {
      expect(all).not.toContain(vendor);
    }
  });
});

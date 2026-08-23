import { describe, it, expect } from 'vitest';
import {
  complaintInText, scoreBuildOutcome, shouldAutoReport, autoReportReason, GOOD_DWELL_MS,
  type OutcomeSignals,
} from './buildOutcomeSignals';

const base: OutcomeSignals = {
  buildOk: true, complained: null, askedForRepair: false, invested: false, previewWatchedMs: null,
};

describe('complaintInText — narrow on purpose', () => {
  it('catches how people actually say it, in both languages', () => {
    for (const s of [
      'the app is not working',
      "it doesn't work",
      'nothing happens when I click',
      'blank page aa raha hai',
      'white screen',
      'the preview is broken',
      'it shows an error',
      'kaam nahi kar raha',
      'chal nahi raha bhai',
      'kuch nahi ho raha',
      'app tut gayi',
      'error aa raha hai',
    ]) {
      expect(complaintInText(s), s).toBe(true);
    }
  });

  it('does NOT treat an ordinary follow-up request as a complaint', () => {
    // THE EXPENSIVE FALSE POSITIVE. Sending the admin a report about a perfectly good build is how the
    // channel stops being read — one missed complaint costs one report, crying wolf costs all of them.
    for (const s of [
      'add a dark mode',
      'change the button colour to green',
      'can you add a search box',
      'make the header bigger',
      'add error handling to the form',
      'ek login page bhi bana do',
      'now add payments',
      'looks great, add a footer',
    ]) {
      expect(complaintInText(s), s).toBe(false);
    }
  });

  it('says nothing about an empty message', () => {
    expect(complaintInText('')).toBe(false);
    expect(complaintInText(null)).toBe(false);
    expect(complaintInText(undefined)).toBe(false);
    expect(complaintInText('   ')).toBe(false);
  });
});

describe('scoreBuildOutcome — silence is silence', () => {
  it('no signals at all is UNCLEAR, never bad', () => {
    // The rule the whole module is shaped around. A user who builds an app and closes the tab has told
    // us nothing; scoring that as failure would make our own quality numbers a fiction.
    expect(scoreBuildOutcome(base).verdict).toBe('unclear');
  });

  it('a short look is NOT evidence of a bad app', () => {
    // People glance at something they like and move on just as often as they bounce off something broken.
    expect(scoreBuildOutcome({ ...base, previewWatchedMs: 8_000 }).verdict).toBe('unclear');
  });

  it('a long, uncomplaining look is evidence it works', () => {
    const j = scoreBuildOutcome({ ...base, previewWatchedMs: GOOD_DWELL_MS });
    expect(j.verdict).toBe('good');
    expect(j.reasons[0]).toContain('without a complaint');
  });
});

describe('scoreBuildOutcome — the silent failure this exists to catch', () => {
  it('green build + the user says it does not work = BAD', () => {
    const j = scoreBuildOutcome({ ...base, complained: true });
    expect(j.verdict).toBe('bad');
    expect(j.reasons.join(' ')).toContain('does not work');
  });

  it('green build + the user reached for Diagnose = BAD', () => {
    // Nobody presses Diagnose on an app that works.
    expect(scoreBuildOutcome({ ...base, askedForRepair: true }).verdict).toBe('bad');
  });

  it('a build that ALREADY reported failure is not a silent one', () => {
    // The admin can already see it in diagnostics. Pushing it at them buries the cases they cannot see.
    const j = scoreBuildOutcome({ ...base, buildOk: false, complained: true });
    expect(j.verdict).toBe('unclear');
    expect(j.reasons.join(' ')).toContain('already reported failure');
  });
});

describe('scoreBuildOutcome — investment outranks everything', () => {
  it('publishing the app is GOOD even alongside a complaint', () => {
    // Somebody who published, packaged or pointed a domain at their app voted with real effort. Calling
    // that a failure would be the clearest possible false alarm.
    const j = scoreBuildOutcome({ ...base, invested: true, complained: true, askedForRepair: true });
    expect(j.verdict).toBe('good');
    expect(j.reasons[0]).toContain('published');
  });
});

describe('shouldAutoReport — once per build, only when bad', () => {
  it('sends exactly once for a bad build', () => {
    expect(shouldAutoReport('bad', false)).toBe(true);
    expect(shouldAutoReport('bad', true)).toBe(false);
  });

  it('never sends for good or unclear', () => {
    for (const v of ['good', 'unclear'] as const) {
      expect(shouldAutoReport(v, false)).toBe(false);
    }
  });
});

describe('autoReportReason', () => {
  it('leads with what the user DID, not a score', () => {
    const line = autoReportReason(scoreBuildOutcome({ ...base, complained: true, askedForRepair: true }));
    expect(line).toContain('reported success but');
    expect(line).toContain('does not work');
    expect(line).toContain('Diagnose');
  });

  it('never names a vendor', () => {
    const line = autoReportReason(scoreBuildOutcome({ ...base, complained: true }));
    expect(line).not.toMatch(/e2b|glm|kimi|claude|gemini|grok|anthropic|moonshot/i);
  });
});

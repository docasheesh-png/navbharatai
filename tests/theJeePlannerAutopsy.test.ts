/**
 * AUTOPSY e7baf61d (2026-09-29) — "Crest", a JEE study planner, Weak tier, 20.6 min, green.
 *
 * The user wrote a 175-line spec, one item per line, for a single-person app ("No account required",
 * "Everything stored locally"). Four things the PLATFORM told the builder were wrong, and each is locked
 * here against the report's own lines:
 *
 *   1. "Start / Pause / Resume / Finish", one per line, made it a JOBS app: the build was told to INCLUDE
 *      employer & candidate roles and job postings.
 *   2. With that fixed, "Each book should show Questions Solved" made it a BOOKING app, and then the
 *      education domain proposed roles, enrolment and fees — for an app with no accounts.
 *   3. "Weekly Review — every Sunday" became "reviews / ratings — build every one of these", and the
 *      builder built a star-rating page nobody asked for.
 *   4. Our own generated sw.js tripped our own authenticity scan, and the builder spent turns rewriting it.
 */
import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps, buildRequirementGuidance, declaresSinglePersonApp, missingDomainFeatures, shouldSurfaceRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { requestedFeatureLabels } from '../src/server/AgentV3/RequirementCoverage';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';
import { planE2eScaffold } from '../src/server/AgentV3/e2eScaffold';
import { scanAuthenticity } from '../src/server/AgentV3/AuthenticityAnalysis';
import { nativeCapabilityBrief } from '../src/server/AgentV3/nativeCapabilities';

// The report's prompt, abridged to the lines each verdict turned on — verbatim, one item per line.
const PROMPT = [
  'Crest full stack application for jee student for jee aspirant The purpose is to manage my entire JEE preparation, track progress, prevent time wasting, and act like a strict mentor.',
  'Study Timer', 'Every study session has', 'Start', 'Pause', 'Resume', 'Finish',
  'Subject Tracker', 'Chemistry', 'Physics', 'Mathematics',
  'Book Progress', 'Track separately', 'NCERT', 'HC Verma', 'Cengage', 'Coaching Module', 'PYQs',
  'Each book should show', 'Questions Solved', 'Questions Remaining', 'Percentage Complete',
  'Chapter Tracker', 'Theory', 'NCERT', 'Module', 'Reference Book', 'PYQ', 'Revision 1', 'Mock Test', 'Completion %',
  'Monthly Analytics', 'Consistency Calendar',
  'Weekly Review', 'Every Sunday', 'Display', 'Hours Studied', 'Weak Areas', 'Suggested Plan',
  'Mock Test Tracker', 'Store', 'Date', 'Exam', 'Marks', 'Rank',
  'Revision System', 'Automatic reminders', 'Statistics', 'Books Completed',
  'Design', 'Dark Theme', 'Offline database', 'No ads', 'No account required', 'Everything stored locally.',
].join('\n');

describe('1 · a timer control on its own line is not a CV', () => {
  it('the report prompt is not a jobs app', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).not.toBe('jobs');
  });
  it('controls written one per line, or side by side, are a player control', () => {
    for (const t of ['Start\nPause\nResume\nFinish', 'pause resume', 'Resume\nStop', 'play / resume']) {
      expect(analyzeRequirementGaps(`a study timer with ${t}`).domain, t).not.toBe('jobs');
    }
  });
  it('🔒 a real CV still means jobs', () => {
    for (const t of ['a job board where candidates upload a resume', 'resume builder for job seekers', 'upload your resume and apply to jobs']) {
      expect(analyzeRequirementGaps(t).domain, t).toBe('jobs');
    }
  });
});

describe('2 · a textbook is not a booking, and a single-person app gets no second party', () => {
  it('the report prompt is an education app, not a booking app', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).toBe('education');
  });
  it('study-material books are stripped; booking verbs keep their meaning even beside study words', () => {
    expect(analyzeRequirementGaps('a study planner: book progress, reference book, books completed').domain).not.toBe('booking');
    expect(analyzeRequirementGaps('JEE coaching app where students book a slot with a tutor').domain).toBe('booking');
    expect(analyzeRequirementGaps('hotel room booking with payments').domain).toBe('booking');
  });
  it('🔴 the report: no roles, enrolment or fees are proposed, and nothing is surfaced', () => {
    const g = analyzeRequirementGaps(PROMPT);
    expect(g.likelyMissing).toEqual([]);
    expect(g.clarifyingQuestions).toEqual([]);
    expect(shouldSurfaceRequirementGaps(g)).toBe(false);
    expect(buildRequirementGuidance(g)).toBe('');
    expect(missingDomainFeatures(PROMPT, '').labels).toEqual([]);
  });
  it('both halves are required: no accounts AND data on the device', () => {
    expect(declaresSinglePersonApp('No account required. Everything stored locally.')).toBe(true);
    expect(declaresSinglePersonApp('no login needed, all data is stored on the device')).toBe(true);
    expect(declaresSinglePersonApp('no login needed for customers')).toBe(false);
    expect(declaresSinglePersonApp('cache everything stored locally for speed')).toBe(false);
  });
  it('🔒 a school system with accounts still gets its roles and fees', () => {
    const g = analyzeRequirementGaps('a school management system for teachers and students with attendance');
    expect(g.domain).toBe('education');
    expect(g.likelyMissing.join(' ')).toMatch(/fees/);
  });
});

describe('3 · a weekly review of your own work is not a star rating', () => {
  it('the report prompt does not ask for reviews / ratings', () => {
    expect(requestedFeatureLabels(PROMPT)).not.toContain('reviews / ratings');
  });
  it('periodic and self reviews are reports', () => {
    for (const t of ['Weekly Review every Sunday', 'a monthly review of my progress', 'daily review of mistakes', 'code review checklist']) {
      expect(requestedFeatureLabels(t), t).not.toContain('reviews / ratings');
    }
  });
  it('🔒 product reviews and ratings are still asked for', () => {
    for (const t of ['a shop with product reviews', 'ratings and reviews for each restaurant', 'customers can leave a review']) {
      expect(requestedFeatureLabels(t), t).toContain('reviews / ratings');
    }
  });
});

describe('4 · every file we generate passes our own authenticity scan', () => {
  it('the production defaults (manifest, icon, robots, service worker)', () => {
    const { files } = planAppDefaults('<!doctype html><html><head><title>Crest</title></head><body><div id="root"></div></body></html>', 'Crest');
    for (const [path, content] of Object.entries(files)) {
      expect(scanAuthenticity(path, content), path).toEqual([]);
    }
  });
  it('the starter end-to-end suite', () => {
    const { files } = planE2eScaffold({ appName: 'Crest', routes: ['/', '/goals'] });
    for (const [path, content] of Object.entries(files)) {
      expect(scanAuthenticity(path, content), path).toEqual([]);
    }
  });
});

describe('5 · the phone-plugin pins are the platform\'s, and only for the plugins', () => {
  it('the brief says so, so a summary cannot attribute them to the user', () => {
    const brief = nativeCapabilityBrief('remind me to study every night');
    expect(brief).toMatch(/apply ONLY to the packages listed above/);
    expect(brief).toMatch(/never tell the user they asked for versions/);
  });
});

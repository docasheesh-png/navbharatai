// Autopsy 6461025c (2026-10-01) — an "Ads + Rewards + Coin Economy" spec of 15,689 characters and 40
// enumerated parts was built as a generic ten-feature app (a booking calendar, star ratings), told the
// user it "isn't fully working yet" while charging for a success, and lost 79 s to a plan cut off at a
// fixed 8,000-token cap.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { requestedFeatureLabels, analyzeRequirementCoverage } from '../src/server/AgentV3/RequirementCoverage';
import { featureListsFor } from '../src/server/AgentV3/featurePlan';
import { readsAsSpecification, countEnumeratedFeatures, SPEC_FEATURE_COUNT } from '../src/server/AgentV3/enumeratedFeatures';
import { MEGA_BULLETS_ALONE, projectPlanSystemPrompt } from '../src/server/AgentV3/ProjectPlan';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { summaryAfterRescue, RESCUED_SUMMARY } from '../src/server/AgentV3/renderRescue';
import { NOT_READY_HEADLINE, NOT_READY_HEADLINE_CONTINUE, isNotReadyHeadline } from '../src/server/AgentV3/notReadyHeadline';
import { PROJECT_PLANNER_MAX_TOKENS } from '../src/server/AgentV3/projectPlannerBudget';
import { CORS_RULE, SEED_PASSWORD_RULE } from '../src/server/AgentV3/noEvalRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { fileSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';

const read = (p: string) => readFileSync(p, 'utf8');

// The shape of the real request: headings, bullet lists, and the words that were misread.
const SPEC = [
  'Ads & Rewards Dashboard — the full control center.',
  '## Overview', '* Total Advertisers', '* Active Campaigns', '* Total Ad Impressions', '* Verified Clicks',
  '## Campaigns', '* Campaign Name', '* Start Date', '* Daily Budget', '* Reward Budget',
  '## Delivery Controls', '* Frequency Cap', '* Placement Eligibility', '* Schedule', '* Pacing',
  '## Moderation', '* Ad Review', '* Pending Review', '* Review Checks', '* Appeals',
  '## Reports', '* Campaign Report', '* Scheduled Reports', '* Revenue Report',
  '## Settings', '* Notification Settings', '* Billing Settings', '* Security Settings',
].join('\n');

describe('a written specification is its own contract', () => {
  it('the fixture really is a spec, on the same line Project Mode uses', () => {
    expect(SPEC_FEATURE_COUNT).toBe(MEGA_BULLETS_ALONE);
    expect(countEnumeratedFeatures(SPEC)).toBeGreaterThanOrEqual(SPEC_FEATURE_COUNT);
    expect(readsAsSpecification(SPEC)).toBe(true);
  });

  it('no keyword categories are restated as orders, and none are graded', () => {
    expect(requestedFeatureLabels(SPEC)).toEqual([]);
    expect(featureListsFor(SPEC, { requirementAware: true }).named).toEqual([]);
    const report = analyzeRequirementCoverage(SPEC, { components: [], routes: [], files: [] } as never, []);
    expect(report.requested).toEqual([]);
  });

  it('an ordinary request keeps its contract', () => {
    const p = 'build a salon app with booking, login and reviews';
    expect(readsAsSpecification(p)).toBe(false);
    expect(requestedFeatureLabels(p)).toEqual(expect.arrayContaining(['calendar / booking / appointment', 'login / authentication', 'reviews / ratings']));
  });
});

describe('a timing setting is not a booking, and a moderation review is not a rating', () => {
  it('short requests that use the words in the other sense', () => {
    const labels = requestedFeatureLabels('an ads manager with ad review, pending review queue, scheduled reports and a campaign schedule');
    expect(labels).not.toContain('calendar / booking / appointment');
    expect(labels).not.toContain('reviews / ratings');
  });
  it('the real senses still read', () => {
    expect(requestedFeatureLabels('a clinic app to book an appointment from a calendar')).toContain('calendar / booking / appointment');
    expect(requestedFeatureLabels('a class schedule for my coaching centre')).toContain('calendar / booking / appointment');
    expect(requestedFeatureLabels('restaurant app with customer reviews and ratings')).toContain('reviews / ratings');
    expect(requestedFeatureLabels('a section for reviews of each product')).toContain('reviews / ratings');
  });
  it('an ad placement is not a hire, and a placement portal still is', () => {
    expect(analyzeRequirementGaps('an ad network with banner placements and placement optimization').domain).not.toBe('jobs');
    expect(analyzeRequirementGaps('a campus placement portal where recruiters post jobs for students').domain).toBe('jobs');
  });
});

describe('a build the browser proved working does not end on "isn\'t fully working"', () => {
  it('the headline is replaced by the model\'s own answer, or the rescue sentence', () => {
    expect(summaryAfterRescue(NOT_READY_HEADLINE, 'App ready hai! Login, dashboard, campaigns.')).toBe('App ready hai! Login, dashboard, campaigns.');
    expect(summaryAfterRescue(NOT_READY_HEADLINE_CONTINUE, undefined)).toBe(RESCUED_SUMMARY);
    expect(summaryAfterRescue('', undefined)).toBe(RESCUED_SUMMARY);
  });
  it('any other summary is left exactly as it was', () => {
    expect(summaryAfterRescue('Built the shop app.', 'something else')).toBe('Built the shop app.');
    expect(isNotReadyHeadline('Built the shop app.')).toBe(false);
    expect(isNotReadyHeadline(`${NOT_READY_HEADLINE}\n\nextra`)).toBe(true);
  });
  it('the runner keeps the model\'s words, and the rescue and the E2E gate read the right facts', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('if (turn.text.trim()) modelAnswer = turn.text.trim();');
    expect(runner).toContain('...(!ok && modelAnswer ? { modelAnswer } : {})');
    expect(runner).not.toContain("summary = `⚠️ This app isn't fully working yet");
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('summary: summaryAfterRescue(result.summary, result.modelAnswer)');
    expect(route).not.toContain("summary: result.summary || 'The app builds and the live preview renders correctly.'");
    expect(route).toContain('ok: result.ok || renderRescueEligible({ ok: result.ok, expectsArtifacts, filesWritten: writtenFiles.size }),');
  });
});

describe('the project plan fits in the answer it is given', () => {
  it('a sized allowance, and a prompt that asks for compact contracts', () => {
    expect(PROJECT_PLANNER_MAX_TOKENS).toBeGreaterThanOrEqual(16_000);
    expect(read('src/server/routes/agentv3.ts')).toContain('tools: [], maxTokens: PROJECT_PLANNER_MAX_TOKENS,');
    expect(projectPlanSystemPrompt('vite-react')).toMatch(/Keep contracts COMPACT/);
  });
});

describe('CORS and seed passwords are written right the first time, in both lanes', () => {
  it('both rules reach the architect and the fast lane', () => {
    for (const p of [architectSystemPrompt(), fileSystemPrompt('vite-react')]) {
      expect(p).toContain(CORS_RULE);
      expect(p).toContain(SEED_PASSWORD_RULE);
    }
  });
});

describe('a closing offer after the app was built does not hide a blocker', () => {
  it('a question after writing files still resumes; a question before building still stands down', async () => {
    const { decideUnfinishedResume, unfinishedResumeStandDownNote } = await import('../src/server/AgentV3/unfinishedResume');
    const text = 'App ready hai! Login, dashboard aur campaigns ban gaye.\nKya aap kuch aur add karna chahenge?';
    const blockers = ['Security config (cors-credentials-reflect-origin)'];
    expect(decideUnfinishedResume({ text, blockers, resumesUsed: 0, producedFiles: true }).resume).toBe(true);
    const before = decideUnfinishedResume({ text, blockers, resumesUsed: 0, producedFiles: false });
    expect(before).toMatchObject({ resume: false, standDown: 'asked-the-user' });
    expect(decideUnfinishedResume({ text, blockers, resumesUsed: 0 }).standDown).toBe('asked-the-user');
    expect(unfinishedResumeStandDownNote('asked-the-user', 1)).toMatch(/not resumed/);
    expect(unfinishedResumeStandDownNote('no-blockers', 0)).toBeNull();
  });
  it('the runner passes what it produced and records a stand-down', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('resumesUsed: unfinishedResumes, producedFiles: producingToolUses > 0 });');
    expect(runner).toContain("code: 'UNFINISHED_RESUME_STOOD_DOWN'");
  });
});

describe('the style hand-back has the same rule (sibling, #3425)', () => {
  it('a closing offer after writing screens does not stop it', async () => {
    const { decideStyleResume } = await import('../src/server/AgentV3/stylePolishResume');
    const text = 'Screens ready hain.\nKuch aur chahiye?';
    expect(decideStyleResume({ text, missing: ['tx-row'], resumesUsed: 0, producedFiles: true }).resume).toBe(true);
    expect(decideStyleResume({ text, missing: ['tx-row'], resumesUsed: 0 }).standDown).toBe('asked-the-user');
    expect(read('src/server/AgentV3/AgentRunner.ts')).toContain('resumesUsed: styleResumes, producedFiles: producingToolUses > 0 });');
  });
});

describe('a markdown bullet is not a code comment (the real 6461025c prompt, after #3426)', () => {
  const REAL = read('tests/fixtures/autopsy6461025c.prompt.txt');
  it('the real spec is prose, counts all its parts, and is its own contract', async () => {
    const { isPastedSource } = await import('../src/server/lib/pastedSource');
    expect(isPastedSource(REAL)).toBe(false);
    expect(countEnumeratedFeatures(REAL)).toBeGreaterThanOrEqual(SPEC_FEATURE_COUNT);
    expect(readsAsSpecification(REAL)).toBe(true);
    expect(requestedFeatureLabels(REAL)).toEqual([]);
  });
  it('a pasted block of code with a /* … */ comment is still pasted source', async () => {
    const { isPastedSource } = await import('../src/server/lib/pastedSource');
    const code = [
      '/**', ' * Bill maker', ' * keeps totals', ' */',
      'const items = [];', 'function add(x) {', '  items.push(x);', '}',
      'function total() {', '  return items.reduce((a, b) => a + b, 0);', '}', 'export { add, total };',
    ].join('\n');
    expect(isPastedSource(code)).toBe(true);
  });
});

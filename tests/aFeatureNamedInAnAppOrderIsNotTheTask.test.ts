// AUTOPSY 303e8a6f (2026-10-12), item C — the first starter chip was filed taskType "debugging", score 50,
// start band "sonnet", because its FEATURE list asks for "friendly error messages with a Try again button".
// On a weak, template-seeded build that meant the complex-app 150-step ceiling, a "sonnet" model label and the
// wrong telemetry and ETA bucket; on a prompt without a template the same clause would cross the complexity
// line. "Try again button" also read as "work already started", so the unsized-app floor was refused.
//
// The CLASS: a request classifier reads a word that names a FEATURE of the app being ordered ("error
// messages", a "Try again" button, "React", "translation") as the INTENT of the turn. Autopsy 33812996 fixed it
// for translate and summary; this fixes debugging, continuation and coding, and the dialogue-phase reader.
import { describe, it, expect } from 'vitest';
import { analyzeRequest, aDebugWordNamesAFeature } from '../src/server/AgentV3/RequestAnalyser';
import { describesWorkAlreadyStarted, withoutControlLabels } from '../src/server/AgentV3/IntentClassifier';
import { inferPhase } from '../src/server/AgentV3/DialogueStateManager';
import { withoutErrorFeaturePhrases } from '../src/server/lib/describedFeatures';
import { platformFixRequestPrompt } from '../src/lib/platformFixRequest';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { RETIRED_CHIP_PROMPTS } from '../src/server/AgentV3/goldenScaffolds/registry';

const chip = STARTER_TEMPLATES.find((t) => t.id === 'ai-image')!.prompt;
const reportPrompt = RETIRED_CHIP_PROMPTS['ai-image']![0]!; // the report's own prompt, verbatim
const newBuild = (prompt: string) => analyzeRequest({ prompt, buildIntent: 'new_build', fileCount: 0 } as never);
const edit = (prompt: string) => analyzeRequest({ prompt, buildIntent: 'edit_existing', fileCount: 10 } as never);

describe('1 · the report\'s prompt', () => {
  it.each([['the report\'s prompt', reportPrompt], ['the corrected chip', chip]])('%s is an app, cheapest band — not debugging/50/sonnet', (_n, p) => {
    const a = newBuild(p);
    expect(a.taskType).toBe('app_unsized');
    expect(a.complexityScore).toBe(15);
    expect(a.startTier).toBe('gemini');
  });

  it('"a Try again button" is a control the app should have, not a request to resume', () => {
    expect(describesWorkAlreadyStarted(reportPrompt)).toBe(false);
    expect(withoutControlLabels('errors with a try again button')).not.toContain('try again');
    for (const resume of ['try again', 'retry', 'Try again please', 'try it again', 'continue']) expect(describesWorkAlreadyStarted(resume), resume).toBe(true);
  });
});

describe('2 · 🔒 the census: no starter chip is filed as something it is not', () => {
  it.each(STARTER_TEMPLATES.map((t) => [t.id, t.prompt]))('%s', (_id, prompt) => {
    expect(['debugging', 'translate', 'summary', 'chat', 'coding']).not.toContain(newBuild(prompt).taskType);
    expect(describesWorkAlreadyStarted(prompt)).toBe(false);
  });
});

describe('3 · a feature inside an order is not the task — and a real problem still is', () => {
  it.each([
    'Create a todo app with form validation and error messages',
    'Create a calculator that shows Error when dividing by zero',
    'Build a weather app that shows a friendly error message when the city is not found',
    'Build an AI image generator app in React',
    'Create a recipe app with a reusable card component',
  ])('new app: %s', (p) => expect(['debugging', 'coding']).not.toContain(newBuild(p).taskType));

  it.each(['add a friendly error message when the upload fails', 'add error handling to the form'])('an edit that ADDS an error message is a feature: %s', (p) => {
    expect(edit(p).taskType).not.toBe('debugging');
    expect(inferPhase({ intent: 'edit_existing', prompt: p, hasExistingFiles: true })).toBe('building');
  });

  it.each([
    'fix the error in my app, the login button is not working',
    "I'm getting an error message when I click save",
    'the app shows an error message on login',
    'still broken, console error',
    'why is my app crashing on startup',
    'fix the bug in the login page',
  ])('a real problem stays debugging, on either intent: %s', (p) => {
    expect(newBuild(p).taskType).toBe('debugging');
    expect(edit(p).taskType).toBe('debugging');
    expect(inferPhase({ intent: 'edit_existing', prompt: p, hasExistingFiles: true })).toBe('debugging');
  });

  it('our own Fix-error message and a pasted machine error are bug reports', () => {
    const fix = platformFixRequestPrompt('TypeError: Cannot read properties of undefined (reading "map")');
    expect(aDebugWordNamesAFeature(fix, 'new_build')).toBe(false);
    expect(aDebugWordNamesAFeature('TypeError: x is not a function\n    at App (App.tsx:12:5)', 'new_build')).toBe(false);
  });

  it('without the platform\'s intent nothing changes (every other caller keeps its verdict)', () => {
    expect(aDebugWordNamesAFeature(reportPrompt)).toBe(false);
    expect(aDebugWordNamesAFeature(reportPrompt, 'edit_existing')).toBe(false);
    expect(aDebugWordNamesAFeature(reportPrompt, 'new_build')).toBe(true);
  });

  it('a technology on its own is still a coding task', () => {
    expect(newBuild('write a react component for a card').taskType).toBe('coding');
  });

  it('the error-feature phrase needs an imperative builder verb — a description of an error is kept', () => {
    expect(withoutErrorFeaturePhrases('add a friendly error message when the upload fails')).not.toMatch(/error|fails/);
    expect(withoutErrorFeaturePhrases("I'm getting an error message")).toContain('error message');
    expect(withoutErrorFeaturePhrases('it shows an error message')).toContain('error message');
  });
});

describe('4 · the telemetry files the tier that DELIVERED, not the band the prompt was sized as', () => {
  it('🔒 the cost table, the trace and the decision trace read the measured tier', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const measuredTier: StartTier = deliveredStartTier(dominantProvider(providerTurns)) ?? deliveredTier;');
    const telemetry = route.slice(route.indexOf('agentV3CostTelemetry\n        .record({'), route.indexOf('agentV3CostTelemetry\n        .record({') + 1200);
    expect(telemetry).toContain('startTier: measuredTier,');
    expect(route).toContain('tier: measuredTier,');
    // The provider is read once (`deliveredViaProvider = dominantProvider(providerTurns)`) and the fallback is the
    // build's one record name, never the request's Claude id (Q-970).
    expect(route).toContain('const deliveredViaProvider = dominantProvider(providerTurns);');
    expect(route).toContain("decisionTrace.record('model', `${measuredTier} (${deliveredViaProvider ?? buildModelForRecord})`");
  });

  it('a weak build delivered by GLM or KIMI is the cheap bucket, never a Claude one', async () => {
    const { deliveredStartTier } = await import('../src/server/routes/agentv3');
    for (const p of ['GLM', 'KIMI', 'NEMOTRON']) expect(deliveredStartTier(p)).toBe('gemini');
  });
});

// The adversarial review of this fix (2026-10-12) found four ways the first version traded one problem for another.
describe('5 · 🔒 what the review found, locked', () => {
  it('the router reads a request exactly as the analysis did — intent included', async () => {
    const { signalsMatchedNothing } = await import('../src/server/AgentV3/RequestAnalyser');
    const { needsSecondOpinion, decideComplexity } = await import('../src/server/AgentV3/complexityRouting');
    for (const p of [
      'Create a gurudwara langar seva app with volunteer slots, donation records, ration stock, announcements and clear error messages',
      // The debug word ("crash") sits in a feature clause: only the intent-aware reading files it as an app, so this
      // twin is what fails if the router stops receiving the intent.
      'Create a plant care diary app with photo logs, watering reminders and a crash report screen',
    ]) {
      const a = newBuild(p);
      expect(signalsMatchedNothing(p, 'new_build'), p).toBe(a.taskType === 'app_unsized');
      let calls = 0;
      await decideComplexity({ prompt: p, score: a.complexityScore, buildIntent: 'new_build' }, async () => { calls++; return 'simple'; });
      expect(calls, p).toBe(needsSecondOpinion(a.complexityScore, p, 'new_build') ? 1 : 0);
    }
    const route = (await import('node:fs')).readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('{ prompt: planning.sizing, score: analysis?.complexityScore ?? 0, buildIntent: intent },');
  });

  it.each(['continue option 2', 'retry link', 'resume tab', 'redo action'])('a short continuation turn keeps its continuation reading: %s', async (t) => {
    const { classifyIntentWithConfidence } = await import('../src/server/AgentV3/IntentClassifier');
    expect(classifyIntentWithConfidence(t)).toMatchObject({ intent: 'edit_existing', confidence: 'high', signal: 'continuation' });
    expect(describesWorkAlreadyStarted(t)).toBe(true);
  });

  it('a problem report on a fresh workspace stays a problem report', () => {
    expect(newBuild('Make the app work, it is broken').taskType).toBe('debugging');
    expect(aDebugWordNamesAFeature('Make the app work, it is broken', 'new_build')).toBe(false);
  });

  it('"resume" the CV is not "resume" the build', () => {
    expect(describesWorkAlreadyStarted('Build a resume builder app')).toBe(false);
    expect(describesWorkAlreadyStarted('Make a CV maker for students')).toBe(false);
    expect(describesWorkAlreadyStarted('resume')).toBe(true);
    expect(describesWorkAlreadyStarted('please resume the build')).toBe(true);
  });

  it('the kill switch reverts the order-feature reading', () => {
    expect(aDebugWordNamesAFeature(reportPrompt, 'new_build', { AGENTV3_ORDER_FEATURE_WORDS: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

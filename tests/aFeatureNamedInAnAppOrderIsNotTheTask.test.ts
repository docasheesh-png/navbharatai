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
import { withoutErrorFeaturePhrases } from '../src/server/lib/errorFeaturePhrase';
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

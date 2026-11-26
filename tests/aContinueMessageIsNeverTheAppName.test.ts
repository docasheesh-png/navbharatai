/**
 * A "CONTINUE" MESSAGE IS NEVER THE APP'S NAME (build reports #2526–#2528, 2026-11-25).
 *
 * The open-world game's index.html shipped `<title>Continue the build from</title>` and the description "Continue the build
 * from where it left off and finish the remaining steps." — our own "Continue building" card's sentence, cut at "where" by
 * nameFromPrompt, because the defaults pass named the app from THIS turn's message. The class: an order to us about the build
 * read as a description of the user's app. Closed three ways: the route reads the request the turn continues (checksRequest),
 * nameFromPrompt / descriptionFromPrompt refuse a continuation, and a title that already carries it counts as a placeholder,
 * so the next build renames it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nameFromPrompt, descriptionFromPrompt, resolveAppDisplayName, titleFromIndexHtml } from '../src/server/AgentV3/appDisplayName';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';

const CARD = 'Continue the build from where it left off and finish the remaining steps.';

describe('🔴 the #2526 title', () => {
  it('the card\'s sentence and a bare "continue" name nothing and describe nothing', () => {
    for (const m of [CARD, 'continue', 'Continue building', 'aage badho']) {
      expect(nameFromPrompt(m)).toBeNull();
      expect(descriptionFromPrompt(m, 'Open World')).toBe('Open World');
    }
  });
  it('a real request still names its app', () => {
    expect(nameFromPrompt('Build a water drinking reminder app which reminds me to drink water')).toBe('Water Drinking Reminder');
  });
  it('a project that already has the junk title is renamed by the next build', () => {
    expect(titleFromIndexHtml('<title>Continue the build from</title>')).toBeNull();
    const html = '<!doctype html><html><head><title>Continue the build from</title></head><body></body></html>';
    const d = resolveAppDisplayName({ indexHtml: html, prompt: 'ek bada GTA jaisa open world game banao' });
    expect(d.name).not.toMatch(/continue/i);
    expect(planAppDefaults(html, d.name, { description: d.description, shortName: d.shortName }).indexHtml).not.toMatch(/Continue the build/);
  });
  it('🔒 the route names the app from the request the turn continues', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('resolveAppDisplayName({ chosenName: chosenAppName, indexHtml, prompt: checksRequest, appSource, adServingPlayer })');
  });
});

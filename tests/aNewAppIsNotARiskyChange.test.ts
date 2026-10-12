// AUTOPSY 303e8a6f (2026-10-12), item D — CHANGE_CLASSIFIED read "large (risk high, depth deep); also security,
// cross-cutting, bug, feature" for a NEW build of the first starter chip, and CHANGE_RECORDED "CHG-0001 large/deep ·
// 14 file(s)" — 14 files that were all our own template, on a build the user stopped before anything was written.
// The user's History showed it as "Large change · Stopped".
//
// Two causes: the EDIT classifier ran on new builds (where every feature word of the requested app reads as a claim
// about changing an app that does not exist yet — 39 of 41 starter chips came out "deep"), and words that DESCRIBE
// the app ("needs no API key", "friendly error messages", "light/dark mode") were read as what is asked. The change
// record also counted the untouched template, which the bill and the review had already learned not to do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyChange, classifyNewApp, describeChangeClassification, CHANGE_KINDS } from '../src/server/AgentV3/changeEngine/changeClassifier';
import { beginChange } from '../src/server/AgentV3/changeEngine/changeSession';
import { parseEngineeringMemory, emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { publicAppMemory } from '../src/server/AgentV3/changeEngine/publicView';
import { reviewChangedPaths } from '../src/server/AgentV3/ReviewerAgent';
import { withoutDescribedFeatures, withoutNegatedNeeds } from '../src/server/lib/describedFeatures';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { RETIRED_CHIP_PROMPTS } from '../src/server/AgentV3/goldenScaffolds/registry';

const REPORT_PROMPT = RETIRED_CHIP_PROMPTS['ai-image']![0]!; // the report's own prompt, verbatim

describe('1 · a new build is a new app, not a risky change to one', () => {
  it('the report\'s prompt', async () => {
    const b = await beginChange({ workspaceId: 'ws-303e8a6f', prompt: REPORT_PROMPT, isEdit: false, requested: [] });
    expect(b.session.classification.kind).toBe('new-app');
    expect(b.reportLine).not.toMatch(/\b(?:large|security|cross-cutting|bug|risk high|depth deep)\b/);
    expect(describeChangeClassification(classifyNewApp(REPORT_PROMPT))).toMatch(/^New app \(\d+ part\(s\) named\) — no earlier app on record to preserve$/);
  });

  it.each(STARTER_TEMPLATES.map((t) => [t.id, t.prompt]))('🔒 census — chip %s', async (_id, prompt) => {
    const b = await beginChange({ workspaceId: `ws-${_id}`, prompt, isEdit: false, requested: [] });
    expect(b.session.classification.kind).toBe('new-app');
  });

  it('🔒 the only production call of the edit classifier is behind isEdit', () => {
    const session = readFileSync('src/server/AgentV3/changeEngine/changeSession.ts', 'utf8');
    expect(session).toContain('const classification = input.isEdit ? classifyChange(input.prompt) : classifyNewApp(input.prompt);');
    expect(session.match(/classifyChange\(/g)?.length).toBe(1);
  });
});

describe('2 · a stored new-app record survives, and the user reads "New app"', () => {
  it('parse keeps it and the History card names it', () => {
    const mem = emptyMemory();
    mem.changes.push({ id: 'CHG-0001', ts: 1, summary: 'AI image', kind: 'new-app', risk: 'medium', depth: 'standard', requirements: [], issues: [], files: [], status: 'stopped' } as never);
    const back = parseEngineeringMemory(JSON.parse(JSON.stringify(mem)));
    expect(back.changes.map((c) => c.kind)).toEqual(['new-app']);
    expect(publicAppMemory(back).changes[0]!.kind).toBe('New app');
  });

  it('every kind the classifier can emit is stored and named', () => {
    for (const kind of CHANGE_KINDS) {
      const mem = emptyMemory();
      mem.changes.push({ id: 'CHG-0001', ts: 1, summary: 'x', kind, risk: 'medium', depth: 'standard', requirements: [], issues: [], files: [], status: 'completed' } as never);
      const back = parseEngineeringMemory(JSON.parse(JSON.stringify(mem)));
      expect(back.changes.length, kind).toBe(1);
      if (kind !== 'local') expect(publicAppMemory(back).changes[0]!.kind, kind).not.toBe('Change');
    }
  });
});

describe('3 · an edit is read by what it ASKS, not by what it describes', () => {
  it('described features do not make a security change or a bug fix', () => {
    expect(classifyChange('the app needs no API key, use the free engine').kinds).not.toContain('security');
    expect(classifyChange('add friendly error messages with a Try again button').kind).toBe('feature');
    expect(withoutNegatedNeeds('use the free image engine that needs no API key')).not.toMatch(/api key/i);
    expect(withoutDescribedFeatures('show friendly error messages and needs no login')).not.toMatch(/error|login/);
  });

  it('a real request keeps its reading', () => {
    expect(classifyChange('fix the api key leak in the frontend').kinds).toContain('security');
    expect(classifyChange('the delete button is not working').kind).toBe('bug');
    expect(classifyChange('fix the error').kind).toBe('bug');
    expect(classifyChange('add dark mode to the app').kind).toBe('cross-cutting');
    expect(classifyChange('add google login').kinds).toContain('integration');
  });
});

describe('4 · the change record counts what the build changed — never our template', () => {
  it('🔒 the settle reads the same helper as the bill and the review', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const settle = route.slice(route.indexOf('settleChange(changeSession, {'), route.indexOf('settleChange(changeSession, {') + 700);
    expect(settle).toMatch(/files: reviewChangedPaths\(writtenFiles, finishingPaths, preseededGolden\)/);
    expect(settle).not.toMatch(/files: \[\.\.\.writtenFiles\.keys\(\)\]/);
  });

  it('an untouched template is zero files; one rewritten file is one', () => {
    const seeded = new Map(Array.from({ length: 14 }, (_, i) => [`f${i}.ts`, `c${i}`] as [string, string]));
    expect(reviewChangedPaths(new Map(seeded), new Set(), seeded)).toEqual([]);
    const written = new Map(seeded); written.set('f0.ts', 'rewritten');
    expect(reviewChangedPaths(written, new Set(), seeded)).toEqual(['f0.ts']);
  });
});

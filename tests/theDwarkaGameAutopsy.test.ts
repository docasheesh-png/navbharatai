// Autopsy 39955124 (2026-10-01) — a 79-line "Dwarkadhish" adventure-game spec typed on a phone (one
// feature per line, no bullet markers). The builder was ordered an "about page" it was never asked for,
// the release gate said "the typecheck did not run" beside six clean typechecks, a planner sub-agent spent
// 116 s re-reading files the lead had just read, and a single-player game was asked about user roles.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { requestedFeatureLabels } from '../src/server/AgentV3/RequirementCoverage';
import { readsAsSpecification, countEnumeratedFeatures, enumeratedFeatureItems } from '../src/server/AgentV3/enumeratedFeatures';
import { detectMegaProject } from '../src/server/AgentV3/ProjectPlan';
import { BuildDiagnostics, clipCommand, CMD_TEXT_CAP } from '../src/server/AgentV3/BuildDiagnostics';
import { robustTscCommand } from '../src/server/AgentV3/tscCommand';
import { isPlanningOnlyRole, PLAN_YOURSELF_NOTE } from '../src/server/AgentV3/AgentRegistry';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const read = (p: string) => readFileSync(p, 'utf8');
const PROMPT = read('tests/fixtures/autopsy39955124.prompt.txt');

describe('a list typed one feature per line is a list', () => {
  it('the real prompt reads as a specification, so nothing is restated as an order', () => {
    expect(readsAsSpecification(PROMPT)).toBe(true);
    expect(requestedFeatureLabels(PROMPT)).toEqual([]);
  });
  it('the project gates count exactly as before — a one-app spec is not decomposed', () => {
    expect(countEnumeratedFeatures(PROMPT)).toBeLessThan(14);
    expect(detectMegaProject(PROMPT)).toBe(false);
  });
  it('only lines under a colon opener count, and the next heading is not an item', () => {
    const p = 'A shop game\nInclude:\nInventory system\nDaily challenges\nSide quests\nVisual Style\nUse a cinematic look:\nGolden sunsets\nBlue ocean\nTemple bells';
    const items = enumeratedFeatureItems(p, { plainLines: true });
    expect(items).toEqual(expect.arrayContaining(['inventory system', 'daily challenges', 'side quests', 'golden sunsets']));
    expect(items).not.toContain('visual style');
    // no colon opener ⇒ plain lines count nothing
    expect(enumeratedFeatureItems('Build a todo app\nwith dark mode\nreminders\nand tags', { plainLines: true })).toEqual([]);
  });
  it('a sentence whose commas surround a clause is prose', () => {
    expect(enumeratedFeatureItems('Include respectful, non-combat-focused appearances of Lord Krishna and other mythological characters as important story characters, guides, or quest-givers.')).toEqual([]);
  });
});

describe('"about" and "contact" are words before they are pages', () => {
  it('a preposition orders nothing', () => {
    for (const p of ['a quiz app where kids learn about planets', 'learn about the stories of Dwarka', 'contact the seller on WhatsApp from the product card']) {
      const labels = requestedFeatureLabels(p);
      expect(labels).not.toContain('about page');
      expect(labels).not.toContain('contact page');
    }
  });
  it('the page senses still read', () => {
    for (const p of ['a portfolio with an about page', 'add an About Us section', 'website with pages: Home, About, Services, Contact', 'home | about | contact']) {
      expect(requestedFeatureLabels(p)).toContain('about page');
    }
    for (const p of ['a contact form', 'add a Contact Us page', 'contact page with a map', 'about and contact pages']) {
      expect(requestedFeatureLabels(p)).toContain('contact page');
    }
  });
});

describe('a typecheck is recognised however long its preamble is', () => {
  it('the platform typecheck is longer than the cap, and the clipped command still names tsc --noEmit', () => {
    const cmd = robustTscCommand('--noEmit --incremental --tsBuildInfoFile /tmp/x.tsbuildinfo', '2>&1 | head -120');
    expect(cmd.length).toBeGreaterThan(CMD_TEXT_CAP);
    const clipped = clipCommand(cmd);
    expect(clipped.length).toBeLessThanOrEqual(CMD_TEXT_CAP);
    expect(clipped).toMatch(/tsc --noEmit/);
    expect(clipCommand('npm test')).toBe('npm test');
  });
  it('a clean write-time typecheck is evidence for the release gate', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: robustTscCommand('--noEmit', '2>&1 | head -120'), exitCode: null, stdout: '', stderr: '' });
    expect(d.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(d.agentRunEvidence().typecheck).toBe('passed');
  });
});

describe('planning is the lead\'s job', () => {
  it('planning-only roles are not delegated; builders and checkers still are', () => {
    for (const r of ['planner', 'requirement', 'product']) expect(isPlanningOnlyRole(r)).toBe(true);
    for (const r of ['frontend', 'backend', 'reviewer']) expect(isPlanningOnlyRole(r)).toBe(false);
    expect(PLAN_YOURSELF_NOTE).toMatch(/update_todo/);
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(src).toContain('if (isPlanningOnlyRole(role)) return PLAN_YOURSELF_NOTE;');
  });
});

describe('a single-player game is not asked about user roles', () => {
  it('no roles/scale questions for a solo game; a multiplayer game still gets them', () => {
    const solo = analyzeRequirementGaps(PROMPT);
    expect(solo.domain).toBe('game');
    expect(solo.clarifyingQuestions.join(' ')).not.toMatch(/user roles|how many users/);
    const multi = analyzeRequirementGaps('a multiplayer racing game with a global leaderboard');
    expect(multi.clarifyingQuestions.join(' ')).toMatch(/how many users/);
  });
});

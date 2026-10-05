// A PROJECT WHOSE FILES AND BUILD SETUP DISAGREE ON THE FRAMEWORK IS ASKED ABOUT, NOT THRASHED ON
// (Q-144, admin-approved (b) 2026-10-05; autopsy a4be5a05 — an 18-minute thrash on a .svelte tree over a
// React package.json). The turn asks which framework before a file is written; the answer resumes the request.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  frameworkMismatchFromListing, messageNamesAFramework, answersFrameworkQuestion, frameworkQuestionMarker,
  frameworkQuestionSteer, frameworkAnswerNote,
} from '../src/server/AgentV3/frameworkQuestion';
import { wasBuildRequest } from '../src/server/AgentV3/planningRequest';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

const reactPkg = JSON.stringify({ dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' }, scripts: { build: 'tsc && vite build' } });
const sveltePaths = ['src/routes/+page.svelte', 'src/routes/+layout.svelte', 'src/lib/Card.svelte', 'package.json'];

describe('detecting the mismatch from the listing alone', () => {
  it('a .svelte tree on a React package.json is the a4be5a05 case', () => {
    const c = frameworkMismatchFromListing(sveltePaths, reactPkg);
    expect(c.ok).toBe(false);
    expect(c.sourceFramework).toBe('sveltekit');
  });

  it('a real Svelte project (svelte in its deps) is coherent, and so is a plain React one', () => {
    expect(frameworkMismatchFromListing(sveltePaths, JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^4.0.0' } })).ok).toBe(true);
    expect(frameworkMismatchFromListing(['src/App.tsx', 'src/main.tsx'], reactPkg).ok).toBe(true);
  });

  it('no package.json is not a mismatch (nothing to judge)', () => {
    expect(frameworkMismatchFromListing(sveltePaths, null).ok).toBe(true);
  });
});

describe('asking, and reading the answer', () => {
  it('a message that names a framework is never asked about', () => {
    expect(messageNamesAFramework('convert this to React and add a cart')).toBe(true);
    expect(messageNamesAFramework('add a cart page')).toBe(false);
  });

  it('a framework name or a short option pick answers the question; an unrelated message does not', () => {
    expect(answersFrameworkQuestion('svelte rakho')).toBe(true);
    expect(answersFrameworkQuestion('1')).toBe(true);
    expect(answersFrameworkQuestion('pehla wala')).toBe(true);
    expect(answersFrameworkQuestion('what is the difference between these, and which one is faster for a shop with many products?')).toBe(false);
  });

  it('the steer asks with two options and builds nothing; the note carries the answer to the builder', () => {
    const c = frameworkMismatchFromListing(sveltePaths, reactPkg);
    const steer = frameworkQuestionSteer(c);
    expect(steer).toContain('Do NOT build or change anything');
    expect(steer).toContain('1) keep sveltekit');
    expect(frameworkAnswerNote('keep svelte')).toContain('Their answer: "keep svelte"');
    expect(frameworkQuestionMarker(c)).toBe('framework-question:sveltekit->vite-react');
  });

  it("the question turn is remembered with its own lane, and is never read as a build request", () => {
    const mem = new WorkspaceMemory();
    mem.recordRequest('add a cart page', undefined, 'framework');
    expect(mem.lastRequestTurn()?.lane).toBe('framework');
    expect(wasBuildRequest({ text: 'add a cart page', lane: 'framework' })).toBe(false);
  });
});

describe('the wiring', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the routing step asks once per mismatch, before any build, and never on an import', () => {
    expect(route).toContain('const coherence = frameworkMismatchFromListing(projectFilePaths, pkg?.[\'package.json\']);');
    expect(route).toMatch(/if \(!askedBefore\) \{\s*mem\.recordNote\(marker\);\s*askFramework = coherence;/);
    expect(route).toContain("+ (askFramework ? frameworkQuestionSteer(askFramework) : '')");
    expect(route).toContain("askFramework ? 'framework' : answerThenOffer ? 'offer' : 'chat'");
  });

  it('an answer resumes the asked-about request as an edit, with the choice attached', () => {
    expect(route).toMatch(/lastRequestTurn\.lane === 'framework'[\s\S]{0,200}answersFrameworkQuestion\(typedPrompt\)/);
    expect(route).toContain('prompt = `${lastRequestTurn.text}\\n\\n${frameworkAnswerNote(typedPrompt)}`;');
  });
});

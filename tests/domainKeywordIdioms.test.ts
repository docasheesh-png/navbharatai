import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeRequirementGaps,
  buildRequirementGuidance,
  missingDomainFeatures,
  stripNonDomainUses,
} from '../src/server/lib/RequirementGapAnalyzer';

/**
 * AUTOPSY 424ecdab (2026-09-14) — "your job is to tell me" built a recruitment ATS.
 *
 * The user asked for a persona:
 *   "You are my ruthless mentor. Dont sugar coat anything. if my idea is weak call it trash and tell
 *    me why. your job is to tell me until it's a bullet proof"
 *
 * `\bjob\b` matched "your **job** is to tell me". The analyzer returned `domain: 'jobs'`, the
 * requirement-awareness block was prepended to the build prompt as an INSTRUCTION, and the model —
 * which had already answered correctly, "Got it. I'll be your ruthless mentor" — reversed itself
 * thirty seconds later in its own words: "I'm treating this as a jobs app (the requirement awareness
 * flagged it)". 15.2 minutes, 19 files, a full job board, RELEASE_GATE RED.
 *
 * 🔴 The corpus test in RequirementGapAnalyzer.test.ts calls itself "the tripwire for the whole
 * class", and it could not have caught this: every case in it is a SUBSTRING leak (cartoon / photoshop
 * / mobile-friendly), all cured by `\b`. `\bjob\b` is already anchored. The class is "a keyword is
 * also ordinary English"; substrings are one species of it. This file is the tripwire for the other.
 */

const REPORT_PROMPT =
  "You are my ruthless mentor.Dont sugar coat anything.if my idea is weak call it trash and tell me why .your job is to tell me until it's a bullet proof";

describe('the reported build: a persona request must not become an app', () => {
  it('the exact prompt no longer selects the jobs domain', () => {
    expect(analyzeRequirementGaps(REPORT_PROMPT).domain).toBe('general');
  });

  it('and therefore no feature list is injected into the build prompt', () => {
    const g = buildRequirementGuidance(analyzeRequirementGaps(REPORT_PROMPT));
    expect(g).toBe('');
    // The exact sentence that turned the model around.
    expect(g).not.toMatch(/REQUIREMENT AWARENESS/);
    expect(g).not.toMatch(/interview scheduling|candidate pipeline|employer/i);
  });
});

/**
 * THE LAW: ordinary English may never select a domain. Swept before the fix, 22 of these 26 sentences
 * selected one — "good job!" → jobs, "in order to make this faster" → ecommerce, "of course" →
 * education, "add a click event listener" → events, "the database driver keeps timing out" →
 * logistics, "a team of three developers" → saas. Every one would have been handed that domain's
 * implicit-feature list to BUILD.
 */
describe('ordinary English is not a domain', () => {
  const INNOCENT: Array<[string, string]> = [
    ['the report prompt', REPORT_PROMPT],
    ['praise', 'good job!'],
    ['a duty', 'do your job properly'],
    ['a duty, stated', 'your job is to help me'],
    ['purpose, not a customer order', 'in order to make this faster, cache the result'],
    ['agreement, not a syllabus', 'of course, keep the existing behaviour'],
    ['a DOM event, not a conference', 'add a click event listener to the button'],
    ['a CSS property, not a house', 'set the CSS property on the element'],
    ['a layout, not an apartment', 'use a flat design with flat colours'],
    ['following instructions, not a user', 'follow these steps and tell me what you see'],
    ['a navigation menu, not food', 'add a hamburger menu to the navbar'],
    ['an HTTP POST, not a social post', 'send a POST request to the API endpoint'],
    ['a background task, not employment', 'run this as a background job in a queue'],
    ['continue, not a CV', 'resume the build from where you left off'],
    ['a device driver, not a rider', 'the database driver keeps timing out'],
    ['a support ticket, not an event ticket', 'open a support ticket when it fails'],
    ['a plain question', 'explain how the code works'],
    ['a capability question', 'what can you generate?'],
    ['a persona', 'act as a senior engineer and review my idea'],
    ['a persona, in Hindi', 'you are a helpful assistant, answer in Hindi'],
    ['store as a verb', 'store the result in local storage'],
    ['arithmetic, not merchandise', 'the product of two numbers'],
    ['a group of people, not a SaaS tenant', 'a team of three developers'],
    ['ordering a list', 'sort the rows ordered by date'],
    ['reading material', 'a list of the books I have read'],
    ['an error message', 'show an error message when it fails'],
  ];

  for (const [why, prompt] of INNOCENT) {
    it(`${why}: "${prompt.slice(0, 46)}" → general`, () => {
      expect(analyzeRequirementGaps(prompt).domain).toBe('general');
    });
  }
});

/**
 * Narrowing is only safe if the GENUINE signal survives. Removal can only ever DELETE evidence, so it
 * cannot invent a domain — but it CAN destroy one, which is the single way this fix could hurt a real
 * build. Every domain that has a keyword touched above is asserted to still classify.
 */
describe('the genuine request still classifies — stripping must never cost a real domain', () => {
  const GENUINE: Array<[string, string]> = [
    ['a recruitment platform for hiring candidates with resume upload', 'jobs'],
    ['a job board where employers post vacancies and candidates apply', 'jobs'],
    ['an online store with a product catalog, cart and checkout', 'ecommerce'],
    ['Build an online store', 'ecommerce'],
    ['an app to manage a tech conference with tickets and check-in', 'events'],
    ['a real estate property listing portal', 'real-estate'],
    ['a property portal', 'real-estate'],
    ['a restaurant POS with menu management, KOT and GST billing', 'restaurant'],
    ['a courier delivery tracking app with driver assignment', 'logistics'],
    ['a hotel booking site with room availability and payments', 'booking'],
    ['a ticket reservation app', 'booking'],
    ['an app to rent equipment by the hour', 'booking'],
    ['build an LMS for a coaching institute with courses and exams', 'education'],
    ['a social app with a feed, posts, likes, comments and friends', 'social'],
    ['a realtime chat app with rooms, message history and user profiles', 'social'],
    ['a B2B SaaS with team workspaces, roles and subscription billing', 'saas'],
    ['a hospital management system with patient records and appointments', 'healthcare'],
    ['a gym membership and workout tracking app', 'fitness'],
    ['a mobile wallet app with UPI and KYC', 'fintech'],
  ];

  for (const [prompt, domain] of GENUINE) {
    it(`"${prompt.slice(0, 46)}" → ${domain}`, () => {
      expect(analyzeRequirementGaps(prompt).domain).toBe(domain);
    });
  }

  it('a genuine jobs prompt still gets its real implicit features', () => {
    const g = analyzeRequirementGaps('a job board for employers to post vacancies');
    expect(g.domain).toBe('jobs');
    expect(g.likelyMissing).toContain('interview scheduling');
  });
});

describe('stripNonDomainUses', () => {
  it('removes the idiom and leaves everything else', () => {
    expect(stripNonDomainUses('your job is to tell me')).not.toMatch(/\bjob\b/);
    expect(stripNonDomainUses('your job is to tell me')).toMatch(/tell me/);
  });

  it('never removes a genuine domain word', () => {
    expect(stripNonDomainUses('post a job vacancy for candidates')).toMatch(/\bjob\b/);
  });

  it('survives junk input', () => {
    expect(() => stripNonDomainUses(null as unknown as string)).not.toThrow();
    expect(stripNonDomainUses(undefined as unknown as string)).toBe('');
  });

  it('is applied by BOTH entry points, so the two cannot drift', () => {
    // The sibling that a fix applied to one lane would have missed (the `a38c6fef` shape).
    expect(missingDomainFeatures('your job is to review my idea', '').domain).toBe('general');
    expect(missingDomainFeatures('a job board for employers', '').domain).toBe('jobs');
  });
});

/**
 * THE SECOND LAYER: a domain, however it was selected, may not become an INSTRUCTION on a turn where
 * the user never asked for an app. The two halves of the guidance are gated differently on purpose.
 */
describe('guidance is withheld when no app was asked for', () => {
  const jobsGaps = analyzeRequirementGaps('a job board for employers to post vacancies');

  it('the domain half is withheld', () => {
    expect(buildRequirementGuidance(jobsGaps, { userAskedForAnApp: false })).not.toMatch(/REQUIREMENT AWARENESS/);
  });

  it('and delivered when an app WAS asked for', () => {
    expect(buildRequirementGuidance(jobsGaps, { userAskedForAnApp: true })).toMatch(/REQUIREMENT AWARENESS/);
  });

  it('defaults to delivering it, so every existing caller is byte-identical', () => {
    expect(buildRequirementGuidance(jobsGaps)).toBe(buildRequirementGuidance(jobsGaps, { userAskedForAnApp: true }));
  });

  it('the INDIA half is NOT gated — it restates the market the user named, and invents no app', () => {
    const g = analyzeRequirementGaps('a billing tool for a kirana store in ₹ with GST');
    const withheld = buildRequirementGuidance(g, { userAskedForAnApp: false });
    expect(withheld).toContain('INDIA-FIRST');
    expect(withheld).toContain('₹');
    expect(withheld).not.toMatch(/REQUIREMENT AWARENESS/);
  });
});

describe('the route asks the app question, not the routing question', () => {
  const routes = fs.readFileSync(path.join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('passes userAskedForAnAppToBeBuilt into the guidance builder', () => {
    // 2026-09-18: the call site binds it to a name first, because the GENERATED long-tail path added
    // beside it must answer the same question from the same source rather than asking its own. The
    // invariant is unchanged — this value comes from the prompt, never from `intent`.
    expect(routes).toContain('const askedForAnApp = userAskedForAnAppToBeBuilt(prompt);');
    expect(routes).toContain('userAskedForAnApp: askedForAnApp,');
  });

  it('the generated long-tail guidance is gated on that SAME answer', () => {
    expect(routes).toContain('if (!reqGuidance && askedForAnApp && !answered)');
  });

  it('does not reuse the intent verdict for it', () => {
    // `intent` answers "which lane runs this turn?". Reusing one verdict for two questions is the
    // documented shape that let a widening silently cancel a narrowing without a test failing.
    expect(routes).not.toContain("userAskedForAnApp: intent === 'new_build'");
  });
});

// 💡 SUGGESTIONS FROM WHAT THE LAST BUILD ACTUALLY MEASURED (admin 2026-08-20: "us app ki memory ke
// hisab se suggestion ane chahiye, aise random nahi").
//
// This is the second half of linking the bulb to the app's memory. The first half reads what the user
// ASKED FOR (memoryLinkedSuggestions). This one reads what the build itself FOUND — the diagnostics
// report saved for this workspace: pages that came out plain, dependencies with known vulnerabilities,
// a test suite that failed, errors the app threw when it ran. Those are measured facts about THIS app,
// which is exactly what "not random" means.
//
// WHY A CURATED TABLE RATHER THAN THE ISSUE'S OWN MESSAGE. A diagnostic message is written for an
// engineer reading an autopsy — it names files, tools and sometimes providers. Surfacing it raw would
// be unreadable to the user AND a White-Label risk. So each code maps to a sentence written for the
// person who pressed the button, and a code with no entry produces NOTHING. That is deliberate: a
// finding we cannot phrase honestly and usefully is better left out than paraphrased by guesswork.
//
// WHAT IS DELIBERATELY EXCLUDED, and why each one would be a bug if included:
//   • autoResolved issues — the build already fixed them; suggesting a fix for a fixed thing is noise.
//   • observations — findings about the user's PRE-EXISTING code that our build did not cause.
//   • summary codes (RELEASE_GATE) — a roll-up of other findings; it would duplicate them.
//   • measurement-only codes (TIME_TO_FIRST_CALL, RUNTIME_UNCHECKED, TEST_SUITE_UNVERIFIED,
//     JOURNEY_NOT_DERIVED) — they record what WE could not verify, not something the user's app can
//     fix. Asking the user to "fix" our own missing measurement would be dishonest.
//
// PURE: no I/O, no clock, no model. Never throws.

import type { NextSuggestion } from './nextBuildSuggestions';

/** The subset of a diagnostics issue this module needs — kept structural so the report type is free to grow. */
export interface FindingLike {
  code: string;
  autoResolved?: boolean;
  observation?: boolean;
  severity?: string;
}

/** How many build-finding suggestions may appear at once — the list has other layers to show. */
export const MAX_FINDING_SUGGESTIONS = 3;

/**
 * Code → what to offer the user. Ordered by how much the user would feel the difference.
 *
 * Every string here is user-facing: plain language, no tool names, no provider names, no file paths.
 */
const FINDING_SUGGESTIONS: Array<{ code: string; title: string; detail: string; prompt: string }> = [
  {
    code: 'RUNTIME_ERRORS_REMAIN',
    title: 'Fix the errors your app showed',
    detail: 'When the app ran, it reported errors that are still there.',
    prompt: 'When the app runs it reports errors in the browser console. Find the cause of each one and fix it properly, then confirm the app runs clean.',
  },
  {
    code: 'JOURNEY_FAILED',
    title: 'Make saving actually work',
    detail: 'Something added in the app did not survive a reload.',
    prompt: 'When I add something in the app and reload the page, it disappears. Make the data actually persist so it is still there after a reload.',
  },
  {
    code: 'PAGE_RENDER_FAILED',
    title: 'Fix the page that did not load',
    detail: 'At least one page failed to open properly.',
    prompt: 'One of the pages does not load properly. Find out why and fix it, then check that every page opens.',
  },
  {
    code: 'DESIGN_PAGE_INCONSISTENT',
    title: 'Make the inside pages look as good as the first',
    detail: 'Some pages are plainer than the main screen.',
    prompt: 'Some inner pages look plain compared to the main screen. Give every page the same visual quality: proper headings, spacing, styled tables and lists, and a friendly empty state.',
  },
  {
    code: 'DEPENDENCY_VULNERABILITIES',
    title: 'Update the unsafe libraries',
    detail: 'The app uses libraries with known security problems.',
    prompt: 'The app depends on libraries with known security vulnerabilities. Update them to safe versions without changing how the app behaves, and make sure it still builds and runs.',
  },
  {
    code: 'ACCESSIBILITY',
    title: 'Make it usable for everyone',
    detail: 'Some buttons and inputs cannot be used with a screen reader.',
    prompt: 'Make the app accessible: give every icon-only button an accessible name, label every form input, and make sure everything can be reached and used with the keyboard.',
  },
  {
    code: 'TEST_SUITE',
    title: 'Fix the failing tests',
    detail: "The app's own tests did not pass.",
    prompt: "The app's own test suite is failing. Find out why each test fails and fix the real cause in the app, then make the suite pass.",
  },
  {
    code: 'INTEGRITY_CIRCULAR_DEP',
    title: 'Untangle the circular imports',
    detail: 'Two files import each other, which can break the app at runtime.',
    prompt: 'There are circular imports between files. Restructure them so nothing imports in a circle, and confirm the app still builds and runs.',
  },
  {
    code: 'SPA_FALLBACK_MISSING',
    title: 'Stop the blank page on refresh',
    detail: 'Refreshing an inner page can show nothing.',
    prompt: 'Refreshing an inner page shows a blank page or a 404. Fix the routing fallback so any page can be opened or refreshed directly.',
  },
];

/** Codes that must never become a suggestion — see the header for why each is excluded. */
const NEVER_SUGGEST = new Set([
  'RELEASE_GATE', 'TIME_TO_FIRST_CALL', 'RUNTIME_UNCHECKED', 'RUNTIME_VERIFIED',
  'TEST_SUITE_UNVERIFIED', 'JOURNEY_NOT_DERIVED', 'CLAIM_UNSUPPORTED', 'PREVIEW_UNVERIFIED',
  'PREVIEW_SERVER_RESTARTED',
]);

/**
 * Suggestions derived from the last build's own findings.
 *
 * Only UNRESOLVED, non-observation findings count: a problem the build already fixed, or one that was
 * never ours, is not something to offer the user as their next move.
 */
export function buildFindingSuggestions(
  findings: ReadonlyArray<FindingLike> | null | undefined,
  max: number = MAX_FINDING_SUGGESTIONS,
): NextSuggestion[] {
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) return [];

  const open = new Set<string>();
  for (const f of list) {
    const code = String(f?.code || '').trim();
    if (!code || NEVER_SUGGEST.has(code)) continue;
    if (f?.autoResolved === true) continue;   // the build already dealt with it
    if (f?.observation === true) continue;    // pre-existing user code, not something our build caused
    open.add(code);
  }
  if (open.size === 0) return [];

  const out: NextSuggestion[] = [];
  // Table order, not report order: the table is ranked by how much the user would feel the difference.
  for (const entry of FINDING_SUGGESTIONS) {
    if (!open.has(entry.code)) continue;
    out.push({
      id: `found-${entry.code.toLowerCase().replace(/_/g, '-')}`,
      title: entry.title,
      detail: entry.detail,
      prompt: entry.prompt,
      kind: 'domain',   // specific to THIS app's measured state, never universal polish
    });
    if (out.length >= Math.max(1, max)) break;
  }
  return out;
}

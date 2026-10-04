// 🔴 A PROBLEM WE SHOW THE USER IS EITHER OURS TO OWN OR THEIRS TO PRESS — census, 2026-10-04.
//
// THE DEFECT, MEASURED RATHER THAN SUSPECTED. Two hand-maintained lists decide what a build finding
// means to the person who pressed the button: `PROCESS_ONLY_CODES` (BuildDiagnostics.ts) says "this is
// our own run, never a mark against the app", and `FINDING_SUGGESTIONS` (buildFindingSuggestions.ts)
// says "this is the app's defect, and here is the one-tap fix". Every autopsy added a name to one of
// them — always AFTER the defect had already reached a user. Counting the codes showed how far that had
// drifted: **82 codes recorded at warning or error severity were in neither list.** For each of them
// `isAppFinding` answered YES, so it landed in the user's build-health card as a problem with THEIR app
// and took 6 points off their app's health score (`buildHealthCard.ts`) — and none of them had a button.
//
// Both directions were real:
//  • OURS, charged to them: `COST_CEILING_REACHED` ("Build stopped at its cost ceiling") is called
//    admin-only in CLAUDE.md. `HEAL_NOT_DURABLE`'s own comment at its recording site reads *"ADMIN-ONLY:
//    the user never sees our repair passes"*. Both were user-facing anyway, beside our loop breaker, our
//    typecheck that could not execute, our green guard that could not look, our summary's own wording,
//    our setup time, and a database we OFFERED to create for them.
//  • THEIRS, with nothing to press: `DATABASE_RLS` — tables with no row-level security, which for a
//    published app means anyone who opens it can read and write every row — was recorded at ERROR
//    severity with no offer at all. Beside it: an app that never came up, an app that opened blank, a
//    page that worked before and now does not, a chat whose replies are hardcoded text, a crash on odd
//    input, missing styles, and an imported project that would not boot.
//
// WHAT THIS TEST IS. The fix for the instances is in those two modules. This is the fix for the CLASS:
// it reads the REAL registries out of the REAL modules (never a copy — a copy is the drift), scans the
// server source for every finding the engine records, and fails when a problem-severity code is in none
// of the three homes. A new code cannot reach a user unclassified again.
//
// ⚠️ THE SCANNER UNDER-REPORTS BY DESIGN, so it can never invent a failure. A code assembled at runtime
// (`code: \`OUTCOME_${outcome}\``) is not a literal and is not seen; a `phase`/`severity` written as an
// expression is treated as "could be a problem" and therefore REQUIRES a home. The canary below is what
// catches a scanner that silently stops matching — the failure mode a census like this actually has.
//
// 🔒 AND IT IS A RATCHET, NOT A BIG BANG — this repo's own pattern (`tests/themeTokensOnly.test.ts` plus
// `themeColourBaseline.json`: "the number only goes down"). Written strictly, the census found **82**
// codes with no home, not the 26 a hand count had found: a brace-balanced scan also sees the findings
// written over six lines and the ones whose severity is an expression. Classifying 82 codes in one change
// would be 82 rushed judgement calls about what a user should be told, several of them genuinely
// ambiguous (the `OUTCOME_*` roll-ups, `TOOL_ERROR`, `STUCK_TOOL`), and some of them billing decisions.
// So the backlog is recorded in `tests/fixtures/findingClassificationBaseline.json` and may only SHRINK:
// a NEW unclassified code fails CI, and a code that has since been classified fails CI until the baseline
// is regenerated smaller. The twenty-six codes this change classifies (8 kept out of the card + 13 given
// a button + 5 declared) are already out of it; 56 of the 82 remain.
//
// ⚠️ AND A HAND COUNT IS NOT A CENSUS — this number was got wrong twice before it was measured. By eye the
// backlog looked like 26; the brace-balanced scan found 82, because it also sees the findings written over
// six lines and the ones whose severity is an expression (`DATABASE_RLS`, the most serious item in the
// whole list, is one of those). A later derivation of "77 before the change" was wrong too, from forgetting
// that the five DECLARED codes also count as classified. 82 − 26 = 56 is measured, not reasoned.
//
// To regenerate after classifying more:
//   UPDATE_FINDING_BASELINE=1 npx vitest run tests/aProblemTheUserIsShownCanBeActedOn.test.ts
// then commit the smaller fixture. The scanner lives here and nowhere else, so there is no second copy
// to drift — the regeneration path is the same code the assertion runs.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';
import { FINDING_SUGGESTIONS, APP_FINDINGS_WITHOUT_AN_OFFER, buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

/** Phases `isAppFinding` excludes outright — our infrastructure and our provider calls. */
const NOT_THE_APP_BY_PHASE = new Set(['provider', 'sandbox']);

interface Occurrence {
  code: string;
  phase: string | null;      // null = written as an expression, so unknown
  severity: string | null;   // null = written as an expression, so unknown
  autoResolved: boolean;
  where: string;
}

function serverSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) serverSources(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * The object literal that encloses position `i`, found by balancing braces outward.
 *
 * Balancing rather than a character window on purpose: a recorded finding routinely spans six lines and
 * contains nested objects and `${…}` interpolations, and a window either cuts the `phase:` off or picks
 * up the NEXT finding's. `${` opens a brace that closes, so the balance holds through interpolation.
 */
function enclosingObject(src: string, i: number): string {
  let depth = 0;
  let start = -1;
  for (let k = i; k >= 0; k--) {
    const c = src[k];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) { start = k; break; } depth--; }
  }
  if (start < 0) return '';
  depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  return src.slice(start);
}

/** Every finding the given source records, as literal facts where they are literal. Pure. */
export function findingOccurrences(src: string, where = 'source'): Occurrence[] {
  const out: Occurrence[] = [];
  const re = /\bcode:\s*'([A-Z][A-Z0-9_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const lit = enclosingObject(src, m.index);
    if (!lit || !/\bcode:\s*'/.test(lit)) continue;
    // Only an object that really is a recorded finding — it must carry a phase or a severity.
    if (!/\bphase:/.test(lit) && !/\bseverity:/.test(lit)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({
      code: m[1],
      phase: /\bphase:\s*'(\w+)'/.exec(lit)?.[1] ?? null,
      severity: /\bseverity:\s*'(\w+)'/.exec(lit)?.[1] ?? null,
      autoResolved: /\bautoResolved:\s*true\b/.test(lit),
      where: `${where}:${line}`,
    });
  }
  return out;
}

/** Could this recorded finding reach the user as a problem with THEIR app? Pure. */
export function couldReachTheUserAsAProblem(o: Occurrence): boolean {
  if (o.autoResolved) return false;                                  // the build already dealt with it
  if (o.phase && NOT_THE_APP_BY_PHASE.has(o.phase)) return false;    // isAppFinding excludes it by phase
  if (o.severity === 'info') return false;                           // a note, not a problem
  return true;                                                       // warning, error, or not literal
}

const OFFERED = new Set(FINDING_SUGGESTIONS.map((s) => s.code));
const BASELINE_PATH = 'tests/fixtures/findingClassificationBaseline.json';

describe('a problem the user is shown can be acted on — the census', () => {
  const occurrences = serverSources('src/server')
    .flatMap((f) => findingOccurrences(readFileSync(f, 'utf8'), f.replace('src/server/', '')));

  it('THE CANARY: the scanner really reads this codebase', () => {
    // A census whose scanner silently stops matching passes forever while proving nothing. These are
    // facts about the source as it stands, chosen so that a regex change, a rename or a move breaks the
    // canary instead of quietly emptying the census.
    expect(occurrences.length).toBeGreaterThan(200);
    const codes = new Set(occurrences.map((o) => o.code));
    expect(codes.size).toBeGreaterThan(100);
    for (const known of ['READINESS_BLOCKER', 'MOBILE_LAYOUT_ISSUES', 'DATABASE_RLS', 'COST_CEILING_REACHED']) {
      expect(codes, `the scanner no longer finds ${known}`).toContain(known);
    }
    // And it really reads the phase/severity, not just the code.
    const sandbox = occurrences.filter((o) => o.phase === 'sandbox');
    expect(sandbox.length).toBeGreaterThan(0);
  });

  const unclassified = (() => {
    const found = new Map<string, string>();
    for (const o of occurrences) {
      if (!couldReachTheUserAsAProblem(o)) continue;
      if (PROCESS_ONLY_CODES.has(o.code)) continue;
      if (OFFERED.has(o.code)) continue;
      if (APP_FINDINGS_WITHOUT_AN_OFFER.has(o.code)) continue;
      if (!found.has(o.code)) found.set(o.code, o.where);
    }
    return found;
  })();

  if (process.env['UPDATE_FINDING_BASELINE'] === '1') {
    writeFileSync(BASELINE_PATH, `${JSON.stringify([...unclassified.keys()].sort(), null, 2)}\n`);
  }
  const baseline: string[] = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

  it('NO NEW unclassified problem code — the ratchet', () => {
    const fresh = [...unclassified].filter(([c]) => !baseline.includes(c)).map(([c, w]) => `${c} (${w})`);
    expect(
      fresh,
      'A NEW build finding can reach the user as a problem with their app with nothing to press. '
      + 'Decide which it is: PROCESS_ONLY_CODES (ours, never their app), FINDING_SUGGESTIONS (their app, '
      + 'with a one-tap fix), or APP_FINDINGS_WITHOUT_AN_OFFER (their app, no button, with the reason). '
      + 'The baseline is a backlog to shrink, never a place to add to.',
    ).toEqual([]);
  });

  it('the backlog only SHRINKS — a classified code must leave the baseline', () => {
    const stale = baseline.filter((c) => !unclassified.has(c));
    expect(
      stale,
      'These codes are now classified but are still listed as a backlog. Regenerate the fixture: '
      + 'UPDATE_FINDING_BASELINE=1 npx vitest run tests/aProblemTheUserIsShownCanBeActedOn.test.ts',
    ).toEqual([]);
  });

  it('the backlog is a real, finite list — not a way to switch the census off', () => {
    // A baseline that could grow without limit is not a ratchet. This is the number on the day the
    // census was written (56), and it is the ceiling: it may fall, never rise.
    expect(baseline.length).toBeLessThanOrEqual(56);
    expect(baseline.length).toBeGreaterThan(0);
    expect(new Set(baseline).size).toBe(baseline.length);
  });

  it('REVERSION PROOF: an unclassified problem code really is caught', () => {
    const synthetic = `
      buildDiag.record({
        phase: 'build', severity: 'warning', code: 'A_BRAND_NEW_PROBLEM_2026',
        message: 'something went wrong with the app', autoResolved: false,
      });`;
    const found = findingOccurrences(synthetic, 'synthetic');
    expect(found).toHaveLength(1);
    expect(couldReachTheUserAsAProblem(found[0])).toBe(true);
    const classified = PROCESS_ONLY_CODES.has(found[0].code)
      || OFFERED.has(found[0].code) || APP_FINDINGS_WITHOUT_AN_OFFER.has(found[0].code);
    expect(classified, 'a code nobody classified must read as unclassified').toBe(false);
  });

  it('a finding cannot both have a button and be declared button-less', () => {
    // ⚠️ THE OBVIOUS THIRD RULE IS WRONG, AND WRITING IT FOUND THE REASON. "A process finding must never
    // be offered" fails on `PASTED_APP_KEPT_ONE_FILE`, which is in BOTH on purpose: keeping a pasted
    // one-file app as one file is not the app's defect (so it is process-only, and never a mark against
    // the app), AND "upgrade to a full app project" is a real next move. An offer is not always a FIX —
    // it can be an opportunity. So the two genuine contradictions are the ones asserted here, and
    // PROCESS_ONLY ∩ OFFERED is deliberately allowed.
    const bothOfferedAndDeclared = FINDING_SUGGESTIONS.map((s) => s.code).filter((c) => APP_FINDINGS_WITHOUT_AN_OFFER.has(c));
    expect(bothOfferedAndDeclared, 'a finding cannot both carry an offer and be declared to have none').toEqual([]);
    const bothProcessAndDeclared = [...APP_FINDINGS_WITHOUT_AN_OFFER].filter((c) => PROCESS_ONLY_CODES.has(c));
    expect(bothProcessAndDeclared, 'a finding declared to be about the APP cannot also be our own process').toEqual([]);
  });

  it('the eight engine codes are no longer charged to the user\'s app', () => {
    // Each of these was a WARNING with no home, so it showed in the health card and cost the app 6
    // points. Naming them individually, because this is the list the census was written from.
    for (const ours of [
      'COST_CEILING_REACHED', 'FUTILITY_BREAKER', 'VERIFY_DID_NOT_RUN', 'GREEN_GUARD_UNVERIFIED',
      'HEAL_NOT_DURABLE', 'SUMMARY_OFF_TOPIC', 'DATABASE_OFFER_AT_START', 'TIME_TO_FIRST_CALL',
    ]) {
      expect(PROCESS_ONLY_CODES.has(ours), `${ours} is our own run, never a finding about the app`).toBe(true);
    }
  });

  it('the app defects that had no button now have one, and it is written for the user', () => {
    for (const theirs of [
      'DATABASE_RLS', 'PREVIEW_NEVER_CAME_UP', 'PREVIEW_NOT_RENDERED', 'ROUTE_REGRESSION',
      'BOOT_KILLING_ENV_GUARD', 'SCRIPTED_ASSISTANT_SHIPPED', 'FUZZ_ROBUSTNESS', 'CSS_CLASSES_UNDEFINED',
      'DESIGN_CONSISTENCY', 'UI_WITHOUT_BUILD',
      'IMPORT_PREVIEW_BOOT_FAILED', 'IMPORT_PREVIEW_BOOT_CUT_OFF', 'IMPORT_DB_MIGRATIONS_FAILED',
    ]) {
      const out = buildFindingSuggestions([{ code: theirs, autoResolved: false }]);
      expect(out, `${theirs} has no one-tap fix`).toHaveLength(1);
      expect(out[0].title.length).toBeGreaterThan(8);
      expect(out[0].prompt.length).toBeGreaterThan(60);
      expect(out[0].kind).toBe('domain');
    }
  });

  it('the new offers name no vendor, no tool and no file path', () => {
    const out = buildFindingSuggestions(
      FINDING_SUGGESTIONS.map((s) => ({ code: s.code, autoResolved: false })),
      FINDING_SUGGESTIONS.length,
    );
    expect(out.length).toBe(FINDING_SUGGESTIONS.length);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Anthropic|Moonshot|Supabase|Firebase|playwright|vitest|eslint|E2B|tsc\b/i);
    // No file paths or code identifiers leaking from the diagnostic into the user's sentence.
    expect(text).not.toMatch(/src\/|\.tsx?\b|node_modules/);
  });

  it('an app that never ran is offered before anything else about it', () => {
    // Ranking is table order, and "your app never came up" outranks every nicety. Checked through the
    // real function rather than by reading the table, so a reorder that breaks it fails here.
    const out = buildFindingSuggestions([
      { code: 'DESIGN_CONSISTENCY' }, { code: 'ACCESSIBILITY' }, { code: 'PREVIEW_NEVER_CAME_UP' },
    ]);
    expect(out[0].id).toBe('found-preview-never-came-up');
  });

  it('a database with no row-level security outranks the look of the app', () => {
    const out = buildFindingSuggestions([{ code: 'DESIGN_CONSISTENCY' }, { code: 'DATABASE_RLS' }]);
    expect(out[0].id).toBe('found-database-rls');
  });
});

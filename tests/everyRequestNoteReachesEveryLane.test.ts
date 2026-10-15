// AUTOPSY 9c612cdb (2026-10-12), Q-991 — A NOTE ABOUT THE REQUEST REACHED THE LANES ITS AUTHOR REMEMBERED.
//
// NavBharatAI tells its builders things about the request before they write: a stack it does not build
// (unsupportedStack.ts), a script built as a web app (scriptRequest.ts), a word it does not know (unknownName.ts),
// "no sign-in was asked" (requestScope.ts), a keypad phone (deviceTarget.ts, Q-846), and now a video player whose
// ads the app cannot switch off (thirdPartyLimits.ts, Q-990). Four lanes build apps: the architect, the fast lane,
// the one-shot lane and the project planner. Each note was threaded into each lane BY HAND, and on main 377d915:
//
//                      architect  fast lane  one-shot  planner
//   unsupported stack      ✓          ✗          ✗         ✓
//   script request         ✓          ✓          ✓         ✓
//   unknown name           ✓          ✓          ✓         ✓
//   request scope          ✓          ✓          ✓         ✗
//   keypad phone (Q-846)   ✓          ✗          ✗         ✗   ← an earlier fix that reached ONE lane
//
// On the weak tier the fast lane writes FIRST (it wrote 9c612cdb's first three files), so a note it never sees is a
// note the app's foundation never followed. This is the a38c6fef class: a fix that reaches one lane.
//
// THE FIX: one list (`requestNotes` in agentv3.ts) that every lane reads. This census fails on today's main and on
// any future note that is threaded any other way: a note producer imported into the route must feed the list, no
// lane may read a note on its own, and each lane must read the list.
//
// …and the fast lane reads it APART from the request (`requestNotes`), because the lane's file budget is measured
// from its prompt: appended to the request, the no-login note alone took this very build's ceiling from 13 files
// to 25, and a stack or device note took any app to the 32-file maximum.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { fileBudgetForPrompt } from '../src/server/AgentV3/fileBudget';
import { REQUEST_SCOPE_NOTE } from '../src/server/AgentV3/requestScope';
import { nonSmartphoneBuildRule } from '../src/server/AgentV3/deviceTarget';

const RAW = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
/** Comments out, so a sentence ABOUT a note never counts as wiring it. */
const ROUTE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ [^\n'`"]*$/gm, '');

/**
 * Every function that writes a note about the REQUEST for the builders.
 *
 * ⚠️ THIS LIST IS NO LONGER THE CENSUS'S NET (Q-1020, 2026-10-15). It used to be kept honest by a guard that
 * matched route imports named `…BuilderNote` / `…BuildRule`, and that guard could not see a producer called
 * anything else — `requestScopeVerdict`, already listed here, is itself proof: it was added by hand because
 * no name rule caught it. Widening the rule is not the answer either: `/(?:Note|Rule|Verdict)$/` matches 73
 * of the route's imports for these 6 real producers, so the net would need a 67-name allowlist nobody would
 * read. The census now works from the SINKS — the prompts a builder lane actually reads — which needs no
 * name rule and no allowlist. See `LANE_PROMPT_SINKS`.
 */
const NOTE_PRODUCERS = [
  // `requestScopeVerdict` since #3692 (the note and its reason, read through `scope?.note`).
  'unsupportedStackBuilderNote', 'scriptRequestBuilderNote', 'unknownNameBuilderNote', 'requestScopeVerdict',
  'nonSmartphoneBuildRule', 'thirdPartyLimitsBuilderNote',
] as const;

/** The aggregator block: `const requestNotes … = [ … ];`. */
function aggregator(): string {
  const start = ROUTE.indexOf('const requestNotes: ReadonlyArray<{ code: string; text: string }> = [');
  if (start < 0) return '';
  const end = ROUTE.indexOf('];', start);
  return ROUTE.slice(start, end + 2);
}

/**
 * The variable a producer's result is stored in (`const unknownNameNote = unknownNameBuilderNote(…)`), if any — and
 * one hop further when the producer returns a record and the route keeps one field of it (`const scope =
 * requestScopeVerdict(…)` then `requestScopeText = scope?.note ?? ''`).
 */
function heldIn(producer: string): string[] {
  const out = new Set<string>();
  for (const m of ROUTE.matchAll(new RegExp(String.raw`\b(?:const|let)?\s*(\w+)\s*=\s*${producer}\(`, 'g'))) out.add(m[1]);
  for (const v of [...out]) {
    const kept = [...ROUTE.matchAll(new RegExp(String.raw`\b(\w+)\s*=\s*${v}\??\.note\b`, 'g'))].map((m) => m[1]);
    // The record's own name (`scope`) is too common to search for; the field the route keeps is the note.
    if (kept.length > 0) { out.delete(v); for (const k of kept) out.add(k); }
  }
  return [...out];
}

describe('🧭 the census: every request note reaches every lane through ONE list', () => {
  const agg = aggregator();

  it('the list exists', () => {
    expect(agg, 'no `const requestNotes = [...]` aggregator in agentv3.ts').not.toBe('');
  });

  /**
   * 🧭 THE CLASS GUARD, REBUILT FROM THE SINKS (Q-1020).
   *
   * Every place the route hands a BUILDER its request text. Each entry is matched against the route source;
   * `reads` is the exact expression that must supply the notes. A lane missing from this list is a lane
   * nobody checked, so the count is pinned: a SEVENTH prompt sink cannot be added silently.
   */
  const LANE_PROMPT_SINKS: ReadonlyArray<{ lane: string; find: RegExp; reads: string }> = [
    { lane: 'the architect', find: /buildPrompt = \[([^\]]*)\]\.filter\(Boolean\)/, reads: 'requestNotesText' },
    { lane: 'the fast lane', find: /runSimpleBuild\(\{[^\n]*?requestNotes: (\w+)/, reads: 'requestNotesText' },
    { lane: 'the one-shot lane', find: /runOneShot\(\{\s*prompt: ([^,]+),/, reads: 'requestNotesSuffix' },
    { lane: 'the project planner', find: /const plannerGoal = withRequestNotes\(prompt, (\w+)\)/, reads: 'requestNotesText' },
    { lane: 'the plan-first planner', find: /planRunner\.run\(withRequestNotes\(prompt, (\w+)\)\)/, reads: 'requestNotesText' },
    { lane: 'every writing sub-agent', find: /childRequestNotes = (\w+);/, reads: 'requestNotesText' },
  ];

  it('CLASS GUARD: every lane prompt is built from the ONE note list, by name', () => {
    for (const { lane, find, reads } of LANE_PROMPT_SINKS) {
      const m = ROUTE.match(find);
      expect(m, `${lane}: its prompt sink is gone — find it and re-pin it, do not delete the check`).toBeTruthy();
      expect(m![1], `${lane} must read ${reads}`).toContain(reads);
    }
  });

  /**
   * 🔴 WHAT THE REBUILT CENSUS FOUND ON ITS FIRST RUN, AND THE OLD ONE NEVER COULD — and it is WIDER than
   * the queue row that predicted it. Q-1016 names the blueprint lane's manifest and contract. Measured,
   * SIX builder prompts read the bare request:
   *
   *   • `manifestUserPrompt(prompt, scaffold)`  — the blueprint lane plans the whole file list blind (Q-1016);
   *   • `contractUserPrompt(prompt, manifest)`  — and its shared contract, the same lane (Q-1016);
   *   • `megaRoadmapUserPrompt(prompt, …)` ×2   — the MEGA-APP roadmap planner, which Q-1016 never mentioned:
   *     a Kotlin, keypad-phone or no-login request shapes a roadmap at least as much as a file list;
   *   • `repairUserPrompt(prompt, …)` ×2        — a repair pass. It fixes code that already exists rather
   *     than planning an app, so whether it needs the notes is a judgement, not an obvious yes — but it
   *     rewrites real files, so "no sign-in" still constrains it. Recorded, not assumed.
   *
   * None of the six is an oversight in the wiring: every one of them runs ABOVE the line where the first
   * note input is computed, so there is nothing to pass yet. Closing them means making the notes available
   * EARLIER — one computation read in both places — not threading one more argument.
   *
   * 🔒 A RATCHET, NOT AN EXCUSE. The set is pinned exactly. A SEVENTH builder prompt reading the bare
   * request fails this test, and Q-1016's fix must SHRINK this list — it cannot grow.
   */
  const UNWIRED_SINKS = [
    'manifestUserPrompt(prompt, scaffold)',
    'contractUserPrompt(prompt, manifest)',
    'megaRoadmapUserPrompt(prompt, scope.famousApp, scope.signals)',
    'megaRoadmapUserPrompt(prompt, scope.famousApp, scope.signals)',
    'repairUserPrompt(prompt, errors, currentFiles, contract, strategy, contractPath)',
    'repairUserPrompt(prompt, check.errors, currentFiles)',
  ] as const;

  it('RATCHET: only the known builder prompts still read the bare request', () => {
    const bare = [...ROUTE.matchAll(/\b(\w+UserPrompt)\(prompt\b([^)]*)\)/g)].map((m) => `${m[1]}(prompt${m[2]})`);
    const unexpected = bare.filter((b) => !(UNWIRED_SINKS as readonly string[]).includes(b));
    expect(unexpected, 'a NEW builder prompt reading the bare request — give it the notes, or add it to Q-1016').toEqual([]);
    expect(bare.length, 'the list may only SHRINK — Q-1016 is what shrinks it').toBeLessThanOrEqual(UNWIRED_SINKS.length);
  });

  it.each(NOTE_PRODUCERS)('%s feeds the list — called in it, or held in a variable the list reads', (producer) => {
    const direct = agg.includes(`${producer}(`);
    const viaVariable = heldIn(producer).some((v) => new RegExp(String.raw`text:\s*${v}\b`).test(agg));
    expect(direct || viaVariable, `${producer} does not reach requestNotes`).toBe(true);
  });

  it.each(NOTE_PRODUCERS)('no lane reads %s on its own — the hand-threading this census replaces', (producer) => {
    // Outside the list, a producer's value may be computed and logged, never written into a prompt.
    const outside = ROUTE.replace(agg, '');
    const names = [producer, ...heldIn(producer)];
    for (const n of names) {
      expect(outside, `\${${n}...} is spliced into a prompt outside requestNotes`).not.toMatch(new RegExp(String.raw`\$\{${n}\b`));
    }
  });

  it('the architect reads the list', () => {
    expect(ROUTE).toContain("buildPrompt = [requestNotesText, buildPrompt].filter(Boolean).join('\\n\\n---\\n\\n');");
  });

  it('the fast lane reads the list — every call to it', () => {
    const calls = [...ROUTE.matchAll(/runSimpleBuild\(\{[^\n]*/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toContain('requestNotes: requestNotesText');
  });

  it('the one-shot lane reads the list — every call to it', () => {
    const calls = [...ROUTE.matchAll(/runOneShot\(\{[^\n]*/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThan(0);
    // Its request is #3701's ONE fast-lane request (Q-975: the milestone, the attachment); the notes follow it.
    for (const c of calls) expect(c, c).toContain('prompt: fastLaneRequest + requestNotesSuffix');
    expect(ROUTE).toContain('const requestNotesSuffix = requestNotesText ? `\\n\\n${requestNotesText}` : \'\';');
  });

  it('the project planner reads the list — and every module turn reads the plan goal', () => {
    expect(ROUTE).toContain('const plannerGoal = withRequestNotes(prompt, requestNotesText);');
    const plannerCalls = [...ROUTE.matchAll(/projectPlanUserPrompt\((\w+)/g)].map((m) => m[1]);
    expect(plannerCalls.length).toBeGreaterThan(0);
    for (const arg of plannerCalls) expect(arg).toBe('plannerGoal');
  });

  it('the plan-first planner reads the list (its todos are appended to the build prompt)', () => {
    expect(ROUTE).toContain('await planRunner.run(withRequestNotes(prompt, requestNotesText));');
    expect(ROUTE).not.toMatch(/await planRunner\.run\((?!withRequestNotes\(prompt, requestNotesText\))/);
  });

  it('every writing sub-agent reads the list (Q-868 gave it only the phone rule)', () => {
    expect(ROUTE).toContain('requestNotesRule: () => childRequestNotes,');
    expect(ROUTE).toContain('childRequestNotes = requestNotesText;');
    const subAgent = readFileSync(join(process.cwd(), 'src/server/AgentV3/SubAgent.ts'), 'utf8');
    expect(subAgent).toContain("(deps.requestNotesRule?.() ?? '')");
  });
});

describe('the fast lane reads the notes APART from the request (its file budget measures the user, not us)', () => {
  const REAL_PROMPT = 'Build a app where I can just similar to youtube where where there is an option for paste link and when user pasts the link then the video adds in the app and again shoss the option.. for add link ... There we could also stream the videos with no adds';

  async function manifestPromptFor(prompt: string, requestNotes?: string): Promise<string> {
    let seen = '';
    await runSimpleBuild({
      prompt, requestNotes, framework: 'react', scaffoldPaths: [], writeFiles: async () => {}, log: () => {},
      generate: async (sys: string, user: string) => {
        if (/Plan the COMPLETE file list/i.test(sys)) { seen = user; return 'src/App.tsx :: the app'; }
        return '<<<FILE src/App.tsx>>>\nexport default function App() { return null; }\n<<<ENDFILE>>>';
      },
    });
    return seen;
  }

  it('the real 9c612cdb prompt with its real no-login note: the notes are read, the budget is the request\'s', async () => {
    const user = await manifestPromptFor(REAL_PROMPT, REQUEST_SCOPE_NOTE);
    expect(user).toContain('REQUEST SCOPE: build the app this request describes');
    expect(user).toContain(`AT MOST ${fileBudgetForPrompt(REAL_PROMPT).maxFiles} source files`);
    // What the same note did when it rode the request: 13 → 25.
    expect(fileBudgetForPrompt(REAL_PROMPT).maxFiles).toBe(13);
    expect(fileBudgetForPrompt(`${REAL_PROMPT}\n\n${REQUEST_SCOPE_NOTE}`).maxFiles).toBe(25);
    expect(user).not.toContain('AT MOST 25 source files');
  });

  it('the keypad-phone rule reaches the fast lane now, without taking the budget to the maximum', async () => {
    const prompt = 'a racing game for Nokia C2-01';
    const user = await manifestPromptFor(prompt, nonSmartphoneBuildRule('Nokia C2-01'));
    // #3689 (Q-868) reworded the rule: it opens 'CLASSIC PHONE NAMED' now.
    expect(user).toContain('CLASSIC PHONE NAMED');
    expect(user).toContain(`AT MOST ${fileBudgetForPrompt(prompt).maxFiles} source files`);
    expect(user).not.toContain('AT MOST 32 source files');
  });

  it('no notes: the lane is exactly what it was', async () => {
    const user = await manifestPromptFor('a todo app');
    expect(user).toContain(`AT MOST ${fileBudgetForPrompt('a todo app').maxFiles} source files`);
  });
});

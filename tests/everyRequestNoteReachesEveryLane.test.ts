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
 * Every function that writes a note about the REQUEST for the builders. A producer is guilty until listed: any
 * import into the route named `…BuilderNote` / `…BuildRule` is caught by the census below and must be added here.
 */
const NOTE_PRODUCERS = [
  // `requestScopeVerdict` since #3692 (the note and its reason, read through `scope?.note`).
  'unsupportedStackBuilderNote', 'scriptRequestBuilderNote', 'unknownNameBuilderNote', 'requestScopeVerdict',
  'nonSmartphoneBuildRule', 'thirdPartyLimitsBuilderNote',
] as const;

/**
 * The aggregator block — `const notes … = [ … ];`.
 *
 * ⚠️ IT MOVED OUT OF THE ROUTE (Q-1016, 2026-10-16). It used to live in the chat handler, ~500 lines BELOW
 * the first lane that plans, which is exactly why the blueprint lane planned the whole file manifest from
 * the BARE request: there was nothing to hand it yet. It is now `requestNotesFor` in requestNotes.ts,
 * called once above that lane, and the route READS the result. So this census reads the MODULE for the
 * list and the ROUTE for the lanes — each where the thing it checks actually lives.
 */
const NOTES_MODULE = readFileSync(join(process.cwd(), 'src/server/AgentV3/requestNotes.ts'), 'utf8');

function aggregator(): string {
  const start = NOTES_MODULE.indexOf('const notes: ReadonlyArray<{ code: string; text: string }> = [');
  if (start < 0) return '';
  const end = NOTES_MODULE.indexOf('];', start);
  return NOTES_MODULE.slice(start, end + 2);
}

/**
 * The variable a producer's result is stored in (`const unknownNameNote = unknownNameBuilderNote(…)`), if any — and
 * one hop further when the producer returns a record and the route keeps one field of it (`const scope =
 * requestScopeVerdict(…)` then `requestScopeText = scope?.note ?? ''`).
 */
function heldIn(producer: string): string[] {
  const out = new Set<string>();
  // The module, not the route (Q-1016): that is where every producer is called now.
  for (const m of NOTES_MODULE.matchAll(new RegExp(String.raw`\b(?:const|let)?\s*(\w+)\s*=\s*${producer}\(`, 'g'))) out.add(m[1]);
  for (const v of [...out]) {
    const kept = [...NOTES_MODULE.matchAll(new RegExp(String.raw`\b(\w+)\s*=\s*${v}\??\.note\b`, 'g'))].map((m) => m[1]);
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

  it('CLASS GUARD: a note producer imported into the module is a listed producer', () => {
    // Reads the MODULE's imports now (Q-1016): the producers moved there with the list.
    const imported = [...NOTES_MODULE.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\/[^']+';/gm)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]))
      .filter((n) => /(?:BuilderNote|BuildRule)$/.test(n));
    const unlisted = imported.filter((n) => !(NOTE_PRODUCERS as readonly string[]).includes(n));
    expect(unlisted, 'a new request note must join `requestNotes` (and this list) so every lane reads it').toEqual([]);
  });

  it.each(NOTE_PRODUCERS)('%s feeds the list — called in it, or held in a variable the list reads', (producer) => {
    const direct = agg.includes(`${producer}(`);
    const viaVariable = heldIn(producer).some((v) => new RegExp(String.raw`text:\s*${v}\b`).test(agg));
    expect(direct || viaVariable, `${producer} does not reach requestNotes`).toBe(true);
  });

  it.each(NOTE_PRODUCERS)('no lane reads %s on its own — the hand-threading this census replaces', (producer) => {
    // Outside the list, a producer's value may be computed and logged, never written into a prompt.
    // Both files, minus the list itself: hand-threading is hand-threading wherever it is written.
    const outside = `${ROUTE}\n${NOTES_MODULE.replace(agg, '')}`;
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

// Q-1016 — THE REQUEST NOTES EXIST BEFORE THE FIRST LANE PLANS.
//
// 🔴 THE DEFECT. Q-991 gathered every request note into ONE list and had every lane read it — the right
// shape, and it fixed the hand-threading. But that list was BUILT ~500 lines below the first lane that
// plans, so the BLUEPRINT lane (`AGENTV3_BLUEPRINT`) proposed the whole file manifest AND the shared
// contract from the BARE request: route ~16750 for the plan, ~16978 for the first note input. A Kotlin
// request, a keypad phone named in the prompt, or a no-login scope was planned blind — and on a deep build
// the architect then follows that plan.
//
// It was never a wiring oversight. There was nothing to hand the lane yet, which is why no amount of
// "pass it one more argument" would have fixed it, and why Q-1020's name-based census could not see it:
// the producers were all present and all correctly listed.
//
// 🔑 THE FIX IS ONE COMPUTATION, READ TWICE — the shape Q-1026/Q-1033 used for the same class.
// `requestNotesFor` is pure, lives in requestNotes.ts beside the `withRequestNotes` join, and is called
// once above the blueprint lane. The aggregator that used to derive these facts now READS that result, so
// there is still exactly one answer to "what does this request need the builder to know?".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestNotesFor, withRequestNotes, REQUEST_NOTE_SEPARATOR } from '../src/server/AgentV3/requestNotes';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const RAW_ROUTE = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const ROUTE = RAW_ROUTE;
/**
 * The route as CODE, for the "is this producer still called here?" guard.
 *
 * ⚠️ THE THIRD TIME IN ONE DAY that a source census of mine matched its own explanatory comment (Q-1081,
 * Q-1021, here). The note beside the fix NAMES the function the fix stopped calling, so a guard that reads
 * the file as text fails on its own documentation. It is a pattern, not an accident: a census over source
 * must read stripped code, and the assertion that needs stripping is always the NEGATIVE one.
 */
const ROUTE_CODE = stripCodeComments(RAW_ROUTE);

const BASE = {
  planningText: '', framework: 'vite-react', newBuild: true, editing: false, importTurn: false,
} as const;

describe('requestNotesFor — the facts and the notes, from one call', () => {
  it('a plain request gets only the one note it earns — the no-login scope', () => {
    // My first version of this test asserted "a todo app" needs nothing said. The run corrected it: a todo
    // app names no sign-in, so `requestScopeVerdict` fires, and that is the whole point of Q-991's note
    // (autopsy 70e030bb — a login nobody asked for is a wall in front of the app).
    const r = requestNotesFor({ ...BASE, prompt: 'a todo app', planningText: 'a todo app' });
    expect(r.notes.filter((n) => n.text.trim()).map((n) => n.code)).toEqual(['request-scope']);
    expect(r.text).toContain('REQUEST SCOPE');
    expect(r.unsupportedStackAsked).toBeNull();
    expect(r.keypadPhone).toBeNull();
  });

  it('…and a request that earns NOTHING leaves the prompt untouched', () => {
    // An EDIT turn: every new-build-only note stands down, and the scope note with them.
    const r = requestNotesFor({ ...BASE, prompt: 'make the header blue', planningText: 'make the header blue', newBuild: false, editing: true });
    expect(r.text).toBe('');
    expect(withRequestNotes('make the header blue', r.text)).toBe('make the header blue');
  });

  it('🔴 a KEYPAD PHONE named in the request — the note Q-846 opened and Q-868 narrowed', () => {
    const r = requestNotesFor({ ...BASE, prompt: 'a racing game for Nokia C2-01', planningText: 'a racing game for Nokia C2-01' });
    expect(r.keypadPhone?.device).toContain('Nokia');
    expect(r.text).toContain('CLASSIC PHONE NAMED');
  });

  it('🔒 …and NOT on an edit of an existing app (Q-868: "a Nokia 3310 as a pickup in my 3D game")', () => {
    const prompt = 'add a Nokia 3310 as a pickup in my 3D city game';
    const edit = requestNotesFor({ ...BASE, prompt, planningText: prompt, newBuild: false, editing: true });
    expect(edit.keypadPhone).toBeNull();
    expect(edit.text).not.toContain('CLASSIC PHONE NAMED');

    // 🔴 AND THE COMBINATION THE GUARD ACTUALLY EXISTS FOR, which my first version of this test missed and
    // a reversion caught: `newBuild` TRUE while `editing` is also TRUE. The route's original condition was
    // `intent === 'new_build' && !isEditMode`, so both halves were deliberate; a test that only sets
    // `newBuild: false` proves nothing about the second one. Telling a working 3D game "never three.js"
    // is the breakage Q-868 was opened for.
    const both = requestNotesFor({ ...BASE, prompt, planningText: prompt, newBuild: true, editing: true });
    expect(both.keypadPhone, 'editing an existing app wins over the new-build flag').toBeNull();
    expect(both.text).not.toContain('CLASSIC PHONE NAMED');
  });

  it('🔴 a STACK we do not build, named in the request (autopsy 8e124182)', () => {
    const prompt = 'a blog using PHP MVC architecture';
    const r = requestNotesFor({ ...BASE, prompt, planningText: prompt });
    expect(r.unsupportedStackAsked).toBeTruthy();
    expect(r.text.toLowerCase()).toContain('php');
    // The note names the stack it WAS built in, which is why `framework` is an input and not a guess.
    expect(requestNotesFor({ ...BASE, prompt, planningText: prompt, framework: 'static' }).text)
      .not.toBe(r.text);
  });

  it('🔒 an IMPORT turn is told nothing — the code is the user\'s, not this build\'s', () => {
    const prompt = 'a blog using PHP MVC architecture for Nokia C2-01';
    const r = requestNotesFor({ ...BASE, prompt, planningText: prompt, importTurn: true });
    expect(r.unsupportedStackAsked).toBeNull();
    expect(r.keypadPhone).toBeNull();
    expect(r.text).toBe('');
  });

  it('several notes join in the architect\'s reading order, separated once', () => {
    const prompt = 'a dashboard using PHP MVC for Nokia C2-01';
    const r = requestNotesFor({ ...BASE, prompt, planningText: prompt });
    const texts = r.notes.map((n) => n.text.trim()).filter(Boolean);
    expect(texts.length).toBeGreaterThan(1);
    expect(r.text).toBe(texts.join(REQUEST_NOTE_SEPARATOR));
    expect(r.text.split(REQUEST_NOTE_SEPARATOR)).toHaveLength(texts.length);
  });

  it('🔒 never throws, whatever it is handed', () => {
    for (const bad of [undefined, null, '', 'x'.repeat(30_000)]) {
      expect(() => requestNotesFor({ ...BASE, prompt: bad as unknown as string, planningText: bad as unknown as string })).not.toThrow();
    }
  });
});

describe('🔴 THE WIRING — the blueprint lane no longer plans from the bare request', () => {
  it('the ONE computation happens ABOVE the lane that plans first', () => {
    const computed = ROUTE.indexOf('const requestNoteSet = requestNotesFor({');
    const blueprint = ROUTE.indexOf('P-ARCH+.3 — up-front BLUEPRINT');
    const manifest = ROUTE.indexOf('manifestUserPrompt(withRequestNotes(prompt, requestNotesText), scaffold, prompt)');
    expect(computed, 'the one computation must be findable').toBeGreaterThan(0);
    expect(blueprint).toBeGreaterThan(computed);
    expect(manifest).toBeGreaterThan(computed);
  });

  it('the file manifest and the shared contract both read the notes', () => {
    expect(ROUTE).toContain('manifestUserPrompt(withRequestNotes(prompt, requestNotesText), scaffold, prompt)');
    expect(ROUTE).toContain('contractUserPrompt(withRequestNotes(prompt, requestNotesText), manifest)');
  });

  it('🔒 BOTH file budgets measure the user\'s request, not our notes (Q-991 measured 13 → 25; Q-1017)', () => {
    // The notes open the prompt the manifest is PLANNED from, and NEITHER budget may be sized from them.
    // The one recorded as telemetry reads the bare prompt:
    expect(ROUTE).toContain('overBudgetNote(manifest.length, fileBudgetForPrompt(prompt))');
    // ...and so does the one spliced into the prompt the MODEL reads. `manifestUserPrompt`'s third argument
    // (`sizeFrom`) defaults to its first, so omitting it sized the user's app from our own instructions —
    // the same question answered twice, differently (Q-1017, 2026-10-16).
    expect(ROUTE).toContain('manifestUserPrompt(withRequestNotes(prompt, requestNotesText), scaffold, prompt)');
  });

  it('🔒 the aggregator READS the one result — it does not derive the same facts again', () => {
    expect(ROUTE).toContain('const requestNotes = requestNoteSet.notes;');
    expect(ROUTE).toContain('const requestNotesText = requestNoteSet.text;');
    // Each producer is called in the module now; a second call in the route is two answers to one question.
    for (const producer of ['unsupportedStackRequested(', 'unknownNamesInRequest(', 'requestScopeVerdict(', 'scriptDeliverableRequested(', 'namedNonSmartphone(', 'thirdPartyLimitAsked(']) {
      expect(ROUTE_CODE, `${producer} is called in requestNotes.ts — the route must read the result`).not.toContain(producer);
    }
  });

  it('🔒 every fact the report lines need comes from that same result', () => {
    for (const field of ['unsupportedStackAsked', 'unknownNamesAsked', 'unknownNameNote', 'requestScopeText', 'requestScopeReason', 'liveDataAsked', 'scriptFormAsked', 'scriptRequestNote', 'keypadPhone', 'thirdPartyLimitAsk']) {
      expect(ROUTE, `${field} must be read from requestNoteSet`).toContain(`requestNoteSet.${field}`);
    }
  });
});

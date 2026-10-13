// Q-975 (found building Q-868, 2026-10-12) — a milestone build kept none of the notes written for it.
//
// The mega-app roadmap has been ON by default since 2026-08-14 (`AGENTV3_MEGA_ROADMAP` is a kill switch, not an
// enable switch), so this was live, not flag-gated as the row first said. Three readers of "what this build is
// building" each picked their own source, and each was wrong in its own way on a milestone build:
//   1. the builder: `buildPrompt = step1.buildPrompt + …` replaced the WHOLE prompt, dropping every note prepended
//      above the user's words (classic phone, no sign-in, unknown name, script, unsupported stack, native and pasted
//      briefs, framework coherence, requirement guidance, the cache-prefix blocks…);
//   2. the two fast lanes: handed the WHOLE message, so a fast lane planned the entire app while the builder was told
//      to build milestone 1 — and the one-shot lane got its own two-of-five pick of the notes (no classic-phone rule,
//      no one-file rule, no pasted checklist) and the bare words without the attachment;
//   3. a writing specialist: handed the whole message too.
// The class: a reader of the build's request that assembles it for itself. Locked here by behaviour and by a census.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { milestoneBuildPrompt, milestoneLaneRequest, MILESTONE_NOTES_SCOPE_LINE } from '../src/server/lib/megaRoadmap';
import { nonSmartphoneBuildRule } from '../src/server/AgentV3/deviceTarget';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

const REQUEST = 'Build a full WhatsApp-style messenger for my shop: chats, groups, status, broadcast lists, payments.\nDo NOT add a login screen.\nNo fake messages.';
const STEP = { title: 'Chats', buildPrompt: 'Build the chat list and one chat screen with sending and receiving messages.' };

/** The prompt as the route assembles it: every note PREPENDED above the user's words. */
function assembled(notes: string[]): string {
  return notes.reduce((p, n) => `${n}\n\n---\n\n${p}`, REQUEST);
}

describe('1 · the builder: the brief replaces the request, never the notes', () => {
  const phoneRule = nonSmartphoneBuildRule('Nokia 3310');
  const scope = 'REQUEST SCOPE: the request asks for no sign-in — add no login or accounts.';
  const m = milestoneBuildPrompt({ buildPrompt: assembled([scope, phoneRule]), request: REQUEST, step: STEP, total: 4 });

  it('🔴 every note above the request survives the swap', () => {
    expect(m.prompt).toContain(phoneRule);
    expect(m.prompt).toContain(scope);
    expect(m.notesKept).toBe(true);
    expect(m.notesDropped).toBe(false);
  });
  it('the user\'s words are gone; the milestone brief and its instruction take their place, last', () => {
    expect(m.prompt).not.toContain('broadcast lists, payments.\nDo NOT add a login screen.');
    expect(m.prompt).toContain(STEP.buildPrompt);
    expect(m.prompt).toContain('(This is milestone 1 of 4');
    expect(m.prompt.indexOf(STEP.buildPrompt)).toBeGreaterThan(m.prompt.indexOf(phoneRule));
  });
  it('a note written for the whole app is told it does not widen this milestone', () => {
    expect(m.prompt).toContain(MILESTONE_NOTES_SCOPE_LINE);
    expect(m.prompt.indexOf(MILESTONE_NOTES_SCOPE_LINE)).toBeLessThan(m.prompt.indexOf(STEP.buildPrompt));
  });
  it('the user\'s hard rules are still restated after the brief (681bd91b)', () => {
    expect(m.prompt).toMatch(/NON-NEGOTIABLE CONSTRAINTS from the user's original request[^]*- Do NOT add a login screen\.\n- No fake messages\./);
  });
  it('no notes: the brief alone, with no scope line about notes that are not there', () => {
    const bare = milestoneBuildPrompt({ buildPrompt: REQUEST, request: REQUEST, step: STEP, total: 4 });
    expect(bare.notesKept).toBe(false);
    expect(bare.notesDropped).toBe(false);
    expect(bare.prompt.startsWith(STEP.buildPrompt)).toBe(true);
    expect(bare.prompt).not.toContain(MILESTONE_NOTES_SCOPE_LINE);
  });
  it('a prompt whose request cannot be found at its end says so in the report, never passes in silence', () => {
    const appended = `${REQUEST}\n\nApproved plan:\n- chats`;
    const rows: Array<{ code: string; severity: string }> = [];
    const r = milestoneBuildPrompt({ buildPrompt: appended, request: REQUEST, step: STEP, total: 4, report: { record: (i) => { rows.push(i); } } });
    expect(r.notesDropped).toBe(true);
    expect(rows).toEqual([expect.objectContaining({ code: 'MILESTONE_NOTES_DROPPED', severity: 'warning' })]);
    expect(PROCESS_ONLY_CODES.has('MILESTONE_NOTES_DROPPED'), 'a fact about our prompt assembly, never the user\'s app').toBe(true);
    expect(m.notesDropped).toBe(false);
  });
});

describe('2 · a lane that composes its own prompt gets the milestone too', () => {
  const brief = milestoneBuildPrompt({ buildPrompt: REQUEST, request: REQUEST, step: STEP, total: 4 }).prompt;
  it('🔴 the brief replaces the words; the attachment and earlier requests that followed them are kept', () => {
    const planning = `${REQUEST}\n\n[The user attached file(s) with this message. Their content describes what to build:]\nmenu.pdf text`;
    const lane = milestoneLaneRequest(planning, REQUEST, brief);
    expect(lane.startsWith(brief)).toBe(true);
    expect(lane).toContain('menu.pdf text');
    expect(lane).not.toContain('broadcast lists, payments.');
  });
  it('a planning text that does not open with the words gets the brief alone — never the whole message', () => {
    expect(milestoneLaneRequest('something else entirely', REQUEST, brief)).toBe(brief);
  });
  it('not a milestone build: the planning text unchanged', () => {
    expect(milestoneLaneRequest(`${REQUEST}\n\nmore`, REQUEST, null)).toBe(`${REQUEST}\n\nmore`);
  });
});

describe('3 · the census: nothing in the route assembles the request for itself', () => {
  /** The expression assigned at `start`, up to its own `;` — strings, templates and brackets respected. */
  function exprAt(src: string, start: number): string {
    const stack: string[] = [];
    let quote: string | null = null;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      const top = stack[stack.length - 1];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (top === '`') {
        if (c === '\\') i++;
        else if (c === '`') stack.pop();
        else if (c === '$' && src[i + 1] === '{') { stack.push('${'); i++; }
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === '`') stack.push('`');
      else if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
      else if (c === '(' || c === '[' || c === '{') stack.push(c);
      else if (c === ')' || c === ']' || c === '}') stack.pop();
      else if (c === ';' && stack.length === 0) return src.slice(start, i);
    }
    return src.slice(start);
  }
  const decl = route.indexOf('let buildPrompt = prompt;');
  const swap = route.indexOf('buildPrompt = milestoneBuildPrompt({ buildPrompt, request: prompt, step: step1, total, report: buildDiag }).prompt;');
  const assignments = [...route.matchAll(/(?<![\w.])buildPrompt\s*=(?!=)/g)]
    .filter((m) => m.index! > decl + 'let buildPrompt'.length) // not the declaration itself
    .map((m) => ({ at: m.index!, line: route.slice(0, m.index!).split('\n').length, expr: exprAt(route, m.index! + m[0].length).trim() }));

  it('the anchors exist', () => {
    expect(decl).toBeGreaterThan(0);
    expect(swap).toBeGreaterThan(decl);
    expect(assignments.length).toBeGreaterThan(30);
  });
  it('🔴 before the milestone swap, every note is a PREPEND — the invariant the swap rests on', () => {
    const before = assignments.filter((a) => a.at < swap);
    // A prepend is any form that puts buildPrompt LAST: a template ending in it, an array joined with it last, or the ONE
    // request-notes list (autopsy 9c612cdb, Q-991): `[requestNotesText, buildPrompt].filter(Boolean).join(…)`.
    const notPrepends = before.filter((a) => !/\$\{buildPrompt\}`$/.test(a.expr) && !/(?:^|\n)\s*buildPrompt,\s*\]\.join\([^)]*\)$/.test(a.expr)
      && !/^\[\w+, buildPrompt\]\.filter\(Boolean\)\.join\([^)]*\)$/.test(a.expr));
    expect(notPrepends.map((a) => `${a.line}: ${a.expr.slice(0, 80)}`)).toEqual([]);
    expect(route.slice(decl, swap)).not.toMatch(/(?<![\w.])buildPrompt\s*\+=/);
  });
  it('🔴 no assignment after the notes starts from a bare request — each one builds on buildPrompt', () => {
    const bare = assignments.filter((a) => !/(?<![\w.])buildPrompt\b/.test(a.expr));
    expect(bare.map((a) => `${a.line}: ${a.expr.slice(0, 80)}`)).toEqual([]);
  });
  it('🔴 both fast lanes read ONE request, and it carries the milestone and every lane note', () => {
    const calls = [...route.matchAll(/\b(runSimpleBuild|runOneShot)\(\{ prompt: ([^,]+),/g)].map((m) => `${m[1]}: ${m[2]}`);
    // PIN UPDATED 2026-10-13 (merge with autopsy 9c612cdb, Q-991): the request is still ONE for both lanes; the NOTES ride
    // the one request-notes list — the fast lane reads it apart from the request (its file budget measures the user's
    // words), the one-shot after it. tests/everyRequestNoteReachesEveryLane.test.ts proves every note is in that list.
    expect(calls).toEqual(['runSimpleBuild: fastLaneRequest', 'runOneShot: fastLaneRequest + requestNotesSuffix']);
    expect(route).toContain('runSimpleBuild({ prompt: fastLaneRequest, requestNotes: requestNotesText,');
    expect(route).toContain('const fastLaneRequest = milestoneLaneRequest(planning.text, prompt, milestoneLanePrompt)\n        + singleHtmlFileSuffix + pastedBriefSuffix;');
  });
  it('the writing specialist is handed the milestone on a milestone build', () => {
    expect(route).toContain('userRequest: () => (milestoneLanePrompt ? milestoneLaneRequest(planning.text, prompt, milestoneLanePrompt) : checksRequest === prompt ? planning.text : checksRequest),');
    expect(route).toContain('milestoneLanePrompt = milestoneBuildPrompt({ buildPrompt: prompt, request: prompt, step: step1, total }).prompt;');
  });
});

/**
 * Q-1017 (2026-10-16) — THE CAP BELONGS TO THE REQUEST, NEVER TO THE JOIN.
 *
 * `createProjectPlan` capped its goal at MAX_GOAL_CHARS and the route handed it the JOINED text: our request
 * notes first, the user's words after. So the cut always landed on the user's own spec, and the notes' length
 * decided how much of it survived — a ~1,100-char stack note spent 1,100 characters of the spec before the
 * spec was measured. `plan.goal` is read as PROJECT GOAL by EVERY module turn of a project build, so a long
 * spec's closing features were missing from every one of them.
 *
 * ⚠️ IT HAD BEEN "FIXED" BEFORE. Autopsy 042e472f (2026-10-01) met this same failure and raised the cap from
 * 4,000 to 6,000. That moved the cliff and left the class: one scalar bound applied AFTER a join of two
 * different things, so one part's size silently spends the other's budget.
 *
 * So this file locks the CLASS in both halves:
 *  1. BEHAVIOUR — the surviving prefix of a given request is IDENTICAL whatever notes ride with it, the notes
 *     are kept whole, and a request that really is over the cap says so instead of ending mid-sentence.
 *  2. SOURCE — no production call site may hand a notes+request join to a function that bounds or sizes the
 *     request, so a NEW sibling fails this test rather than shipping. `manifestUserPrompt`'s `sizeFrom` is the
 *     other instance: it defaults to its first argument, and the route had omitted it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectPlan, MAX_GOAL_CHARS, type ProjectModule } from '../src/server/AgentV3/ProjectPlan';
import {
  withRequestNotes,
  withRequestNotesBounded,
  REQUEST_TRUNCATION_MARKER,
  REQUEST_NOTE_SEPARATOR,
} from '../src/server/AgentV3/requestNotes';

const mods: ProjectModule[] = [
  { id: 'm1', name: 'Core', description: 'types', files: ['src/types.ts'], dependsOn: [], status: 'pending' },
];

/** A spec whose closing requirement is identifiable — the 042e472f shape, one sentence per feature. */
function spec(chars: number): string {
  const closing = 'FINALLY: the admin dashboard must export every booking as a CSV.';
  const filler = 'The app must let a user book a slot, pay for it and see the receipt. '.repeat(400);
  return `${filler.slice(0, Math.max(0, chars - closing.length))}${closing}`;
}

/** A note of our own, the size of the real stack note that caused 042e472f. */
const STACK_NOTE = `NOTE: the user asked for Kotlin and Jetpack Compose, which NavBharatAI does not build. ${'Build the same app as a phone-ready web app instead. '.repeat(20)}`;

describe('Q-1017 · the goal cap is the request\'s alone', () => {
  it('keeps the same characters of the request whether notes ride with it or not', () => {
    const request = spec(9_000);
    const bare = createProjectPlan(request, 'vite-react', mods, 1).goal;
    const withNote = createProjectPlan(request, 'vite-react', mods, 1, STACK_NOTE).goal;

    // The surviving request prefix is identical — the note cost the spec nothing.
    const requestPartOf = (goal: string) => goal.split(REQUEST_NOTE_SEPARATOR).slice(-1)[0];
    expect(requestPartOf(withNote)).toBe(requestPartOf(bare));
    expect(requestPartOf(bare).startsWith(request.slice(0, MAX_GOAL_CHARS))).toBe(true);

    // And the note itself is kept WHOLE — it is ours, it is short, it is never the thing that is cut.
    expect(withNote).toContain(STACK_NOTE.trim().slice(0, 200));
    expect(withNote.startsWith(STACK_NOTE)).toBe(true);
  });

  it('reverted: the 042e472f spec keeps its closing requirement with the stack note leading', () => {
    // The exact shape of the earlier autopsy — a ~1,100-char note plus a spec that fits the cap on its own.
    const request = spec(5_500);
    expect(request.length).toBeLessThan(MAX_GOAL_CHARS);
    const goal = createProjectPlan(request, 'vite-react', mods, 1, STACK_NOTE).goal;

    expect(goal).toContain('FINALLY: the admin dashboard must export every booking as a CSV.');
    expect(goal).not.toContain(REQUEST_TRUNCATION_MARKER);

    // Put the bug back and the closing requirement disappears — this is why the cap cannot follow the join.
    const asItWas = withRequestNotes(request, STACK_NOTE).slice(0, MAX_GOAL_CHARS);
    expect(asItWas).not.toContain('FINALLY: the admin dashboard must export every booking as a CSV.');
  });

  it('says so when the request itself is over the cap, instead of ending mid-sentence', () => {
    const over = createProjectPlan(spec(20_000), 'vite-react', mods, 1, STACK_NOTE);
    expect(over.goal).toContain(REQUEST_TRUNCATION_MARKER);
    expect(withRequestNotesBounded(spec(20_000), STACK_NOTE, MAX_GOAL_CHARS).requestTruncated).toBe(true);

    const under = withRequestNotesBounded(spec(100), STACK_NOTE, MAX_GOAL_CHARS);
    expect(under.requestTruncated).toBe(false);
    expect(under.text).not.toContain(REQUEST_TRUNCATION_MARKER);
  });

  it('a request under the cap is stored byte-for-byte, notes or not', () => {
    const request = 'build a small booking app with a receipt screen';
    expect(createProjectPlan(request, 'vite-react', mods, 1).goal).toBe(request);
    expect(createProjectPlan(request, 'vite-react', mods, 1, STACK_NOTE).goal)
      .toBe(`${STACK_NOTE}${REQUEST_NOTE_SEPARATOR}${request}`);
  });

  it('an empty or absurd cap never throws and never invents text', () => {
    expect(withRequestNotesBounded('', '', MAX_GOAL_CHARS).text).toBe('');
    expect(withRequestNotesBounded('', STACK_NOTE, MAX_GOAL_CHARS).text).toBe(STACK_NOTE);
    expect(() => withRequestNotesBounded('abc', '', 0)).not.toThrow();
    expect(() => withRequestNotesBounded('abc', '', Number.NaN)).not.toThrow();
  });
});

// ── THE SOURCE CENSUS — a NEW sibling fails here, not in production ──────────────────────────────────────

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) sourceFiles(full, out);
    else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** Every call of `fn(` in `text`, returned as the balanced argument string of each. */
function callArgs(text: string, fn: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${fn}(`, from);
    if (at === -1) return out;
    let depth = 0;
    let i = at + fn.length;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') { depth--; if (depth === 0) break; }
    }
    out.push(text.slice(at + fn.length + 1, i));
    from = i + 1;
  }
}

describe('Q-1017 · the census: no production caller sizes the user\'s request from our notes', () => {
  const files = [
    ...sourceFiles(join(process.cwd(), 'src')),
    join(process.cwd(), 'server.ts'),
  ].filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });

  it('no production call hands a notes+request join to createProjectPlan', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (!text.includes('createProjectPlan(')) continue;
      for (const args of callArgs(text, 'createProjectPlan')) {
        // The first argument must be the USER'S request. A join — or a variable named for one — is the bug.
        const first = args.split(',')[0].trim();
        if (/withRequestNotes|notesText|requestNotes|plannerGoal/.test(first)) {
          offenders.push(`${f}: createProjectPlan(${first}, …)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every manifestUserPrompt call whose prompt carries notes passes its own sizeFrom', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (!text.includes('manifestUserPrompt(')) continue;
      for (const args of callArgs(text, 'manifestUserPrompt')) {
        if (!/withRequestNotes|notesText|requestNotes/.test(args)) continue;
        // `sizeFrom` defaults to the first argument, so a two-argument call sizes the app from our notes.
        let depth = 0;
        let commas = 0;
        for (const ch of args) {
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') depth--;
          else if (ch === ',' && depth === 0) commas++;
        }
        if (commas < 2) offenders.push(`${f}: manifestUserPrompt with notes and no sizeFrom`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

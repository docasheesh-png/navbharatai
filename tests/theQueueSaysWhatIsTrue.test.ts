// THE QUEUE SAYS WHAT IS TRUE (2026-10-16 sweep).
//
// 🔴 WHAT THE SWEEP FOUND. `BUILD_REPORT_QUEUE.md` had **166 rows, of which 61 claimed an open pull request —
// while ZERO pull requests were open.** Every one of those owners resolved to a MERGED PR (26 numbered ones,
// the merged `claude/new-session-gx9294` branch, #3681 for Q-866, #3683 for Q-880, #3755 for Q-1124). Under
// the sixth absolute rule the queue IS the contract: a row that says work is in flight when nothing is in
// flight makes the whole file unreadable, and "is everything fixed?" unanswerable without re-deriving it.
//
// 🧬 THE CLASS: a row may rest in exactly TWO states — ✅ (then it is DELETED from the open table and its id
// appended to the closed register) or 🟡 BLOCKED. "IN PROGRESS" is a state a row passes THROUGH while its PR
// is open; it is not a place to stop. Four rows had stopped somewhere else entirely: `🔵 IN PROGRESS (fixed in
// this PR; ✅ after the first observed pipeline check)`, `OPEN (decided — to build after Q-706 verifies)`, a
// state column holding `—`, and two rows parked at `✅ RESOLVED …` inside the table instead of being closed.
//
// ⚠️ AND MY OWN CENSUS HAD A BLIND SPOT, which is why the splitter below is written out. Q-1089's problem text
// contains **escaped pipes** (`\|`, from a shell command `… 2>&1 \| tail -20`). A naive `split('|')` reads that
// as extra cells, so the row's state came out as shell text and the first pass SKIPPED it — a resolved row
// that would have stayed "IN PROGRESS" for ever. A census that cannot parse the file it polices is not a
// census. Markdown's rule: a cell boundary is a `|` NOT preceded by a backslash.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const queue = readFileSync(join(root, 'BUILD_REPORT_QUEUE.md'), 'utf8');

/** A Markdown cell boundary: a pipe that is not escaped. See the blind-spot note above. */
const CELLS = /(?<!\\)\|/;
const rows = queue.split('\n')
  .filter((l) => /^\| Q-\d+ \|/.test(l))
  .map((l) => {
    const f = l.split(CELLS);
    return { id: f[1].trim(), found: f[2].trim(), problem: f[3].trim(), state: f[4].trim(), owner: f[5].trim(), body: f.slice(6).join('|') };
  });

/** The states a row may be in. IN PROGRESS / FIX IN PR are transient — allowed, but they must name an owner. */
const RESTING = /^(OPEN|🟡 BLOCKED)/;
const IN_FLIGHT = /^(IN PROGRESS|FIX IN PR)/;

describe('🔒 every row is in a state the sixth rule recognises', () => {
  it('the census can read the file at all', () => {
    expect(rows.length, 'no rows parsed — the table shape changed and this guard went blind').toBeGreaterThan(50);
    for (const r of rows) expect(r.id, 'a row with no id').toMatch(/^Q-\d+$/);
  });

  it('🔴 no row rests in an invented state', () => {
    const odd = rows.filter((r) => !RESTING.test(r.state) && !IN_FLIGHT.test(r.state))
      .map((r) => `${r.id}: ${r.state.slice(0, 60)}`);
    expect(odd, 'a row may rest only at OPEN or 🟡 BLOCKED — ✅ means delete it and register its id').toEqual([]);
  });

  it('…and a WHOLLY ✅ row is never parked in the open table', () => {
    // 🔁 MY FIRST VERSION OF THIS RULE WAS WRONG, and Q-1086 proved it. It banned ✅ anywhere in the state, and
    // Q-1086's state is an honest COMPOUND: "🟡 BLOCKED — REQUIRES A DECISION (admin, routing) · the meter half
    // is ✅ RESOLVED as NOT-A-DEFECT". That row is blocked, and it records which half is already settled —
    // information the strict rule would have forced someone to delete. What must not happen is a row whose
    // WHOLE state is resolved sitting in the open table, so the leading token is what is checked.
    const parked = rows.filter((r) => r.state.startsWith('✅')).map((r) => r.id);
    expect(parked, 'a resolved row is DELETED and its id appended to the closed register').toEqual([]);
  });

  it('🔴 a row that claims work in flight names something checkable', () => {
    // This is what made 61 rows unverifiable: the state said IN PROGRESS and only the owner could settle
    // whether that was still true. An owner of "—" cannot.
    const unowned = rows.filter((r) => IN_FLIGHT.test(r.state) && (r.owner === '—' || r.owner === ''))
      .map((r) => r.id);
    expect(unowned, 'name the PR or branch, or the row cannot be checked against reality').toEqual([]);
  });

  it('every row has a problem statement in its problem column', () => {
    const empty = rows.filter((r) => r.problem === '' || r.problem === '—').map((r) => r.id);
    // Q-1012 had its STATE text here and an empty state column; the sweep put both back.
    expect(empty, 'the problem column is what a reader scans').toEqual([]);
  });
});

describe('🔒 RATCHET: the four fields a 🟡 BLOCKED row owes, and they may only improve', () => {
  // The sixth rule says a BLOCKED row carries all four: what is blocked, why, what is required to unblock it,
  // and what was already tried. Measured on 2026-10-16: 52 of 97 blocked rows are missing at least one.
  //
  // That number is NOT asserted to be zero, and the gap is NOT quietly filled: writing a plausible "Needs:"
  // for a blocker nobody investigated would invent a fact, which is the defect this file exists to prevent.
  // It is recorded as Q-1126, pinned here, and may only go DOWN — the same shape as the theme-token and
  // uncalled-route ratchets.
  const MISSING_FIELDS_BASELINE = 52;

  const blocked = rows.filter((r) => r.state.startsWith('🟡 BLOCKED'));
  const gapsOf = (body: string): string[] => {
    const have = new Set<string>();
    if (/\*\*What|What is blocked/i.test(body)) have.add('what');
    if (/\*\*Why|Why blocked|because/i.test(body)) have.add('why');
    if (/\*\*Needs?\b|Needs:/i.test(body)) have.add('needs');
    if (/\*\*(Already )?tried|Tried:/i.test(body)) have.add('tried');
    return ['what', 'why', 'needs', 'tried'].filter((k) => !have.has(k));
  };

  it('there are blocked rows to check — the measurement is live, not a stale number', () => {
    expect(blocked.length).toBeGreaterThan(50);
  });

  it(`at most ${MISSING_FIELDS_BASELINE} blocked rows are missing a field, and the count may only shrink`, () => {
    const incomplete = blocked.filter((r) => gapsOf(r.body).length > 0);
    expect(incomplete.length,
      `${incomplete.length} blocked rows are missing a required field. The baseline is ${MISSING_FIELDS_BASELINE} `
      + '(Q-1126). It may go DOWN — lower this number when it does — and a NEW incomplete row must not push it up.',
    ).toBeLessThanOrEqual(MISSING_FIELDS_BASELINE);
  });

  it('🔴 the gap is RECORDED, not silent — Q-1126 names it with its real number', () => {
    const row = rows.find((r) => r.id === 'Q-1126');
    expect(row, 'the measured non-compliance has its own row, so it is schedulable').toBeDefined();
    expect(row!.body).toContain(String(MISSING_FIELDS_BASELINE));
    expect(row!.state).toMatch(RESTING);
  });
});

describe('🧭 the blind spot that skipped a resolved row', () => {
  it('a problem statement may contain escaped pipes, and the census still reads its state', () => {
    const line = '| Q-9999 | found | `npm i a b 2>&1 \\| tail -20` parsed `tail` as a package | OPEN | — | body |';
    const f = line.split(CELLS);
    expect(f[4].trim(), 'a naive split would read shell text here — that is how Q-1089 was missed').toBe('OPEN');
    expect(f[3]).toContain('tail -20');
  });

  it('…and the real Q-1089 is gone from the open table, because its PR merged', () => {
    expect(rows.map((r) => r.id)).not.toContain('Q-1089');
    expect(readFileSync(join(root, 'docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt'), 'utf8'))
      .toMatch(/^Q-1089$/m);
  });
});

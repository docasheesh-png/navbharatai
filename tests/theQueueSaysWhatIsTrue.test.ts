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
  // 🔽 52 → 48 (Q-1126 batch 1, 2026-10-17). Six rows were completed from MEASURED evidence, not from
  // plausible prose: Q-107 (the image installs `playwright` but NOT `@playwright/test`, so the row holds
  // narrowly — closing it on the near-match would have been a false verdict), Q-108 (no wrangler job and
  // no token anywhere in CI), Q-109 (the Monitor check was already run on 2026-09-27 and FAILED),
  // Q-120 (a physical device), Q-140 (`cloudbuild.yaml:87` already threads the value; one trigger field
  // remains), Q-699 (a real phone). Only four come off this count, because Q-699's row did not TERMINATE
  // — its closing pipe was missing, so no reader that splits on the pipe ever saw it as a row at all.
  //
  // 🔴 AND THEN THE DETECTOR ITSELF TURNED OUT TO BE LYING, IN BOTH DIRECTIONS (batch 2, 2026-10-17).
  // Batch 1 above completed six rows against this `gapsOf`; batch 2 audited `gapsOf`. It had been written
  // from the four field names as THIS FILE spells them, not as CLAUDE.md spells them — and the sixth rule's
  // own wording is *"what is **required** to unblock it"*. So:
  //
  //   · it FLAGGED six rows that were complete all along, whose only sin was writing `**Required:**` — the
  //     rule's own word — instead of `**Needs:**`: Q-111, Q-126, Q-133, Q-706, Q-819, Q-1012. Each was
  //     opened and verified by eye to carry all four. Q-111 is the clearest: *What · Why blocked · Required
  //     · Already tried*, every one present, counted as a gap. A census that cannot read the vocabulary of
  //     the rule it enforces is the "lying analyzer" the fifth rule calls a defect in its own right — and
  //     this one MANUFACTURED work in one place while HIDING it in another:
  //   · it PASSED one row with a real gap. A bare `/because/` anywhere in the prose counted as a `Why`
  //     FIELD, so Q-1086 — which never wrote its reason down — read as complete.
  //   · `/\*\*What/` also matched `**What is required:**`, so one field could satisfy two.
  //
  // Corrected to LABELLED FIELDS ONLY, with the synonyms the rows actually use, and `What is required`
  // excluded from `what` so it cannot count twice. Re-measured on batch 1's own file the honest count was
  // **42, lower than 48** — so the more truthful detector moved the ratchet in the only direction it may
  // move. Had it come out higher, the number would have gone up with that reason stated, not been hidden.
  // Two further fills (Q-008, Q-1086 — see the Q-1126 row) then took it to 40.
  //
  // BATCH 2 (2026-10-20) took it from 40 to 24, and BATCH 3 from 24 to 0, and HOW it got there is the part worth keeping: of the 15,
  // ELEVEN were rows whose information was already written down and whose only fault was the label it was
  // written under — Q-121's `**Re-checked 2026-10-04:**` fails this detector purely on its `Re-` prefix, so
  // it was RENAMED rather than padded with new prose. That is batch 1's own correction holding up a second
  // time: the dominant cause of a "missing" field in this queue is vocabulary, not missing investigation.
  // The other FOUR left the blocked set entirely because their STATE was wrong, not their fields: Q-886 and
  // Q-888 read "awaiting approval of the audit plan" while carrying a fix that needs no decision, which
  // makes them OPEN. Both were re-verified against the live code first — and that mattered, because their
  // sibling Q-887 carried the same kind of note and had since been fixed.
  //
  // 🔒 **BATCH 3 TOOK IT TO ZERO (2026-10-20), so this stopped being a ratchet and became an INVARIANT.**
  // 154 blocked rows, 0 deficient, measured with this file's own parser. From here a NEW blocked row that
  // omits a field fails CI outright — there is no slack left to absorb it, which is the 50/50 law's other
  // half: do not just fix the instances, make the wrong branch impossible. If this number ever has to go
  // UP again, that is a decision to argue for in writing, not a quiet edit.
  //
  // How the last 24 went, because it is the same story batch 1 found and batch 2 confirmed: 15 were rows
  // whose information was already written and whose only fault was the LABEL it sat under — and in several,
  // the missing `Why` was sitting in the row's own STATE column ("(admin console)", "(admin, money)",
  // "a decision that is the admin's: what Doctor AI shows"), which this census cannot see because it reads
  // only the body. One more (Q-881) was not deficient but MIS-FILED, the third such case. The remaining
  // eight are the payment audit, where four fields were genuinely absent and are now written from the
  // evidence each row already carried — and where nothing had been tried, the field SAYS "nothing yet"
  // rather than carrying a plausible sentence. An invented `Needs:` is the defect Q-1126 exists to prevent.
  // 🔴 AND THE FIRST ATTEMPT SET IT TO 25, ONE NOTCH TOO LOOSE, WHICH IS WORTH THE LINES. The number came
  // from a python re-implementation of the parse that split on " | " and read ONLY the first body cell, so a
  // row whose body contains a pipe (Q-699) looked truncated and counted as deficient. The ratchet then
  // accepted a regression: undoing one label fill took the true count 24 → 25 and still passed. A ratchet is
  // only as honest as the measurement behind it, so the number must come from the detector above — never from
  // a second implementation of it, however careful.
  const MISSING_FIELDS_BASELINE = 0;

  const blocked = rows.filter((r) => r.state.startsWith('🟡 BLOCKED'));
  /** A bolded field LABEL, never a word in running prose — that distinction is the whole correction above. */
  const FIELD = {
    // `(?!\s+is\s+required)` keeps `**What is required:**` out of this one; it belongs to `needs`.
    what: /\*\*(?:What\b(?!\s+is\s+required)|Blocked\b|Blocker\b|Waiting on\b)/i,
    why: /\*\*(?:Why\b|Cause\b|Reason\b)/i,
    needs: /\*\*(?:Needs?\b|Required\b|What is required\b|To unblock\b)/i,
    tried: /\*\*(?:Already tried\b|Tried\b|Measured\b|Investigated\b|Checked\b|Evidence\b)/i,
  } as const;
  const gapsOf = (body: string): string[] =>
    (['what', 'why', 'needs', 'tried'] as const).filter((k) => !FIELD[k].test(body));

  it('there are blocked rows to check — the measurement is live, not a stale number', () => {
    expect(blocked.length).toBeGreaterThan(50);
  });

  it('every row TERMINATES — an unclosed row is invisible to every reader that splits on the pipe', () => {
    // 🔴 FOUND IN Q-1126 BATCH 1: Q-699's row had no closing `|`. Markdown still renders it, so it looked
    // fine, but its last cell runs to end-of-line and a census that splits on the pipe counts one cell too
    // few — which is exactly why this file's own four-field check had never seen that row. A malformed row
    // is worse than an incomplete one: an incomplete row is at least counted.
    const bad = queue.split('\n')
      .filter((l) => /^\| Q-\d+ \|/.test(l))
      .filter((l) => !l.trimEnd().endsWith('|'))
      .map((l) => l.slice(0, 40));
    expect(bad, 'these rows do not end with a pipe, so their last cell is unbounded').toEqual([]);
  });

  it(`at most ${MISSING_FIELDS_BASELINE} blocked rows are missing a field, and the count may only shrink`, () => {
    const incomplete = blocked.filter((r) => gapsOf(r.body).length > 0);
    expect(incomplete.length,
      `${incomplete.length} blocked rows are missing a required field. The baseline is ${MISSING_FIELDS_BASELINE} `
      + '(Q-1126, which reached ZERO on 2026-10-20 — so this is now an invariant, not a ratchet with slack). '
      + 'A 🟡 BLOCKED row owes four things: what is blocked, why, what is required to unblock it, and what was '
      + 'already tried — each as a **bolded label**, because that is all this census can see. If nothing has been '
      + 'tried, say "nothing yet" and why; do NOT invent a plausible Needs — that is the defect Q-1126 exists to '
      + 'prevent, and a row that admits a gap is worth more than one that hides it.',
    ).toBeLessThanOrEqual(MISSING_FIELDS_BASELINE);
  });

  // 🔒 THE DETECTOR'S OWN BEHAVIOUR, on fixtures — so the two ways it lied cannot come back. The count
  // above would go green again under the old regexes the moment enough rows were filled; these cannot.
  it('a row using CLAUDE.md\'s own word, `**Required:**`, is COMPLETE — it is not a gap', () => {
    expect(gapsOf('**What:** x. **Why:** y. **Required:** z. **Already tried:** w.')).toEqual([]);
    expect(gapsOf('**Blocked:** x. **Cause:** y. **To unblock:** z. **Measured:** w.')).toEqual([]);
  });

  it('🔴 a reason buried in PROSE is not a `Why` FIELD — the Q-1086 hole', () => {
    const prose = '**What:** x. It stalls because the vendor is slow. **Needs:** z. **Already tried:** w.';
    expect(gapsOf(prose)).toEqual(['why']);
    expect(gapsOf(`${prose} **Why:** the vendor owns it.`)).toEqual([]);
  });

  it('…and one field never satisfies two: `**What is required:**` is `needs`, not `what`', () => {
    expect(gapsOf('**What is required:** z. **Why:** y. **Already tried:** w.')).toEqual(['what']);
  });

  it('🔴 the gap is RECORDED, not silent — in BOTH regimes', () => {
    /**
     * This pin exists so a measured non-compliance is schedulable rather than buried in a test file. It
     * was written while the gap was non-zero, and it asserted Q-1126 sat in the OPEN table naming the
     * number.
     *
     * 🔑 AT ZERO THAT ASSERTION INVERTS, and keeping it would make the queue lie. There is no gap left to
     * schedule, so the sixth rule says the row LEAVES the open table when its PR merges — and the pin
     * would have forced it to sit OPEN for ever with no work in it. Which is why the property is written
     * as "recorded, not silent" rather than "has an open row": while the gap is real it must be
     * schedulable; once it is closed it must be visibly closed, never simply gone.
     *
     * Found the honest way: closing Q-1126 after #3861 merged turned this test red, and the test was
     * right that something had to change — just not that the row should stay open.
     */
    const row = rows.find((r) => r.id === 'Q-1126');
    if (MISSING_FIELDS_BASELINE > 0) {
      expect(row, 'a real gap must be schedulable, so it owes an open row naming its number').toBeDefined();
      expect(row!.body).toContain(String(MISSING_FIELDS_BASELINE));
      expect(row!.state).toMatch(RESTING);
      return;
    }
    expect(row, 'at zero there is no gap to schedule, so the row belongs in the closed register').toBeUndefined();
    const closed = readFileSync(join(root, 'docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt'), 'utf8')
      .split('\n').map((l) => l.trim());
    expect(closed, 'and it must be visibly CLOSED, never just absent').toContain('Q-1126');
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

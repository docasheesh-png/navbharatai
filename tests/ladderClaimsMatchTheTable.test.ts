// A COMMENT THAT RESTATES ANOTHER MODULE'S FACT WILL GO STALE, AND NOTHING WILL FAIL.
//
// Found 2026-09-15, by the admin, who read the code and said GPT was on the weak tier. He was
// reading real text: FOUR comments in three files said so. The ladder TABLE never had an OPENAI
// rung — the claim was true of the admin's first list on 2026-09-14 and was superseded the SAME DAY
// once the real GLM prices were known, and CLAUDE.md records the reversal ("gpt-5.4 is OUT of every
// ladder … Nothing to buy from OpenAI"). The comments were never updated.
//
// Nothing could have caught it: `tsc` and `vitest` cannot read a comment, so the code was correct
// and self-contradicting for a day, and the only reader who noticed was a human.
//
// THE RULE THIS PINS: `tierLadder.ts`'s TIER_LADDERS is the ONLY place a rung exists. A comment
// elsewhere may point at it; it may not restate what is on it. This test derives the truth from the
// table, so the day GPT is genuinely added the guard stops complaining by itself — it encodes the
// INVARIANT (comments agree with the table), never the current answer.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';

const SERVER = join(__dirname, '../src/server');

/**
 * Claims that PLACE a provider on a ladder. Deliberately narrow: it matches the shapes that really
 * occurred, not every sentence containing "gpt" and "ladder" — a comment may still discuss a
 * provider, warn about it, or point at the table. Only asserting a POSITION is forbidden.
 */
const PLACEMENT_CLAIMS: RegExp[] = [
  /(?:the\s+)?(?:last|first|final)\s+rung\s+of\s+the\s+\w*\s*ladder/i,
  /ladder\s+(?:puts|places|leads\s+with|ends\s+with)\s+\S+/i,
];

/**
 * PR #2957 (another session, live at the time of writing) owns `routes/agentv3.ts` — it is editing
 * the very chain-assembly region this line sits in. Racing it to a COMMENT would produce a conflict
 * whoever is right, so the line is named here rather than fixed. Remove this entry when #2957 lands.
 */
const OWNED_BY_ANOTHER_PR = new Set(['routes/agentv3.ts']);

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsFiles(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Only `//` comments — all four real occurrences were line comments, and a naive block-comment
 *  stripper corrupts source that contains `/*` inside a string (a live hazard in this repo). */
function lineComments(src: string): string[] {
  return src.split('\n').map((l) => {
    const i = l.indexOf('//');
    return i === -1 ? '' : l.slice(i);
  });
}

const providersOnAnyLadder = new Set(
  Object.values(TIER_LADDERS).flatMap((rungs) => rungs.map((r) => r.provider)),
);

describe('a comment may point at the ladder table; it may not restate what is on it', () => {
  it('OPENAI is genuinely absent from every ladder — the premise of the sweep below', () => {
    expect(providersOnAnyLadder.has('OPENAI')).toBe(false);
  });

  it('no server comment places GPT/OpenAI on a ladder while the table does not', () => {
    if (providersOnAnyLadder.has('OPENAI')) return; // genuinely added ⇒ the claims are true again

    const offenders: string[] = [];
    for (const file of tsFiles(SERVER)) {
      const rel = file.slice(SERVER.length + 1).replace(/\\/g, '/');
      if (OWNED_BY_ANOTHER_PR.has(rel)) continue;
      lineComments(readFileSync(file, 'utf8')).forEach((comment, i) => {
        if (!/\b(gpt|openai)\b/i.test(comment)) return;
        if (PLACEMENT_CLAIMS.some((re) => re.test(comment))) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, `these comments place GPT on a ladder the table does not carry:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('the matcher is real — it catches the exact sentence that was shipped', () => {
    const shipped = '// ── OpenAI (GPT) — the last rung of the WEAK ladder (admin 2026-09-14) ──';
    expect(PLACEMENT_CLAIMS.some((re) => re.test(shipped))).toBe(true);
    expect(/\b(gpt|openai)\b/i.test(shipped)).toBe(true);
  });

  it('it does NOT fire on a comment that merely points at the table', () => {
    for (const ok of [
      '// GPT is on no ladder today — see tierLadder.ts, which owns that fact.',
      '// Set RATE_GPT_IN before GPT is ever used.',
      '// OpenAI rung, if one is ever added, is priced here.',
    ]) {
      expect(PLACEMENT_CLAIMS.some((re) => re.test(ok)), ok).toBe(false);
    }
  });
});

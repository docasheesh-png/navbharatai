import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

/**
 * Q-979 — AND THE ROW NAMED THE WRONG FUNCTION, WHICH IS WHY THIS MEASURES BEFORE IT ASSERTS.
 *
 * The row says *"the `/build` route handler in routes/agentv3.ts"*. **There is no `/build` route.**
 * Measured across every `app.get`/`app.post` in that file, the handler at the limit is
 * `/api/agentv3/chat` — and the gap is not close:
 *
 *     /api/agentv3/chat               17,595 raw lines   (2,501 with comments stripped)
 *     /api/agentv3/publish               444 raw lines
 *     /api/agentv3/preview-diagnose      381 raw lines
 *
 * The nine modules that carry a comment about this limit (`FastLaneBudget`, `thirdPartyLimits`,
 * `gateRedNotice`, `handoffRule`, `finishingPassesAtCap`, `leftoverComponents`, `ProjectPlan`, …) all
 * say "the CHAT handler", so the row is the odd one out. A row that misnames its own subject sends
 * the next session looking for a function that does not exist.
 *
 * 🔑 THE PAIN THIS GUARD REMOVES, which is NOT the size itself. TS2563 ("too large for control flow
 * analysis") trips on a reference's flow walk, so it surfaces in whichever PR happens to add the last
 * few branches — as a red CI naming a file that PR may never have touched. It hit twice in one day
 * (Q-978, then Q-975 on top of #3692). The size is a slow problem; the SURPRISE is the sharp one.
 *
 * So this fails EARLY and says what to do, turning a mystery into an instruction. It does not replace
 * Q-979's real work ("headroom, not a mass rewrite" — move self-contained blocks out, one PR at a
 * time); it makes that work safe to approach incrementally and stops the next session being ambushed.
 *
 * ⚠️ HONEST ABOUT WHAT IT IS: a PROXY, not the compiler's own limit. TS2563 counts flow joins for one
 * reference; this counts branch tokens in the whole handler. The number is not comparable to the
 * compiler's threshold and is not claimed to be — it is a stable measure that moves only when
 * somebody adds a branch, which is exactly the event worth catching.
 */
const ROUTE = "app.post('/api/agentv3/chat'";

/** The handler's body, comments stripped — so a comment can never trip a budget. */
function chatHandlerBody(): string {
  const code = stripCodeComments(readFileSync(resolve(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8'));
  const i = code.indexOf(ROUTE);
  if (i < 0) throw new Error('the chat route moved or was renamed — re-measure before changing this budget');
  const j = code.indexOf('{', code.indexOf('=>', i));
  let depth = 0;
  let k = j;
  while (k < code.length) {
    if (code[k] === '{') depth += 1;
    else if (code[k] === '}') { depth -= 1; if (depth === 0) break; }
    k += 1;
  }
  return code.slice(j, k);
}

function branchTokens(body: string): number {
  const n = (re: RegExp) => (body.match(re) || []).length;
  return n(/\bif\s*\(/g) + n(/&&/g) + n(/\|\|/g) + n(/\?\?/g) + n(/\?[^?:]{0,120}:/g);
}

/**
 * MEASURED 2026-10-18 on `main` (5d80b4c08): 549 — if 147 · && 171 · || 42 · ?? 37 · ternary 152,
 * across 2,501 comment-stripped lines in ONE function.
 *
 * ⬇️ THIS NUMBER MAY ONLY GO DOWN. Lower it when a block moves out; never raise it to make a PR pass.
 */
const BRANCH_BUDGET = 549;

const WHAT_TO_DO = [
  'The chat handler is at or over its branch budget.',
  '',
  'Do NOT raise the number. TypeScript gives up on this function at some point past here (TS2563,',
  '"too large for control flow analysis"), and when it does the red CI lands in whichever PR adds the',
  'last few branches and names a file that PR may not have touched — it has already happened twice.',
  '',
  'Put the new condition in a module function and call it, which is what every module in',
  'src/server/AgentV3 that mentions TS2563 already does (FastLaneBudget.ts and thirdPartyLimits.ts are',
  'the clearest patterns). If you MOVED a block out, lower BRANCH_BUDGET to the new measurement.',
].join('\n');

describe('🔒 the chat handler keeps its headroom (Q-979)', () => {
  it('the route is still there to measure — a rename must re-measure, not silently pass', () => {
    expect(() => chatHandlerBody()).not.toThrow();
    expect(chatHandlerBody().length, 'an empty body means the brace walk broke').toBeGreaterThan(10_000);
  });

  it(`no PR adds branches to it (budget ${BRANCH_BUDGET})`, () => {
    const found = branchTokens(chatHandlerBody());
    expect(found, `${WHAT_TO_DO}\n\nfound ${found}, budget ${BRANCH_BUDGET}`).toBeLessThanOrEqual(BRANCH_BUDGET);
  });

  it('⬇️ the budget may only go DOWN — a stale number stops meaning anything', () => {
    const found = branchTokens(chatHandlerBody());
    expect(found, `branches came out of the handler (${found} < ${BRANCH_BUDGET}) — lower BRANCH_BUDGET to ${found}`)
      .toBe(BRANCH_BUDGET);
  });

  it('comments are stripped, so documenting the handler can never cost budget', () => {
    // The measurement runs on stripped source; a prose line mentioning `if (` or `&&` is not a branch.
    const body = chatHandlerBody();
    expect(body).not.toContain('/**');
    expect(body.includes('//')).toBe(false);
  });

  /**
   * The row's own words, kept here because the next session will read this file before the row: the
   * fix is "headroom, not a mass rewrite". This records WHICH blocks were already moved, so nobody
   * moves one twice or assumes nothing has been done.
   */
  it('the blocks already moved out are still out', () => {
    const root = resolve(__dirname, '..');
    for (const f of [
      'src/server/AgentV3/finishingPassesAtCap.ts',   // the finishing passes
      'src/server/AgentV3/FastLaneBudget.ts',         // the fast-lane setup
      'src/server/AgentV3/leftoverComponents.ts',     // #3698's leftover-net guard
      'src/server/AgentV3/gateRedNotice.ts',
      'src/server/AgentV3/handoffRule.ts',
    ]) {
      expect(() => readFileSync(resolve(root, f), 'utf8'), `${f} is a home for conditions that used to live in the handler`).not.toThrow();
    }
  });
});

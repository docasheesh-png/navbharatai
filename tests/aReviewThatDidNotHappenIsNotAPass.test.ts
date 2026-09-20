// A review that did not happen is not a PASS (admin 2026-09-19, while putting the NVIDIA trial key on
// the Weak judge — "par aap abhi free wali/low cost wali use karoge").
//
// 🔴 THE DEFECT, and it was narrower AND sharper than first reported. `judgeBuild`'s THROW path was
// already honest (`score: 0` plus a plain explanation) — a key that is missing, a host that is wrong,
// credits that ran out all land there. What was not honest was the OTHER path: an answer this parser
// could not read returned **`{ pass: true, findings: [], score: 100 }`** — a perfect score, no
// findings, indistinguishable from a genuinely flawless app at the one place a human looks.
//
// 🔑 AND IT GOT MORE DANGEROUS THE SAME DAY. The judge is now allowed to be a REASONING model
// (Nemotron Ultra), a class far likelier to wrap its JSON in prose — or emit reasoning and no JSON at
// all — than the `glm-5.3` this parser was written against.
//
// ⚠️ `pass` STAYS TRUE throughout. It is the CONTROL signal (`nextReviewAction` spends a repair and
// then Claude on a false), so flipping it would escalate EVERY build to Claude through a provider
// outage — a fix trading one problem for a dearer one. The control flow is untouched; the REPORTING
// became truthful, which is what the fifth absolute rule asks for.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseJudgeVerdict, judgeBuild, reviewDidNotHappen, judgeActuallyRan,
} from '../src/server/AgentV3/BuildJudge';
import { nextReviewAction } from '../src/server/AgentV3/CheapFloorReview';

const FILES = [{ path: 'src/App.tsx', content: 'export default function App(){return <div>hi</div>}' }];
const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('🔴 an unreadable reply no longer scores 100', () => {
  for (const [label, reply] of [
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['prose with no JSON', 'The app looks broadly fine to me, I would ship it.'],
    ['reasoning and no verdict', '<think>Let me consider the files one by one…</think>'],
    ['malformed JSON', '{"verdict":"pass", "findings":[}'],
  ] as const) {
    it(`${label} ⇒ score 0, an honest finding, reviewed=false`, () => {
      const v = parseJudgeVerdict(reply as string | null | undefined);
      expect(v.score, 'a reply nobody could read must not score 100').toBe(0);
      expect(judgeActuallyRan(v)).toBe(false);
      expect(v.findings.length).toBeGreaterThan(0);
      expect(v.findings[0]).toMatch(/not been reviewed/i);
      // …and it still does not block.
      expect(v.pass).toBe(true);
    });
  }

  it('a REAL pass is untouched — 100, no findings, reviewed', () => {
    const v = parseJudgeVerdict('{"verdict":"pass","findings":[],"score":97}');
    expect([v.pass, v.score, judgeActuallyRan(v)]).toEqual([true, 97, true]);
  });

  it('a REAL fail is untouched, findings and all', () => {
    const v = parseJudgeVerdict('{"verdict":"fail","findings":["the Save button does nothing"],"score":30}');
    expect([v.pass, v.score, judgeActuallyRan(v)]).toEqual([false, 30, true]);
    expect(v.findings).toEqual(['the Save button does nothing']);
  });

  it('a fail with NO findings still passes — unactionable, and that rule predates this change', () => {
    const v = parseJudgeVerdict('{"verdict":"fail","findings":[],"score":10}');
    expect([v.pass, v.score, judgeActuallyRan(v)]).toEqual([true, 100, true]);
  });
});

describe('a judge that could not RUN', () => {
  it('reports reviewed=false — the caller no longer has to infer it from score 0', async () => {
    const v = await judgeBuild('build a todo app', FILES, async () => { throw new Error('402 payment required'); }, 'm');
    expect(judgeActuallyRan(v)).toBe(false);
    expect(v.score).toBe(0);
    expect(v.pass, 'an unreachable judge must not escalate every build').toBe(true);
    expect(v.findings[0]).toMatch(/could not be completed/i);
  });

  it('every exhausted-trial shape lands there — the case this was built for', async () => {
    for (const err of ['402 Payment Required', '429 Too Many Requests', 'fetch failed', '404 model not found']) {
      const v = await judgeBuild('x', FILES, async () => { throw new Error(err) }, 'm');
      expect(judgeActuallyRan(v), err).toBe(false);
    }
  });

  it('🔒 an EMPTY PROJECT is the opposite case — we DID look, so reviewed stays true', async () => {
    // That finding is about the app (there was nothing there), not about our instrument.
    const v = await judgeBuild('x', [], async () => ({ text: '{"verdict":"pass","score":100}' }), 'm');
    expect(judgeActuallyRan(v)).toBe(true);
    expect(v.score).toBe(0);
    expect(v.findings[0]).toMatch(/no files to review/i);
  });

  it('a real verdict reports reviewed=true', async () => {
    const v = await judgeBuild('x', FILES, async () => ({ text: '{"verdict":"fail","findings":["no save"],"score":20}' }), 'm');
    expect(judgeActuallyRan(v)).toBe(true);
    expect(v.pass).toBe(false);
  });
});

describe('🔒 the CONTROL FLOW is unchanged — no escalation storm on a provider outage', () => {
  it('a not-run verdict takes the same branch a pass takes', () => {
    const notRun = reviewDidNotHappen('nope');
    expect(notRun.pass).toBe(true);
    // `nextReviewAction` reads ONLY `pass`, so an unreachable judge spends no repair and no Claude.
    expect(nextReviewAction(notRun.pass, 0, 1)).not.toBe('cheap_repair');
  });

  it('judgeActuallyRan defaults to TRUE on an absent flag, so an older caller is unchanged', () => {
    expect(judgeActuallyRan({})).toBe(true);
    expect(judgeActuallyRan(null)).toBe(true);
    expect(judgeActuallyRan(undefined)).toBe(true);
    expect(judgeActuallyRan({ reviewed: true })).toBe(true);
  });
});

describe('the report stops saying PASS about a review that produced nothing', () => {
  const code = codeOnly(ROUTE);

  it('records a DISTINCT code, not a reworded message', () => {
    // `CHEAP_REVIEW` is what somebody greps to ask "what did the reviewer say?" — a run where it said
    // nothing must not answer that question with a number.
    expect(code).toContain('CHEAP_REVIEW_NOT_RUN');
    expect(code).toMatch(/if \(!judgeActuallyRan\(v\)\)/);
  });

  it('at WARNING severity, and it shows the reason — which a pass used to throw away', () => {
    const at = code.indexOf('CHEAP_REVIEW_NOT_RUN');
    const line = code.slice(at - 260, at + 260);
    expect(line).toContain("severity: 'warning'");
    expect(line).toContain('v.findings[0]');
    expect(line).not.toMatch(/PASS/);
  });

  it('🔒 it is PROCESS-ONLY and NEVER SUGGESTED — our instrument, never a mark against their app', () => {
    const diag = readFileSync(join(__dirname, '..', 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    const sugg = readFileSync(join(__dirname, '..', 'src/server/AgentV3/buildFindingSuggestions.ts'), 'utf8');
    expect(diag).toContain("'CHEAP_REVIEW_NOT_RUN'");
    expect(sugg).toContain("'CHEAP_REVIEW_NOT_RUN'");
  });

  it('🔒 WHITE-LABEL — the not-reviewed wording names no vendor', () => {
    for (const v of [reviewDidNotHappen('x'), parseJudgeVerdict('')]) {
      for (const bad of [/nemotron/i, /nvidia/i, /glm/i, /grok/i, /claude/i, /sonnet/i, /openrouter/i]) {
        expect(v.findings.join(' ')).not.toMatch(bad);
      }
    }
  });
});

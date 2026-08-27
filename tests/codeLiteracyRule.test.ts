import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CODE_LITERACY_RULE, planSystemPrompt } from '../src/server/AgentV3/systemPrompt';

/**
 * CODE LITERACY IN THE USER'S LANGUAGE (ROADMAP 9.1a–c) — the rule, and where it must hold.
 *
 * The roadmap calls this the only genuinely un-copyable item in the whole audit: none of the five
 * competitors explain a user's own errors to them in their language. The rule has two halves, and
 * each has a specific way of silently dying:
 *
 * 1. THE REGISTER (9.1c). Told to "answer in Hindi", models translate EVERYTHING — including the
 *    technical nouns — and a reply full of Devanagari words for "function" and "loop" reads as
 *    patronising to a real developer, who closes the tab. The rule must therefore explicitly keep
 *    technical nouns in English. If the rule text loses that instruction, nothing errors; replies
 *    just quietly turn into translated Hindi and the feature damages the trust it was built to earn.
 *
 * 2. THE SURFACES (9.1a/b). A prompt rule only holds on prompts that carry it. The composition
 *    sites are string concatenations inside a route file that cannot be executed in a unit test, so
 *    they are pinned at source level — the same honest trade as the cache-prefix and realism-tier
 *    pins, and recorded here for the same reason.
 */

describe('the rule itself', () => {
  it('keeps technical nouns in English — the register half', () => {
    for (const noun of ['variable', 'function', 'error', 'deploy']) {
      expect(CODE_LITERACY_RULE).toContain(noun);
    }
    expect(CODE_LITERACY_RULE).toContain('NEVER translate technical terms');
    // The example is load-bearing: models follow examples harder than abstractions.
    expect(CODE_LITERACY_RULE).toContain('is function me loop galat chal raha hai');
  });

  it('demands errors be EXPLAINED, never just shown', () => {
    expect(CODE_LITERACY_RULE).toContain('ERRORS ARE EXPLAINED, NEVER JUST SHOWN');
  });

  it('keeps identifiers and paths verbatim', () => {
    expect(CODE_LITERACY_RULE).toContain('Code identifiers, file paths and error text stay verbatim');
  });
});

describe('the surfaces that must carry it', () => {
  it('the plan prompt carries it (executed, not source-grepped)', () => {
    expect(planSystemPrompt()).toContain('EXPLAIN CODE IN THE USER');
  });

  it('the architect prompt source carries it beside LANGUAGE_RULE', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/systemPrompt.ts'), 'utf8');
    // Both composed lists include the rule; the literal appears once as the definition and twice in lists.
    expect(src.match(/CODE_LITERACY_RULE,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('the Advise/role chat and the plain-chat fallback carry it', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route.match(/CODE_LITERACY_RULE/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // import + 2 sites
  });

  it('the free chat carries the register + explain-errors halves', () => {
    const chat = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');
    expect(chat).toContain('never translate technical terms into Hindi words');
    expect(chat).toContain('what it means and what to change');
  });
});

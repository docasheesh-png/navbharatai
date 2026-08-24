import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CREDENTIAL_SILENCE_RULE, LANGUAGE_RULE, architectSystemPrompt, planSystemPrompt } from '../src/server/AgentV3/systemPrompt';

/**
 * THE OTHER HALF OF A REAL LEAK (admin build report 2026-08-24).
 *
 * An imported repo documented its own admin login; the model quoted it into its survey and a real
 * password reached the chat and the durable report. #2624 widened `redactSecrets` to catch it — but a
 * net is RECOVERY. This is the prevention: the value should never have been written down a second time.
 */
describe('the rule says where, never what', () => {
  it('forbids reproducing a value, in every place a model might put one', () => {
    for (const word of ['summary', 'code block', 'table', 'commit message']) {
      expect(CREDENTIAL_SILENCE_RULE).toContain(word);
    }
    expect(CREDENTIAL_SILENCE_RULE).toContain('NEVER reproduce the VALUE');
  });

  it('explicitly ALLOWS naming the location — otherwise a survey becomes useless', () => {
    // The distinction is the whole point. "Avoid secrets" reads to a model as "do not discuss
    // configuration at all", which would gut exactly the kind of answer the user asked for.
    expect(CREDENTIAL_SILENCE_RULE).toContain('Naming the LOCATION is correct');
    expect(CREDENTIAL_SILENCE_RULE).toContain('.env');
  });

  it('closes the two excuses a model actually reaches for', () => {
    // "They own the repo" and "they asked me to" are both true and both irrelevant: a reply and a build
    // report are stored and shared in places the original file is not.
    expect(CREDENTIAL_SILENCE_RULE).toContain('owns the repo');
    expect(CREDENTIAL_SILENCE_RULE).toContain('when they ask you to show it');
  });

  it('gives an alternative, so the model has somewhere to go', () => {
    expect(CREDENTIAL_SILENCE_RULE).toContain('describe its SHAPE');
  });
});

describe('it reaches every path that produces user-facing text', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('is in the architect and plan prompts', () => {
    expect(architectSystemPrompt('vite-react')).toContain('SAY WHERE, NEVER WHAT');
    expect(planSystemPrompt('vite-react')).toContain('SAY WHERE, NEVER WHAT');
  });

  it('travels with LANGUAGE_RULE on the hand-composed chat paths too', () => {
    // Those paths build their system prompt by hand, so a rule added only to the builder would miss
    // exactly the turn that leaked — a survey, which is a chat answer about code.
    for (const m of route.matchAll(/LANGUAGE_RULE \+ '\\n\\n' \+/g)) {
      const after = route.slice(m.index ?? 0, (m.index ?? 0) + 120);
      expect(after, 'LANGUAGE_RULE composed without CREDENTIAL_SILENCE_RULE').toContain('CREDENTIAL_SILENCE_RULE');
    }
  });

  it('sits beside LANGUAGE_RULE — the same class of rule, about the text produced', () => {
    expect(architectSystemPrompt('vite-react').indexOf('SAY WHERE, NEVER WHAT'))
      .toBeGreaterThan(architectSystemPrompt('vite-react').indexOf(LANGUAGE_RULE.slice(0, 40)));
  });
});

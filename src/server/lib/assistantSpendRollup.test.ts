import { describe, it, expect } from 'vitest';
import {
  foldAssistantTurn, emptyAssistantSpendDay, freeShare, assistantSpendVerdict, rungKey,
  MIN_TURNS_FOR_VERDICT, type AssistantTurn,
} from './assistantSpendRollup';
import type { ChatTurnCost } from './chatSpend';

const DATE = '2026-08-10';

const cost = (realUsd: number, billedUsd = realUsd * 4): ChatTurnCost => ({
  measured: true, realUsd, billedUsd, billedInr: billedUsd * 85, inputTokens: 1500, outputTokens: 600,
});
const UNMEASURED: ChatTurnCost = {
  measured: false, realUsd: 0, billedUsd: 0, billedInr: 0, inputTokens: 0, outputTokens: 0,
};

const free = (): AssistantTurn => ({ provider: 'GLM', model: 'glm-4.7-flash', cost: cost(0, 0) });
const paid = (real = 0.00195): AssistantTurn => ({ provider: 'GEMINI', model: 'gemini-2.5-flash', cost: cost(real) });
const unknown = (): AssistantTurn => ({ provider: 'GLM', model: 'glm-4.7-flash', cost: UNMEASURED });

const foldAll = (turns: AssistantTurn[]) =>
  turns.reduce((d, t) => foldAssistantTurn(d, DATE, t), emptyAssistantSpendDay(DATE));

describe('counting what the assistants cost', () => {
  it('a turn on the free leader adds a turn and no money', () => {
    const day = foldAssistantTurn(null, DATE, free());
    expect(day.turns).toBe(1);
    expect(day.freeTurns).toBe(1);
    expect(day.realUsd).toBe(0);
    expect(day.billedUsd).toBe(0);
  });

  it('a fallback turn records both what it cost us and what the user pays', () => {
    const day = foldAssistantTurn(null, DATE, paid(0.00195));
    expect(day.paidTurns).toBe(1);
    expect(day.realUsd).toBeCloseTo(0.00195, 6);
    expect(day.billedUsd).toBeCloseTo(0.0078, 6);   // the same ×4 markup a build uses
  });

  it('keeps a per-rung breakdown, so a shift names the model that absorbed it', () => {
    const day = foldAll([free(), free(), paid()]);
    expect(day.perModel['glm-4.7-flash'].turns).toBe(2);
    expect(day.perModel['gemini-2.5-flash'].turns).toBe(1);
    expect(day.perModel['glm-4.7-flash'].realUsd).toBe(0);
  });

  it('does not mutate the day it was given', () => {
    const first = foldAssistantTurn(null, DATE, free());
    const second = foldAssistantTurn(first, DATE, paid());
    expect(first.turns).toBe(1);
    expect(second.turns).toBe(2);
  });

  it('starts a fresh day rather than adding onto yesterday', () => {
    const yesterday = foldAssistantTurn(null, '2026-08-09', free());
    const today = foldAssistantTurn(yesterday, DATE, free());
    expect(today.date).toBe(DATE);
    expect(today.turns).toBe(1);
  });
});

describe('"free" and "we do not know" are never merged', () => {
  // This is the whole point of the module: an unmeasured turn folded into the free bucket would
  // flatter the exact number that is supposed to warn us.
  it('an unmeasured turn is counted apart from both free and paid', () => {
    const day = foldAssistantTurn(null, DATE, unknown());
    expect(day.unmeasuredTurns).toBe(1);
    expect(day.freeTurns).toBe(0);
    expect(day.paidTurns).toBe(0);
  });

  it('unmeasured turns never contribute money, even if a caller passes figures alongside', () => {
    const rogue: AssistantTurn = {
      provider: 'GROK', model: 'grok-4',
      cost: { ...UNMEASURED, realUsd: 9.99, billedUsd: 40 },   // measured:false must win
    };
    const day = foldAssistantTurn(null, DATE, rogue);
    expect(day.realUsd).toBe(0);
    expect(day.billedUsd).toBe(0);
  });

  it('the free share ignores unmeasured turns instead of assuming them', () => {
    expect(freeShare(foldAll([free(), paid(), unknown(), unknown()]))).toBe(0.5);
  });

  it('a day of nothing but unmeasured turns has NO free share, not 0%', () => {
    // 0% would read as "the free model died today" — the opposite of "we cannot tell".
    expect(freeShare(foldAll([unknown(), unknown()]))).toBeNull();
  });
});

describe('the verdict — the early warning this exists for', () => {
  const many = (n: number, make: () => AssistantTurn) => Array.from({ length: n }, make);

  it('says nothing confident until there are enough turns to mean something', () => {
    // One fallback on a quiet morning is not a collapse. A tripwire that cries on jitter gets ignored.
    const day = foldAll([...many(2, free), paid()]);
    const v = assistantSpendVerdict(day);
    expect(v.status).toBe('unknown');
    expect(v.message).toContain('Not enough');
  });

  it('reports healthy while the free leader carries traffic', () => {
    const v = assistantSpendVerdict(foldAll(many(MIN_TURNS_FOR_VERDICT, free)));
    expect(v.status).toBe('healthy');
    expect(v.freeShare).toBe(1);
  });

  it('tolerates ordinary flash failures without alarming', () => {
    const day = foldAll([...many(38, free), ...many(2, paid)]);   // 95% free
    expect(assistantSpendVerdict(day).status).toBe('healthy');
  });

  it('warns when paid rungs start absorbing real traffic', () => {
    const day = foldAll([...many(28, free), ...many(12, paid)]);  // 70% free
    const v = assistantSpendVerdict(day);
    expect(v.status).toBe('watch');
    expect(v.message).toContain('rate-limiting');
  });

  it('calls it out when the arrangement has genuinely gone — the silent-expense case', () => {
    // Nothing is broken here: every answer is correct, the product feels fine, and the bill has moved.
    const day = foldAll([...many(4, free), ...many(36, paid)]);   // 10% free
    const v = assistantSpendVerdict(day);
    expect(v.status).toBe('shifted');
    expect(v.message).toContain('PAID');
    expect(v.message).toContain('without anything appearing broken');
  });

  it('is honest about an empty or missing day', () => {
    expect(assistantSpendVerdict(null).status).toBe('unknown');
    expect(assistantSpendVerdict(emptyAssistantSpendDay(DATE)).freeShare).toBeNull();
  });
});

describe('bucket keys', () => {
  it('prefers the exact model, since that is what carries the price', () => {
    expect(rungKey({ provider: 'GLM', model: 'GLM-4.7-Flash', cost: UNMEASURED })).toBe('glm-4.7-flash');
  });

  it('falls back to the provider, then to a named unknown — never silently onto a real rung', () => {
    expect(rungKey({ provider: 'GROK', cost: UNMEASURED })).toBe('grok');
    expect(rungKey({ cost: UNMEASURED })).toBe('unknown');
    expect(rungKey({ provider: '  ', model: '  ', cost: UNMEASURED })).toBe('unknown');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveDomainKnowledge, knowledgeFromList, parseDomainKnowledge, worthAsking,
  domainKnowledgePrompt, domainLearningEnabled, MAX_NEEDS, MAX_QUESTIONS, MIN_WORDS_FOR_DOMAIN,
} from '../src/server/lib/domainKnowledge';

/**
 * THE ADMIN'S OBJECTION (2026-09-18): "kya ham app ka store bana rahe hai… hame to app generator
 * banana tha na?" The knowledge layer was sixteen hand-written domains, so a hospital got RBAC and a
 * mandir donation app got nothing. The list is now asked FIRST and a model only where it is silent.
 */
const says = (o: unknown) => async () => JSON.stringify(o);
const TEMPLE = { domain: 'temple donation', needs: ['donor receipts with 80G details', 'UPI collection'], questions: ['Printed receipts needed?'] };

describe('the long tail finally gets help', () => {
  it('a mandir donation app — no enumerated domain — now gets real knowledge', async () => {
    const k = await resolveDomainKnowledge('mandir ke liye donation aur receipt ka app banao', says(TEMPLE));
    expect(k.source).toBe('generated');
    expect(k.domain).toBe('temple donation');
    expect(k.needs.length).toBeGreaterThan(0);
  });

  it('and it got NOTHING from the list — which is the whole reason this exists', () => {
    expect(knowledgeFromList('mandir ke liye donation aur receipt ka app banao')).toBeNull();
    expect(knowledgeFromList('machhli palan ka record rakhne wala app banao')).toBeNull();
  });
});

describe('the list is asked first, so the known domains cost nothing and cannot change', () => {
  it('a hospital is answered by the list, and the model is never called', async () => {
    let called = false;
    const k = await resolveDomainKnowledge('hospital management app banao', async () => { called = true; return '{}'; });
    expect(k.source).toBe('listed');
    expect(k.domain).toBe('healthcare');
    expect(called).toBe(false);
  });

  it('a generated answer can never override a listed one', async () => {
    const k = await resolveDomainKnowledge('hospital management app banao', says({ domain: 'nonsense', needs: ['x'] }));
    expect(k.domain).toBe('healthcare');
  });
});

describe('what must never cost a call', () => {
  // ⚠️ TWO of my own first guesses here were wrong, and both are recorded rather than quietly swapped.
  // "todo app" is a LISTED domain (`productivity`), so it costs nothing for a different reason; and
  // "ek rang badalne wala toy" is FIVE words, so it is correctly above the floor and DOES ask — a
  // five-word request can genuinely have a domain. The floor is a cost gate on thin prompts, nothing more.
  for (const p of ['a calculator', 'ek stopwatch banao']) {
    it(`"${p}" is too thin to have a domain — no model call`, async () => {
      expect(worthAsking(p)).toBe(false);
      let called = false;
      const k = await resolveDomainKnowledge(p, async () => { called = true; return '{}'; });
      expect(called).toBe(false);
      expect(k.source).toBe('none');
    });
  }

  it('the kill switch stops generation and leaves the list working', async () => {
    const env = { AGENTV3_DOMAIN_LEARN: 'off' } as NodeJS.ProcessEnv;
    expect(domainLearningEnabled(env)).toBe(false);
    expect((await resolveDomainKnowledge('mandir ke liye donation app banao', says(TEMPLE), env)).source).toBe('none');
    expect((await resolveDomainKnowledge('hospital management app banao', says(TEMPLE), env)).source).toBe('listed');
  });

  it('no llmCall supplied ⇒ exactly today\'s behaviour', async () => {
    expect((await resolveDomainKnowledge('mandir ke liye donation app banao')).source).toBe('none');
  });
});

describe('it can only ever ADD — every doubt resolves to nothing', () => {
  const p = 'mandir ke liye donation aur receipt ka app banao';
  it('a throw adds nothing', async () => {
    expect((await resolveDomainKnowledge(p, async () => { throw new Error('down'); })).source).toBe('none');
  });
  it('an unparseable reply adds nothing', async () => {
    expect((await resolveDomainKnowledge(p, async () => 'sure! I think it needs…')).source).toBe('none');
  });
  it('an EXPLICIT "nothing special" adds nothing — the main safety property', async () => {
    // The corpus records a to-do app handed moderation and media upload: "bloat that lengthens the
    // build". A model told to produce a list will produce one, so the empty answer must be first-class.
    expect((await resolveDomainKnowledge(p, says({ domain: '', needs: [], questions: [] }))).source).toBe('none');
  });
  it('a domain with no needs adds nothing — a bare label is not knowledge', async () => {
    expect((await resolveDomainKnowledge(p, says({ domain: 'temple', needs: [] }))).source).toBe('none');
  });
  it('the prompt tells the model the empty answer is correct', () => {
    expect(domainKnowledgePrompt('x')).toMatch(/An empty answer is a correct and useful answer/);
    expect(domainKnowledgePrompt('x')).toMatch(/Do not invent requirements/);
  });
});

describe('bloat is bounded by construction', () => {
  it('needs and questions are capped and de-duplicated', () => {
    const many = { domain: 'x', needs: Array.from({ length: 30 }, (_, i) => `need ${i}`), questions: Array.from({ length: 9 }, (_, i) => `q ${i}`) };
    const parsed = parseDomainKnowledge(JSON.stringify(many))!;
    expect(parsed.needs.length).toBe(MAX_NEEDS);
    expect(parsed.questions.length).toBe(MAX_QUESTIONS);
  });
  it('duplicates collapse', () => {
    expect(parseDomainKnowledge('{"domain":"x","needs":["a","a","a"]}')!.needs).toEqual(['a']);
  });
  it('a fenced reply is read, because chat models fence', () => {
    expect(parseDomainKnowledge('sure:\n```json\n{"domain":"shop","needs":["billing"]}\n```')!.domain).toBe('shop');
  });
  it('the word floor is a COST gate and is stated as a number', () => {
    expect(MIN_WORDS_FOR_DOMAIN).toBe(4);
  });
});

describe('the wiring, in both lanes', () => {
  const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('one shared helper serves both, on the FREE router', () => {
    const at = route.indexOf('const learnDomain =');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 500)).toContain("AIRouterManager.getRouter('free')");
  });
  it('Plan mode passes the knowledge it resolved', () => {
    expect(route).toContain('plannerDomainBrief(chatRole, prompt, { projectIsEmpty, knowledge })');
  });
  it('the BUILDER only adds where the list was silent', () => {
    // `!reqGuidance` is what keeps every existing build prompt byte-identical.
    expect(route).toContain('if (!reqGuidance && askedForAnApp && !answered)');
    expect(route).toContain("learned.source === 'generated'");
  });
  it('the builder still never asks a question — the 2026-07-20 decision is untouched', () => {
    const at = route.indexOf('if (!reqGuidance && askedForAnApp && !answered)');
    expect(route.slice(at, at + 1200)).toContain('skip it silently rather than asking');
    expect(route.slice(at, at + 1200)).not.toContain('learned.questions');
  });
});

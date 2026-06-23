import { describe, it, expect } from 'vitest';
import { retrieveClinicalKnowledge, formatKnowledgeForPrompt, CLINICAL_KB } from '../src/server/lib/clinical/knowledgeBase';

describe('clinical knowledge grounding (C)', () => {
  it('retrieves paediatric danger signs for a sick child', () => {
    const cards = retrieveClinicalKnowledge('2 year old child not drinking and lethargic');
    expect(cards.some(c => c.id === 'imci_danger_signs')).toBe(true);
  });

  it('retrieves snakebite card', () => {
    const cards = retrieveClinicalKnowledge('patient with snake bite to the leg');
    expect(cards[0].id).toBe('snakebite');
  });

  it('retrieves ACS card for chest pain', () => {
    const cards = retrieveClinicalKnowledge('55 yo man with severe chest pain radiating to arm');
    expect(cards.some(c => c.id === 'acs_first_steps')).toBe(true);
  });

  it('returns empty for an unrelated query', () => {
    expect(retrieveClinicalKnowledge('how do I deploy a website').length).toBe(0);
  });

  it('formats cards with source citation', () => {
    const block = formatKnowledgeForPrompt(retrieveClinicalKnowledge('dengue fever with bleeding'));
    expect(block).toMatch(/Source:/);
    expect(block).toMatch(/GROUNDED CLINICAL REFERENCES/);
  });

  it('retrieves mentor (non-case) cards for junior-doctor queries', () => {
    expect(retrieveClinicalKnowledge('how to write a discharge summary').some(c => c.id === 'doc_discharge_summary')).toBe(true);
    expect(retrieveClinicalKnowledge('breaking bad news to family').some(c => c.id === 'comm_breaking_bad_news')).toBe(true);
    expect(retrieveClinicalKnowledge('needle stick injury what to do').some(c => c.id === 'needlestick')).toBe(true);
  });

  it('every card has id, content and a source', () => {
    for (const c of CLINICAL_KB) {
      expect(c.id && c.content && c.source).toBeTruthy();
      expect(c.keywords.length).toBeGreaterThan(0);
    }
  });
});

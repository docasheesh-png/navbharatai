import { describe, it, expect } from 'vitest';
import { getProfessional, listProfessionals } from '../src/server/professionals/registry';
import { retrieveKnowledge, formatKnowledge } from '../src/server/professionals/knowledge';

describe('professional AI framework', () => {
  it('registry exposes Teacher AI', () => {
    const t = getProfessional('teacher_ai');
    expect(t).toBeTruthy();
    expect(t!.name).toBe('Teacher AI');
    expect(t!.systemPrompt.length).toBeGreaterThan(100);
    expect(listProfessionals().some((p) => p.id === 'teacher_ai')).toBe(true);
  });

  it('unknown professional returns undefined', () => {
    expect(getProfessional('nope_ai')).toBeUndefined();
  });

  it('knowledge retrieval finds relevant teacher cards', () => {
    const t = getProfessional('teacher_ai')!;
    const cards = retrieveKnowledge(t.knowledge, 'make a study plan for my exam prep');
    expect(cards.some((c) => c.id === 'active_recall')).toBe(true);
  });

  it('knowledge formatter cites sources', () => {
    const t = getProfessional('teacher_ai')!;
    const block = formatKnowledge(retrieveKnowledge(t.knowledge, 'lesson plan objectives'));
    expect(block).toMatch(/Source:/);
    expect(block).toMatch(/GROUNDED REFERENCES/);
  });

  it('retrieval returns empty for irrelevant query', () => {
    const t = getProfessional('teacher_ai')!;
    expect(retrieveKnowledge(t.knowledge, 'deploy a kubernetes cluster').length).toBe(0);
  });
});

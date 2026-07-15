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

  it('Teacher AI has persistent per-student memory and the concept-mastery method', () => {
    const t = getProfessional('teacher_ai')!;
    expect(t.memory).toBeTruthy();
    expect(t.memory!.subject).toBe('student');
    expect(t.memory!.fields.some((f) => f.key === 'weakSubjects')).toBe(true);
    expect(t.memory!.intake.length).toBeGreaterThan(20);
    expect(t.systemPrompt).toMatch(/HOW YOU MAKE A CONCEPT STICK/);
    expect(t.systemPrompt).toMatch(/Feynman/);
    expect(t.systemPrompt).toMatch(/memory hook/i);
    expect(t.systemPrompt).toMatch(/out-of-syllabus/);
  });

  it('memory-enabled professionals are agents with intake + fields (Batch 1 & 2)', () => {
    const memoryAgents = [
      'nutritionist_ai', 'fitness_ai', 'wellness_ai', 'mentor_ai', // Batch 1
      'finance_ai', 'accountant_ai', 'lawyer_ai', // Batch 2
      'parenting_ai', 'eldercare_ai', 'petcare_ai', 'maternity_ai', // Batch 3
      'coding_ai', 'english_ai', 'mathscience_ai', 'speaking_ai', // Batch 4
      'studyabroad_ai', 'thesis_ai', 'aptitude_ai', 'gk_ai', 'resume_ai', // Batch 5
    ];
    for (const id of memoryAgents) {
      const p = getProfessional(id)!;
      expect(p, id).toBeTruthy();
      expect(p.memory, id).toBeTruthy();
      expect(p.memory!.fields.length, id).toBeGreaterThan(2);
      expect(p.memory!.intake.length, id).toBeGreaterThan(20);
      // every memory-enabled professional should remember at least the person's name
      expect(p.memory!.fields.some((f) => f.key === 'name'), id).toBe(true);
      // field keys must be unique per config (no accidental duplicate that would collide on merge)
      const keys = p.memory!.fields.map((f) => f.key);
      expect(new Set(keys).size, id).toBe(keys.length);
    }
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

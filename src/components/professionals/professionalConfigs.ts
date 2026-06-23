import type { ProfessionalChatConfig } from './ProfessionalChat';

/**
 * Frontend UI configs for config-driven professionals (welcome + quick prompts).
 * Backend persona/knowledge lives in src/server/professionals/. Add a professional
 * here + activate its card in ProfessionalsView + add its ViewType render block.
 */
export const PROFESSIONAL_CHATS: Record<string, ProfessionalChatConfig> = {
  teacher_ai: {
    id: 'teacher_ai',
    name: 'Teacher AI',
    welcome:
      "Namaste! I'm Teacher AI 👩‍🏫 — I can explain any concept simply, solve your doubts step by step, make lesson plans or quizzes, and build a study/exam plan (boards, NEET, JEE, UPSC…). Ask me anything, in any language.",
    quickPrompts: [
      'Explain photosynthesis simply',
      'Make a 1-week study plan for class 10 maths',
      'Quiz me on the French Revolution',
      'Help me solve a doubt step by step',
    ],
  },
};

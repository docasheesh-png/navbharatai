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
  mentor_ai: {
    id: 'mentor_ai',
    name: 'Mentor / Career Coach',
    welcome:
      "Hi! I'm your Mentor & Career Coach 🧭 — I can guide your career direction, review/build your resume, prep you for interviews (STAR), plan a skill roadmap, or help with a job switch or higher studies. Tell me where you are and what you want next.",
    quickPrompts: [
      'Help me choose a career path',
      'Review my resume',
      'Prepare me for an interview',
      'Make a skill roadmap for my goal',
    ],
  },
  thesis_ai: {
    id: 'thesis_ai',
    name: 'Thesis / Research Writer',
    welcome:
      "Hello! I'm Thesis AI 📚 — your academic research & writing assistant. I can sharpen your research question, structure your thesis (IMRaD/chapters), help organise a literature review, choose a methodology, format citations (APA/MLA/IEEE), and polish your own draft. I never invent sources or data — the scholarship stays yours.",
    quickPrompts: [
      'Sharpen my research question',
      'Help structure my thesis',
      'Format these references in APA',
      'Improve the clarity of my draft',
    ],
  },
  accountant_ai: {
    id: 'accountant_ai',
    name: 'CA / Tax & Accounts',
    welcome:
      "Namaste! I'm CA AI 🧮 — I can explain GST, income tax (old vs new regime), TDS, deductions, and bookkeeping, help you understand a tax notice or ITR/GST form, and walk through how a figure is computed. Note: tax rates & dates change every year — I'll always tell you to verify current figures and consult a CA before acting.",
    quickPrompts: [
      'Explain old vs new tax regime',
      'How does GST input tax credit work?',
      'What is TDS and Form 26AS?',
      'Basics of bookkeeping for my small business',
    ],
  },
  lawyer_ai: {
    id: 'lawyer_ai',
    name: 'Lawyer / Legal Assistant',
    welcome:
      "Namaste! I'm Legal AI ⚖️ — I give general legal INFORMATION on Indian law: explain your rights & processes (consumer, tenancy, FIR, RTI, contracts), help you understand a notice or clause, and draft templates (legal notice, RTI, complaint, rent agreement). Important: this is information, not legal advice — get drafts vetted by an advocate, and verify current laws (they change & vary by state).",
    quickPrompts: [
      'Explain my consumer rights',
      'Help me draft a legal notice',
      'How do I file an RTI?',
      'Explain this contract clause',
    ],
  },
  finance_ai: {
    id: 'finance_ai',
    name: 'Financial Advisor',
    welcome:
      "Hi! I'm Finance AI 💹 — I explain personal finance for India: budgeting & emergency funds, how SIP/mutual funds/PPF/NPS/FD work, insurance (term + health first), paying off debt, and goal-based planning. This is financial EDUCATION, not investment advice — investments carry market risk; for personalised advice consult a SEBI-registered adviser.",
    quickPrompts: [
      'How do I start a budget & emergency fund?',
      'Explain SIP and mutual funds',
      'Term vs endowment insurance?',
      'How should I pay off my loans?',
    ],
  },
  astrologer_ai: {
    id: 'astrologer_ai',
    name: 'Astrologer',
    welcome:
      "Namaste 🙏 I'm Astro AI — for fun and cultural interest, I can share your sign's horoscope, explain kundli/rashi/nakshatra & gun-milan, and offer positive, hopeful guidance. Just for entertainment — not science, and never a substitute for real medical, money or legal advice. Your choices matter most! ✨",
    quickPrompts: [
      "Today's horoscope for my sign",
      'Explain my rashi & personality',
      'What is a kundli / birth chart?',
      'How does gun-milan work?',
    ],
  },
  govt_schemes_ai: {
    id: 'govt_schemes_ai',
    name: 'Govt Schemes Helper',
    welcome:
      "Namaste! 🏛️ I'm Yojana AI — I help you find and understand Indian government schemes (central & state): who's eligible, what benefit, which documents, and how to apply. Tell me about yourself (state, work, age, need). ⚠️ Always verify the latest details on official portals — and remember, real govt schemes never charge a fee or ask for your OTP/PIN.",
    quickPrompts: [
      'Schemes for farmers',
      'Scholarships for students',
      'Housing scheme — am I eligible?',
      'What documents do I usually need?',
    ],
  },
  kisan_ai: {
    id: 'kisan_ai',
    name: 'Kisan / Agri Advisor',
    welcome:
      "Namaste kisan bhai/behen! 🌱 I'm Kisan AI — I can help with crop choice & season, soil & fertiliser, pest/disease (IPM), irrigation, and market/MSP & scheme awareness. Tell me your crop, region and problem. ⚠️ Local conditions vary — confirm big decisions with your KVK / agri officer & a soil test, and always follow pesticide-label safety.",
    quickPrompts: [
      'Which crop should I sow this season?',
      'My crop has a pest — what to do?',
      'How to read my Soil Health Card?',
      'Water-saving irrigation tips',
    ],
  },
  nutritionist_ai: {
    id: 'nutritionist_ai',
    name: 'Nutritionist / Diet AI',
    welcome:
      "Namaste! 🥗 I'm Nutritionist AI — I can help you build a balanced Indian plate, plan sustainable eating for your goal (weight, muscle, energy), find good veg/non-veg protein, and cut sugar/salt/junk. Tell me your goal, food preferences and routine. ⚠️ This is general nutrition education — for any health condition (diabetes, thyroid, pregnancy, allergies) please consult a registered dietitian or doctor.",
    quickPrompts: [
      'Make a balanced veg meal plan',
      'Healthy ways to lose weight',
      'Best protein sources for vegetarians',
      'How do I cut down sugar & junk food?',
    ],
  },
  wellness_ai: {
    id: 'wellness_ai',
    name: 'Wellness / Counsellor AI',
    welcome:
      "Hello, I'm here for you. 🌼 I'm Wellness AI — a caring space to talk about stress, anxiety, low mood, exams, work or relationships, and to share gentle coping & self-care ideas. I'm an AI companion, not a therapist, and not a substitute for professional care. If you're ever in distress or thinking of harming yourself, please reach out now: Tele-MANAS 14416, KIRAN 1800-599-0019, or emergency 112. How are you feeling today?",
    quickPrompts: [
      "I'm feeling stressed and overwhelmed",
      'Help me calm down from anxiety',
      'How do I deal with low mood?',
      'When should I see a counsellor?',
    ],
  },
};

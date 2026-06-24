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
  fitness_ai: {
    id: 'fitness_ai',
    name: 'Fitness / Personal Trainer AI',
    welcome:
      "Let's get moving! 💪 I'm Fitness AI — your personal-trainer companion. I can build a home or gym workout plan for your goal (fat loss, muscle, stamina, general fitness), explain exercise form, and help with warm-up, recovery & staying consistent. Tell me your goal, level and equipment. ⚠️ This is general fitness guidance, not medical advice — get a doctor's clearance if you have any health condition, and stop & see a physio for pain/injury.",
    quickPrompts: [
      'Make a beginner home workout plan',
      'Workout plan to build muscle',
      'How do I lose fat safely?',
      'Fix my squat / push-up form',
    ],
  },
  vet_ai: {
    id: 'vet_ai',
    name: 'Veterinary / Pashu Advisor AI',
    welcome:
      "Namaste! 🐄🐕 I'm Pashu / Vet AI — I help with general care of livestock (cattle, buffalo, goat, poultry) and pets (dogs, cats): feeding & housing, hygiene, breeding basics, and prevention/vaccination awareness. Tell me the animal and your question. ⚠️ I'm not a vet and don't diagnose or prescribe — for any sick, injured or distressed animal, please see a licensed veterinarian. Take any bite/suspected rabies seriously and get urgent medical care.",
    quickPrompts: [
      'How to care for a dairy cow?',
      'Basic care & feeding for my dog',
      'My animal is off-feed — what should I do?',
      'Why are vaccination & deworming important?',
    ],
  },
  parenting_ai: {
    id: 'parenting_ai',
    name: 'Parenting / Child-Care AI',
    welcome:
      "Namaste! 👶 I'm Parenting AI — a supportive space for raising kids: development & milestones, routines (sleep, feeding, screen-time), positive discipline & tantrums, study stress, and connecting with teens. Tell me your child's age and what's on your mind. ⚠️ This is general parenting guidance, not medical advice — for fever, illness, vaccination or any growth/developmental worry, please see a paediatrician.",
    quickPrompts: [
      'Is my child meeting milestones?',
      'How do I handle tantrums calmly?',
      'Build a good bedtime routine',
      'Help me support my teen during exams',
    ],
  },
  cybersafety_ai: {
    id: 'cybersafety_ai',
    name: 'Cyber Safety / Digital Suraksha AI',
    welcome:
      "Namaste! 🛡️ I'm Digital Suraksha AI — I help you stay safe online: spot scams (UPI/OTP fraud, fake KYC calls, 'digital arrest', loan apps, phishing), secure your accounts, and know exactly what to do if you've been targeted. ⚠️ I will NEVER ask for your password, OTP, UPI PIN or card details — and neither will any real bank. If you've lost money, call 1930 and your bank right away. How can I help?",
    quickPrompts: [
      'Is this message/call a scam?',
      'How do I keep my UPI & bank safe?',
      "I've been scammed — what do I do now?",
      'Make my accounts more secure',
    ],
  },
  insurance_ai: {
    id: 'insurance_ai',
    name: 'Insurance Advisor AI',
    welcome:
      "Namaste! 🛡️ I'm Insurance AI — I explain insurance honestly so you can choose well: term life vs ULIP/endowment, health/mediclaim, motor, accident, home, travel & crop cover, plus how claims work and why they get rejected. I don't sell or push any policy. ⚠️ This is general education, not personalised advice — verify current terms, read the policy wording, and always disclose your details truthfully when buying.",
    quickPrompts: [
      'How much term life cover do I need?',
      'What to look for in a health policy?',
      'Why do insurance claims get rejected?',
      'Term plan vs LIC endowment — which is better?',
    ],
  },
  chef_ai: {
    id: 'chef_ai',
    name: 'Chef / Recipe AI',
    welcome:
      "Namaste! 👨‍🍳 I'm Chef AI — tell me what's in your kitchen or what you're craving and I'll give you a clear step-by-step recipe. Indian or world dishes, veg or non-veg, quick tiffin or festive feast — I can adapt it lighter, Jain (no onion-garlic), or milder/spicier. I'll also help fix a dish that went too salty/spicy/watery. What are we cooking today?",
    quickPrompts: [
      'What can I make with these ingredients?',
      'A quick 15-minute dinner idea',
      'My curry is too salty — how to fix it?',
      'Easy tiffin/lunchbox recipes',
    ],
  },
  travel_ai: {
    id: 'travel_ai',
    name: 'Travel Planner AI',
    welcome:
      "Namaste! ✈️ I'm Travel AI — tell me where you want to go (or your interests), how many days, your month and budget, and I'll plan a day-by-day itinerary with rough costs, transport and packing tips. India or abroad, family, solo or pilgrimage. ⚠️ I give planning guidance, not live bookings — always verify current fares, timings and visa/entry rules on official sources, and never share passport/card/OTP details.",
    quickPrompts: [
      'Plan a 5-day trip for me',
      'Budget breakdown for a Goa trip',
      'Best time & itinerary for Ladakh',
      'What do I need for international travel?',
    ],
  },
  vastu_ai: {
    id: 'vastu_ai',
    name: 'Vastu Consultant AI',
    welcome:
      "Namaste 🙏 I'm Vastu AI — I share traditional Vastu Shastra guidance on directions and room placement, and simple, free ways to bring light, air and calm into your home or workplace. Tell me your layout or concern. ✨ This is cultural/traditional belief, not science — no fear, no costly remedies. For real construction, safety, legal rules and a licensed architect always come first.",
    quickPrompts: [
      'Vastu tips for my home entrance',
      'Best direction for kitchen & bedroom?',
      'Vastu for a rented flat (no changes)',
      'Simple ways to make my space positive',
    ],
  },
  yoga_ai: {
    id: 'yoga_ai',
    name: 'Yoga & Meditation AI',
    welcome:
      "Namaste 🧘 I'm Yoga & Meditation AI — I can guide you with simple asanas & Surya Namaskar, gentle pranayama (Anulom Vilom, Bhramari), and meditation for calm, focus & better sleep. Tell me your level, time and goal. ⚠️ This is general practice guidance, not medical advice — check with a doctor first if you have any health condition, are pregnant or injured, and never push through pain.",
    quickPrompts: [
      'A 15-minute beginner yoga routine',
      'Breathing exercises to reduce stress',
      'Help me start a meditation habit',
      'Desk stretches for back & neck',
    ],
  },
};

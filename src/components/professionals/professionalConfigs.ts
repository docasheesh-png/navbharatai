import type { ProfessionalChatConfig } from './ProfessionalChat';

/**
 * Frontend UI configs for config-driven professionals (welcome + quick prompts).
 * Backend persona/knowledge lives in src/server/professionals/. Add a professional
 * here + activate its card in ProfessionalsView + add its ViewType render block.
 */
/**
 * Professionals that do NOT live in the map below, because they have their own component rather than
 * a ProfessionalChat config. They are still professionals to the user — they sit on the same screen —
 * so anything reasoning about "is this a professional?" has to include them.
 *
 * Today that is Doctor AI alone (`SDAChat`). Kept HERE, beside the map, so the answer to that question
 * has one address; `tabParenting.test.ts` fails if a card on the Professionals screen is in neither
 * place, which is what stops this list going stale the next time one is added.
 */
export const PROFESSIONALS_IMPLEMENTED_ELSEWHERE = ['sda_chat'] as const;

export const PROFESSIONAL_CHATS: Record<string, ProfessionalChatConfig> = {
  teacher_ai: {
    id: 'teacher_ai',
    name: 'Teacher AI',
    welcome:
      "Namaste! I'm Teacher AI 👩‍🏫 — your personal teacher. First time here? Introduce yourself — your name, what you're studying, which exam you're preparing for, and which subjects feel weak — and I'll remember you (when you're signed in) and teach you accordingly every time. Ask me any concept, doubt, quiz, or study plan — any topic, any language.",
    quickPrompts: [
      'Hi! Let me introduce myself',
      'Explain photosynthesis so I never forget it',
      'Make a 1-week study plan for class 10 maths',
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
      "Namaste \ud83d\ude4f I'm Astro AI \u2014 a jyotishi in the classical tradition, reading from the granthas "
      + '(Brihat Parashara Hora Shastra, Phaladeepika, Saravali, Samudrik Shastra). For a proper reading tell me '
      + 'your JANMA TITHI (birth date), JANMA SAMAYA (birth time, as exact as you know) and JANMA STHANA (birth '
      + 'city) \u2014 time and place are what fix your lagna, which changes about every two hours. Birth time '
      + 'unknown? That is common, we will work around it honestly. Later I can also read your hasta rekha from a '
      + 'palm photo, if you wish. \u2728 This is tradition and guidance, not science \u2014 and never a substitute '
      + 'for medical, money or legal advice. I will never predict lifespan or illness, and never ask you to pay for '
      + 'a remedy. Your own effort matters most.',
    quickPrompts: [
      'Read my kundli — here are my birth details',
      'What does my lagna say about my career?',
      'Gun-milan: are we compatible?',
      'Read my hasta rekha (palm)',
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
  english_ai: {
    id: 'english_ai',
    name: 'Spoken English / Language Tutor AI',
    welcome:
      "Hello! 🗣️ I'm your English Tutor — let's build your spoken English and confidence, step by step. We can practise conversation, fix grammar gently, improve your writing (emails, essays), prep for interviews or IELTS-style tests. Tell me your level and goal — mistakes are welcome, that's how we learn! Shall we start with a small conversation?",
    quickPrompts: [
      "Let's practise an English conversation",
      'Correct my sentences and explain why',
      'Help me write a formal email',
      'Run a mock interview with me',
    ],
  },
  resume_ai: {
    id: 'resume_ai',
    name: 'Resume & Job-Application AI',
    welcome:
      "Hi! 📄 I'm Resume AI — I'll help you build a strong, honest resume that gets noticed: better bullet points, ATS-friendly formatting, tailored cover letters and LinkedIn. Share your real experience (or paste your current resume + the job you want) and we'll make it shine. I never invent qualifications — we present YOUR truth, powerfully. Where shall we start?",
    quickPrompts: [
      'Review & improve my resume',
      'Make my resume ATS-friendly for this job',
      'Write a cover letter for this role',
      'Turn my duties into strong bullet points',
    ],
  },
  gardening_ai: {
    id: 'gardening_ai',
    name: 'Gardening / Home-Plants AI',
    welcome:
      "Namaste! 🪴 I'm Gardening AI — let's keep your plants happy! I help with watering, light, soil & repotting, balcony/terrace kitchen gardens (herbs & veggies), and fixing problems like yellow leaves or pests (organic-first). Tell me your plant, space and issue. 🌿 Tip: most plant trouble is over-watering — when unsure, check if the soil is dry first!",
    quickPrompts: [
      'Why are my plant’s leaves turning yellow?',
      'Easy plants for a low-light home',
      'Start a balcony kitchen garden',
      'How do I get rid of mealybugs/aphids?',
    ],
  },
  pharmacist_ai: {
    id: 'pharmacist_ai',
    name: 'Pharmacist / Medicine-Info AI',
    welcome:
      "Namaste! 💊 I'm Medicine-Info AI — I share general, factual information about medicines: what a medicine is for, how to use medicines safely, reading labels, generics/Jan Aushadhi, and responsible antibiotic use. ⚠️ Important: I do NOT diagnose or prescribe, and I never give doses — for what to take or any personal/medical question, please consult a doctor or registered pharmacist. In an emergency, call 112.",
    quickPrompts: [
      'What is this medicine generally used for?',
      'How do I store & use medicines safely?',
      'Generic vs brand — what’s the difference?',
      'Why is antibiotic misuse dangerous?',
    ],
  },
  business_ai: {
    id: 'business_ai',
    name: 'Small-Business / Startup Advisor AI',
    welcome:
      "Namaste! 🚀 I'm Business AI — your small-business & startup mentor. I can help you validate an idea, plan, price & manage cash, market on a budget (Google/WhatsApp/social), understand registration (Udyam/MSME, structure) and funding options. Tell me your business & stage. ⚠️ This is general guidance — for tax/GST use the CA AI, for legal use a lawyer/CS, and beware pay-to-join/MLM & fake-loan scams.",
    quickPrompts: [
      'Validate my business idea',
      'How should I price my product/service?',
      'Low-cost ways to get customers',
      'How do I register my small business?',
    ],
  },
  homerepair_ai: {
    id: 'homerepair_ai',
    name: 'Home Repair / Handyman AI',
    welcome:
      "Namaste! 🔧 I'm Home Repair AI — I guide simple, SAFE DIY fixes (dripping tap, blocked drain, running flush, tripped MCB, loose handle) and help you understand a problem before calling a technician. ⚠️ I'm not a licensed electrician/plumber/gas technician — always switch off the power/water first, and for electrical faults, gas smells or anything risky, please call a professional. Gas smell? No switches/flames — turn the regulator off, ventilate, leave & call the gas agency.",
    quickPrompts: [
      'My tap is dripping — how do I fix it?',
      'How to clear a blocked drain safely?',
      'My MCB keeps tripping — what now?',
      'Monsoon home-maintenance checklist',
    ],
  },
  realestate_ai: {
    id: 'realestate_ai',
    name: 'Real-Estate / Property Advisor AI',
    welcome:
      "Namaste! 🏠 I'm Property AI — I help you make smart, safe property decisions: buy vs rent, what to check before buying (title, RERA, approvals), home-loan basics, rent agreements, and avoiding fraud. Tell me your situation. ⚠️ This is general guidance, not legal/financial advice — always get documents vetted by a property lawyer, verify projects on your state RERA portal, and beware advance-fee & fake-listing scams.",
    quickPrompts: [
      'Should I buy or rent right now?',
      'What to check before buying a flat?',
      'How does a home loan & EMI work?',
      'What should a rent agreement include?',
    ],
  },
  driving_ai: {
    id: 'driving_ai',
    name: 'Driving / RTO & Licence AI',
    welcome:
      "Namaste! 🚗 I'm Driving & RTO AI — I explain how to get a Learner's/Driving Licence, vehicle papers (RC, insurance, PUC), road rules & safety, and checking/paying challans. Tell me what you need. ⚠️ Rules, fees & steps vary by state and change — always apply & verify on the official Parivahan/RTO portal. Avoid touts/bribes, drive safely (helmet/seatbelt, never drink-drive), and beware fake-RTO & OTP scams.",
    quickPrompts: [
      'How do I get a driving licence?',
      'Which documents must I carry while driving?',
      'Explain important road rules & signs',
      'How do I check & pay an e-challan?',
    ],
  },
  petcare_ai: {
    id: 'petcare_ai',
    name: 'Pet-Care / Dog-Training AI',
    welcome:
      "Namaste! 🐶🐱 I'm Pet-Care AI — your positive-training & care companion. I help with training (sit, potty, leash), behaviour (barking, chewing, anxiety), exercise & enrichment, grooming, and general feeding. Tell me about your pet. ⚠️ I'm not a vet — for illness, injury, vaccines or any health concern, please see a vet. I only use kind, reward-based methods — never punishment.",
    quickPrompts: [
      'How do I potty-train my puppy?',
      'My dog barks/chews too much — help',
      'Teach basic commands with rewards',
      'What foods are unsafe for my pet?',
    ],
  },
  beauty_ai: {
    id: 'beauty_ai',
    name: 'Beauty / Skincare & Grooming AI',
    welcome:
      "Namaste! ✨ I'm Beauty & Skincare AI — I help you build a simple, affordable routine for skin, hair & grooming: cleanse, moisturise, daily sunscreen, dealing with oiliness/dryness/dandruff, shaving & beard care, and reading ingredients. Tell me your skin/hair type & concern. ⚠️ General cosmetic guidance only — for acne, rashes, pigmentation or hair loss, see a dermatologist. Always patch-test; healthy skin over 'fair', no risky hacks.",
    quickPrompts: [
      'Build a simple skincare routine for me',
      'How do I deal with oily skin / acne?',
      'Help with dandruff & hair care',
      'Shaving & beard-care tips',
    ],
  },
  music_ai: {
    id: 'music_ai',
    name: 'Music / Instrument Learning AI',
    welcome:
      "Namaste! 🎵 I'm Music AI — let's learn music together! I can help you start an instrument (guitar, keyboard, harmonium, tabla, flute…), sing/riyaaz, understand theory (notes, chords, sargam, taal), and build a practice routine. Tell me your instrument/goal & level. 🎶 Real skill comes from regular practice — and for serious classical, a guru/teacher is best. Don't strain your voice or play through pain.",
    quickPrompts: [
      'I want to start learning guitar',
      'Teach me singing basics & riyaaz',
      'Explain chords / sargam simply',
      'Make me a daily practice routine',
    ],
  },
  sports_ai: {
    id: 'sports_ai',
    name: 'Sports & Cricket Coaching AI',
    welcome:
      "Namaste! 🏏 I'm Sports Coach AI — strong on cricket (batting, bowling, fielding, strategy) and ready to help with football, badminton, kabaddi, athletics & more: technique, drills (even solo/at-home), sport fitness & mindset. Tell me your sport, level & goal. ⚠️ Coaching guidance only — always warm up & wear protective gear, never play through sharp pain (see a physio), and a coach/academy helps for serious growth.",
    quickPrompts: [
      'Improve my cricket batting technique',
      'Bowling drills for line & length',
      'Solo practice drills at home',
      'Sport fitness & agility plan',
    ],
  },
  photography_ai: {
    id: 'photography_ai',
    name: 'Photography & Videography AI',
    welcome:
      "Namaste! 📸 I'm Photography & Video AI — phone or camera, hobby or going pro, I'll help you shoot better: exposure (aperture/shutter/ISO), composition & light, portraits/travel/product, reels & video, and editing. Tell me your gear & goal. 🎥 Great shots come from seeing light & practice, not just expensive gear — and always respect privacy/consent, no-photo rules & your own safety while shooting.",
    quickPrompts: [
      'Explain aperture, shutter & ISO simply',
      'Composition tips for better photos',
      'Smartphone photography & reels tips',
      'How do I start as a paid photographer?',
    ],
  },
  speaking_ai: {
    id: 'speaking_ai',
    name: 'Public Speaking & Communication AI',
    welcome:
      "Namaste! 🎤 I'm Public Speaking & Communication AI — let's build your confidence to speak clearly in any language. I help with stage fright, structuring speeches/presentations, voice & body language, speaking up in meetings/GDs, and interview/pitch delivery. Tell me your situation. 💬 Nervousness is normal — confidence comes from preparation & practice, and I'll give kind, specific feedback (your authentic voice stays yours).",
    quickPrompts: [
      'Help me overcome stage fright',
      'Structure a 5-minute speech',
      'Improve my voice & body language',
      'Speak up confidently in meetings/GDs',
    ],
  },
  events_ai: {
    id: 'events_ai',
    name: 'Event & Wedding Planner AI',
    welcome:
      "Namaste! 🎉 I'm Event & Wedding Planner AI — let's plan your function stress-free! Weddings, engagements, birthdays, poojas or parties: timelines & checklists, budgets, vendors (venue, caterer, decor, photo), guests & day-of coordination. Tell me the event, date, rough size & budget. 💍 I keep it respectful of YOUR customs (I'll ask, not assume) — and always get vendor terms in writing & verify vendors to avoid scams.",
    quickPrompts: [
      'Plan a timeline for my wedding',
      'Help me budget for my event',
      'What to ask caterers & decorators?',
      'A day-of schedule & checklist',
    ],
  },
  eldercare_ai: {
    id: 'eldercare_ai',
    name: 'Elder-Care / Senior Support AI',
    welcome:
      "Namaste 🙏 I'm Elder-Care AI — here to support families caring for elderly loved ones, and seniors themselves: daily routine & nutrition, home safety & fall prevention, emotional wellbeing & loneliness, staying organised with medicines, and caregiver support. Tell me your situation. ⚠️ I give care & wellbeing guidance, NOT medical advice — for illness, a fall, confusion or any emergency, get medical help immediately / call 112. Always with dignity & respect.",
    quickPrompts: [
      'Make the home safer to prevent falls',
      'A gentle daily routine for my parent',
      'Help with loneliness & low mood',
      'Tips to avoid caregiver burnout',
    ],
  },
  interior_ai: {
    id: 'interior_ai',
    name: 'Interior Design & Home-Decor AI',
    welcome:
      "Namaste! 🛋️ I'm Interior & Decor AI — let's make your home beautiful & functional on any budget! Space planning, colour & lighting, affordable decor & DIY, storage & decluttering, and room-by-room ideas (rented or owned). Tell me your room, style & budget. ⚠️ I give decor & design ideas, not structural/electrical advice — for walls, false ceilings or wiring, hire a qualified pro; in rentals, keep changes reversible.",
    quickPrompts: [
      'Make my small room feel bigger',
      'Suggest a colour palette for my room',
      'Budget decor ideas for my living room',
      'Smart storage & decluttering tips',
    ],
  },
  studyabroad_ai: {
    id: 'studyabroad_ai',
    name: 'Study-Abroad & Education Consultant AI',
    welcome:
      "Namaste! 🎓 I'm Study-Abroad & Education AI — honest guidance for higher studies abroad or in India: choosing course/country/university, exams (IELTS/GRE/GMAT…), applications & SOPs (your real story), scholarships & loans, and the student-visa process. Tell me your goal, field & budget. ⚠️ General guidance only — always verify deadlines/fees/visa rules on official sites, never fake an SOP, and beware 'guaranteed admission/visa' agent scams.",
    quickPrompts: [
      'Help me choose a course & country',
      'Which exams do I need & how to prep?',
      'Guide me on my SOP / application',
      'Scholarships & education-loan basics',
    ],
  },
  disability_ai: {
    id: 'disability_ai',
    name: 'Disability & Accessibility Support AI',
    welcome:
      "Namaste 🙏 I'm Disability & Accessibility Support AI — here with respect and information for persons with disabilities and their families: rights (RPwD Act), schemes & benefits (UDID, ADIP, pensions, scholarships), assistive technology & accessibility, daily living & inclusion, and caregiver support. Tell me what you need. ⚠️ General info & support, not medical/legal/official advice — verify schemes/rights on official sources, and beware bribe/OTP scams around certificates & benefits.",
    quickPrompts: [
      'My rights under the RPwD Act',
      'Schemes & benefits I may be eligible for',
      'Assistive technology for my needs',
      'Accommodations at school/work',
    ],
  },
  fashion_ai: {
    id: 'fashion_ai',
    name: 'Fashion & Personal Styling AI',
    welcome:
      "Namaste! 👗 I'm Fashion & Styling AI — let's help you dress well & feel confident, on any budget! Outfit ideas for any occasion (office, wedding, casual, festive), building a versatile wardrobe, fit & colours, ethnic wear & draping, and accessories. Tell me the occasion, your style & budget. ✨ I'm body-positive & inclusive — style is to express YOU, not to judge. Taste is personal, so I'll give options, not rules.",
    quickPrompts: [
      'What should I wear for this occasion?',
      'Help me build a versatile wardrobe',
      'Outfit ideas for my body type',
      'Style my ethnic wear & accessories',
    ],
  },
  productivity_ai: {
    id: 'productivity_ai',
    name: 'Productivity & Time-Management AI',
    welcome:
      "Namaste! ✅ I'm Productivity & Time-Management AI — let's get more done with less stress! I help with planning & prioritising, focus & beating distractions (Pomodoro, time-blocking), overcoming procrastination, building habits & routines, and study/work schedules. Tell me your goal or what's stuck. 🌱 No magic hacks — small consistent steps win, missed plans are normal, and productivity should reduce stress, not cause burnout.",
    quickPrompts: [
      'Plan my day & priorities',
      'Help me stop procrastinating',
      'Improve my focus & beat distractions',
      'Build a study/work routine',
    ],
  },
  relationship_ai: {
    id: 'relationship_ai',
    name: 'Relationship & Communication AI',
    welcome:
      "Namaste 🙏 I'm Relationship & Communication AI — a warm, non-judgemental space to think through relationships: partner/marriage, family & in-laws, friends or workplace. I help with communicating better, resolving conflict, boundaries, trust and understanding. ⚠️ I offer general support & perspective (and only hear one side) — NOT therapy or legal advice. For ongoing distress see a counsellor (Wellness AI), for legal use the Lawyer AI. If there's any abuse or danger, your safety comes first — India: 181 / 112 / Tele-MANAS 14416.",
    quickPrompts: [
      'Help me communicate better with my partner',
      'How do I handle family/in-law pressure?',
      'We keep having the same fight — what to do?',
      'How do I set healthy boundaries?',
    ],
  },
  vehicle_ai: {
    id: 'vehicle_ai',
    name: 'Vehicle & Auto-Maintenance AI',
    welcome:
      "Namaste! 🔧🚗 I'm Vehicle & Auto-Maintenance AI — for your car or bike: service schedules, simple safe checks (tyre pressure, oil, coolant, lights), understanding warning lights & noises, mileage tips, and what to ask at the service centre. Tell me your vehicle & issue. ⚠️ General guidance only — safety-critical work (brakes, steering, engine, electrical, EV high-voltage) needs a qualified mechanic; follow your owner's manual, and if anything feels unsafe, stop & get help.",
    quickPrompts: [
      'What maintenance does my vehicle need?',
      'Safe checks I can do myself',
      'What might this warning light/noise mean?',
      'How can I improve my mileage?',
    ],
  },
  stocks_ai: {
    id: 'stocks_ai',
    name: 'Stock-Market & Investing Education AI',
    welcome:
      "Namaste! 📈 I'm Stock-Market & Investing Education AI — I explain how the market works: shares, Sensex/Nifty, demat accounts, mutual funds/SIP/ETFs, risk vs return, diversification & compounding. Ask me to explain any concept. ⚠️ EDUCATION ONLY — I never give stock tips, buy/sell calls, or predict returns. Investing carries risk (you can lose money); for personal advice consult a SEBI-registered adviser, and beware 'guaranteed return' & tip-group scams.",
    quickPrompts: [
      'How does the stock market work?',
      'Stocks vs mutual funds vs SIP?',
      'Explain risk, diversification & compounding',
      'How do I avoid investment scams?',
    ],
  },
  techhelp_ai: {
    id: 'techhelp_ai',
    name: 'Gadget & Tech-Help AI',
    welcome:
      "Namaste! 📱💻 I'm Gadget & Tech-Help AI — patient help in simple language for phones, laptops, apps & Wi-Fi: fix a slow/hanging device, storage full, battery drain, app crashes, internet issues, accounts & backups, and choosing/caring for gadgets. Tell me your device & problem. ⚠️ I'll never ask for passwords/OTPs or to install remote apps (neither will real support) — beware tech-support scams. For hardware/water damage or warranty, see an authorised service centre.",
    quickPrompts: [
      'My phone is slow / hanging — fix it',
      'Free up storage on my device',
      'Wi-Fi / internet not working',
      'Help me back up my phone',
    ],
  },
  mathscience_ai: {
    id: 'mathscience_ai',
    name: 'Maths & Science Problem-Solver AI',
    welcome:
      "Namaste! 🧮🔬 I'm Maths & Science Problem-Solver AI — paste a problem and I'll solve it STEP BY STEP and explain the method, so you actually understand it. Maths (algebra, geometry, trig, calculus, stats) and science (physics, chemistry, biology) — school to NEET/JEE level. ✏️ I'll often give a hint first so you can try — the goal is YOUR learning (please don't use me to cheat). I aim to be accurate, but check important answers with your textbook/teacher.",
    quickPrompts: [
      'Solve this maths problem step by step',
      'Explain this concept with an example',
      'Help me with a physics numerical',
      'Give me practice problems & check my work',
    ],
  },
  coding_ai: {
    id: 'coding_ai',
    name: 'Coding & Programming Tutor AI',
    welcome:
      "Namaste! 💻 I'm Coding & Programming Tutor AI — I'll teach you to CODE and understand CS, from zero to intermediate: pick a first language (Python/JavaScript), core concepts, debugging, data structures & algorithms (placements), and project ideas. Tell me your goal & level. ✏️ I teach for understanding (hints first — please don't just copy for graded work). I aim to be accurate but test code & check the docs. To BUILD a full app, use the Engineer AI.",
    quickPrompts: [
      'How do I start learning to code?',
      'Explain this code / concept simply',
      'Help me debug my code',
      'A roadmap for DSA / placements',
    ],
  },
  maternity_ai: {
    id: 'maternity_ai',
    name: 'Pregnancy & New-Mother Care AI',
    welcome:
      "Namaste 🙏 I'm Pregnancy & New-Mother Care AI — a warm, reassuring companion for expecting & new mothers: general guidance on pregnancy wellbeing & antenatal care, recognising warning signs, newborn care, feeding & breastfeeding support, and your recovery & emotional wellbeing. ⚠️ I'm NOT a doctor and never diagnose or prescribe — always attend your check-ups and follow your gynaecologist/paediatrician. For ANY warning sign (heavy bleeding, severe pain, high fever, reduced baby movements, a baby not feeding) get medical help immediately / call 112.",
    quickPrompts: [
      'What does antenatal care involve?',
      'Pregnancy warning signs to watch for',
      'Newborn care basics',
      'Breastfeeding & my recovery support',
    ],
  },
  firstaid_ai: {
    id: 'firstaid_ai',
    name: 'First-Aid & Emergency-Response AI',
    welcome:
      "Namaste! ⛑️ I'm First-Aid & Emergency-Response AI — calm, clear general first-aid for everyday emergencies (bleeding, burns, choking, fainting, heatstroke, fractures) and recognising what's serious. ⚠️ In ANY serious situation, CALL 112 (or 108 ambulance) and get to a hospital NOW — first-aid helps WHILE help is coming, it doesn't replace it. I'm not a doctor and can't see you; please also take a certified first-aid/CPR course. What's the situation?",
    quickPrompts: [
      'What to do for severe bleeding?',
      'Someone is choking — what do I do?',
      'First aid for a burn',
      'What should be in a first-aid kit?',
    ],
  },
  environment_ai: {
    id: 'environment_ai',
    name: 'Environment & Sustainability AI',
    welcome:
      "Namaste! 🌍 I'm Environment & Sustainability AI — practical, no-guilt ways to live greener and understand environmental issues: reduce waste & plastic, save water & electricity (and money!), home composting & segregation, eco-friendly choices, and understanding climate/pollution honestly. Tell me your goal or question. 🌱 Small consistent steps matter — and so do systemic changes; I keep it realistic, affordable & science-based.",
    quickPrompts: [
      'Easy ways to reduce my plastic & waste',
      'Save electricity & water at home',
      'How do I start home composting?',
      'Explain climate change simply',
    ],
  },
  gk_ai: {
    id: 'gk_ai',
    name: 'General Knowledge & Current-Affairs AI',
    welcome:
      "Namaste! 💡 I'm GK & Current-Affairs AI — your study companion for competitive exams (UPSC, SSC, banking, railways, state PSC) & quizzes: static GK (history, geography, polity, economy, science, culture) explained with context, current-affairs concepts, study strategy, and MCQ practice. Tell me a topic or 'quiz me'. ⚠️ I'm a study aid, not an official source — I may not know the very latest news/dates, so verify current facts from reliable up-to-date sources.",
    quickPrompts: [
      'Explain a static GK topic with context',
      'Quiz me with MCQs on a subject',
      'How to study GK & current affairs?',
      'Background of a current-affairs topic',
    ],
  },
  safety_ai: {
    id: 'safety_ai',
    name: 'Personal Safety & Self-Defense AI',
    welcome:
      "Namaste! 🛡️ I'm Personal Safety & Self-Defense AI — calm, empowering help to stay safe & prepared: situational awareness, safe travel, phone SOS & emergency contacts, women's & children's safety, and getting help fast. ⚠️ In ANY danger, call 112 / 100 / Women Helpline 181 and get to safety NOW — awareness helps you avoid danger & reach help, not to fight (escape first). I'm not police or a self-defense instructor; for real skills, join a certified class. Harassment is NEVER your fault.",
    quickPrompts: [
      'Important safety helplines & SOS setup',
      'Travel & cab safety tips',
      "Women's safety: what should I know?",
      'Teach kids about safe & unsafe touch',
    ],
  },
  translate_ai: {
    id: 'translate_ai',
    name: 'Language & Translation Helper AI',
    welcome:
      "Namaste! 🌐 I'm Language & Translation Helper AI — I translate and explain text across Indian languages (Hindi, Tamil, Bengali, Marathi, Telugu & more) and English/foreign languages: translate messages, explain meaning & idioms, write in another language, and handy travel phrases. Paste your text & tell me the languages. ⚠️ Translation isn't always exact and AI can err — for official/legal/medical documents, please use a certified human translator.",
    quickPrompts: [
      'Translate this text for me',
      'What does this phrase/idiom mean?',
      'Help me write a message in another language',
      'Useful travel phrases in a language',
    ],
  },
  civic_ai: {
    id: 'civic_ai',
    name: 'Civic / RTI & Grievance Helper AI',
    welcome:
      "Namaste! 🏛️ I'm Civic / RTI & Grievance Helper AI — I help you use your civic rights & public systems: file an RTI, lodge a public grievance (CPGRAMS), consumer complaints (1915 / e-Daakhil), and citizen services/documents (Aadhaar, PAN, certificates). I can DRAFT clear applications & complaints for you. ⚠️ General info & drafting help, not legal advice — verify procedures/fees on official .gov.in portals, use the legit process (no bribes/touts) & beware fake-govt-site scams.",
    quickPrompts: [
      'Help me file an RTI application',
      'Lodge a grievance against a department',
      'File a consumer complaint',
      'How do I apply for a certificate/document?',
    ],
  },
  sarkari_ai: {
    id: 'sarkari_ai',
    name: 'Sarkari / Govt-Job Exam Guide AI',
    welcome:
      "Namaste! 🎖️ I'm Sarkari / Govt-Job Exam Guide AI — guidance for government-job aspirants: which exam leads to which job (UPSC, SSC, banking/IBPS, railways/RRB, defence, teaching, state PSC), general eligibility & selection process, and exam-wise prep strategy & motivation. Tell me your qualification & goal. ⚠️ General guidance, not official notifications — always verify vacancies/dates/eligibility on the official site. NEVER pay anyone for a govt job — that's a scam.",
    quickPrompts: [
      'Which govt exam suits my qualification?',
      'Explain an exam’s eligibility & process',
      'Make a preparation strategy for me',
      'How to stay consistent & handle attempts?',
    ],
  },
  spiritual_ai: {
    id: 'spiritual_ai',
    name: 'Spiritual & Philosophy Companion AI',
    welcome:
      "Namaste 🪔 I'm Spiritual & Philosophy Companion AI — a calm, respectful space to reflect on life, meaning, values & inner peace, drawing gently on the wisdom of India's and the world's traditions. Mindfulness, gratitude, everyday ethics, and perspective in hard times. 🙏 I respect ALL beliefs equally and never push any — I'm not a religious authority (consult your own scriptures/guru for doctrine), and not therapy. For deep distress, please reach out for support (Wellness AI; Tele-MANAS 14416).",
    quickPrompts: [
      'Help me find some calm & perspective',
      'Explain a teaching from a wisdom tradition',
      'A simple gratitude / mindfulness practice',
      'Thinking through what’s the right thing to do',
    ],
  },
  crafts_ai: {
    id: 'crafts_ai',
    name: 'DIY Crafts & Hobbies AI',
    welcome:
      "Namaste! 🎨 I'm DIY Crafts & Hobbies AI — let's make something fun! Step-by-step craft projects (paper, painting, knitting, jewellery, clay), festive DIY (rangoli, diyas, cards), budget upcycling, kids' crafts & school projects, and starting creative hobbies — all with affordable materials. Tell me your idea, materials or occasion. ✂️ Craft safely (mind sharp tools, hot glue, chemicals & supervise kids) — and remember, there's no 'wrong' art!",
    quickPrompts: [
      'Give me a fun beginner craft project',
      'Festive DIY decoration ideas',
      'Upcycle something I have at home',
      'Easy & safe craft for kids',
    ],
  },
  festival_ai: {
    id: 'festival_ai',
    name: 'Festival & Culture Guide AI',
    welcome:
      "Namaste! 🎉 I'm Festival & Culture Guide AI — a warm, inclusive guide to India's many festivals & traditions: the meaning & stories behind festivals (Diwali, Holi, Eid, Christmas, Pongal, Onam & more), how they're commonly celebrated, planning ideas, and wishing/participating respectfully. I celebrate ALL communities equally and never favour or rank any. 🙏 I share general info, not religious rulings — for exact rites follow your family/community; festival dates vary yearly, so verify locally. Celebrate safely!",
    quickPrompts: [
      'Tell me about a festival’s meaning & story',
      'Ideas to celebrate this festival',
      'How do I wish someone respectfully?',
      'Safe & eco-friendly celebration tips',
    ],
  },
  writing_ai: {
    id: 'writing_ai',
    name: 'Creative Writing & Storytelling AI',
    welcome:
      "Namaste! ✍️ I'm Creative Writing & Storytelling AI — your imaginative writing partner for stories, poems, shayari, scripts, blogs & social content. I help you brainstorm ideas, beat writer's block, craft plot/characters/dialogue, write poetry, and polish your draft — keeping your voice & vision. 📝 I co-create & coach (the work stays YOURS), make original work (respecting copyright), and won't write graded assignments to submit as your own. What shall we write?",
    quickPrompts: [
      'Give me story ideas / a writing prompt',
      'Help me develop my plot & characters',
      'Write/improve a poem or shayari',
      'Polish my draft & give feedback',
    ],
  },
  aptitude_ai: {
    id: 'aptitude_ai',
    name: 'Mental Maths & Aptitude AI',
    welcome:
      "Namaste! 🧠 I'm Mental Maths & Aptitude AI — let's get fast & sharp! Mental-maths & Vedic tricks (with the WHY behind them), quantitative aptitude (percentages, ratio, time-speed-distance, interest…), logical & verbal reasoning (series, puzzles, syllogisms), and speed/accuracy strategy for exams & placements. Tell me a topic or 'quiz me'. ✏️ I teach so you build real skill — attempt steps yourself; I keep the maths accurate and note when a trick only applies in certain cases.",
    quickPrompts: [
      'Teach me a fast multiplication trick',
      'Quant: explain & practise a topic',
      'Reasoning puzzle practice',
      'Speed & accuracy strategy for my exam',
    ],
  },
  disaster_ai: {
    id: 'disaster_ai',
    name: 'Disaster Preparedness & Weather-Safety AI',
    welcome:
      "Namaste! ⚠️ I'm Disaster Preparedness & Weather-Safety AI — practical help to prepare for and stay safe in floods, cyclones, earthquakes, heatwaves, fire & more: family plans, emergency kits, and what to do before/during/after each hazard. ⚠️ In any active emergency, call 112 (or 108/101) and FOLLOW official IMD/NDMA & local warnings and evacuation orders immediately — I'm not a live forecast/alert service and can't predict your area. Let's get you prepared & safe.",
    quickPrompts: [
      'Build a family emergency plan & kit',
      'What to do during a flood / heavy rain',
      'Earthquake safety: Drop, Cover, Hold',
      'Heatwave safety & heatstroke signs',
    ],
  },
  nature_ai: {
    id: 'nature_ai',
    name: 'Nature & Wildlife Guide AI',
    welcome:
      "Namaste! 🦜🌿 I'm Nature & Wildlife Guide AI — let's explore the natural world! I help identify birds, animals, insects, trees & plants (from your description), share fascinating accurate facts, get you started with birdwatching, and encourage conservation. 🌱 ID from a description is a best guess (verify with field guides/apps like Merlin). Always keep a respectful distance — never handle wild animals; for a snake/injured wildlife, call the Forest Dept / a licensed rescue. Respect wildlife laws.",
    quickPrompts: [
      'Help me identify a bird I saw',
      'Fascinating facts about an animal',
      'How do I start birdwatching?',
      'There’s a snake near my home — what to do?',
    ],
  },
  freelance_ai: {
    id: 'freelance_ai',
    name: 'Freelancing & Online-Income AI',
    welcome:
      "Namaste! 💻 I'm Freelancing & Online-Income AI — practical, realistic help to earn through legitimate freelancing & gig work: choosing a skill/path, building a portfolio & profiles, finding clients, pricing, getting paid safely, and growing. Tell me your skills & goal. ⚠️ Freelance income is irregular & takes time — no get-rich-quick. CRITICAL: never PAY to get a 'job'/task or join 'guaranteed income' schemes — those are scams (real work means YOU get paid). Tax → CA AI.",
    quickPrompts: [
      'Which freelancing path suits my skills?',
      'Help me build a portfolio & profile',
      'Write a winning client proposal',
      'How should I price my freelance work?',
    ],
  },
  babynames_ai: {
    id: 'babynames_ai',
    name: 'Baby-Names & Naming Helper AI',
    welcome:
      "Namaste! 👶✨ I'm Baby-Names & Naming Helper AI — congratulations! Let's find a beautiful name: suggestions by gender, starting letter, meaning/theme or your language & community (all faiths & regions welcome), plus meanings, origins & shortlisting help. Tell me what you're looking for. 🌸 Meanings can vary by source — verify one that matters to you. The choice is entirely your family's; no lucky/unlucky claims here.",
    quickPrompts: [
      'Suggest names with a meaning I like',
      'Names starting with a letter/sound',
      'What does this name mean & where’s it from?',
      'Help me shortlist between some names',
    ],
  },
  hygiene_ai: {
    id: 'hygiene_ai',
    name: 'Hygiene & Public-Health Awareness AI',
    welcome:
      "Namaste! 🧼 I'm Hygiene & Public-Health Awareness AI — simple, proven habits to keep you & your family healthy: handwashing & personal hygiene, safe drinking water & food hygiene, sanitation & clean surroundings, mosquito/disease prevention, and stigma-free menstrual hygiene. Ask me anything. ⚠️ This is prevention & awareness, NOT medical advice — for symptoms, illness or dehydration, see a doctor (emergencies → 112/108).",
    quickPrompts: [
      'Proper handwashing & personal hygiene',
      'How to make drinking water safe?',
      'Prevent mosquito-borne diseases at home',
      'Menstrual hygiene — safe practices',
    ],
  },
  volunteer_ai: {
    id: 'volunteer_ai',
    name: 'Volunteering & Social-Impact AI',
    welcome:
      "Namaste! 🤝 I'm Volunteering & Social-Impact AI — let's help you give back meaningfully! Find a cause & way to help (time, skills, money, awareness), volunteer with genuine NGOs, donate safely, or start a small community initiative. Tell me what you care about & what you can give. ⚠️ Always verify a charity before donating & give only through official channels (beware fake-charity scams); for 80G/tax, the CA AI. Help with respect & dignity.",
    quickPrompts: [
      'Find a cause & way I can help',
      'How do I volunteer with a genuine NGO?',
      'How to donate safely & avoid scams',
      'Help me start a community initiative',
    ],
  },
  astronomy_ai: {
    id: 'astronomy_ai',
    name: 'Astronomy & Space AI',
    welcome:
      "Namaste! 🔭🚀 I'm Astronomy & Space AI — let's explore the universe! Stargazing tips (constellations, planets, the Moon, meteor showers), astronomy concepts (stars, galaxies, black holes, eclipses), space missions (ISRO's Chandrayaan/Mangalyaan/Gaganyaan, NASA & more), and telescopes/astrophotography. This is SCIENCE (not astrology!). ⚠️ NEVER look at the Sun directly or through optics without certified solar filters. Verify live sky timings with a sky app. What would you like to explore?",
    quickPrompts: [
      'How do I start stargazing?',
      'Explain black holes / galaxies simply',
      'Tell me about ISRO’s space missions',
      'Which telescope should a beginner get?',
    ],
  },
  calligraphy_ai: {
    id: 'calligraphy_ai',
    name: 'Calligraphy & Hand-Lettering AI',
    welcome:
      "Namaste! ✒️ I'm Calligraphy & Hand-Lettering AI — let's make your writing beautiful! Neater everyday handwriting (English & Devanagari), calligraphy styles & strokes (modern brush, italic & more), affordable tools, and lettering for cards/quotes/journaling — plus practice drills. Tell me what you'd like to improve or create. ✨ Mastery comes from short, regular practice (no instant fixes) — I'll give targeted exercises since I can't see your writing.",
    quickPrompts: [
      'Help me make my handwriting neater',
      'Teach me a calligraphy style & strokes',
      'What beginner tools do I need?',
      'Lettering ideas for a card/quote',
    ],
  },
  dance_ai: {
    id: 'dance_ai',
    name: 'Dance & Movement AI',
    welcome:
      "Namaste! 💃🕺 I'm Dance & Movement AI — let's dance! Start at any age/level, find your rhythm, explore styles (classical like Bharatanatyam/Kathak, folk like Garba/Bhangra, Bollywood & freestyle), practise routines, or dance for fitness & joy. Tell me your goal & level. ⚠️ Always warm up & never push through sharp pain (rest/see a physio); text can't fix your form like a teacher — for serious classical, learn from a guru. Progress comes with practice!",
    quickPrompts: [
      'How do I start dancing & find rhythm?',
      'Tell me about a dance style',
      'Plan practice for a routine/performance',
      'Fun dance workout for fitness',
    ],
  },
  games_ai: {
    id: 'games_ai',
    name: 'Games, Puzzles & Family-Fun AI',
    welcome:
      "Namaste! 🎲🧩 I'm Games, Puzzles & Family-Fun AI — let's play! I explain game rules (chess, carrom, ludo, rummy, tambola, antakshari & more), suggest games for any group/occasion (even no-equipment ones), give riddles & brain-teasers, and plan family/party fun. Tell me your group, time & vibe. 😊 Keeping it family-friendly & good-natured — and stakes-free: no betting or real-money gambling here. Let's have fun!",
    quickPrompts: [
      'Explain the rules of a game',
      'Suggest games for my group/occasion',
      'Give me riddles & brain-teasers',
      'Plan fun activities for a get-together',
    ],
  },
  techbuy_ai: {
    id: 'techbuy_ai',
    name: 'Tech Buying Advisor AI',
    welcome:
      "Namaste! 🛒 I'm Tech Buying Advisor AI — independent, commission-free help to choose electronics & appliances: phones, laptops, TVs, fridge/washing-machine/AC, audio & more. I match a device to YOUR needs & budget, explain which specs actually matter (vs hype), and help you compare & buy safely. Tell me what you want & your budget. ⚠️ Prices & models change fast — I won't quote exact prices or 'the latest model'; verify current specs/prices/reviews before buying. Beware fake deals!",
    quickPrompts: [
      'Which phone/laptop for my needs & budget?',
      'Explain which specs actually matter',
      'Compare these options for me',
      'How do I buy safely & avoid fakes?',
    ],
  },
  adventure_ai: {
    id: 'adventure_ai',
    name: 'Trekking & Adventure-Travel AI',
    welcome:
      "Namaste! 🏔️ I'm Trekking & Adventure-Travel AI — let's plan your outdoor adventure safely! Treks/hikes (by fitness & season), packing & gear, road trips & camping, altitude & weather safety, and adventure activities. Tell me your experience, region & time. ⚠️ Safety before ambition: go with experienced groups/registered guides (never trek alone/off-route), verify weather/permits with official & local sources, use only licensed operators for adventure sports, and know altitude-sickness signs.",
    quickPrompts: [
      'Suggest a trek for my fitness & season',
      'Make a trek/camping packing list',
      'Plan a safe road trip',
      'Altitude sickness & outdoor safety tips',
    ],
  },
  budget_ai: {
    id: 'budget_ai',
    name: 'Home-Budget & Frugal-Living AI',
    welcome:
      "Namaste! 🐷 I'm Home-Budget & Frugal-Living AI — practical, judgement-free help to manage everyday money: make a simple monthly budget, track spends, cut bills & grocery costs, build a saving habit & emergency fund, and live well on a budget. Tell me your rough income & main expenses. ⚠️ This is everyday money-management, not investment/tax advice (Finance AI for investing, CA AI for tax) — and beware 'save/earn fast' schemes. Frugality should reduce stress, not cause misery!",
    quickPrompts: [
      'Help me make a monthly budget',
      'Practical ways to cut my expenses',
      'How do I build a saving habit & emergency fund?',
      'Budgeting tips for an irregular income',
    ],
  },
  repo_analyst: {
    id: 'repo_analyst',
    name: 'GitHub Repo Analyst & Improver',
    endpoint: '/api/repo-analyst/chat',
    welcome:
      "Namaste! 🔍 I'm GitHub Repo Analyst & Improver — paste a PUBLIC GitHub repo URL (or owner/repo) and I'll fetch it for real and analyse it: what it is, tech stack, strengths, gaps, security/quality flags, its license, and a prioritised improvement plan with code snippets you can adopt. 📌 I analyse public repos read-only — I can't push changes to repos you don't own, and I help you LEARN good patterns license-respecting (no code-laundering). Which repo shall we look at?",
    quickPrompts: [
      'Analyse https://github.com/owner/repo',
      'What are this repo’s strengths & gaps?',
      'Security & quality issues you can see?',
      'Give me a prioritised improvement plan',
    ],
  },
};

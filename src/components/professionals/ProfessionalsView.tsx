import { Stethoscope, HardHat, Scale, GraduationCap, Building2, Calculator, Compass, BookOpen, TrendingUp, Sparkles, Leaf, Apple, HeartHandshake, Activity, PawPrint, Baby, ShieldCheck, Umbrella, ChefHat, Map, LayoutGrid, Flower2, Languages, FileText, Sprout, Pill, Briefcase, Hammer, Home, Car, Dog, Gem, Music, Trophy, Camera, Megaphone, PartyPopper, Accessibility, Sofa, Globe2, HandHelping, Shirt, ListChecks, Users, Wrench, CandlestickChart, Smartphone, Sigma, Code2 } from 'lucide-react';

interface ProfessionalCard {
  id: string;
  label: string;
  description: string;
  icon: typeof Stethoscope;
  active: boolean;
}

const CARDS: ProfessionalCard[] = [
  { id: 'sda_chat', label: 'Doctor AI', description: 'Senior Doctor Assistant — clinical Q&A, case notes, red-flag detection.', icon: Stethoscope, active: true },
  { id: 'engineer_ai', label: 'Engineer AI', description: 'Autonomous coding agent — writes, builds and fixes code.', icon: HardHat, active: true },
  { id: 'lawyer_ai', label: 'Lawyer / Legal', description: 'Explains Indian law & rights, understands notices/clauses, drafts legal notice/RTI/complaints (vet with an advocate).', icon: Scale, active: true },
  { id: 'teacher_ai', label: 'Teacher AI', description: 'Explains concepts, solves doubts step by step, lesson plans, quizzes & exam study plans.', icon: GraduationCap, active: true },
  { id: 'mentor_ai', label: 'Mentor / Career Coach', description: 'Career direction, resume & interview prep, skill roadmaps, job-switch & higher-studies guidance.', icon: Compass, active: true },
  { id: 'thesis_ai', label: 'Thesis / Research Writer', description: 'Research question, thesis structure, literature review, methodology, citations & draft editing.', icon: BookOpen, active: true },
  { id: 'finance_ai', label: 'Financial Advisor', description: 'Budgeting, SIP/mutual funds, insurance, debt & goal planning — financial education (not investment advice).', icon: TrendingUp, active: true },
  { id: 'astrologer_ai', label: 'Astrologer', description: 'Horoscope, kundli/rashi/nakshatra & gun-milan — for cultural interest & entertainment (not science).', icon: Sparkles, active: true },
  { id: 'govt_schemes_ai', label: 'Govt Schemes Helper', description: 'Find & understand central/state schemes — eligibility, benefits, documents & how to apply (verify on official portals).', icon: Building2, active: true },
  { id: 'kisan_ai', label: 'Kisan / Agri Advisor', description: 'Crop & season choice, soil & fertiliser, pest/disease (IPM), irrigation, market/MSP & scheme awareness (confirm with KVK).', icon: Leaf, active: true },
  { id: 'nutritionist_ai', label: 'Nutritionist / Diet AI', description: 'Balanced Indian plate, sustainable weight/muscle plans, veg & non-veg protein, cutting sugar/salt/junk — general nutrition education (not medical advice).', icon: Apple, active: true },
  { id: 'wellness_ai', label: 'Wellness / Counsellor', description: 'A caring space for stress, anxiety & low mood — listening, coping & self-care, crisis helplines. AI companion, not a therapist or a substitute for professional care.', icon: HeartHandshake, active: true },
  { id: 'fitness_ai', label: 'Fitness / Personal Trainer', description: 'Home/gym workout plans for your goal, exercise form, warm-up & recovery, staying consistent — general fitness guidance (not medical/physio advice).', icon: Activity, active: true },
  { id: 'vet_ai', label: 'Veterinary / Pashu Advisor', description: 'Livestock (cattle, buffalo, goat, poultry) & pet (dog, cat) care, hygiene, nutrition & vaccination awareness — general guidance, not a vet diagnosis (see a vet for sick animals).', icon: PawPrint, active: true },
  { id: 'parenting_ai', label: 'Parenting / Child-Care', description: 'Development & milestones, routines (sleep, screen-time), positive discipline & tantrums, study stress & teens — general parenting guidance (not medical; see a paediatrician).', icon: Baby, active: true },
  { id: 'cybersafety_ai', label: 'Cyber Safety / Digital Suraksha', description: 'Spot scams (UPI/OTP, fake KYC, "digital arrest", loan apps, phishing), secure accounts, and act fast if scammed — reporting via 1930 & cybercrime.gov.in. Defensive only.', icon: ShieldCheck, active: true },
  { id: 'insurance_ai', label: 'Insurance Advisor', description: 'Term/health/motor/home/travel/crop insurance explained, choosing the right cover, policy terms & claims, avoiding mis-selling — honest education, not a product pitch.', icon: Umbrella, active: true },
  { id: 'chef_ai', label: 'Chef / Recipe AI', description: 'Step-by-step Indian & world recipes, cook with what you have, substitutions, fixing a dish, quick tiffin & budget meals — adapts veg/Jain/lighter. Food-safety aware.', icon: ChefHat, active: true },
  { id: 'travel_ai', label: 'Travel Planner', description: 'Day-by-day itineraries, budgets & transport, packing, best season & safety, India & international visa/passport awareness — planning guidance, not live bookings.', icon: Map, active: true },
  { id: 'vastu_ai', label: 'Vastu Consultant', description: 'Traditional Vastu directions & room placement, plus simple free ways to add light, air & calm — cultural belief, not science. No fear, no paid remedies; architect first.', icon: LayoutGrid, active: true },
  { id: 'yoga_ai', label: 'Yoga & Meditation', description: 'Beginner asanas & Surya Namaskar, gentle pranayama, and meditation for calm, focus & sleep — general practice guidance (not medical; check with a doctor, never push pain).', icon: Flower2, active: true },
  { id: 'english_ai', label: 'Spoken English / Tutor', description: 'Conversation practice, gentle grammar & vocab fixes, writing (emails/essays), interview & IELTS-style prep — a patient tutor for every level. Practice builds fluency.', icon: Languages, active: true },
  { id: 'resume_ai', label: 'Resume & Job Application', description: 'Strong resume/CV bullet points, ATS-friendly formatting, tailored cover letters & LinkedIn — presents YOUR real experience well. Never invents qualifications; no scams.', icon: FileText, active: true },
  { id: 'gardening_ai', label: 'Gardening / Home-Plants', description: 'Houseplant & balcony care, watering/light/soil, kitchen gardens, and fixing yellow leaves & pests (organic-first) — friendly home-gardening guidance for every space.', icon: Sprout, active: true },
  { id: 'pharmacist_ai', label: 'Pharmacist / Medicine-Info', description: 'General medicine information — what a medicine is for, safe use & storage, generics/Jan Aushadhi, antibiotic safety. Information only — never diagnoses, prescribes or gives doses.', icon: Pill, active: true },
  { id: 'business_ai', label: 'Small-Business / Startup', description: 'Validate ideas, plan, pricing & cash flow, low-cost marketing, registration (Udyam/MSME) & funding awareness — practical mentoring (tax→CA, legal→lawyer; beware scams).', icon: Briefcase, active: true },
  { id: 'homerepair_ai', label: 'Home Repair / Handyman', description: 'Simple safe DIY fixes (tap, drain, flush, tripped MCB), understanding a problem before calling a technician, and maintenance — strong electrical/gas safety, pro when risky.', icon: Hammer, active: true },
  { id: 'realestate_ai', label: 'Real-Estate / Property', description: 'Buy vs rent, buying due diligence (title, RERA, approvals), home-loan basics, rent agreements & avoiding fraud — honest education (lawyer/CA verify; not valuation).', icon: Home, active: true },
  { id: 'driving_ai', label: 'Driving / RTO & Licence', description: 'Learner/Driving Licence process, vehicle papers (RC, insurance, PUC), road rules & safety, e-challans — general info (verify on Parivahan; avoid touts, drive safely).', icon: Car, active: true },
  { id: 'petcare_ai', label: 'Pet-Care / Dog-Training', description: 'Positive reward-based training (commands, potty, leash), behaviour (barking, chewing, anxiety), exercise, grooming & feeding basics — humane methods; vet for medical.', icon: Dog, active: true },
  { id: 'beauty_ai', label: 'Beauty / Skincare & Grooming', description: 'Simple skincare routines, sunscreen, oily/dry/acne & dandruff basics, shaving & grooming, ingredient sense — general cosmetic guidance (dermatologist for conditions).', icon: Gem, active: true },
  { id: 'music_ai', label: 'Music / Instrument Learning', description: 'Start an instrument (guitar, keyboard, harmonium, tabla…), singing/riyaaz, theory (chords, sargam, taal) & practice routines — for all levels (guru for serious classical).', icon: Music, active: true },
  { id: 'sports_ai', label: 'Sports & Cricket Coaching', description: 'Cricket (batting, bowling, fielding, strategy) plus football/badminton/athletics — technique, drills, sport fitness & mindset. Coaching only; warm up, gear, physio for injury.', icon: Trophy, active: true },
  { id: 'photography_ai', label: 'Photography & Videography', description: 'Exposure, composition & light, portraits/travel/product, reels & video, and editing — phone or camera, hobby to pro. Practice over gear; respect consent & safety.', icon: Camera, active: true },
  { id: 'speaking_ai', label: 'Public Speaking & Communication', description: 'Beat stage fright, structure speeches, voice & body language, meetings/GDs & interview delivery — confident communication in any language (kind, specific feedback).', icon: Megaphone, active: true },
  { id: 'events_ai', label: 'Event & Wedding Planner', description: 'Timelines & checklists, budgets, vendors (venue/caterer/decor/photo), guests & day-of coordination for weddings & functions — respectful of your customs; verify vendors.', icon: PartyPopper, active: true },
  { id: 'eldercare_ai', label: 'Elder-Care / Senior Support', description: 'Daily routine & nutrition, home safety & fall prevention, wellbeing & loneliness, medicine organisation & caregiver support — care guidance with dignity (not medical).', icon: Accessibility, active: true },
  { id: 'interior_ai', label: 'Interior Design & Home-Decor', description: 'Space planning, colour & lighting, affordable decor & DIY, storage & decluttering, room-by-room ideas — for rented or owned homes on any budget (pro for structural).', icon: Sofa, active: true },
  { id: 'studyabroad_ai', label: 'Study-Abroad & Education', description: 'Course/country/university choice, exams (IELTS/GRE/GMAT), applications & SOPs, scholarships & loans, student-visa process — honest guidance (verify officially; beware agent scams).', icon: Globe2, active: true },
  { id: 'disability_ai', label: 'Disability & Accessibility Support', description: 'Rights (RPwD Act), schemes & benefits (UDID/ADIP), assistive technology, inclusion at school/work & caregiver support — respectful info (verify officially; not medical/legal).', icon: HandHelping, active: true },
  { id: 'fashion_ai', label: 'Fashion & Personal Styling', description: 'Outfit & occasion ideas, versatile wardrobe, fit/colour for every body, ethnic wear & draping, accessories — body-positive, inclusive styling on any budget (options, not rules).', icon: Shirt, active: true },
  { id: 'productivity_ai', label: 'Productivity & Time-Management', description: 'Planning & priorities, focus (Pomodoro/time-blocking), beating procrastination, habits & routines, study/work schedules — small consistent steps, balance over burnout.', icon: ListChecks, active: true },
  { id: 'relationship_ai', label: 'Relationship & Communication', description: 'Communicating better, resolving conflict, boundaries, trust & family/in-law dynamics — warm, non-judgemental support (not therapy/legal; safety-first on abuse).', icon: Users, active: true },
  { id: 'vehicle_ai', label: 'Vehicle & Auto-Maintenance', description: 'Car & bike service schedules, safe owner checks, understanding warning lights & noises, mileage tips & service-centre sense — general guidance (mechanic for safety-critical work).', icon: Wrench, active: true },
  { id: 'stocks_ai', label: 'Stock-Market & Investing', description: 'How markets work — shares, Sensex/Nifty, demat, mutual funds/SIP/ETFs, risk/diversification/compounding & scam-avoidance. Education only — no tips, calls or guaranteed returns.', icon: CandlestickChart, active: true },
  { id: 'techhelp_ai', label: 'Gadget & Tech-Help', description: 'Simple-language fixes for phones, laptops, apps & Wi-Fi — slow device, storage, battery, internet, accounts & backups, buying & care. Beware tech-support scams; pro for hardware.', icon: Smartphone, active: true },
  { id: 'mathscience_ai', label: 'Maths & Science Solver', description: 'Step-by-step solutions & concepts for maths (algebra/trig/calculus) & science (physics/chemistry/biology), school to NEET/JEE — learn the method (hints first, not just answers).', icon: Sigma, active: true },
  { id: 'coding_ai', label: 'Coding & Programming Tutor', description: 'Learn to code (Python/JS), core concepts, debugging, data structures & algorithms (placements) & projects — teaches for understanding (hints first). To build apps, use Engineer AI.', icon: Code2, active: true },
  { id: 'architect_ai', label: 'Architect AI', description: 'Design and structural planning assistant.', icon: Building2, active: false },
  { id: 'accountant_ai', label: 'CA / Tax & Accounts', description: 'GST, income tax, TDS, deductions, bookkeeping & business compliance — explained (verify with a CA).', icon: Calculator, active: true },
];

interface ProfessionalsViewProps {
  onSelect: (id: string) => void;
}

export function ProfessionalsView({ onSelect }: ProfessionalsViewProps) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-10 bg-[#0d1117]">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-black text-white tracking-tight mb-1">Professionals</h1>
        <p className="text-sm text-[#8b949e] mb-8">Domain-expert AI assistants — pick a profession to get started.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CARDS.map((card) => (
            <button
              key={card.id}
              disabled={!card.active}
              onClick={() => card.active && onSelect(card.id)}
              className={`text-left p-4 rounded-2xl border transition-all ${
                card.active
                  ? 'bg-[#161b22] border-white/10 hover:border-indigo-500/40 hover:bg-[#1c222b]'
                  : 'bg-[#161b22]/50 border-white/5 opacity-40 grayscale cursor-not-allowed'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                  <card.icon className="w-5 h-5" />
                </div>
                {!card.active && (
                  <span className="text-[9px] font-black uppercase tracking-widest bg-white/5 text-white/40 border border-white/10 px-2 py-0.5 rounded-full">
                    Coming Soon
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-white mb-1">{card.label}</h3>
              <p className="text-[11px] text-[#8b949e] leading-snug">{card.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

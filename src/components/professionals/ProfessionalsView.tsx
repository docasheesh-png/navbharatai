import { Stethoscope, HardHat, Scale, GraduationCap, Building2, Calculator, Compass, BookOpen, TrendingUp, Sparkles, Leaf, Apple, HeartHandshake, Activity, PawPrint, Baby, ShieldCheck, Umbrella } from 'lucide-react';

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

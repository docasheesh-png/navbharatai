import type { ProfessionalConfig } from '../types';

export const INSURANCE_AI: ProfessionalConfig = {
  id: 'insurance_ai',
  name: 'Insurance Advisor AI',
  systemPrompt: `You are Insurance Advisor AI inside NavBharatAI — a clear, honest insurance educator for Indian users. You explain how insurance works and help people make informed choices. You give general EDUCATION, not a recommendation of any specific policy/company, and you are NOT a licensed insurance agent or IRDAI adviser.

WHAT YOU HELP WITH (detect the need):
- TYPES OF INSURANCE → term life, health/mediclaim (individual/family floater, top-up), motor (third-party vs comprehensive), personal accident, home, travel, and crop (PMFBY) — what each covers and who needs it.
- CHOOSING WISELY → adequate cover (sum insured), why TERM life beats investment-linked plans for protection, health cover before/alongside employer cover, riders worth considering, and reading the key terms.
- POLICY TERMS → premium, sum insured, deductible/co-pay, waiting periods, pre-existing disease clauses, room-rent limits, exclusions, no-claim bonus, free-look period, grace period, portability.
- CLAIMS → how cashless vs reimbursement works, documents needed, common reasons claims get rejected (non-disclosure, waiting period, exclusion), and how to avoid them.
- AVOIDING MIS-SELLING & FRAUD → never buy under pressure, don't mix insurance with investment blindly, verify the insurer/agent on IRDAI, and report fraud.

CRITICAL HONESTY & SAFETY (non-negotiable):
- This is general insurance education, NOT personalised advice or a specific product recommendation. For a tailored decision, consult a licensed IRDAI-registered advisor and ALWAYS read the policy wording/brochure.
- Be brutally honest about protection vs investment: for most people, term insurance + separate investing beats endowment/ULIP-as-protection. Never push a product or commission.
- ALWAYS DISCLOSE TRUTHFULLY when buying (medical history, smoking, income) — non-disclosure is the top reason genuine claims get rejected. Say this clearly.
- Premiums, rules, tax treatment and product features change and vary by insurer — tell users to verify current terms. Never fabricate specific premiums, IDV, or policy clauses.

INDIA CONTEXT: aware of IRDAI, term vs ULIP/endowment mis-selling, family floater health norms, PMFBY crop insurance, Ayushman Bharat (govt health scheme — route scheme specifics to the Govt Schemes Helper), motor third-party legal requirement. Reply in the user's language (Hindi/regional) if they use it.`,
  disclaimer: 'Insurance Advisor AI gives general insurance education, not personalised advice or a specific product recommendation. Premiums, rules and terms change and vary by insurer — verify current policy wording and consult a licensed IRDAI-registered advisor. Always disclose your medical/income details truthfully when buying, or claims can be rejected.',
  knowledge: [
    {
      id: 'term_vs_invest',
      topic: 'Term life vs investment-linked plans',
      keywords: ['term', 'life insurance', 'ulip', 'endowment', 'lic', 'protection', 'sum assured'],
      content: 'For pure life protection, a TERM plan gives a large cover for a low premium — ideal if anyone depends on your income. Endowment/money-back/ULIP plans mix insurance with investment, usually giving low cover AND modest returns; for most people, buying term insurance and investing the difference separately works better. A common guideline is life cover of roughly 10–15× your annual income, but your needs (loans, dependents, goals) decide. Verify current premiums; disclose health/smoking honestly.',
      source: 'General insurance education',
    },
    {
      id: 'health_insurance',
      topic: 'Health insurance basics',
      keywords: ['health', 'mediclaim', 'medical', 'family floater', 'top up', 'hospital', 'cashless', 'sum insured'],
      content: 'Get adequate health cover early (premiums are lower and waiting periods start sooner). Understand: sum insured, family floater vs individual, room-rent limits, co-pay/deductible, pre-existing disease waiting periods (often 2–4 years), disease-specific waiting, and exclusions. Employer cover is good but not enough (it ends with the job) — a personal policy plus an affordable top-up boosts cover cheaply. Check the insurer’s claim-settlement ratio and network hospitals.',
      source: 'General health-insurance concepts',
    },
    {
      id: 'motor_other',
      topic: 'Motor, accident, home & travel cover',
      keywords: ['motor', 'car', 'bike', 'vehicle', 'third party', 'comprehensive', 'accident', 'home', 'travel', 'idv'],
      content: 'Motor: third-party insurance is legally mandatory; comprehensive adds own-damage + theft (IDV is the insured value). A personal accident cover protects against disability/death from accidents and is cheap. Home insurance covers structure/contents against fire, theft and disasters. Travel insurance covers medical emergencies, trip issues and lost baggage abroad. Match cover to real risk and read exclusions.',
      source: 'General — verify current terms',
    },
    {
      id: 'claims',
      topic: 'Making a claim & why claims get rejected',
      keywords: ['claim', 'rejected', 'cashless', 'reimbursement', 'documents', 'settlement', 'denied'],
      content: 'Cashless: use a network hospital and get pre-authorisation; reimbursement: pay first, then submit bills/documents. Claims commonly get rejected due to non-disclosure of medical history, claiming within a waiting period, an excluded condition, a lapsed policy, or missing documents. To avoid this: disclose everything truthfully when buying, know your waiting periods/exclusions, pay premiums on time, and keep all paperwork. If wrongly rejected, escalate to the insurer’s grievance cell, then the IRDAI / Insurance Ombudsman.',
      source: 'Claims process (general)',
    },
    {
      id: 'mis_selling',
      topic: 'Avoiding mis-selling & fraud',
      keywords: ['mis-selling', 'fraud', 'agent', 'pressure', 'fake policy', 'irdai', 'scam', 'commission'],
      content: 'Never buy insurance under pressure or because of "guaranteed double returns" claims — that is usually mis-selling. Buy from verified IRDAI-registered insurers/agents, pay premiums only to the company (not an individual’s personal account), and check policy documents arrive officially. Use the free-look period (usually 15–30 days) to cancel a mis-sold policy. Report fraud to the insurer and IRDAI. Don’t let anyone fill your proposal form with false information.',
      source: 'IRDAI consumer-protection principles',
    },
  ],
};

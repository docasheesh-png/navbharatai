/**
 * C — Clinical knowledge grounding for Doctor AI (SDA).
 *
 * GOAL: make SDA safest for PATIENTS and most useful for JUNIOR / rural doctors —
 * ground answers in conservative, widely-accepted, India-relevant safety guidance
 * (danger signs, when-to-refer, emergency first steps) instead of free-form model
 * recall. Relevant cards are retrieved per case and injected into the prompt with
 * an instruction to USE and CITE them.
 *
 * SCOPE (honest): this is a CURATED STARTER set of standard, non-controversial
 * safety knowledge — NOT a complete guideline library. It is designed to be
 * extended. Sources are widely-accepted standards (WHO/IMCI, standard emergency
 * medicine, India NLEM); always confirmed by the treating doctor.
 */

export interface KnowledgeCard {
  id: string;
  topic: string;
  keywords: string[];
  content: string;
  source: string;
}

export const CLINICAL_KB: KnowledgeCard[] = [
  {
    id: 'imci_danger_signs',
    topic: 'Paediatric general danger signs (refer urgently)',
    keywords: ['child', 'pediatric', 'paediatric', 'infant', 'baby', 'imci', 'not drinking', 'vomiting everything', 'convulsion', 'lethargic', 'unconscious'],
    content: 'In any sick child screen IMCI general danger signs: (1) unable to drink/breastfeed, (2) vomits everything, (3) convulsions, (4) lethargic/unconscious. ANY present → urgent: give first dose of appropriate treatment and refer NOW.',
    source: 'WHO IMCI',
  },
  {
    id: 'sepsis_first_steps',
    topic: 'Sepsis — first hour',
    keywords: ['sepsis', 'septic', 'qsofa', 'infection', 'shock', 'fever low bp', 'hypotension'],
    content: 'Suspected sepsis: take blood cultures, give broad-spectrum IV antibiotics early, IV fluids for hypoperfusion, measure lactate, monitor urine output (the "Sepsis-6" idea). Escalate/refer if hypotension persists after fluids.',
    source: 'Surviving Sepsis (standard)',
  },
  {
    id: 'acs_first_steps',
    topic: 'Acute chest pain / suspected ACS',
    keywords: ['chest pain', 'acs', 'mi', 'heart attack', 'angina', 'cardiac'],
    content: 'Suspected ACS: do a 12-lead ECG within 10 minutes, give aspirin (chew 300 mg) unless contraindicated, assess for STEMI. Arrange urgent referral to a PCI/thrombolysis-capable centre. Do not delay transfer for tests.',
    source: 'Standard emergency cardiology',
  },
  {
    id: 'stroke_fast',
    topic: 'Suspected stroke — time-critical',
    keywords: ['stroke', 'fast', 'facial droop', 'weakness one side', 'slurred speech', 'cva'],
    content: 'Use FAST (Face/Arm/Speech/Time). Note exact symptom onset time — it decides thrombolysis eligibility. Check glucose (rule out hypoglycaemia). Refer immediately to a stroke-capable centre; time = brain.',
    source: 'Standard stroke care',
  },
  {
    id: 'anaphylaxis',
    topic: 'Anaphylaxis — first drug is adrenaline',
    keywords: ['anaphylaxis', 'allergic reaction', 'angioedema', 'wheeze rash', 'severe allergy'],
    content: 'Anaphylaxis: give IM adrenaline (adult 0.5 mg = 0.5 mL of 1:1000) into the mid-outer thigh immediately; repeat after 5 min if needed. High-flow oxygen, IV fluids, lie flat with legs raised. Antihistamines/steroids are second-line, never first.',
    source: 'Resuscitation Council (standard)',
  },
  {
    id: 'severe_dehydration',
    topic: 'Severe dehydration / acute diarrhoea',
    keywords: ['dehydration', 'diarrhoea', 'diarrhea', 'ors', 'gastroenteritis', 'sunken eyes'],
    content: 'Severe dehydration (lethargy, sunken eyes, very slow skin pinch): IV fluids (Ringer lactate) per WHO Plan C; if able to drink, ORS alongside. Some dehydration: ORS (Plan B). Reassess frequently; refer if shock or not improving.',
    source: 'WHO ORS / IMCI',
  },
  {
    id: 'dengue_warning',
    topic: 'Dengue warning signs (admit)',
    keywords: ['dengue', 'fever rash', 'platelet', 'bleeding', 'abdominal pain fever'],
    content: 'Dengue warning signs needing admission: severe abdominal pain, persistent vomiting, mucosal bleeding, lethargy/restlessness, liver enlargement >2 cm, rising haematocrit with rapid platelet fall. Avoid NSAIDs/aspirin; use paracetamol; careful fluid management.',
    source: 'WHO Dengue',
  },
  {
    id: 'snakebite',
    topic: 'Snake bite (India)',
    keywords: ['snake bite', 'snakebite', 'envenomation', 'snake'],
    content: 'Snake bite: immobilise the limb, keep patient calm, do NOT cut/suck/tourniquet tightly. Do the 20-minute whole-blood clotting test (20WBCT). Give polyvalent anti-snake-venom for signs of envenomation (haemotoxic/neurotoxic). Refer urgently; monitor airway in neurotoxic bites.',
    source: 'India national snakebite protocol',
  },
  {
    id: 'pph',
    topic: 'Postpartum haemorrhage',
    keywords: ['pph', 'postpartum', 'bleeding after delivery', 'obstetric bleeding'],
    content: 'PPH: call for help, uterine massage, IV oxytocin (first-line uterotonic), two large-bore IV lines + fluids, examine for tears/retained products, tranexamic acid early. Refer for ongoing bleeding; do not delay transfer.',
    source: 'WHO PPH',
  },
  {
    id: 'pregnancy_danger',
    topic: 'Pregnancy danger signs (refer)',
    keywords: ['pregnant', 'pregnancy', 'antenatal', 'eclampsia', 'pre-eclampsia', 'headache pregnancy', 'bleeding pregnancy'],
    content: 'Pregnancy danger signs needing urgent referral: severe headache/visual changes + high BP (pre-eclampsia), convulsions (eclampsia — give magnesium sulphate), vaginal bleeding, severe abdominal pain, reduced fetal movements, high fever, water breaking before term.',
    source: 'WHO antenatal care',
  },
  {
    id: 'tb_suspicion',
    topic: 'TB suspicion',
    keywords: ['tb', 'tuberculosis', 'cough 2 weeks', 'chronic cough', 'weight loss night sweats', 'haemoptysis'],
    content: 'Suspect TB with cough ≥2 weeks, fever, night sweats, weight loss, or haemoptysis. Send sputum for NAAT (e.g., CBNAAT/GeneXpert). Notify and link to the national TB programme (NTEP). Screen contacts; assess HIV status.',
    source: 'India NTEP / WHO',
  },
  {
    id: 'drug_safety_renal',
    topic: 'Common drug cautions',
    keywords: ['nsaid', 'metformin', 'renal', 'kidney', 'drug caution', 'contraindication', 'ckd'],
    content: 'Common cautions: avoid NSAIDs in renal impairment, active GI bleed, and dehydration; hold metformin in significant renal impairment and before contrast; dose-reduce renally-cleared drugs in CKD; check pregnancy category before any drug in women of reproductive age.',
    source: 'Standard pharmacology / NLEM',
  },
  {
    id: 'antibiotic_stewardship',
    topic: 'Antibiotic stewardship',
    keywords: ['antibiotic', 'stewardship', 'empirical', 'culture', 'resistance'],
    content: 'Start the narrowest effective empirical antibiotic for the likely source, take cultures BEFORE the first dose where possible, set a review/stop date, and de-escalate to a targeted agent once cultures return. Avoid antibiotics for clearly viral illness.',
    source: 'WHO AMR stewardship',
  },
];

/** Lightweight keyword retrieval — returns the most relevant cards for a query. */
export function retrieveClinicalKnowledge(query: string, max = 4): KnowledgeCard[] {
  const q = (query || '').toLowerCase();
  if (!q.trim()) return [];
  const scored = CLINICAL_KB.map((card) => {
    let score = 0;
    for (const kw of card.keywords) {
      if (q.includes(kw)) score += kw.includes(' ') ? 3 : 2; // phrase match worth more
    }
    // topic word overlap as a weak signal
    for (const w of card.topic.toLowerCase().split(/[^a-z]+/)) {
      if (w.length > 3 && q.includes(w)) score += 1;
    }
    return { card, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.card);
}

/** Format retrieved cards as a prompt block SDA must use and cite. */
export function formatKnowledgeForPrompt(cards: KnowledgeCard[]): string {
  if (!cards.length) return '';
  const lines = cards.map((c) => `• [${c.topic}] ${c.content} (Source: ${c.source})`);
  return `GROUNDED CLINICAL REFERENCES (use these where relevant and cite the source in your answer; if your advice goes beyond them, say so and reason carefully):\n${lines.join('\n')}`;
}

import type { ProfessionalConfig } from './types';
import { TEACHER_AI } from './configs/teacher';
import { MENTOR_AI } from './configs/mentor';
import { THESIS_AI } from './configs/thesis';
import { ACCOUNTANT_AI } from './configs/accountant';
import { LAWYER_AI } from './configs/lawyer';
import { FINANCE_AI } from './configs/finance';
import { ASTROLOGER_AI } from './configs/astrologer';
import { GOVT_SCHEMES_AI } from './configs/govtschemes';
import { KISAN_AI } from './configs/kisan';
import { NUTRITIONIST_AI } from './configs/nutritionist';
import { WELLNESS_AI } from './configs/wellness';
import { FITNESS_AI } from './configs/fitness';
import { VET_AI } from './configs/vet';
import { PARENTING_AI } from './configs/parenting';
import { CYBERSAFETY_AI } from './configs/cybersafety';
import { INSURANCE_AI } from './configs/insurance';
import { CHEF_AI } from './configs/chef';
import { TRAVEL_AI } from './configs/travel';

/**
 * Registry of all config-driven professionals. Add a new professional by adding
 * its config here — the generic engine + /api/professional/:id/chat route + a
 * generic chat UI serve it automatically.
 *
 * (Doctor AI / Engineer AI keep their own bespoke routes; new professionals use
 * this shared framework.)
 */
const PROFESSIONALS: Record<string, ProfessionalConfig> = {
  [TEACHER_AI.id]: TEACHER_AI,
  [MENTOR_AI.id]: MENTOR_AI,
  [THESIS_AI.id]: THESIS_AI,
  [ACCOUNTANT_AI.id]: ACCOUNTANT_AI,
  [LAWYER_AI.id]: LAWYER_AI,
  [FINANCE_AI.id]: FINANCE_AI,
  [ASTROLOGER_AI.id]: ASTROLOGER_AI,
  [GOVT_SCHEMES_AI.id]: GOVT_SCHEMES_AI,
  [KISAN_AI.id]: KISAN_AI,
  [NUTRITIONIST_AI.id]: NUTRITIONIST_AI,
  [WELLNESS_AI.id]: WELLNESS_AI,
  [FITNESS_AI.id]: FITNESS_AI,
  [VET_AI.id]: VET_AI,
  [PARENTING_AI.id]: PARENTING_AI,
  [CYBERSAFETY_AI.id]: CYBERSAFETY_AI,
  [INSURANCE_AI.id]: INSURANCE_AI,
  [CHEF_AI.id]: CHEF_AI,
  [TRAVEL_AI.id]: TRAVEL_AI,
};

export function getProfessional(id: string): ProfessionalConfig | undefined {
  return PROFESSIONALS[id];
}

export function listProfessionals(): Array<{ id: string; name: string }> {
  return Object.values(PROFESSIONALS).map((p) => ({ id: p.id, name: p.name }));
}

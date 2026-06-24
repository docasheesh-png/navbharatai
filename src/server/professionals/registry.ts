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
import { VASTU_AI } from './configs/vastu';
import { YOGA_AI } from './configs/yoga';
import { ENGLISH_AI } from './configs/english';
import { RESUME_AI } from './configs/resume';
import { GARDENING_AI } from './configs/gardening';
import { PHARMACIST_AI } from './configs/pharmacist';
import { BUSINESS_AI } from './configs/business';
import { HOMEREPAIR_AI } from './configs/homerepair';
import { REALESTATE_AI } from './configs/realestate';
import { DRIVING_AI } from './configs/driving';
import { PETCARE_AI } from './configs/petcare';
import { BEAUTY_AI } from './configs/beauty';
import { MUSIC_AI } from './configs/music';
import { SPORTS_AI } from './configs/sports';
import { PHOTOGRAPHY_AI } from './configs/photography';
import { SPEAKING_AI } from './configs/speaking';
import { EVENTS_AI } from './configs/events';
import { ELDERCARE_AI } from './configs/eldercare';
import { INTERIOR_AI } from './configs/interior';
import { STUDYABROAD_AI } from './configs/studyabroad';
import { DISABILITY_AI } from './configs/disability';
import { FASHION_AI } from './configs/fashion';
import { PRODUCTIVITY_AI } from './configs/productivity';

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
  [VASTU_AI.id]: VASTU_AI,
  [YOGA_AI.id]: YOGA_AI,
  [ENGLISH_AI.id]: ENGLISH_AI,
  [RESUME_AI.id]: RESUME_AI,
  [GARDENING_AI.id]: GARDENING_AI,
  [PHARMACIST_AI.id]: PHARMACIST_AI,
  [BUSINESS_AI.id]: BUSINESS_AI,
  [HOMEREPAIR_AI.id]: HOMEREPAIR_AI,
  [REALESTATE_AI.id]: REALESTATE_AI,
  [DRIVING_AI.id]: DRIVING_AI,
  [PETCARE_AI.id]: PETCARE_AI,
  [BEAUTY_AI.id]: BEAUTY_AI,
  [MUSIC_AI.id]: MUSIC_AI,
  [SPORTS_AI.id]: SPORTS_AI,
  [PHOTOGRAPHY_AI.id]: PHOTOGRAPHY_AI,
  [SPEAKING_AI.id]: SPEAKING_AI,
  [EVENTS_AI.id]: EVENTS_AI,
  [ELDERCARE_AI.id]: ELDERCARE_AI,
  [INTERIOR_AI.id]: INTERIOR_AI,
  [STUDYABROAD_AI.id]: STUDYABROAD_AI,
  [DISABILITY_AI.id]: DISABILITY_AI,
  [FASHION_AI.id]: FASHION_AI,
  [PRODUCTIVITY_AI.id]: PRODUCTIVITY_AI,
};

export function getProfessional(id: string): ProfessionalConfig | undefined {
  return PROFESSIONALS[id];
}

export function listProfessionals(): Array<{ id: string; name: string }> {
  return Object.values(PROFESSIONALS).map((p) => ({ id: p.id, name: p.name }));
}

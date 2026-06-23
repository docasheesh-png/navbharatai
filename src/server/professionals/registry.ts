import type { ProfessionalConfig } from './types';
import { TEACHER_AI } from './configs/teacher';
import { MENTOR_AI } from './configs/mentor';
import { THESIS_AI } from './configs/thesis';
import { ACCOUNTANT_AI } from './configs/accountant';
import { LAWYER_AI } from './configs/lawyer';

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
};

export function getProfessional(id: string): ProfessionalConfig | undefined {
  return PROFESSIONALS[id];
}

export function listProfessionals(): Array<{ id: string; name: string }> {
  return Object.values(PROFESSIONALS).map((p) => ({ id: p.id, name: p.name }));
}

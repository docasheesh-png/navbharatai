import type { ProfessionalConfig } from './types';
import { TEACHER_AI } from './configs/teacher';

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
};

export function getProfessional(id: string): ProfessionalConfig | undefined {
  return PROFESSIONALS[id];
}

export function listProfessionals(): Array<{ id: string; name: string }> {
  return Object.values(PROFESSIONALS).map((p) => ({ id: p.id, name: p.name }));
}

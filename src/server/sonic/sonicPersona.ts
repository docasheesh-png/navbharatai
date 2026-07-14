// Voice-persona resolver (admin 2026-07-14) — the SINGLE place that turns a `professionalId` from the
// client into the system prompt a NavBharatAI Voice session runs on. Server-side only: the client only
// ever NAMES which professional; a raw prompt is never trusted from the client (prompt-injection guard).
//
// Two sources, one resolver (rule 2 — no drift):
//   • Bespoke Doctor AI (SDA) — NOT a config-driven professional; it has its own clinical voice persona.
//     Accepts 'sda' or 'doctor' (the SDAChat id + a friendly alias).
//   • Every config-driven professional in the registry — its own persona via buildProfessionalSystemPrompt.
// Unknown / absent id → undefined → the session falls back to the default NavBharatAI Voice assistant.

import { getProfessional } from '../professionals/registry';
import { buildProfessionalSystemPrompt } from '../professionals/engine';
import { sdaVoiceSystemPrompt } from '../lib/clinical/sdaVoicePrompt';

export function sonicPersonaFor(professionalId: string | undefined | null): string | undefined {
  if (!professionalId || typeof professionalId !== 'string') return undefined;
  const id = professionalId.trim().toLowerCase();
  if (!id) return undefined;
  // Doctor AI is bespoke (its clinical system prompt lives in routes/sda.ts, not the professionals
  // registry) — resolve its dedicated SPOKEN clinical persona so the voice assistant IS the doctor.
  if (id === 'sda' || id === 'doctor') return sdaVoiceSystemPrompt();
  const cfg = getProfessional(professionalId);
  return cfg ? buildProfessionalSystemPrompt(cfg) : undefined;
}

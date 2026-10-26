import { entryAdmissionFor } from './entryAdmission';
import type { Request } from 'express';
import { verifyFirebaseIdentity, verifyFirebaseToken } from '../../lib/authMiddleware';
import { parseEnvFlag } from '../../lib/envFlag';
import { conversationHash } from './control';
import type { FreeChainContext } from './rollout';
import { identityGrantEmail } from '../../AgentV3/featureFlag';
import {
  cheaperInferenceExclusiveAdmin,
  cheaperInferenceMode,
} from '../../lib/cheaperInferencePolicy';
import { isAdminEmail } from '../../lib/adminEmails';

/** Called only after attachment, vision, image, safety and direct-answer paths have returned. */
export async function freeChainRequestContext(req: Request, input: { tier: string; message: string; history: unknown[]; attachments: number; hasProfile: boolean; hasMemory: boolean; grounded: boolean }): Promise<FreeChainContext | undefined> {
  const entryAdmission = entryAdmissionFor(req);
  const mode = cheaperInferenceMode();
  const freeChainOn = parseEnvFlag(process.env.FREE_CHAIN_ENABLED) === true;
  if (input.tier !== 'navbharat' || input.attachments) return undefined;
  if (!entryAdmission && !freeChainOn && mode !== 'admin' && mode !== 'all') return undefined;

  let uid: string | null = entryAdmission?.uid ?? null;
  let isAdmin = false;

  if (mode === 'admin' || mode === 'all') {
    const identity = await verifyFirebaseIdentity(req).catch(() => null);
    if (identity) {
      uid = uid ?? identity.uid;
      isAdmin = isAdminEmail(identityGrantEmail(identity));
      // FreeChain OFF: only the exclusive admin CheaperInference path may continue.
      if (!entryAdmission && !freeChainOn && !cheaperInferenceExclusiveAdmin(identityGrantEmail(identity))) return undefined;
    } else {
      if (!uid) uid = await verifyFirebaseToken(req).catch(() => null);
      // Without a verified identity we cannot prove admin; exclusive path is closed.
      if (!entryAdmission && !freeChainOn) return undefined;
    }
  } else if (!uid) {
    uid = await verifyFirebaseToken(req).catch(() => null);
  }

  // Never trust body.uid for rollout/caps.
  if (!uid) return undefined;

  const first = input.history.find(m => !!m && typeof m === 'object' && ((m as any).sender === 'user' || (m as any).role === 'user')) as any;
  const conversation = typeof req.body?.conversationId === 'string' && req.body.conversationId.length <= 200
    ? req.body.conversationId : String(first?.text ?? first?.content ?? input.message);
  const privateTurn = req.body?.private === true || req.body?.privacy === 'private' || input.hasProfile || input.hasMemory;
  const healthTurn = /\b(doctor|patient|diagnos\w*|symptom\w*|medicine|dose|pregnan\w*|medical|health)\b|दवा|बीमारी|मरीज़|मरीज|डॉक्टर|स्वास्थ्य|रोग/u.test(input.message.toLowerCase())
    || req.body?.mode === 'doctor' || req.body?.mode === 'health';
  return { uid, ...(entryAdmission ? { entryAdmission } : {}), conversationKey: conversationHash(uid, conversation), privateTurn, healthTurn,
    teachingTurn: typeof req.body?.mode === 'string' && /^(teacher|teacher_ai|exam|exam_mode|tutor|study)$/i.test(req.body.mode),
    cacheEligible: !privateTurn && !healthTurn && !input.grounded && !input.history.length && !input.attachments,
    ...(isAdmin ? { isAdmin: true } : {}) };
}

import type { Express, Request, Response } from 'express';
import { buildRateLimiter, verifyFirebaseIdentity, enforceNotBanned } from '../lib/authMiddleware';
import { getProfessional, listProfessionals } from '../professionals/registry';
import { runProfessionalChat, type ProfessionalTurn } from '../professionals/engine';
import { buildDocumentContext, isVisionAttachment, type RawAttachment } from '../lib/attachmentText';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { decideProfessionalAccess } from '../professionals/access';
import {
  professionalPaidEnabled, professionalFreeDailyLimit, professionalPassPriceInr,
  professionalPassDays, isProfessionalFreeUser,
} from '../professionals/professionalPaid';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import { professionalUsageStore } from '../professionals/ProfessionalUsageStore';

/**
 * Professional Pass gate for one chat turn. FLAG OFF ⇒ always allow (today's behaviour, zero extra
 * Firestore reads). FLAG ON ⇒ free-list & active-pass are unlimited; anonymous callers must sign in;
 * everyone else gets professionalFreeDailyLimit() free messages/day. Returns the decision plus a
 * ready-to-send paywall payload for a block.
 */
async function gateProfessionalTurn(uid: string | null, email: string | null) {
  if (!professionalPaidEnabled()) {
    return { allow: true as const, countsAgainstFree: false, uid };
  }
  const freeListed = isProfessionalFreeUser(uid, email);
  const freeDailyLimit = professionalFreeDailyLimit();
  // Only touch Firestore for a signed-in, non-free-listed user (pass + today's count).
  const hasActivePass = !!uid && !freeListed ? (await professionalPassStore.getStatus(uid)).active : false;
  const usedToday = !!uid && !freeListed && !hasActivePass ? await professionalUsageStore.getTodayCount(uid) : 0;
  const decision = decideProfessionalAccess({
    enabled: true, signedIn: !!uid, isFreeListed: freeListed, hasActivePass, usedToday, freeDailyLimit,
  });
  if (decision.action === 'allow') {
    return { allow: true as const, countsAgainstFree: decision.countsAgainstFree, remainingFree: decision.remainingFree, uid };
  }
  const login = decision.reason === 'login-required';
  return {
    allow: false as const,
    status: login ? 401 : 402,
    body: {
      error: login
        ? 'Please sign in to use the Professionals. New users get free messages every day.'
        : `You've used your ${freeDailyLimit} free messages for today. Get the Professional Pass for unlimited access to every professional.`,
      code: login ? 'login_required' : 'professional_paywall',
      reason: decision.reason,
      remainingFree: 0,
      freeDailyLimit,
      passPriceInr: professionalPassPriceInr(),
      passDays: professionalPassDays(),
    },
  };
}

/** Max attachments accepted per turn (defense against oversized payload loops). */
const MAX_PROFESSIONAL_ATTACHMENTS = 4;

/**
 * Generic config-driven professional chat (Teacher, and future Lawyer/CA/etc.).
 *  - GET  /api/professionals          — list available config-driven professionals
 *  - POST /api/professional/:id/chat  — one chat turn for that professional
 *
 * Attachments: the engine itself is text-only, so files become TEXT before the
 * model sees them — documents (Word/Excel/PowerPoint/ZIP/text/code) via the
 * shared extractor, and images/PDFs via the vision-describe chain. This is the
 * same server-side pattern Pro v3.0 uses, so every professional reads every
 * supported format without a per-professional integration.
 */
export function registerProfessionalsRoutes(app: Express): void {
  app.get('/api/professionals', (_req: Request, res: Response) => {
    res.json({ professionals: listProfessionals() });
  });

  app.post('/api/professional/:id/chat', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    const config = getProfessional(req.params.id);
    if (!config) {
      res.status(404).json({ error: `Unknown professional: ${req.params.id}` });
      return;
    }
    const { message, history, fileAttachments } = req.body || {};
    const rawAttachments: RawAttachment[] = Array.isArray(fileAttachments)
      ? fileAttachments
          .filter((a: any) => a && typeof a.base64 === 'string' && a.base64 && typeof a.type === 'string')
          .slice(0, MAX_PROFESSIONAL_ATTACHMENTS)
          .map((a: any) => ({ name: String(a.name || 'file'), type: String(a.type), base64: String(a.base64) }))
      : [];
    if ((typeof message !== 'string' || !message.trim()) && rawAttachments.length === 0) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }

    // Turn files into text the (text-only) professional engine can actually read.
    let effectiveMessage = typeof message === 'string' ? message.trim() : '';
    if (rawAttachments.length > 0) {
      const parts: string[] = [];
      try {
        const docBlock = await buildDocumentContext(rawAttachments);
        if (docBlock) parts.push(docBlock);
      } catch { /* best-effort — a bad document never blocks the turn */ }
      try {
        if (rawAttachments.some((a) => isVisionAttachment(a.type, a.name))) {
          const visionBlock = await describeVisionAttachments(rawAttachments);
          if (visionBlock) parts.push(visionBlock);
        }
      } catch { /* best-effort — a bad image never blocks the turn */ }
      if (parts.length > 0) {
        effectiveMessage = `${parts.join('\n\n')}\n\n---\n${effectiveMessage || 'Please review the attached file(s) above and respond.'}`;
      } else {
        // Honest state: never pretend the file was read when nothing could be extracted.
        effectiveMessage = `[The user attached ${rawAttachments.length} file(s) (${rawAttachments.map((a) => a.name).join(', ')}) but their content could not be read. Say so honestly and ask for the content in a supported format.]\n\n${effectiveMessage}`;
      }
    }

    const turns: ProfessionalTurn[] = Array.isArray(history)
      ? history
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : [];
    // Persistent memory (e.g. Teacher AI's student profile) is keyed by the VERIFIED
    // token identity ONLY — the client-claimed body `userId` is never trusted for it
    // (trusting it would let anyone read another user's remembered facts).
    const identity = await verifyFirebaseIdentity(req);
    const verifiedUserId = identity?.uid || null;

    // Professional Pass gate (flag-off = no-op). Blocks anonymous / out-of-free-quota users honestly.
    const gate = await gateProfessionalTurn(verifiedUserId, identity?.email || null);
    if (!gate.allow) {
      res.status(gate.status).json(gate.body);
      return;
    }

    try {
      const reply = await runProfessionalChat(config, effectiveMessage, turns, verifiedUserId || undefined);
      // Only a genuinely-answered FREE turn burns a daily message (never on a paywall block or an error).
      if (gate.countsAgainstFree && verifiedUserId) {
        void professionalUsageStore.increment(verifiedUserId);
      }
      res.json({ reply, professionalId: config.id });
    } catch (err: any) {
      res.status(503).json({ error: err?.message || 'The assistant is busy. Please try again.' });
    }
  });
}

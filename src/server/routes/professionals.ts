import type { Express, Request, Response } from 'express';
import { buildRateLimiter, verifyFirebaseIdentity, enforceNotBanned } from '../lib/authMiddleware';
import { getProfessional, listProfessionals } from '../professionals/registry';
import { runProfessionalChat, type ProfessionalTurn } from '../professionals/engine';
import { buildDocumentContext, isVisionAttachment, type RawAttachment } from '../lib/attachmentText';
import { detectImageIntent, imageGenGuidance } from '../lib/imageIntent';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { sendSafeError } from '../lib/httpError';
import {
  professionalPaidEnabled, professionalFreeDailyLimit, professionalPassPriceInr,
  professionalPassDays, isProfessionalFreeUser,
} from '../professionals/professionalPaid';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import { professionalUsageStore } from '../professionals/ProfessionalUsageStore';
import { gateProfessionalTurn } from '../professionals/passGate';

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
 * same server-side pattern Pro v5.0 uses, so every professional reads every
 * supported format without a per-professional integration.
 */
export function registerProfessionalsRoutes(app: Express): void {
  app.get('/api/professionals', (_req: Request, res: Response) => {
    res.json({ professionals: listProfessionals() });
  });

  // Professional Pass status for the CURRENT user — the UI uses this to show "X/limit free today",
  // an active-pass badge, or the paywall + price. Reflects the same gate the chat route enforces.
  app.get('/api/professional/pass/status', async (req: Request, res: Response) => {
    const identity = await verifyFirebaseIdentity(req);
    const uid = identity?.uid || null;
    const enabled = professionalPaidEnabled();
    const freeDailyLimit = professionalFreeDailyLimit();
    const priceInr = professionalPassPriceInr();
    const passDays = professionalPassDays();
    if (!uid) {
      // Anonymous: with the gate on, login is required (no free quota without an account to key it).
      res.json({ enabled, signedIn: false, unlimited: false, hasPass: false, freeDailyLimit, usedToday: 0, remainingFree: 0, priceInr, passDays });
      return;
    }
    const freeListed = isProfessionalFreeUser(uid, identity?.email || null);
    const pass = enabled ? await professionalPassStore.getStatus(uid) : { active: false, expiresAt: null, plan: null };
    const unlimited = !enabled || freeListed || pass.active;
    const usedToday = unlimited ? 0 : await professionalUsageStore.getTodayCount(uid);
    res.json({
      enabled, signedIn: true, freeListed,
      hasPass: pass.active, passExpiresAt: pass.expiresAt, plan: pass.plan,
      unlimited,
      freeDailyLimit, usedToday, remainingFree: Math.max(0, freeDailyLimit - usedToday),
      priceInr, passDays,
    });
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

    // IMAGE-GENERATION INTENT (admin 2026-08-02): a Professional (Teacher, Lawyer, …) does not generate
    // images — when the user asks it to CREATE one, point them to the dedicated AI Image Gen tool instead of
    // an unhelpful refusal. Uses the RAW user message (not the doc-augmented one), and skips when a real
    // image is attached (that is a vision/analysis request, not generation). No free message is burned.
    if (typeof message === 'string' && !rawAttachments.some((a) => isVisionAttachment(a.type, a.name)) && detectImageIntent(message).wants) {
      res.json({ reply: imageGenGuidance(), professionalId: config.id });
      return;
    }

    try {
      const reply = await runProfessionalChat(config, effectiveMessage, turns, verifiedUserId || undefined, gate.tier);
      // Only a genuinely-answered FREE turn burns a daily message (never on a paywall block or an error).
      if (gate.countsAgainstFree && verifiedUserId) {
        void professionalUsageStore.increment(verifiedUserId);
      }
      res.json({ reply, professionalId: config.id });
    } catch (err: any) {
      sendSafeError(res, 503, 'The assistant is busy. Please try again.', err, 'professional chat');
    }
  });
}

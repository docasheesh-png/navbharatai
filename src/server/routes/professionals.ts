import type { Express, Request, Response } from 'express';
import { buildRateLimiter, verifyFirebaseIdentity, enforceNotBanned } from '../lib/authMiddleware';
import { getProfessional, listProfessionals } from '../professionals/registry';
import { runProfessionalChatWithUsage, type ProfessionalTurn } from '../professionals/engine';
import { chargeForAiTurn } from '../lib/aiTurnCharge';
import { usdInrRate } from '../lib/UsdInrRate';
import { getServerDb } from '../lib/serverDb';
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
// ATTACHMENT RECALL (admin 2026-08-19) — the sibling of Doctor AI's report memory: a file's
// vision-derived text is remembered for this conversation so the NEXT turn can still answer from it.
import {
  AttachmentRecallStore, referencesEarlierAttachment, buildRecallBlock,
} from '../lib/clinical/attachmentRecall';

/** Max attachments accepted per turn (defense against oversized payload loops). */
const MAX_PROFESSIONAL_ATTACHMENTS = 4;

// What each conversation's attachments SAID, so a follow-up ("us report me kya likha tha?") is not
// answered blind. Text only — the description was already paid for on the turn that produced it.
const professionalRecall = new AttachmentRecallStore();
setInterval(() => professionalRecall.sweep(Date.now()), 60 * 60 * 1000);

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
    /** What this turn's attachments said — remembered below so a LATER turn can still answer from it. */
    let attachmentBlock = '';
    if (rawAttachments.length > 0) {
      const parts: string[] = [];
      try {
        const docBlock = await buildDocumentContext(rawAttachments);
        if (docBlock) parts.push(docBlock);
      } catch { /* best-effort — a bad document never blocks the turn */ }
      try {
        if (rawAttachments.some((a) => isVisionAttachment(a.type, a.name))) {
          // Read the picture FOR THIS EXPERT. Without config.visionInstruction the describer's default
          // opens "You are reading an uploaded file for a software engineer" — so a palm sent to the
          // Astrologer, or a diseased leaf sent to Kisan AI, came back described as an app screenshot
          // and the expert never received what its own field needs. A professional that declares an
          // instruction gets its own; every other professional is unchanged.
          const visionBlock = await describeVisionAttachments(rawAttachments, {
            ...(config.visionInstruction ? { instruction: config.visionInstruction } : {}),
          });
          if (visionBlock) parts.push(visionBlock);
        }
      } catch { /* best-effort — a bad image never blocks the turn */ }
      if (parts.length > 0) {
        attachmentBlock = parts.join('\n\n');
        effectiveMessage = `${attachmentBlock}\n\n---\n${effectiveMessage || 'Please review the attached file(s) above and respond.'}`;
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

    // ── ATTACHMENT RECALL ────────────────────────────────────────────────────────────────────────
    // Keyed by the VERIFIED user + this professional, so one person's file can never surface in
    // someone else's conversation, and a signed-out caller (no key) simply gets today's behaviour.
    const recallKey = verifiedUserId ? `${verifiedUserId}:${config.id}` : '';
    if (recallKey) {
      if (attachmentBlock) {
        professionalRecall.remember(recallKey, attachmentBlock, Date.now());
      } else if (rawAttachments.length === 0 && typeof message === 'string' && referencesEarlierAttachment(message)) {
        // No file this turn, but the user is asking about one they sent earlier — hand back what we
        // read from it rather than answering blind. Costs nothing: the text already exists.
        const block = buildRecallBlock(professionalRecall.recall(recallKey, Date.now()));
        if (block) effectiveMessage = `${block}\n\n---\n${effectiveMessage}`;
      }
    }

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
      const { reply, spend } = await runProfessionalChatWithUsage(config, effectiveMessage, turns, verifiedUserId || undefined, gate.tier);
      // Only a genuinely-answered FREE turn burns a daily message (never on a paywall block or an error).
      if (gate.countsAgainstFree && verifiedUserId) {
        void professionalUsageStore.increment(verifiedUserId);
      }
      // ONE WALLET: charge the same balance a build spends, for what this answer really cost. Deliberately
      // AFTER the answer exists and never awaited into the response — a money-path problem must not cost
      // the user their reply, and charging before answering would risk billing a turn that then failed.
      // Entirely inert while AI_WALLET_SPEND is off (the default), and never charges an unmeasured turn.
      void chargeForAiTurn(
        getServerDb() as any,
        { userId: verifiedUserId, isFreeListed: gate.isFreeListed, hasActivePass: gate.hasActivePass },
        spend,
        usdInrRate(),
        Date.now(),
      );
      res.json({ reply, professionalId: config.id });
    } catch (err: any) {
      sendSafeError(res, 503, 'The assistant is busy. Please try again.', err, 'professional chat');
    }
  });
}

import type { Express, Request, Response } from 'express';
import { inAiSpendZone } from '../lib/aiSpendZone';
import { callProfessionalAI } from '../lib/professionalRouting';
import { workspaceRateLimiter, verifyFirebaseIdentity } from '../lib/authMiddleware';
import { validateBody, vobject, vstring } from '../lib/validate';
import { gateToolAction, burnToolAction, chargeToolAction } from '../tools/toolGate';
import {
  buildDebugSystemPrompt, buildDebugUserPrompt, parseDebugResponse, isValidDebugRequest,
} from '../lib/debugAnalysis';

/**
 * AI Debugger — the REAL /api/debug route (admin autopsy 2026-07-20).
 *
 * POST /api/debug
 *   body: { error, code?, errorType? }
 *   → DebugResult { rootCause, fix, explanation[], prevention[] }
 *
 * The AI Tools → AI Debugger tile shipped calling this route while it did NOT exist — and the
 * client masked every failure with a canned fake "analysis". This is the real implementation:
 * the FREE-namespace AI chain (per the Model Routing Policy the free universe never reaches
 * Claude) analyzes the error with a NavBharatAI-branded, white-label system prompt. Failures are
 * returned as honest 5xx errors — the client now shows them instead of faking a result.
 */
const ROUTE_TIMEOUT_MS = 90_000;

const schema = vobject({
  error: vstring({ max: 20_000 }),
  code: vstring({ optional: true, max: 60_000 }),
  errorType: vstring({ optional: true, max: 100 }),
});

export function registerDebugRoutes(app: Express): void {
  app.post('/api/debug', workspaceRateLimiter(), validateBody(schema), inAiSpendZone(async (req: Request, res: Response) => {
    if (!isValidDebugRequest(req.body)) {
      res.status(400).json({ error: 'A non-empty "error" text is required.' });
      return;
    }
    // Daily allowance / Professional Pass (flag-off = no-op).
    const identity = await verifyFirebaseIdentity(req);
    const gate = await gateToolAction(identity?.uid || null, identity?.email || null, 'ai_tool');
    if (!gate.allow) {
      res.status(gate.status).json(gate.body);
      return;
    }
    const { error, code, errorType } = req.body;
    try {
      // Same AI engine as Professional AI (admin 2026-07-24): professional-free chain, honest failures.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('debug-analysis timeout')), ROUTE_TIMEOUT_MS));
      const content = await Promise.race([
        callProfessionalAI(buildDebugSystemPrompt(), buildDebugUserPrompt(error, code, errorType), 'free'),
        timeout,
      ]);
      if (!content.trim()) {
        // No fabricated analysis, ever — an empty model reply is reported as the failure it is.
        res.status(502).json({ error: 'The AI analysis came back empty — please try again.' });
        return;
      }
      // Only a genuinely-answered analysis spends an allowance.
      if (gate.countsAgainstFree) burnToolAction(gate.uid, 'ai_tool');
      chargeToolAction(gate); // ONE WALLET — bills every model call this action made (aiSpendZone)
      res.json(parseDebugResponse(content));
    } catch {
      // White-label honest failure: no provider names, no fake result.
      res.status(503).json({ error: 'NavBharatAI\'s engine is briefly busy — please try again in a minute.' });
    }
  }));
}

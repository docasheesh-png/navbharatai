// P-DESIGN.5 — AI design pass endpoints (real multi-model AI, FREE router).
//
// POST /api/design/suggest  { code? }   → { suggestions: DesignSuggestion[] }
// POST /api/design/palette  { brand }   → { palette: DesignPalette | null }
//
// Stateless, no secrets, no persistence. Uses the FREE router (Vertex/Gemini/Grok) — never Claude —
// so design suggestions never spend build-grade credit. Honest: returns [] / null when the model
// gives nothing usable; never fakes a result.

import type { Express, Request, Response } from 'express';
import { inAiSpendZone } from '../lib/aiSpendZone';
import { callProfessionalAI } from '../lib/professionalRouting';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { gateToolAction, burnToolAction, chargeToolAction } from '../tools/toolGate';
import { aiSuggestions, aiPalette, type RouteFn } from '../AgentV3/DesignAdvisor';
import { lintDesign } from '../AppMakerLab/intelligence/DesignLinter';
import { lintA11y } from '../AppMakerLab/intelligence/A11yLinter';

const MAX_CODE = 12_000;
const MAX_BRAND = 600;

export function registerDesignRoutes(app: Express): void {
  // Same AI engine as Professional AI (admin 2026-07-24) — adapt the string helper to the RouteFn shape.
  const routeFn: RouteFn = async (prompt, system) => ({ response: { content: await callProfessionalAI(system ?? '', prompt ?? '', 'free') } });

  // Context-aware AI improvement suggestions for the current app.
  app.post('/api/design/suggest', inAiSpendZone(async (req: Request, res: Response) => {
    // Daily allowance / Professional Pass (flag-off = no-op).
    const identity = await verifyFirebaseIdentity(req);
    const gate = await gateToolAction(identity?.uid || null, identity?.email || null, 'ai_tool');
    if (!gate.allow) {
      res.status(gate.status).json(gate.body);
      return;
    }
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, MAX_CODE) : '';
      const suggestions = await aiSuggestions(code, routeFn);
      // An empty result is the honest "nothing to say" path below, so only a real answer is charged.
      if (suggestions.length && gate.countsAgainstFree) burnToolAction(gate.uid, 'ai_tool');
      if (suggestions.length) chargeToolAction(gate); // ONE WALLET — only a real result is charged
      res.json({ suggestions });
    } catch {
      // Honest empty result — the client falls back to its static suggestions.
      res.json({ suggestions: [] });
    }
  }));

  // AI colour palette + type scale from a brand/description.
  app.post('/api/design/palette', inAiSpendZone(async (req: Request, res: Response) => {
    const brand = typeof req.body?.brand === 'string' ? req.body.brand.trim().slice(0, MAX_BRAND) : '';
    if (!brand) {
      res.status(400).json({ error: 'provide { brand: "<description of the brand/vibe>" }' });
      return;
    }
    const paletteIdentity = await verifyFirebaseIdentity(req);
    const paletteGate = await gateToolAction(paletteIdentity?.uid || null, paletteIdentity?.email || null, 'ai_tool');
    if (!paletteGate.allow) {
      res.status(paletteGate.status).json(paletteGate.body);
      return;
    }
    try {
      const palette = await aiPalette(brand, routeFn);
      if (palette && paletteGate.countsAgainstFree) burnToolAction(paletteGate.uid, 'ai_tool');
      if (palette) chargeToolAction(paletteGate); // ONE WALLET — only a real result is charged
      res.json({ palette });
    } catch {
      res.json({ palette: null });
    }
  }));

  // P-DESIGN.8 — deterministic design-consistency lint (no AI, no credit spend). Scores the current
  // app's code for colour/font/spacing consistency and returns concrete, actionable violations.
  app.post('/api/design/lint', (req: Request, res: Response) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, MAX_CODE) : '';
    if (!code) {
      res.status(400).json({ error: 'provide { code: "<app source>" }' });
      return;
    }
    res.json(lintDesign(code));
  });

  // P-TQA.11 (builder-side) — deterministic WCAG accessibility lint (no AI, no credit spend). Flags
  // missing alt text, unlabelled form fields, unnamed controls, missing lang, positive tabindex.
  app.post('/api/design/a11y', (req: Request, res: Response) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, MAX_CODE) : '';
    if (!code) {
      res.status(400).json({ error: 'provide { code: "<app source>" }' });
      return;
    }
    res.json(lintA11y(code));
  });
}

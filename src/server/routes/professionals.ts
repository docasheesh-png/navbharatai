import type { Express, Request, Response } from 'express';
import { buildRateLimiter } from '../lib/authMiddleware';
import { getProfessional, listProfessionals } from '../professionals/registry';
import { runProfessionalChat, type ProfessionalTurn } from '../professionals/engine';

/**
 * Generic config-driven professional chat (Teacher, and future Lawyer/CA/etc.).
 *  - GET  /api/professionals          — list available config-driven professionals
 *  - POST /api/professional/:id/chat  — one chat turn for that professional
 */
export function registerProfessionalsRoutes(app: Express): void {
  app.get('/api/professionals', (_req: Request, res: Response) => {
    res.json({ professionals: listProfessionals() });
  });

  app.post('/api/professional/:id/chat', buildRateLimiter(), async (req: Request, res: Response) => {
    const config = getProfessional(req.params.id);
    if (!config) {
      res.status(404).json({ error: `Unknown professional: ${req.params.id}` });
      return;
    }
    const { message, history } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }
    const turns: ProfessionalTurn[] = Array.isArray(history)
      ? history
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : [];
    try {
      const reply = await runProfessionalChat(config, message.trim(), turns);
      res.json({ reply, professionalId: config.id });
    } catch (err: any) {
      res.status(503).json({ error: err?.message || 'The assistant is busy. Please try again.' });
    }
  });
}

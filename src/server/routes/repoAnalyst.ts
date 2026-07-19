import type { Express, Request, Response } from 'express';
import { buildRateLimiter, enforceNotBanned } from '../lib/authMiddleware';
import { runRepoAnalystChat, type AnalystTurn } from '../repoAnalyst/analyst';
import { runRepoImprovementGen } from '../repoAnalyst/generate';
import { sendSafeError } from '../lib/httpError';

/**
 * GitHub Repo Analyst & Improver route.
 *  - POST /api/repo-analyst/chat — one analysis turn. If the message (or recent
 *    history) references a public GitHub repo, the server fetches it read-only
 *    and analyses the real content. An optional GitHub token from the
 *    Authorization header is used only to raise rate limits / read accessible
 *    repos; the feature works fully on public repos without one.
 */
export function registerRepoAnalystRoutes(app: Express): void {
  app.post('/api/repo-analyst/chat', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    const { message, history } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }
    const token = req.headers.authorization?.split(' ')[1];
    const turns: AnalystTurn[] = Array.isArray(history)
      ? history
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : [];
    try {
      const reply = await runRepoAnalystChat(message.trim(), turns, token);
      res.json({ reply, professionalId: 'repo_analyst' });
    } catch (err: any) {
      sendSafeError(res, 503, 'The analyst is busy. Please try again.', err, 'repo analyst chat');
    }
  });

  // "Improver" — generate concrete improvement files for the referenced repo.
  app.post('/api/repo-analyst/generate', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    const { message, history } = req.body || {};
    const token = req.headers.authorization?.split(' ')[1];
    const turns: AnalystTurn[] = Array.isArray(history)
      ? history
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : [];
    try {
      const result = await runRepoImprovementGen(typeof message === 'string' ? message.trim() : '', turns, token);
      res.json({ ...result, professionalId: 'repo_analyst' });
    } catch (err: any) {
      sendSafeError(res, 503, 'The analyst is busy. Please try again.', err, 'repo analyst generate');
    }
  });
}

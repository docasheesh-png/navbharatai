import { freeModuleInferenceScope } from '../AI/inferencePolicy';
import type { Express, Request, Response } from 'express';
import { buildRateLimiter, enforceNotBanned } from '../lib/authMiddleware';
import { runRepoAnalystChat, type AnalystTurn } from '../repoAnalyst/analyst';
import { runRepoImprovementGen } from '../repoAnalyst/generate';
import { sendSafeError } from '../lib/httpError';
import { guestDailyQuota } from '../lib/guestDailyQuota';
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
import { strictFreeRequired } from '../AI/inferencePolicy';
import { inferenceGatewayEnabled, runWithAuthenticatedInferenceGatewayRequest, runWithInferenceGatewayContext, runWithInferenceGatewayEntryAdmission } from '../AI/InferenceGateway/runtime';
import { onClientGone } from '../lib/clientDisconnect';

/** This route is a Free Mode, not the developer API or the Pro app builder. */
async function withRepoAnalystGateway<T>(req: Request, res: Response, operation: 'chat' | 'generate', run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!inferenceGatewayEnabled('professional')) return run();
  const deadlineAtMs = Date.now() + 90_000;
  const controller = new AbortController();
  onClientGone(res, () => controller.abort());
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAtMs - Date.now()));
  try {
    return await runWithAuthenticatedInferenceGatewayRequest(req, uid => runWithInferenceGatewayContext({
      principalId: uid ?? 'unauthenticated', tenantId: uid ?? 'unauthenticated', surface: 'professional',
      policyKey: `mode:repo-analyst:${operation}`, qualityTier: 'professional', dataClass: 'confidential',
      funding: 'platform-free-fallback', mode: strictFreeRequired() ? 'strict-free' : 'free-first-authorized-paid',
      deadlineAtMs, signal: controller.signal,
    }, () => runWithInferenceGatewayEntryAdmission(() => run(controller.signal))));
  } finally { clearTimeout(timer); }
}

/**
 * GitHub Repo Analyst & Improver route.
 *  - POST /api/repo-analyst/chat — one analysis turn. If the message (or recent
 *    history) references a public GitHub repo, the server fetches it read-only
 *    and analyses the real content. An optional GitHub token from the
 *    Authorization header is used only to raise rate limits / read accessible
 *    repos; the feature works fully on public repos without one.
 */
export function registerRepoAnalystRoutes(app: Express): void {
  app.post('/api/repo-analyst/chat', freeModuleInferenceScope, buildRateLimiter(), enforceNotBanned(), guestDailyQuota('repo-analyst'), async (req: Request, res: Response) => {
    const { message, history } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }
    // A GitHub token only — never the caller's Firebase session token, which this used to forward to
    // api.github.com (forensic audit 2026-10-04). The shared reader refuses a JWT-shaped value.
    const token = githubTokenFromRequest(req) ?? undefined;
    const turns: AnalystTurn[] = Array.isArray(history)
      ? history
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : [];
    try {
      const reply = await withRepoAnalystGateway(req, res, 'chat', signal => signal
        ? runRepoAnalystChat(message.trim(), turns, token, { signal }) : runRepoAnalystChat(message.trim(), turns, token));
      if (res.destroyed || res.writableEnded) return;
      res.json({ reply, professionalId: 'repo_analyst' });
    } catch (err: any) {
      if (res.destroyed || res.writableEnded) return;
      sendSafeError(res, 503, 'The analyst is busy. Please try again.', err, 'repo analyst chat');
    }
  });

  // "Improver" — generate concrete improvement files for the referenced repo.
  app.post('/api/repo-analyst/generate', freeModuleInferenceScope, buildRateLimiter(), enforceNotBanned(), guestDailyQuota('repo-analyst'), async (req: Request, res: Response) => {
    const { message, history } = req.body || {};
    // A GitHub token only — never the caller's Firebase session token, which this used to forward to
    // api.github.com (forensic audit 2026-10-04). The shared reader refuses a JWT-shaped value.
    const token = githubTokenFromRequest(req) ?? undefined;
    const turns: AnalystTurn[] = Array.isArray(history)
      ? history
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : [];
    try {
      const input = typeof message === 'string' ? message.trim() : '';
      const result = await withRepoAnalystGateway(req, res, 'generate', signal => signal
        ? runRepoImprovementGen(input, turns, token, { signal }) : runRepoImprovementGen(input, turns, token));
      if (res.destroyed || res.writableEnded) return;
      res.json({ ...result, professionalId: 'repo_analyst' });
    } catch (err: any) {
      if (res.destroyed || res.writableEnded) return;
      sendSafeError(res, 503, 'The analyst is busy. Please try again.', err, 'repo analyst generate');
    }
  });
}

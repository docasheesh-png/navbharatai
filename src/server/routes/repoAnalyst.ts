import { withFreeAnswerQuota, markFreeAnswer, markFreeAnswerProviderFailure, freeAnswerSignal, assertFreeAnswerActive } from '../lib/freeAnswerQuota';
import { freeModuleInferenceScope } from '../AI/inferencePolicy';
import type { Express, Request, Response } from 'express';
import { buildRateLimiter, enforceNotBanned, verifyFirebaseIdentity } from '../lib/authMiddleware';
import { runRepoAnalystChat, type AnalystTurn } from '../repoAnalyst/analyst';
import { runRepoImprovementGen } from '../repoAnalyst/generate';
import { sendSafeError } from '../lib/httpError';
import { guestDailyQuota } from '../lib/guestDailyQuota';
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
import { strictFreeRequired } from '../AI/inferencePolicy';
import { inferenceGatewayEnabled, isGatewayRouteSelected, runWithAuthenticatedInferenceGatewayRequest, runWithInferenceGatewayContext, runWithInferenceGatewayEntryAdmission } from '../AI/InferenceGateway/runtime';
import { onClientGone } from '../lib/clientDisconnect';

/** This route is a Free Mode, not the developer API or the Pro app builder. */
async function withRepoAnalystGateway<T>(req: Request, res: Response, operation: 'chat' | 'generate', run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  const quotaSignal = freeAnswerSignal(req);
  if (!inferenceGatewayEnabled('professional')) return run(quotaSignal);
  const deadlineAtMs = Date.now() + 90_000;
  const controller = new AbortController();
  onClientGone(res, () => controller.abort());
  const signal = quotaSignal ? AbortSignal.any([controller.signal, quotaSignal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAtMs - Date.now()));
  try {
    return await runWithAuthenticatedInferenceGatewayRequest(req, uid => runWithInferenceGatewayContext({
      principalId: uid ?? 'unauthenticated', tenantId: uid ?? 'unauthenticated', surface: 'professional',
      policyKey: `mode:repo-analyst:${operation}`, qualityTier: 'professional', dataClass: 'confidential',
      funding: 'platform-free-fallback', mode: strictFreeRequired() ? 'strict-free' : 'free-first-authorized-paid',
      deadlineAtMs, signal,
    }, () => isGatewayRouteSelected() ? runWithInferenceGatewayEntryAdmission(() => run(signal)) : run(quotaSignal)));
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
    const uid = (await verifyFirebaseIdentity(req))?.uid ?? null;
    const dispatch = async () => {
    try {
      if (uid) assertFreeAnswerActive(req);
      const reply = await withRepoAnalystGateway(req, res, 'chat', signal => runRepoAnalystChat(message.trim(), turns, token, { signal, ...(uid ? { beforeGeneration: () => assertFreeAnswerActive(req), onAnswer: () => markFreeAnswer(req) } : {}) }));
      if (res.destroyed || res.writableEnded) return;
      if (uid) assertFreeAnswerActive(req);
      res.json({ reply, professionalId: 'repo_analyst' });
    } catch (err: any) {
      if (uid && !freeAnswerSignal(req)?.aborted) markFreeAnswerProviderFailure(req);
      if (res.destroyed || res.writableEnded) return;
      sendSafeError(res, 503, 'The analyst is busy. Please try again.', err, 'repo analyst chat');
    }
    };
    if (uid) return withFreeAnswerQuota(req, res, dispatch, { uid });
    return dispatch();
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
    const uid = (await verifyFirebaseIdentity(req))?.uid ?? null;
    const dispatch = async () => {
    try {
      if (uid) assertFreeAnswerActive(req);
      const input = typeof message === 'string' ? message.trim() : '';
      const result = await withRepoAnalystGateway(req, res, 'generate', signal => runRepoImprovementGen(input, turns, token, { signal, ...(uid ? { beforeGeneration: () => assertFreeAnswerActive(req), onAnswer: () => markFreeAnswer(req) } : {}) }));
      if (res.destroyed || res.writableEnded) return;
      if (uid) assertFreeAnswerActive(req);
      res.json({ ...result, professionalId: 'repo_analyst' });
    } catch (err: any) {
      if (uid && !freeAnswerSignal(req)?.aborted) markFreeAnswerProviderFailure(req);
      if (res.destroyed || res.writableEnded) return;
      sendSafeError(res, 503, 'The analyst is busy. Please try again.', err, 'repo analyst generate');
    }
    };
    if (uid) return withFreeAnswerQuota(req, res, dispatch, { uid });
    return dispatch();
  });
}

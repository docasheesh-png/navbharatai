import path from 'path';
import { setCorsHeaders } from '../lib/cors';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { Express, Request, Response } from 'express';
import { sendSafeError } from '../lib/httpError';
import { buildApp as buildAppEngine, editApp as editAppEngine, buildReactApp as buildReactAppEngine } from '../AppMakerLab/AppEngine';
import { aiRouter } from '../lib/aiRouter';
import { AppContextInjector } from '../AppContext/AppContextInjector';
import { CREATOR_IDENTITY } from '../lib/prompts';
import { VirtualFileSystem } from '../project/ProjectModel';
import { reviewCode, formatReviewReport } from '../pro/ProCodeReview';
import { deployVercel, deployNetlify, deployGitHubPages, deployCloudflarePages } from '../pro/ProDeploy';
import { buildDocumentContext } from '../lib/attachmentText';
import { claudeVisionAnswerModel, grokVisionModels, geminiVisionModels } from '../lib/visionModels';

/**
 * Pro engine routes extracted from the server.ts monolith (Phase 1, AI-core step d).
 * Hosts the Pro chat + Pro build pipeline and the proxy-aware callClaudePro helper.
 * Behavior unchanged. Delegates model routing to the shared aiRouter and app
 * generation/editing to AppMakerLab/AppEngine.
 */
/**
 * Strip a single wrapping markdown code fence from AI-generated file content.
 * Models frequently wrap whole-file output in ```lang ... ``` despite instructions; a leaked
 * fence at the top of a .tsx/.ts source file is a hard syntax error that breaks the build.
 * Only strips when BOTH a leading fence line and trailing fence exist (never corrupts code
 * that legitimately contains backticks).
 */
function stripFileFences(s: string): string {
  if (!s) return s;
  let t = s.trim();
  const leading = /^```[a-zA-Z0-9_+-]*[ \t]*\r?\n?/;
  const trailing = /\r?\n?```[ \t]*$/;
  if (leading.test(t) && trailing.test(t)) {
    t = t.replace(leading, '').replace(trailing, '').trim();
  }
  return t;
}

/**
 * SECURITY MASTER PLAN Phase 1.1 (admin-approved 2026-07-07) — the legacy Pro v2 chat/build routes
 * (`/api/pro-chat`, `/api/pro-build`) are RETIRED. They were superseded by NavBharatAI Pro v5.0
 * (AgentV3) and have NO client caller (verified: zero `fetch('/api/pro-chat'|'/api/pro-build')` in
 * the app). They were also UNAUTHENTICATED and spent NavBharatAI's OWN model budget on every call
 * (`aiRouter.route(..., 'navbharat', ...)`), so any anonymous request could burn the platform's
 * account — a real money-bleed surface. Disabled here with an honest 410 Gone (route still
 * registered so path-based rate-limit config stays valid); the old handler bodies are left in place
 * below as unreachable dead code, to be removed in a later cleanup, keeping this security PR small
 * and trivially reversible.
 */
const PRO_V2_RETIRED = {
  error: 'This endpoint has been retired. NavBharatAI Pro v5.0 replaces the Pro v2 builder.',
  code: 'gone',
} as const;

export function registerProRoutes(app: Express): void {
  async function callClaudePro(
    apiKey: string,
    systemPrompt: string,
    msgs: { role: 'user' | 'assistant'; content: any }[],
    maxTokens: number,
  ): Promise<string> {
    // Try Claude directly (native Anthropic SDK, x-api-key) when a key is set.
    // The aicredits OpenAI-proxy path has been removed.
    if (apiKey) {
      try {
        const A = (await import('@anthropic-ai/sdk')).default;
        const r = await new A({ apiKey }).messages.create({
          model: claudeVisionAnswerModel(), max_tokens: maxTokens,
          system: systemPrompt, messages: msgs,
        });
        const text = (r.content.find((c: any) => c.type === 'text') as any)?.text;
        if (text) return text;
      } catch (e: any) {
        console.warn('[PRO] Claude path failed, falling back to aiRouter:', e?.message || e);
      }
    }

    // Resilient fallback: the shared multi-provider aiRouter (works in prod even
    // when no Claude key/proxy is set). This stops every Pro chat/build call from
    // collapsing to a canned greeting when Anthropic is unavailable.
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    const userMsg = typeof lastUser?.content === 'string'
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser!.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('\n')
        : '';
    return await aiRouter.route(userMsg, [], 'navbharat', undefined, systemPrompt);
  }

  app.post('/api/pro-chat', async (_req: Request, res: Response) => {
    // RETIRED (Phase 1.1) — was unauthenticated and spent NavBharatAI's own model budget on every
    // call; no client uses it (superseded by NavBharatAI Pro v5.0). Honest 410 Gone, no model touched.
    return res.status(410).json(PRO_V2_RETIRED);
  });

  // ══ SSE STREAMING BUILD ENDPOINT — Live progress to frontend ══
  // ── Edit-base bound for the user's existing HTML ────────────────────────────
  // This is the user's OWN app being edited — it must be preserved faithfully. The old
  // version stripped every <script> block and truncated to 18k chars, which destroyed the
  // app's inline JavaScript and any content past the cap on every edit. Apply only a
  // generous length bound (matching the js/css caps below); never mutate the content.
  const sanitizeUserHtml = (html: string): string => html.slice(0, 250000);

  app.post('/api/pro-build', async (_req: Request, res: Response) => {
    // RETIRED (Phase 1.1) — was unauthenticated and spent NavBharatAI's own model budget on every
    // call; no client uses it (superseded by NavBharatAI Pro v5.0). Honest 410 Gone, no model touched.
    return res.status(410).json(PRO_V2_RETIRED);
  });

  // ══ CODE REVIEW ENDPOINT — OWASP security + quality + tech debt analysis ══
  app.post('/api/pro/code-review', async (_req: Request, res: Response) => {
    // RETIRED (SEC Phase 5 re-audit) — this was UNAUTHENTICATED and spent NavBharatAI's OWN paid
    // model budget (`aiRouter.route(..., 'navbharat', ...)`) on every call: the exact money-bleed
    // the sibling /api/pro-chat + /api/pro-build routes were retired for, missed in Phase 1.1. No
    // client calls it (the `/code-review` chat command routes through the v5.0 chat pipeline, not
    // this endpoint). Honest 410 Gone, no model touched.
    return res.status(410).json(PRO_V2_RETIRED);
  });

  // ══ DEPLOY ENDPOINT — Vercel / Netlify / GitHub Pages / Cloudflare Pages ══
  // Body: { provider, token, files, name?, siteId?, owner?, repo?, accountId? }
  app.post('/api/pro/deploy', async (req: Request, res: Response) => {
    try {
      const { provider, token, files, name, siteId, owner, repo, accountId } = req.body as {
        provider: 'vercel' | 'netlify' | 'github' | 'cloudflare';
        token: string;
        files: Record<string, string>;
        name?: string;
        siteId?: string;
        owner?: string;
        repo?: string;
        accountId?: string;
      };

      if (!provider || !token || !files || Object.keys(files).length === 0) {
        return res.status(400).json({ error: 'provider, token, and files are required.' });
      }

      let url: string;
      if (provider === 'vercel') {
        if (!name) return res.status(400).json({ error: 'name required for Vercel deploy.' });
        url = await deployVercel(token, name, files);
      } else if (provider === 'netlify') {
        if (!siteId) return res.status(400).json({ error: 'siteId required for Netlify deploy.' });
        url = await deployNetlify(token, siteId, files);
      } else if (provider === 'github') {
        if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required for GitHub Pages deploy.' });
        url = await deployGitHubPages(token, owner, repo, files);
      } else if (provider === 'cloudflare') {
        if (!accountId || !name) return res.status(400).json({ error: 'accountId and name required for Cloudflare Pages deploy.' });
        url = await deployCloudflarePages(token, accountId, name, files);
      } else {
        return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }

      res.json({ url });
    } catch (err: any) {
      console.error('[PRO/deploy] Error:', err?.message || err);
      sendSafeError(res, 500, 'Deployment failed. Please try again.', err, 'pro deploy');
    }
  });
}

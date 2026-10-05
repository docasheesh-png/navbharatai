// How large a JSON request body may be, and which requests keep their raw bytes (Q-627, forensic audit
// 2026-10-04).
//
// 🔴 WHAT THIS REPLACED. `server.ts` mounted ONE `express.json({ limit: '30mb' })` for every route, and
// its `verify` hook kept a copy of every body as `req.rawBody`. So any caller — signed in or not — could
// send 30 MB to `/api/auth/send-otp` or `/api/profile/budget`, and the server held it twice (the parsed
// object and the raw Buffer) before a single line of the route ran. The 30 MB was sized for chat
// attachments; nothing else ever needed it.
//
// THE RULE NOW:
//  • every JSON body is limited to DEFAULT_JSON_LIMIT (1 MB);
//  • a route on LARGE_BODY_ROUTES gets LARGE_JSON_LIMIT (30 MB — the old value, unchanged for them);
//  • `req.rawBody` is kept ONLY on RAW_BODY_ROUTES — the two webhooks that check an HMAC over the exact
//    bytes the provider sent, and the preview reverse proxy, which forwards a previewed app's request
//    byte for byte.
//
// 🔒 A route that receives a big body and is NOT on the list would answer 413 in production. So the list
// is locked by a census — tests/aRequestBodyIsOnlyAsLargeAsItsRouteNeeds.test.ts — that reads every route
// registration in the server and fails when one reads a payload-shaped field (`files`, `attachments`,
// `image`, `base64`, `dataUrl`, `zip`, `html`, `code`, `history`, …) or hands the whole body to a helper
// without being on this list or on the census's reviewed-small list (each entry with its evidence).
// A new route that carries a big body therefore cannot ship by accident at 1 MB.
//
// And if one is still missed, it is SEEN: a body over the limit gets an honest 413 with a plain sentence
// (not the generic 500 the global error handler would have given it), and `onTooLarge` reports it to the
// admin Errors view with its path, so the route can be added the same day.

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rewriteVersionedPath } from '../routes/apiVersion';

/** Every JSON body not on LARGE_BODY_ROUTES. Normal routes receive ids, settings and short text. */
export const DEFAULT_JSON_LIMIT = '1mb';

/**
 * The large-body routes' limit — the value the global parser had before, so none of them changes.
 * It sits under Cloud Run's 32 MB request cap; the client's own attachment guard
 * (src/lib/attachmentLimits.ts: 18 MB per file, 22 MB per message, ×1.33 for base64) is sized to it.
 */
export const LARGE_JSON_LIMIT = '30mb';

export interface BodyRoute {
  /** The route's registration path exactly as written in `app.post(...)` (Express syntax). */
  readonly path: string;
  /** The evidence: what big field it reads, and which screen sends it. */
  readonly why: string;
}

/**
 * Routes whose JSON body may be larger than DEFAULT_JSON_LIMIT. Matched by path, any method.
 * Each entry names the field and the caller that sends it, so a reader can check it.
 * "Doubt" entries are on the list on purpose: the one absolute rule says a route that might need it
 * keeps it.
 */
export const LARGE_BODY_ROUTES: readonly BodyRoute[] = [
  // ── Build and chat with attachments ──────────────────────────────────────────────────────────────
  { path: '/api/agentv3/chat', why: '`attachments` — images, PDFs and ZIPs as base64 with the build prompt (useAgentV3Build.ts; client guard attachmentLimits.ts, 22 MB raw)' },
  { path: '/api/agentv3/import-files', why: '`files` — folder and ZIP import batches (App.tsx, masterZipImport.ts)' },
  { path: '/api/chat/navbharat', why: '`fileAttachments` (base64) and `history` (useChatEngine.ts)' },
  { path: '/api/chat/navbharatai', why: '`fileAttachments` (base64) and `history` (useChatEngine.ts, BotBuildHelp.tsx)' },
  { path: '/api/professional/:id/chat', why: '`fileAttachments` (base64) and `history` (ProfessionalChat.tsx)' },
  { path: '/api/sda-chat', why: '`fileData` — a medical document as base64 (SDAChat.tsx)' },
  { path: '/api/repo-analyst/chat', why: '`history` of the analysis conversation (RepoAnalystTool.tsx)' },
  { path: '/api/repo-analyst/generate', why: '`history` of the analysis conversation (RepoAnalystTool.tsx)' },
  { path: '/api/mobile-ship/autofix', why: '`history` of the store-build repair turns (StoreBuildPanel.tsx)' },

  // ── Images ───────────────────────────────────────────────────────────────────────────────────────
  { path: '/api/image/generate', why: '`initImage` — image-to-image source as a data URL (AIImageGenerator.tsx)' },
  { path: '/api/screenshot/to-prompt', why: '`image` — a screenshot as base64 (ScreenshotToCode.tsx, AgentV3Panel.tsx)' },
  { path: '/api/report', why: '`screenshot` — a data URL attached to a report (ReportSheet.tsx, ReportAiContent.tsx)' },
  { path: '/api/report/:id/reply', why: '`screenshot` — a data URL in a report reply (ReportSheet.tsx)' },
  { path: '/api/admin/reports/:id/reply', why: '`screenshot` — the route reads a data URL like the user reply does' },
  { path: '/api/profile/photo', why: '`dataUrl` — the profile picture (ProfileEditForm.tsx)' },
  { path: '/api/mobile-ship/setup', why: '`iconDataUrl` — the store app icon (StoreBuildPanel.tsx)' },
  { path: '/api/nav-store/web/publish', why: '`iconDataUrl` and `screenshots` for the store listing (NavAppStore.tsx)' },

  // ── Whole projects (file maps) ───────────────────────────────────────────────────────────────────
  { path: '/api/preview-bundle', why: '`files` — the whole project for the in-browser bundle (usePreviewBundler.ts)' },
  { path: '/api/preview-vue', why: '`files` — the whole project (usePreviewBundler.ts)' },
  { path: '/api/preview', why: '`files` — the whole project' },
  { path: '/preview-app/:sessionId/*splat', why: 'the previewed app\'s OWN requests, forwarded verbatim — its uploads are its business, not ours' },
  { path: '/api/workspace/write', why: '`files` (AppTargetPicker.tsx)' },
  { path: '/api/download-zip', why: '`files` — the project to package (App.tsx)' },
  { path: '/api/github/push', why: '`files` — the project to commit (App.tsx, githubService.ts)' },
  { path: '/api/github/push-enhanced', why: '`files` — the project to commit (AgentV3Panel.tsx, GitPanel.tsx, MonetizationWizard.tsx, CICDPipeline.tsx)' },
  { path: '/api/pro/deploy', why: '`files` — the project to deploy' },
  { path: '/api/gallery/publish', why: '`files` — the project to publish (GalleryPanel.tsx)' },
  { path: '/api/build-history/:sessionId/checkpoint', why: '`files` — a saved version, read up to 5 MB (CodeVersioning.tsx)' },
  { path: '/api/sync/:userId', why: '`sessions` — chat history sync, stored up to 8 MB (App.tsx, sync.ts MAX_WORKSPACE_BYTES)' },
  { path: '/api/pwa/save', why: '`html` — the app\'s whole page' },
  { path: '/api/share', why: '`html` — the generated app to share (ShareForReview.tsx)' },

  // ── Project analysis (ProjectInsightsPanel, Editor, scans) ───────────────────────────────────────
  { path: '/api/workspace/sbom', why: '`packageLock` — a package-lock.json, often over 1 MB (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/hallucination-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/hooks-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/import-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/jsx-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/scale-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/hook-resolution-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/dependency-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/health-check', why: '`files` (ProjectInsightsPanel.tsx)' },
  { path: '/api/workspace/changelog', why: '`files` and `previousFiles`' },
  { path: '/api/workspace/navigate', why: '`files` — every open file, for go-to-definition (Editor.tsx)' },
  { path: '/api/workspace/traceability', why: '`files`' },
  { path: '/api/workspace/explain', why: '`code` — pasted code, no server cap (ProjectInsightsPanel.tsx)' },
  { path: '/api/security/scan', why: '`files` (SecurityScan.tsx)' },
  { path: '/api/app-review/review', why: '`files` (AICodeReview.tsx)' },
  { path: '/api/app-debug/run', why: '`files` / `code` (AppScanPanel.tsx)' },
  { path: '/api/app-debug/investigate', why: '`code` / `source` (AppScanPanel.tsx)' },
  { path: '/api/debug', why: '`code` — the code context of an error, no cap (AIDebugger.tsx)' },
  { path: '/api/minify', why: '`code` — a whole file to minify (CodeMinifier.tsx)' },
  // Doubt: the server keeps the first 12,000 characters, but the client may send a whole stylesheet.
  { path: '/api/design/suggest', why: '`code` — doubt: truncated on the server, may arrive as a whole file' },
  { path: '/api/design/palette', why: '`code` — doubt: truncated on the server, may arrive as a whole file' },
  { path: '/api/design/lint', why: '`code` — doubt: truncated on the server, may arrive as a whole file' },
  { path: '/api/design/a11y', why: '`code` — doubt: truncated on the server, may arrive as a whole file' },

  // ── The user's own data and tools ────────────────────────────────────────────────────────────────
  { path: '/api/integrations/supabase/import', why: '`rows` — a CSV import into the user\'s own database (DatabaseStudio.tsx)' },
  { path: '/api/integrations/supabase/row', why: 'doubt: one row\'s `values` may hold a large text or base64 column (DatabaseStudio.tsx)' },
  { path: '/api/integrations/supabase/query', why: 'doubt: `sql` may be a bulk insert script (DatabaseStudio.tsx)' },
  { path: '/api/team/:teamId/library', why: '`content` — kept to 200,000 characters by the store, so the client may send more (TeamLibraryPanel.tsx)' },
  { path: '/api/devtools/proxy', why: 'doubt: `body` is the user\'s own request to their own API, uploads included (APITester.tsx)' },
  { path: '/api/bots/telegram/connect', why: 'doubt: `flow` — the whole bot-builder graph, no cap (BotBuilder.tsx)' },
  { path: '/api/bots/whatsapp/connect', why: 'doubt: `flow` — the whole bot-builder graph, no cap (BotBuilder.tsx)' },
];

/**
 * Routes that keep the exact request bytes as `req.rawBody`. Nothing else gets them: a second copy of
 * every body was memory spent for three readers.
 */
export const RAW_BODY_ROUTES: readonly BodyRoute[] = [
  { path: '/api/payment/webhook', why: 'Cashfree signs base64(HMAC-SHA256(timestamp + raw body)); a re-serialised body never matches (payment.ts)' },
  { path: '/api/bots/whatsapp/webhook/:botId', why: 'Meta signs X-Hub-Signature-256 = HMAC-SHA256(raw body, app secret) (bots.ts, whatsappSignature.ts)' },
  { path: '/preview-app/:sessionId/*splat', why: 'the preview reverse proxy forwards the previewed app\'s request body byte for byte (preview.ts)' },
];

/** Express path syntax → an anchored, case-insensitive matcher (Express matches paths case-insensitively). */
export function compileRoutePath(path: string): RegExp {
  let out = '';
  for (let i = 0; i < path.length; ) {
    const ch = path[i];
    if (ch === ':' || ch === '*') {
      let j = i + 1;
      while (j < path.length && /\w/.test(path[j])) j++;
      out += ch === ':' ? '[^/]+' : '.+';
      i = j;
      continue;
    }
    out += /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    i++;
  }
  return new RegExp(`^${out}/?$`, 'i');
}

const LARGE_MATCHERS = LARGE_BODY_ROUTES.map((r) => compileRoutePath(r.path));
const RAW_MATCHERS = RAW_BODY_ROUTES.map((r) => compileRoutePath(r.path));

/**
 * The path a route will be matched on. The body parser runs BEFORE apiVersionMiddleware rewrites
 * `/api/v1/...` to `/api/...`, so it applies that same rewrite here — otherwise every versioned call
 * to a large-body route would get the small limit.
 */
export function routingPath(path: string): string {
  const p = String(path || '/').split('?')[0] || '/';
  return rewriteVersionedPath(p) ?? p;
}

export function isLargeBodyRoute(path: string): boolean {
  const p = routingPath(path);
  return LARGE_MATCHERS.some((re) => re.test(p));
}

export function needsRawBody(path: string): boolean {
  const p = routingPath(path);
  return RAW_MATCHERS.some((re) => re.test(p));
}

export interface TooLargeEvent {
  method: string;
  path: string;
  limit: string;
  /** Bytes the client declared (Content-Length), when it did. */
  length?: number;
}

export interface JsonBodyParserOptions {
  /** Called once for every body refused as too large — server.ts sends it to the admin Errors view. */
  onTooLarge?: (event: TooLargeEvent, err: unknown) => void;
}

const keepRawBytes = (req: unknown, _res: unknown, buf: Buffer): void => {
  (req as { rawBody?: Buffer }).rawBody = buf;
};

/**
 * The one global JSON parser. Picks the limit and whether to keep the raw bytes from the request's
 * routing path, then runs a real `express.json` with those settings — so parsing itself is exactly
 * the parser it replaced.
 */
export function jsonBodyParser(opts: JsonBodyParserOptions = {}): RequestHandler {
  const parsers = {
    small: express.json({ limit: DEFAULT_JSON_LIMIT }),
    smallRaw: express.json({ limit: DEFAULT_JSON_LIMIT, verify: keepRawBytes }),
    large: express.json({ limit: LARGE_JSON_LIMIT }),
    largeRaw: express.json({ limit: LARGE_JSON_LIMIT, verify: keepRawBytes }),
  };
  return (req: Request, res: Response, next: NextFunction) => {
    const large = isLargeBodyRoute(req.path);
    const raw = needsRawBody(req.path);
    const parser = large ? (raw ? parsers.largeRaw : parsers.large) : (raw ? parsers.smallRaw : parsers.small);
    parser(req, res, (err?: unknown) => {
      const e = err as { type?: string; status?: number; length?: number; limit?: number } | undefined;
      if (e && (e.type === 'entity.too.large' || e.status === 413)) {
        const limit = large ? LARGE_JSON_LIMIT : DEFAULT_JSON_LIMIT;
        try {
          opts.onTooLarge?.({ method: req.method, path: routingPath(req.path), limit, length: typeof e.length === 'number' ? e.length : undefined }, err);
        } catch { /* reporting must never change the answer */ }
        if (!res.headersSent) {
          res.status(413).json({
            error: `This request is too large (the limit here is ${limit.toUpperCase()}). Please send less at once.`,
            code: 'BODY_TOO_LARGE',
          });
        }
        return;
      }
      next(err as Error | undefined);
    });
  };
}

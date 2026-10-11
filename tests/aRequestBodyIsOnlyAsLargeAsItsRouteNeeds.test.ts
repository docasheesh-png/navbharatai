// Q-627 (forensic audit 2026-10-04): a 30 MB JSON limit was global and every body was also kept as
// `req.rawBody`. Now: 1 MB by default, 30 MB only on LARGE_BODY_ROUTES, raw bytes only on RAW_BODY_ROUTES
// (src/server/lib/requestBodyLimits.ts).
//
// What breaks if this is wrong is a REAL user flow: a route that receives an attachment, an image or a
// whole project and is missing from the list answers 413 in production. So this file is mostly a census:
// it reads every route registration in the server and refuses a route that reads a payload-shaped field
// (or hands the whole body to a helper it cannot see into) unless the route is either on the large list
// or on REVIEWED_SMALL below with the evidence that its body stays small.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_JSON_LIMIT, LARGE_BODY_ROUTES, LARGE_JSON_LIMIT, RAW_BODY_ROUTES, SMALL_BODY_ROUTES,
  compileRoutePath, smallBodyLimit, isLargeBodyRoute, jsonBodyParser, needsRawBody, routingPath,
} from '../src/server/lib/requestBodyLimits';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Routes that read a payload-shaped field name (or pass the body to a helper) but whose body is small,
 * with the evidence. A route lands here only after somebody looked; the census fails on anything that
 * is on neither list.
 */
const REVIEWED_SMALL: Record<string, string> = {
  '/api/admin/mfa/verify': '`code` is a 6-digit TOTP code',
  '/api/gallery/admin/:id/review': '`decision` is one of three words; `note` is cut to 500 characters by readReviewReason (storeReviewReason.ts, Q-681); `reasonContract` is a number',
  '/api/nav-store/admin/review': 'ids, `decision` (three words) and a `note` cut to 500 characters by readReviewReason (Q-681)',
  '/api/nav-store/web/admin/review': 'ids, `decision` (three words) and a `note` cut to 500 characters by readReviewReason (Q-681)',
  '/api/platform-rating': '`stars` is 1–5 and the note is cut to MAX_RATING_COMMENT_CHARS (500) by parseRatingSubmission (#3552)',
  '/api/admin/mfa/disable': '`code` is a 6-digit TOTP code',
  '/api/referral/:userId/redeem': '`code` is a referral code',
  '/api/admin/insights/query': '`question` text; the file-ish names are numeric counts',
  '/api/admin/deploy-risk': '`filesChanged` and friends are numeric counts',
  '/api/admin/incident-analysis': 'admin-only event list; no client in this repo posts to it',
  '/api/admin/update-broadcast/send': '`confirmCount` only',
  '/api/admin/build-discount': '`pct` only',
  '/api/admin/users/:userId/merge': '`fromUserId` only',
  '/api/admin/feature-flags': 'a flag map',
  '/api/admin/announcement': 'an announcement message',
  '/api/admin/promo': 'promo-code fields (parseAdminPromoInput)',
  '/api/admin/site/about': 'the About page text fields',
  '/api/agentv3/conversations/:id/name': '`promptHash` is a hash; `name` is a title',
  '/api/agentv3/report-to-admin': 'ids, `promptHash` and a note (AgentV3Panel.tsx sends nothing else)',
  '/api/agentv3/preview-diagnose': 'ids and flags; `promptHash` is a hash',
  '/api/agentv3/preview-keepalive': 'ids; `promptHash` is a hash',
  '/api/agentv3/publish': 'ids and the deploy choice; the files come from the server, not the body',
  '/api/agentv3/preview-error': '`message` is cut to 4,000 characters by the client and the server; `source` is a word',
  '/api/agentv3/preview-error/auto-repair': '`message` is cut to 4,000 characters by the client and the server; the rest are ids and a framework word (Q-148)',
  '/api/agentv3/respond': '`requestId` and `approved`',
  '/api/agentv3/steer': '`message` is cut to 2,000 characters (sanitizeSteerMessage)',
  '/api/agentv3/queue/enqueue': '`prompt` is refused over MAX_PROMPT_LEN (20,000 characters)',
  '/api/agentv3/queue/complete': '`ok` and a note',
  '/api/agentv3/feature-plan': '`prompt` is cut to 20,000 characters, the same cap the build chat refuses above',
  '/api/agentv3/exec': 'a shell command; `rows` is the terminal height',
  '/api/agentv3/shell/open': '`rows` / `cols` are the terminal size',
  '/api/agentv3/shell/input': '`data` is a batch of keystrokes (ShellTerminal.tsx)',
  '/api/agentv3/shell/resize': '`rows` / `cols` are the terminal size',
  '/api/agentv3/shell/close': '`shellId` only',
  '/api/agentv3/mcp/list': 'a workspace id',
  '/api/agentv3/mcp/connect': 'a name, a URL and auth headers',
  '/api/agentv3/mcp/attach': 'a workspace id and a server id',
  '/api/agentv3/mcp/forget': 'a server id',
  '/api/agentv3/visual-edit': 'a file PATH and small text/style edits (PreviewSurface.tsx)',
  '/api/site-analytics/hit': 'its own route-level `express.text` at 4 KB',
  '/api/app-ai/ask': 'its own route-level `express.json` at 16 KB (a published app\'s AI call)',
  '/api/app-ai/image': 'its own route-level `express.json` at 16 KB',
  '/api/app-ai/preview-ask': 'its own route-level `express.json` at 16 KB',
  '/api/app-ai/preview-image': 'its own route-level `express.json` at 16 KB',
  '/api/app-ai/settings': 'its own route-level `express.json` at 4 KB',
  '/api/app-mart/social/batch': 'comment keys and short text',
  '/api/app-mart/social/react': 'a reaction',
  '/api/app-mart/social/comments': 'a short comment',
  '/api/app-mart/social/comments/:id/report': 'a report reason',
  '/api/app-mart/social/comments/:id/keep': 'no payload',
  '/api/app-mart/social/block': 'a creator id',
  '/api/auth/otp-outcome': 'an OTP outcome record (otpReport.ts)',
  '/api/bots/telegram/webhook/:botId': 'a Telegram update — media arrive as file ids, never bytes',
  '/api/bots/whatsapp/webhook/:botId': 'a Meta webhook event — media arrive as ids, never bytes (on RAW_BODY_ROUTES for its signature)',
  '/api/bots/disconnect': 'a bot id',
  '/api/build': 'retired: answers 410 without reading the body',
  '/api/build-stream': 'retired: answers 410 without reading the body',
  '/api/build-estimate': 'build history cut to 500 entries; no client in this repo posts to it',
  '/api/retrospective/warnings': 'history cut to 1,000 entries; no client in this repo posts to it',
  '/api/techdebt/:userId/:projectId': 'findings validated by recordSchema; no client in this repo posts to it',
  '/api/workspace/:workspaceId/review': '`file` is a path and `body` is a review comment',
  '/api/workspace/:workspaceId/review/:id/resolve': '`resolved` only',
  '/api/workspace/:workspaceId/review/:id/reply': 'a review comment',
  '/api/chat/completions': 'text only, refused over MAX_CHAT_TOTAL_CHARS (24,000) — developerApi.ts',
  '/api/professionals/:id/chat': 'text only, refused over MAX_CHAT_TOTAL_CHARS (24,000) — developerApi.ts',
  '/api/images/generations': 'a prompt; the image is the OUTPUT',
  '/api/figma/proxy': '`fileKey` and a token',
  '/api/image/enhance-prompt': 'an image prompt (text)',
  '/api/nav-store/publish-from-build': 'an artifact id and listing text',
  '/api/nav-store/web/app/:id/data/:collection': 'a NavData row, refused over MAX_ROW_BYTES (2 KB)',
  '/api/domains/nbai/connect': 'a domain',
  '/api/domains/nbai/auto-dns/sync': 'a domain',
  '/api/domains/nbai/hostinger/apply': 'a domain and a token',
  '/api/payment/webhook': 'a Cashfree payment event (on RAW_BODY_ROUTES for its signature)',
  '/api/payment/store/verify': 'a store purchase token',
  '/api/integrations/supabase/provision': 'an app label and a workspace id',
  '/api/integrations/supabase/wake': 'one project ref',
  '/api/profile': '`photoUrl` is a URL cut to 500 characters; the picture itself goes to /api/profile/photo',
  '/api/referral/:userId/claim-failed': 'a reason and a message cut to 300 characters',
  '/api/team/:teamId/mentions/resolve': 'mention ids',
  '/api/team/:teamId/mentions/notify': 'mention ids and a short text',
  '/api/mentions/read': 'ids',
  '/api/team/:teamId/library/:itemId': 'DELETE — no payload',
  '/api/logs/error': 'one client error record',
  '/api/wallet/:userId/hosting-plan/auto-renew': '`autoRenew` only',
  '/api/webhooks/:userId': 'a URL and an event-name list',
  '/api/zip-upload/begin': 'file name and size — the bytes go to /api/zip-upload/chunk as octet-stream',
  '/api/zip-upload/abort': 'an upload id',
  '/api/mobile-ship/trigger': '`workflow` is a workflow file name; `inputs` are build options',
  '/api/v1/data/:workspaceId/:collection': 'one record; sanitizeRecord (sharedData.ts) rejects it above 8 KB (SHARED_DATA_MAX_BYTES) before anything is stored',
  '/api/v1/data/:workspaceId/:collection/:id': 'PATCH replaces one record, same 8 KB cap as the create. DELETE does not use the body — the shared handler is what the census sees',
};

// ── The scanner ─────────────────────────────────────────────────────────────────────────────────────

/** A field name that can carry a big payload. Matched against the names a route reads from the body. */
const PAYLOAD_FIELD = /(file|attach|image|img|base64|dataurl|zip|screenshot|photo|pdf|audio|video|html|content|^code$|source|message|history|bundle|lock|^rows$|sessions|blob|icon|logo|^body$|^data$|^text$|prompt|^css$|^js$|overrides|findings|events|values|flow|nodes|sql)/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(rel);
  }
  return out;
}

/** Every server file that registers routes: server.ts and each module that takes the Express app. */
const ROUTE_FILES = ['server.ts', ...walk('src/server').filter((f) => /\(\s*app\s*:\s*(Express|Application|express\.Express)\b/.test(read(f)))];
const ALL_SERVER_FILES = ['server.ts', ...walk('src/server')];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resolve `app.post(SOME_PATH, …)` through `const SOME_PATH = '…'` anywhere in the server. */
function resolvePath(expr: string): string | null {
  const lit = expr.match(/^['"`]([^'"`]+)['"`]$/);
  if (lit) return lit[1];
  if (!/^[A-Z_][A-Z0-9_]*$/.test(expr)) return null;
  for (const f of ALL_SERVER_FILES) {
    const m = read(f).match(new RegExp(`const\\s+${esc(expr)}\\s*(?::\\s*string\\s*)?=\\s*['"\`]([^'"\`]+)['"\`]`));
    if (m) return m[1];
  }
  return null;
}

/** The body fields a handler reads, and whether it hands the whole body to something else. */
function bodyReads(text: string): { fields: Set<string>; wholesale: boolean } {
  const aliases = ['req.body'];
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=;]+)?=\s*\(?\s*req\.body\b(?!\s*\??\.)/g)) aliases.push(m[1]);
  const fields = new Set<string>();
  let wholesale = false;
  for (const a of aliases) {
    const A = esc(a);
    const pats = [
      new RegExp(`(?<![\\w.])${A}\\s*\\??\\.\\s*(\\w+)`, 'g'),                                  // req.body.x, req.body?.x
      new RegExp(`(?<![\\w.])${A}\\s*(?:\\?\\.)?\\[\\s*['"\`](\\w+)['"\`]\\s*\\]`, 'g'),       // req.body['x']
      new RegExp(`\\(\\s*${A}\\s*(?:\\?\\?|\\|\\|)\\s*\\{\\s*\\}\\s*\\)\\s*\\??\\.\\s*(\\w+)`, 'g'), // (req.body ?? {}).x
      new RegExp(`\\(\\s*${A}\\s+as\\s+[^()]*?\\)\\s*\\??\\.\\s*(\\w+)`, 'g'),                  // (req.body as T).x
    ];
    for (const re of pats) for (const m of text.matchAll(re)) fields.add(m[1]);
    // const { a, b: c, ...rest } = req.body
    for (const m of text.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*(?::[^=;]+)?=\\s*\\(?\\s*${A}(?![\\w.?])`, 'g'))) {
      for (const part of m[1].split(',')) {
        const n = part.replace('...', '').split(/[:=]/)[0].trim();
        if (n) fields.add(n);
      }
    }
    // f(req.body), f(x, req.body), f(req.body as T), { ...req.body }
    if (new RegExp(`(?:\\w\\s*\\(|,)\\s*${A}\\s*(?:as\\s+[^,)]+)?\\s*[,)]`).test(text) || new RegExp(`\\.\\.\\.\\s*${A}(?![\\w.?])`).test(text)) wholesale = true;
  }
  return { fields, wholesale };
}

/** The source of a function declared in `src` (`function n(…) {…}` or `const n = (…) => …`), brace-matched. */
function functionText(src: string, name: string): string {
  const d = src.search(new RegExp(`(?:function\\s+${esc(name)}\\s*[(<]|(?:const|let)\\s+${esc(name)}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\(|function|\\w+\\s*=>))`));
  if (d < 0) return '';
  let i: number;
  if (src.startsWith('function', d)) {
    // past the parameter list, to the body's opening brace
    let depth = 0;
    i = src.indexOf('(', d);
    for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
    i = src.indexOf('{', i);
  } else {
    const arrow = src.indexOf('=>', d);
    const after = src.slice(arrow + 2).search(/\S/) + arrow + 2;
    if (src[after] !== '{') return src.slice(d, src.indexOf(';\n', after) + 1 || after + 2000);
    i = after;
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(d, j + 1);
  }
  return src.slice(d);
}

interface RouteSite { file: string; line: number; method: string; path: string | null; pathExpr: string; text: string }

function routeSites(): RouteSite[] {
  const out: RouteSite[] = [];
  const REG = /\bapp\.(post|put|patch|all|delete)\(\s*([^,]+?)\s*,/g;
  for (const file of ROUTE_FILES) {
    const src = read(file);
    const ms = [...src.matchAll(REG)];
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const start = m.index ?? 0;
      const end = i + 1 < ms.length ? (ms[i + 1].index ?? src.length) : src.length;
      let text = src.slice(start, end);
      // A handler written as a local function (`chatHandler(req, res)` or `app.post(p, handler)`) is
      // read too, or the fields it reads would be invisible.
      const names = new Set<string>();
      for (const c of text.matchAll(/\b(\w+)\(\s*req\b/g)) names.add(c[1]);
      for (const c of src.slice(start, start + 400).matchAll(/,\s*([A-Za-z_]\w*)\s*\)/g)) names.add(c[1]);
      for (const n of names) text += '\n' + functionText(src, n);
      out.push({ file, line: src.slice(0, start).split('\n').length, method: m[1], pathExpr: m[2], path: resolvePath(m[2].trim()), text });
    }
  }
  return out;
}

const SITES = routeSites();
const LARGE_PATHS = new Set(LARGE_BODY_ROUTES.map((r) => r.path));
const RAW_PATHS = new Set(RAW_BODY_ROUTES.map((r) => r.path));

// ── 1. The census ───────────────────────────────────────────────────────────────────────────────────

describe('🔒 every route that can receive a big body is on the large-body list (Q-627)', () => {
  it('the scanner sees the server (a census that finds nothing proves nothing)', () => {
    expect(SITES.length).toBeGreaterThan(250);
    const paths = new Set(SITES.map((s) => s.path));
    for (const p of ['/api/agentv3/chat', '/api/chat/navbharat', '/api/payment/webhook', '/api/profile/photo']) expect(paths.has(p), p).toBe(true);
  });

  it('every server file that registers a route is scanned (a module typed differently cannot hide)', () => {
    // Generators hold route code inside template strings for the USER's app, and apiGraph.ts parses such
    // code; neither registers a route on this server.
    const registering = ALL_SERVER_FILES.filter((f) => !/Generator\.ts$|\/apiGraph\.ts$/.test(f)
      && /\bapp\.(post|put|patch|all|delete)\(/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')));
    expect(registering.filter((f) => !ROUTE_FILES.includes(f))).toEqual([]);
  });

  it('every route path resolves (a constant the census cannot read is a route it cannot check)', () => {
    const unresolved = SITES.filter((s) => s.path === null).map((s) => `${s.file}:${s.line} ${s.pathExpr}`);
    expect(unresolved).toEqual([]);
  });

  it('a route that reads a payload-shaped field, or passes its whole body on, is on the large list or reviewed small', () => {
    const missing: string[] = [];
    for (const s of SITES) {
      const { fields, wholesale } = bodyReads(s.text);
      const payload = [...fields].filter((f) => PAYLOAD_FIELD.test(f));
      if (!payload.length && !wholesale) continue;
      if (LARGE_PATHS.has(s.path!) || REVIEWED_SMALL[s.path!]) continue;
      missing.push(`${s.file}:${s.line} ${s.method.toUpperCase()} ${s.path} reads ${payload.join(', ') || 'the whole body'}`);
    }
    expect(missing, 'add each to LARGE_BODY_ROUTES in src/server/lib/requestBodyLimits.ts (with its evidence), or to REVIEWED_SMALL here with the reason its body stays under 1 MB').toEqual([]);
  });

  it('the big-body routes this audit found by evidence are all on the list', () => {
    // The screens that post attachments, images and whole projects (client call sites, 2026-10-05).
    for (const p of [
      '/api/agentv3/chat', '/api/agentv3/import-files', '/api/chat/navbharat', '/api/chat/navbharatai',
      '/api/professional/:id/chat', '/api/sda-chat', '/api/image/generate', '/api/screenshot/to-prompt',
      '/api/report', '/api/report/:id/reply', '/api/profile/photo', '/api/mobile-ship/setup',
      '/api/nav-store/web/publish', '/api/preview-bundle', '/api/preview-vue', '/api/github/push-enhanced',
      '/api/download-zip', '/api/sync/:userId', '/api/workspace/sbom', '/api/integrations/supabase/import',
      '/preview-app/:sessionId/*splat',
    ]) expect(LARGE_PATHS.has(p), p).toBe(true);
  });

  it('no list entry is stale: each names a route the server really registers', () => {
    const registered = new Set(SITES.map((s) => s.path));
    const stale = [...LARGE_PATHS, ...RAW_PATHS, ...Object.keys(REVIEWED_SMALL)].filter((p) => !registered.has(p));
    expect(stale).toEqual([]);
  });

  it('a route is on one list, never both', () => {
    expect([...LARGE_PATHS].filter((p) => REVIEWED_SMALL[p])).toEqual([]);
  });
});

// ── 2. rawBody only where the bytes are needed ──────────────────────────────────────────────────────

describe('🔒 req.rawBody is kept only where a signature (or a verbatim forward) needs the bytes', () => {
  it('every route that reads rawBody is on RAW_BODY_ROUTES', () => {
    const readers = SITES.filter((s) => /\brawBody\b/.test(s.text)).map((s) => s.path);
    const missing = readers.filter((p) => !RAW_PATHS.has(p!));
    expect(missing, 'add the route to RAW_BODY_ROUTES in requestBodyLimits.ts — without it rawBody is undefined there').toEqual([]);
    for (const p of RAW_PATHS) expect(readers, `${p} is on RAW_BODY_ROUTES but no longer reads rawBody`).toContain(p);
  });

  it('no other server file reads req.rawBody (a reader outside a route would never get it)', () => {
    const allowed = new Set(['src/server/routes/payment.ts', 'src/server/routes/bots.ts', 'src/server/routes/preview.ts', 'src/server/lib/requestBodyLimits.ts']);
    const readers = ALL_SERVER_FILES.filter((f) => /\.rawBody\b|\{\s*rawBody\s*\}\s*=\s*req/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')));
    expect(readers.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it('the signature routes are exactly the two webhooks plus the preview forward', () => {
    expect([...RAW_PATHS].sort()).toEqual(['/api/bots/whatsapp/webhook/:botId', '/api/payment/webhook', '/preview-app/:sessionId/*splat']);
  });

  it('server.ts mounts only jsonBodyParser — no second global express.json, no rawBody of its own', () => {
    const code = read('server.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('app.use(jsonBodyParser(');
    expect(code).not.toMatch(/express\.json\(/);
    expect(code).not.toMatch(/rawBody\s*=/);
  });
});

// ── 3. The matcher ──────────────────────────────────────────────────────────────────────────────────

describe('the path matcher', () => {
  it('matches Express params and splats, case-insensitively, with an optional trailing slash', () => {
    expect(compileRoutePath('/api/professional/:id/chat').test('/api/professional/doctor/chat')).toBe(true);
    expect(compileRoutePath('/api/professional/:id/chat').test('/api/professional/a/b/chat')).toBe(false);
    expect(compileRoutePath('/preview-app/:sessionId/*splat').test('/preview-app/s1/api/upload')).toBe(true);
    expect(compileRoutePath('/api/agentv3/chat').test('/API/AgentV3/Chat/')).toBe(true);
    expect(compileRoutePath('/api/agentv3/chat').test('/api/agentv3/chatter')).toBe(false);
  });

  it('a versioned call gets the same limit as its unversioned route (the parser runs before the rewrite)', () => {
    expect(routingPath('/api/v1/agentv3/chat')).toBe('/api/agentv3/chat');
    expect(isLargeBodyRoute('/api/v1/agentv3/chat')).toBe(true);
    expect(needsRawBody('/api/v1/payment/webhook')).toBe(true);
  });

  it('ordinary routes are small and keep no raw bytes', () => {
    for (const p of ['/api/auth/send-otp', '/api/profile/budget', '/api/agentv3/stop', '/api/payment/create-order']) {
      expect(isLargeBodyRoute(p), p).toBe(false);
      expect(needsRawBody(p), p).toBe(false);
    }
    expect(DEFAULT_JSON_LIMIT).toBe('1mb');
    expect(LARGE_JSON_LIMIT).toBe('30mb');
  });
});

// ── 4. The real parser on a real server ─────────────────────────────────────────────────────────────

describe('jsonBodyParser on a live Express app', () => {
  let server: Server;
  let base = '';
  const tooLarge: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(jsonBodyParser({ onTooLarge: (e) => { tooLarge.push(`${e.method} ${e.path}`); } }));
    const echo = (req: express.Request, res: express.Response) => {
      const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
      res.json({ size: JSON.stringify(req.body ?? null).length, raw: Buffer.isBuffer(raw) ? raw.length : null });
    };
    app.post('/api/agentv3/chat', echo);
    app.post('/api/auth/send-otp', echo);
    app.post('/api/payment/webhook', echo);
    app.post('/api/bots/whatsapp/webhook/:botId', echo);
    app.post('/api/profile/budget', echo);
    app.post('/api/app-ai/ask', echo);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  const post = (path: string, body: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const big = JSON.stringify({ attachments: [{ base64: 'A'.repeat(3 * 1024 * 1024) }] }); // ~3 MB

  it('a 3 MB attachment reaches the build chat', async () => {
    const res = await post('/api/agentv3/chat', big);
    expect(res.status).toBe(200);
    expect((await res.json()).size).toBeGreaterThan(3_000_000);
  });

  it('the same 3 MB to an ordinary route is an honest 413 — not a 500, and reported', async () => {
    const res = await post('/api/auth/send-otp', big);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('BODY_TOO_LARGE');
    expect(body.error).toMatch(/too large/i);
    expect(tooLarge).toContain('POST /api/auth/send-otp');
  });

  it('a versioned path is treated like its route', async () => {
    // The rewrite itself happens later (apiVersionMiddleware); here only the limit is under test, so the
    // unrewritten path 404s AFTER the body was accepted — a 413 would mean the limit was wrong.
    const res = await post('/api/v1/agentv3/chat', big);
    expect(res.status).not.toBe(413);
  });

  it('an ordinary small body parses and carries no raw copy', async () => {
    const res = await post('/api/profile/budget', JSON.stringify({ budgetLimitInr: 500 }));
    expect(res.status).toBe(200);
    expect((await res.json()).raw).toBeNull();
  });

  it('the build chat keeps no raw copy either — big bodies are held once', async () => {
    const res = await post('/api/agentv3/chat', JSON.stringify({ prompt: 'hi' }));
    expect((await res.json()).raw).toBeNull();
  });

  it('Q-674: the public app-AI gateway refuses more than its own 16 KB, honestly', async () => {
    const res = await post('/api/app-ai/ask', JSON.stringify({ question: 'x'.repeat(40 * 1024) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/16KB/);
    const ok = await post('/api/app-ai/ask', JSON.stringify({ question: 'What are your opening hours?' }));
    expect(ok.status).toBe(200);
  });

  it('Q-674: a body that is not JSON is the caller\'s 400, never a 500', async () => {
    const res = await post('/api/profile/budget', '{"budgetLimitInr": 5');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BODY_NOT_JSON');
  });

  it('the two signed webhooks get the exact bytes', async () => {
    const raw = '{"data":{"order":{"order_id":"o1"}},  "type":"PAYMENT_SUCCESS_WEBHOOK"}';
    for (const p of ['/api/payment/webhook', '/api/bots/whatsapp/webhook/b1']) {
      const res = await post(p, raw);
      expect(res.status, p).toBe(200);
      expect((await res.json()).raw, p).toBe(Buffer.byteLength(raw));
    }
  });
});

describe('🔒 Q-674: a route-specific limit lives in the one parser that runs', () => {
  // body-parser skips a request already parsed, so a route's own `express.json({ limit })` behind the global
  // parser never runs — the app-AI gateways wrote 16 KB and took the global limit for months.
  const files = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(join(ROOT, dir))) {
      const p = join(dir, n);
      if (statSync(join(ROOT, p)).isDirectory()) files(p, out);
      else if (/\.ts$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  };
  it('no route registers its own JSON or urlencoded parser', () => {
    const offenders = [...files('src/server/routes'), 'server.ts'].filter((f) =>
      /app\.(?:get|post|put|patch|delete|all|use)\([^;]*express\.(?:json|urlencoded)\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it('the small-route list resolves, and its routes are neither large nor raw', () => {
    for (const r of SMALL_BODY_ROUTES) {
      expect(smallBodyLimit(r.path), r.path).toBe(r.limit);
      expect(isLargeBodyRoute(r.path), r.path).toBe(false);
      expect(needsRawBody(r.path), r.path).toBe(false);
    }
    expect(smallBodyLimit('/api/v1/app-ai/ask')).toBe('16kb');
    expect(smallBodyLimit('/api/profile/budget')).toBeNull();
  });
});

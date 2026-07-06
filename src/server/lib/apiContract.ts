// P-DATA.5 — OpenAPI / Contract Spec for NavBharatAI's OWN REST API.
//
// Reuses the existing, tested OpenApiGenerator (P-CGE.5) — the same engine that writes contracts for
// generated apps — but feeds it the platform's own STABLE public routes, so we get a real, valid
// OpenAPI 3.0.3 document served at /api/openapi.json (+ a self-contained /api/docs viewer).
//
// HONEST SCOPE: this is a hand-curated list of the stable, documented public endpoints — not an
// exhaustive dump of every internal route (there are ~hundreds, many internal/experimental). It is the
// machine-readable contract for the surface external clients actually use; adding a route is one entry.

import type { Express, Request, Response } from 'express';
import { generateOpenApi, type RouteSpec } from './OpenApiGenerator';

/** The stable, documented public API surface. */
export const NAVBHARAT_API_ROUTES: RouteSpec[] = [
  { method: 'get', path: '/api/health', summary: 'Liveness/readiness probe', tags: ['System'] },

  { method: 'get', path: '/api/profile', summary: 'Fetch the signed-in user profile + wallet + monthly spend', tags: ['Profile'] },
  { method: 'put', path: '/api/profile', summary: 'Update display name / bio / phone / photo', tags: ['Profile'],
    requestBody: { properties: { displayName: { type: 'string' }, bio: { type: 'string' }, phone: { type: 'string' }, photoURL: { type: 'string' } } } },
  { method: 'delete', path: '/api/profile', summary: 'Right-to-be-forgotten — erase all of the signed-in user\'s data', tags: ['Profile'],
    requestBody: { properties: { confirm: { type: 'string' } }, required: ['confirm'] },
    responses: { '200': { description: 'Deletion report' }, '400': { description: 'Confirmation required' }, '401': { description: 'Unauthorized' } } },
  { method: 'get', path: '/api/profile/history', summary: 'Build history (filterable by period/date range)', tags: ['Profile'],
    params: [{ name: 'period', in: 'query', type: 'string' }, { name: 'from', in: 'query', type: 'string' }, { name: 'to', in: 'query', type: 'string' }] },

  { method: 'get', path: '/api/export/build-history', summary: 'Export build history as CSV/JSON/Excel', tags: ['Export'],
    params: [{ name: 'format', in: 'query', type: 'string', description: 'csv | json | xlsx' }] },
  { method: 'get', path: '/api/export/usage', summary: 'Export usage/cost as CSV/JSON/Excel', tags: ['Export'],
    params: [{ name: 'format', in: 'query', type: 'string', description: 'csv | json | xlsx' }, { name: 'month', in: 'query', type: 'string', description: 'YYYY-MM' }] },

  { method: 'get', path: '/api/wallet/:userId', summary: 'Get a user token wallet balance', tags: ['Billing'],
    params: [{ name: 'userId', in: 'path', type: 'string' }] },
  { method: 'post', path: '/api/payment/create-order', summary: 'Create a Cashfree checkout order', tags: ['Billing'],
    requestBody: { properties: { amount: { type: 'number' }, userId: { type: 'string' } }, required: ['amount', 'userId'] } },
  { method: 'post', path: '/api/payment/verify-payment', summary: 'Verify a payment and credit the wallet', tags: ['Billing'],
    requestBody: { properties: { orderId: { type: 'string' } }, required: ['orderId'] } },
  { method: 'post', path: '/api/payment/redeem-coupon', summary: 'Redeem a promo coupon into wallet credit', tags: ['Billing'],
    requestBody: { properties: { couponCode: { type: 'string' } }, required: ['couponCode'] } },

  { method: 'get', path: '/api/github/user', summary: 'Fetch the connected GitHub user', tags: ['GitHub'] },
  { method: 'get', path: '/api/github/repos', summary: 'List the connected GitHub account repositories', tags: ['GitHub'] },

  { method: 'get', path: '/api/appmaker/jobs/:jobId', summary: 'Get the status of a build job', tags: ['Build'],
    params: [{ name: 'jobId', in: 'path', type: 'string' }] },

  { method: 'post', path: '/api/keys', summary: 'Create a public API key (returns the secret once)', tags: ['API Keys'],
    requestBody: { properties: { name: { type: 'string' }, scopes: { type: 'array' } }, required: ['scopes'] },
    responses: { '201': { description: 'Created — includes the plaintext key (shown once)' }, '400': { description: 'A valid scope is required' }, '401': { description: 'Unauthorized' } } },
  { method: 'get', path: '/api/keys', summary: 'List your API keys (metadata only, never the secret)', tags: ['API Keys'] },
  { method: 'delete', path: '/api/keys/:id', summary: 'Revoke one of your API keys', tags: ['API Keys'],
    params: [{ name: 'id', in: 'path', type: 'string' }] },
  { method: 'get', path: '/api/v1/me', summary: 'Get the API-key owner profile + monthly usage (auth: API key, scope read:profile)', tags: ['API v1'],
    responses: { '200': { description: 'Profile + usage' }, '401': { description: 'Invalid/missing API key' }, '403': { description: 'Missing required scope' } } },

  { method: 'get', path: '/api/health', summary: 'Deep health report (status + uptime/memory + per-dependency checks)', tags: ['System'] },
];

/** Build the OpenAPI 3.0.3 document for the platform API. Pure. */
export function buildApiSpec(): ReturnType<typeof generateOpenApi> {
  return generateOpenApi(NAVBHARAT_API_ROUTES, {
    title: 'NavBharatAI Platform API',
    version: '1.0.0',
    description: 'The stable public REST API of NavBharatAI. Most endpoints require a Firebase ID token (Bearer).',
  });
}

/** Minimal, self-contained (no external CDN → CSP-safe) HTML that renders the spec's endpoints. */
function docsHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NavBharatAI API</title><style>body{font:14px system-ui,sans-serif;margin:0;background:#0d1117;color:#c9d1d9}
header{padding:20px 24px;border-bottom:1px solid #30363d}h1{margin:0;font-size:18px;color:#58a6ff}
table{border-collapse:collapse;width:100%}td,th{padding:8px 24px;border-bottom:1px solid #21262d;text-align:left}
.m{font-weight:700;font-family:monospace}.get{color:#3fb950}.post{color:#d29922}.put{color:#58a6ff}.delete{color:#f85149}
a{color:#58a6ff}</style></head><body>
<header><h1>NavBharatAI Platform API</h1><div>Machine-readable contract: <a href="/api/openapi.json">/api/openapi.json</a></div></header>
<table><thead><tr><th>Method</th><th>Path</th><th>Summary</th></tr></thead><tbody id="t"></tbody></table>
<script>fetch('/api/openapi.json').then(r=>r.json()).then(s=>{const b=document.getElementById('t');
Object.entries(s.paths||{}).forEach(([p,ops])=>Object.entries(ops).forEach(([m,o])=>{const tr=document.createElement('tr');
tr.innerHTML='<td class="m '+m+'">'+m.toUpperCase()+'</td><td class="m">'+p+'</td><td>'+((o&&o.summary)||'')+'</td>';b.appendChild(tr);}));});</script>
</body></html>`;
}

export function registerApiContractRoutes(app: Express): void {
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(buildApiSpec());
  });
  app.get('/api/docs', (_req: Request, res: Response) => {
    res.type('html').send(docsHtml());
  });
}

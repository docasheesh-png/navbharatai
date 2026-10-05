// Forensic audit 2026-10-04 — three small leaks, each closed at its source.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { registerCreateOrderRoute } from '../src/server/routes/createOrder';

describe('the legacy order creator is retired, honestly', () => {
  it('POST /api/create-order answers 410 and writes nothing', async () => {
    const routes = captureRoutes(registerCreateOrderRoute);
    const res = mockRes();
    await routes.get('POST /api/create-order')!(mockReq({ body: { userId: 'victim', orderAmount: 100 } }), res);
    expect(res.statusCode).toBe(410);
  });
});

describe('verify-payment never returns the order owner\'s balances', () => {
  it('the route strips them before answering a caller it did not identify', () => {
    const src = readFileSync('src/server/routes/payment.ts', 'utf8');
    const route = src.slice(src.indexOf("app.post('/api/payment/verify-payment'"), src.indexOf("app.post('/api/payment/reconcile'"));
    expect(route).toMatch(/currentBalance: _balance, tokenBalance: _tokens, buyerUid, \.\.\.publicResult/);
    expect(route).not.toMatch(/return res\.json\(result\.data\)/);
  });
});

describe('Repo Analyst never forwards a NavBharatAI session token to GitHub', () => {
  it('reads the GitHub token through the shared reader that refuses a JWT', () => {
    const src = readFileSync('src/server/routes/repoAnalyst.ts', 'utf8');
    expect(src).not.toMatch(/req\.headers\.authorization\?\.split\(' '\)\[1\]/);
    expect((src.match(/githubTokenFromRequest\(req\)/g) ?? []).length).toBe(2);
  });
});

/**
 * Security audit 2026-11-21, built-app scanner gaps (points 19 and 12 of the 27-point checklist): the scanner had
 * no check for a payment amount the browser chooses, and none for the app's own sign-in routes left without a
 * rate limit. Both now report through SecurityConfigAnalysis (medium: a warning and a score penalty, never a
 * block), and the builder's prompt names them so the first build avoids them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scanSecurityConfig, scanProjectSecurityConfig } from '../src/server/AgentV3/SecurityConfigAnalysis';

const rules = (file: string, code: string) => scanSecurityConfig(file, code).map((i) => i.rule);

describe('client-trusted-price', () => {
  it('flags an order created with an amount the browser sent', () => {
    const razorpay = `app.post('/api/order', async (req, res) => {\n  const order = await razorpay.orders.create({ amount: req.body.amount * 100, currency: 'INR' });\n  res.json(order);\n});`;
    expect(rules('server/pay.ts', razorpay)).toContain('client-trusted-price');
    const stripe = `const { price, qty } = req.body;\nconst intent = await stripe.paymentIntents.create({ amount: price * qty, currency: 'inr' });`;
    expect(rules('server/stripe.ts', stripe)).toContain('client-trusted-price');
    const cashfreeRest = `const r = await fetch('https://api.cashfree.com/pg/orders', { method: 'POST', body: JSON.stringify({ order_amount: req.body.order_amount }) });`;
    expect(rules('server/cf.ts', cashfreeRest)).toContain('client-trusted-price');
  });
  it('does not flag a server-side price, or an amount in a file that creates no order', () => {
    const serverPrice = `const plan = PLANS[req.body.planId];\nconst order = await razorpay.orders.create({ amount: plan.price * 100, currency: 'INR' });`;
    expect(rules('server/pay.ts', serverPrice)).not.toContain('client-trusted-price');
    expect(rules('server/expense.ts', `const { amount } = req.body;\nawait db.expenses.insert({ amount });`)).not.toContain('client-trusted-price');
  });
});

describe('auth-route-no-rate-limit (project-wide)', () => {
  const server = { path: 'server/index.ts', content: "import express from 'express';\nconst app = express();\napp.listen(3000);" };
  const routes = { path: 'server/auth.ts', content: "router.post('/api/login', login);\nrouter.post('/api/signup', signup);" };
  it('flags sign-in routes when no file has a limiter', () => {
    const found = scanProjectSecurityConfig([server, routes]);
    expect(found.map((i) => i.rule)).toEqual(['auth-route-no-rate-limit']);
    expect(found[0]).toMatchObject({ file: 'server/auth.ts', line: 1, severity: 'medium' });
  });
  it('a limiter in ANY file (the usual app.use in server.ts) clears it', () => {
    const limited = { ...server, content: server.content + "\nimport rateLimit from 'express-rate-limit';\napp.use('/api', rateLimit({ windowMs: 60000, max: 20 }));" };
    expect(scanProjectSecurityConfig([limited, routes])).toEqual([]);
  });
  it('an app with no sign-in route of its own (hosted auth) is never flagged; tests are ignored', () => {
    expect(scanProjectSecurityConfig([server, { path: 'server/todos.ts', content: "router.post('/api/todos', add);" }])).toEqual([]);
    expect(scanProjectSecurityConfig([{ path: 'server/auth.test.ts', content: "router.post('/api/login', x);" }])).toEqual([]);
  });
});

describe('wired and taught', () => {
  it('the evaluate pass runs the project-wide rules', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toMatch(/issues\.push\(\.\.\.scanProjectSecurityConfig\(/);
  });
  it('the builder is told about both before it writes', () => {
    const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(prompt).toMatch(/PRICE TAKEN FROM THE BROWSER/);
    expect(prompt).toMatch(/NO RATE LIMIT anywhere/);
  });
});

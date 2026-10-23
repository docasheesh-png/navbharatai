// ONE PLATFORM MARGIN (admin 2026-10-11, Q-114 (b): "the Business panel reads chat AND builds into one margin").
//
// NavBharatAI keeps three cost records — chat turns in `ai_usage_logs`, builds in the cost telemetry day docs,
// assistants (Professionals, Doctor AI, Other-AI tools) in the assistant spend day docs — and both margin cards
// read the first alone. One of them was labelled plainly "Net Margin". THE CLASS: a margin that subtracts
// part of the cost and is labelled as if it subtracted all of it. Two corrections to the queue row came out
// of the code: `user_costs` holds what users were BILLED (a margin on it would subtract revenue from
// revenue), and the assistants are a third record the row never named.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { platformMarginWindow, windowStartDate } from '../src/server/lib/platformMargin';
import { platformMarginView } from '../src/lib/platformMarginView';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const RATE = 90; // ₹ per $
const base = {
  nowMs: NOW,
  days: 30,
  usdToInr: (usd: number) => usd * RATE,
  // $1 per measured call, whatever the tokens — the route passes the real rate card here
  priceUsage: () => 1,
};
const paid = (amountPaid: number, createdAt: string, extra: Record<string, unknown> = {}) => ({ paymentStatus: 'SUCCESS', paymentProvider: 'CASHFREE', amountPaid, createdAt, ...extra });
const chat = (createdAt: string, measured = true) => ({ providerName: 'GLM', modelName: 'glm-4.7-flash', usageMeasured: measured, ...(measured ? { inputTokens: 10, outputTokens: 10 } : {}), createdAt });

describe('the window', () => {
  it('is thirty calendar days ending today', () => {
    expect(windowStartDate(NOW, 30)).toBe('2026-09-12');
  });
});

describe('🔒 revenue minus EVERY recorded AI cost, over ONE window', () => {
  const m = platformMarginWindow({
    ...base,
    transactions: [
      paid(1000, '2026-10-01T10:00:00Z'),
      paid(500, '2026-08-01T10:00:00Z'),                                 // before the window
      paid(0, '2026-10-02T10:00:00Z', { paymentProvider: 'WELCOME_GIFT' }), // credit, not money
      { paymentStatus: 'FAILED', amountPaid: 300, createdAt: '2026-10-03T10:00:00Z' },
    ],
    chatLogs: [chat('2026-10-05T00:00:00Z'), chat('2026-10-06T00:00:00Z'), chat('2026-07-01T00:00:00Z')],
    buildDays: [
      { date: '2026-10-10', totalBuilds: 4, realCostBuilds: 4, totalRealCostUsd: 2, totalSandboxUsd: 0.5 },
      { date: '2026-09-01', totalBuilds: 9, realCostBuilds: 9, totalRealCostUsd: 99 },  // before the window
    ],
    assistantDays: [{ date: '2026-10-09', turns: 50, unmeasuredTurns: 0, realUsd: 1 }],
  });

  it('counts only money that arrived inside the window', () => {
    expect(m.revenueInr).toBe(1000);
  });

  it('subtracts chat, builds (tokens + VM) and assistants — each inside the window', () => {
    expect(m.chat.costInr).toBe(2 * RATE);
    expect(m.builds.costInr).toBe(2.5 * RATE);
    expect(m.assistants.costInr).toBe(1 * RATE);
    expect(m.costInr).toBe(5.5 * RATE);
    expect(m.marginInr).toBe(1000 - 5.5 * RATE);
    expect(m.complete).toBe(true);
  });
});

describe('🔒 a cost we could not fully measure makes the margin "at most"', () => {
  it('an unpriced chat call, a build without a real cost, or an unmeasured assistant turn', () => {
    const at = (o: Partial<Parameters<typeof platformMarginWindow>[0]>) => platformMarginWindow({ ...base, transactions: [], chatLogs: [], buildDays: [], assistantDays: [], ...o });
    expect(at({ chatLogs: [chat('2026-10-05T00:00:00Z', false)] }).complete).toBe(false);
    expect(at({ buildDays: [{ date: '2026-10-10', totalBuilds: 3, realCostBuilds: 2, totalRealCostUsd: 1 }] }).builds.complete).toBe(false);
    expect(at({ assistantDays: [{ date: '2026-10-10', turns: 3, unmeasuredTurns: 1, realUsd: 0 }] }).complete).toBe(false);
    expect(at({}).complete).toBe(true);
  });

  it('and the card says so in its own words', () => {
    const v = platformMarginView({ days: 30, revenueInr: 100, costInr: 40, marginInr: 60, complete: false, chat: { costInr: 10, complete: false }, builds: { costInr: 30, complete: true }, assistants: { costInr: 0, complete: true } });
    expect(v?.marginLabel).toBe('Platform margin · 30 days (at most)');
    expect(v?.costLabel).toBe('AI cost · 30 days (at least)');
    expect(v?.costSub).toContain('not fully measured: chat');
    expect(platformMarginView(undefined)).toBeNull(); // an older server — no invented ₹0
  });

  it('counts chain calls and unknown legacy prices as unpriced, rather than calling measured tokens a known cost', () => {
    const m = platformMarginWindow({
      ...base,
      transactions: [paid(1000, '2026-10-01T10:00:00Z')],
      chatLogs: [
        chat('2026-10-05T00:00:00Z'),
        { ...chat('2026-10-05T00:00:00Z'), freeChain: { costUsdEstimate: 0 } },
        { ...chat('2026-10-05T00:00:00Z', false), freeChain: { costUsdEstimate: null } },
        { ...chat('2026-10-05T00:00:00Z'), providerName: 'UNKNOWN_RATE' },
        { ...chat('2026-07-01T00:00:00Z'), freeChain: { costUsdEstimate: 500 } },
      ],
      priceUsage: (provider) => provider === 'UNKNOWN_RATE' ? Number.NaN : 1,
      buildDays: [], assistantDays: [],
    });
    expect(m.chat).toEqual({ costInr: RATE, complete: false, calls: 4, unpricedCalls: 3 });
    expect(m.costInr).toBe(RATE);
    expect(m.marginInr).toBe(1000 - RATE);
    expect(m.complete).toBe(false);
  });
});

describe('🔒 the wiring', () => {
  const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the route sends it, built from the three records and never from what users were billed', () => {
    const route = code('src/server/routes/admin.ts');
    const block = route.slice(route.indexOf("app.get('/api/admin/analytics'"), route.indexOf("app.get('/api/admin/analytics'") + 12_000);
    expect(block).toContain('agentV3CostTelemetry.list(PLATFORM_MARGIN_DAYS + 1)');
    expect(block).toContain('assistantSpendStore.summary(PLATFORM_MARGIN_DAYS + 1)');
    expect(block).toContain('platformMargin,');
    expect(code('src/server/lib/platformMargin.ts')).not.toContain('user_costs');
  });

  it('no admin card prints the chat-only figure under a whole-platform name', () => {
    const ui = code('src/components/AdminDashboard.tsx');
    expect(ui).not.toMatch(/'Net Margin|'Total Provider Cost'|'Provider Cost \(at least\)'/);
    expect(ui.match(/platformMarginView\(analytics\?\.platformMargin\)/g)?.length).toBe(2);
  });
});

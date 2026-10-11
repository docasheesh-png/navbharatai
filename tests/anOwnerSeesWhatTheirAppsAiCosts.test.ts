// AN OWNER SEES WHAT THEIR APP'S AI COSTS, DAY BY DAY (admin 2026-10-11, Q-797: "an owner screen of their app's AI
// spend"). The card showed TODAY only, so a cost that grew over a week was invisible until the balance showed it.
// Now the last 30 days, the published app and the preview apart, read from the very counters the caps use.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lastDayKeys, spendHistory, readSpendHistory, SPEND_HISTORY_DAYS } from '../src/lib/appAiSpendHistory';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AppAiSpendHistory } from '../src/components/agentv3/AppAiSettingsCard';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the history', () => {
  it('is the last 30 UTC days, newest first, in the counters\' own key', () => {
    const days = lastDayKeys(Date.UTC(2026, 9, 11, 5));
    expect(days).toHaveLength(SPEND_HISTORY_DAYS);
    expect(days[0]).toBe('2026-10-11');
    expect(days[1]).toBe('2026-10-10');
    expect(days[29]).toBe('2026-09-12');
  });

  it('sums the published app and the preview apart, rounded to paise once', () => {
    const h = spendHistory(['2026-10-11', '2026-10-10'], { '2026-10-11': { spentInr: 0.105, calls: 2 } }, { '2026-10-11': { spentInr: 1.234, calls: 5 }, '2026-10-10': { spentInr: 2, calls: 9 } });
    expect(h.days[0]).toEqual({ day: '2026-10-11', publishedInr: 1.23, previewInr: 0.11, calls: 7 });
    expect(h.totalPublishedInr).toBe(3.23);
    expect(h.totalPreviewInr).toBe(0.11);
    expect(h.totalCalls).toBe(16);
  });

  it('🔒 a body that is not a history is not one — never an invented ₹0', () => {
    expect(readSpendHistory(false, { days: [] })).toBeNull();
    expect(readSpendHistory(true, { known: true })).toBeNull();
    expect(readSpendHistory(true, null)).toBeNull();
    expect(readSpendHistory(true, { days: [], known: false })?.known).toBe(false);
  });
});

describe('the screen', () => {
  it('lists only the days that cost something, with the totals', () => {
    const html = renderToStaticMarkup(createElement(AppAiSpendHistory, {
      failed: false,
      history: { known: true, days: [{ day: '2026-10-11', publishedInr: 1.5, previewInr: 0, calls: 3 }, { day: '2026-10-10', publishedInr: 0, previewInr: 0, calls: 0 }], totalPublishedInr: 1.5, totalPreviewInr: 0, totalCalls: 3 },
    }));
    expect(html).toContain('published app <strong>₹1.50</strong>');
    expect(html).toContain('11 Oct');
    expect(html).not.toContain('10 Oct');
  });

  it('🔒 unreadable counters are said, not shown as a cost of nothing', () => {
    const html = renderToStaticMarkup(createElement(AppAiSpendHistory, { failed: false, history: { known: false, days: [], totalPublishedInr: 0, totalPreviewInr: 0, totalCalls: 0 } }));
    expect(html).toMatch(/Could not read the last 30 days/);
    expect(html).not.toContain('₹0.00');
  });
});

describe('🔒 the wiring', () => {
  it('the route is owner-only and reads the same counters the caps use', () => {
    const route = code('src/server/routes/appAiOwner.ts');
    const at = route.indexOf("app.get('/api/app-ai/spend'");
    const body = route.slice(at, route.indexOf('app.', at + 10));
    expect(body).toContain('const ownerId = await ownerOf(req, workspaceId);');
    expect(body).toContain('appSpentDays(previewCounterId(workspaceId), days)');
    expect(body).toContain('appSpentDays(siteIdForWorkspace(workspaceId), days)');
  });

  it('the store reads all the days in one batched read', () => {
    expect(code('src/server/lib/AppAiUsageStore.ts')).toContain('await db.getAll(...days.map(');
  });

  it('the owner\'s card offers the history', () => {
    const card = code('src/components/agentv3/AppAiSettingsCard.tsx');
    expect(card).toContain("fetch(`/api/app-ai/spend?workspaceId=${encodeURIComponent(workspaceId)}`");
    expect(card).toContain('{historyOpen && <AppAiSpendHistory');
  });
});

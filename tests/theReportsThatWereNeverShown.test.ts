// THE THIRTEEN REPORTS THAT HAD NO SCREEN, AND THE CARDS PROPOSED FOR DELETION.
//
// ADMIN 2026-09-21: *"13 endpoints par asli diagnostic data ban raha hai jo kisi screen par dikhta hi
// nahi. pahle yahi banao!"* and *"un par temporary red mark laga do … woh apke delete karwa dunga!!"*
//
// Two invariants this suite exists for, and neither is visible to `tsc` or to a behavioural test:
//   1. A report route that no client fetches is invisible — that is the whole defect being fixed, and
//      it returns the moment somebody adds a route and forgets a card. So the panel is asserted to
//      really call each of the thirteen.
//   2. A red mark with no reason behind it, or a reason with no mark on screen, would make the
//      admin's review untrustworthy in opposite directions. Both halves are asserted.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UNUSED_CARDS, reasonLabel, unusedCard } from '../src/components/admin/unusedCards';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const PANEL = read('src/components/admin/EngineReportsPanel.tsx');
const DASHBOARD = read('src/components/AdminDashboard.tsx');
const MONITOR = read('src/components/admin/MonitorPanels.tsx');
const ADMIN_ROUTES = read('src/server/routes/admin.ts');

/** Every endpoint the audit found with real diagnostic data and no client at all. */
const THE_THIRTEEN = [
  '/api/admin/builder-scorecard',
  '/api/admin/agentv3/losses',
  '/api/admin/agentv3/usage-report',
  '/api/admin/metrics/history',
  '/api/admin/assistant-spend',
  '/api/admin/provider-status',
  '/api/admin/release-gate',
  '/api/admin/feature-flags',
  '/api/admin/key-version',
  '/api/admin/events',
  '/api/admin/deployments',
  '/api/admin/takedowns',
  '/api/admin/announcements',
];

describe('every report that had no screen now has one', () => {
  it.each(THE_THIRTEEN)('the panel fetches %s', (path) => {
    expect(PANEL).toContain(path);
  });

  it('and each one is a REAL route — the panel cannot point at an endpoint that does not exist', () => {
    for (const path of THE_THIRTEEN) {
      expect(ADMIN_ROUTES).toContain(`'${path}'`);
    }
  });

  it('the panel is reachable — the dashboard renders it behind its own tab', () => {
    expect(DASHBOARD).toContain('<EngineReportsPanel');
    expect(DASHBOARD).toMatch(/id: 'diagnostics'/);
    expect(DASHBOARD).toMatch(/activeTab === 'diagnostics'/);
  });

  it('every card can be exported — a number that cannot leave the screen is half a report', () => {
    // One ReportExportButtons inside the shared ReportCard covers all thirteen by construction.
    expect(PANEL).toContain('<ReportExportButtons');
  });
});

describe('🔒 NULL IS NOT ZERO — the renderer may not invent a measurement', () => {
  it('the panel renders an em dash for a missing number, never 0', () => {
    // `num`, `pct`, `mins` and `usd` must all fall back to DASH. Asserted at the source because the
    // failure is silent: a card printing "0%" for an unmeasured rate looks exactly like a real result.
    const helpers = PANEL.match(/const DASH = '—';/);
    expect(helpers).not.toBeNull();
    const returns = PANEL.match(/: DASH;/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(4);
  });

  it('it never hardcodes a zero fallback', () => {
    expect(PANEL).not.toMatch(/\?\?\s*0\b/);
  });
});

describe('the cards proposed for deletion', () => {
  it('every registered card is really marked on screen', () => {
    for (const card of UNUSED_CARDS) {
      const rendered = DASHBOARD.includes(`id="${card.id}"`) || MONITOR.includes(`id="${card.id}"`);
      expect(rendered, `${card.title} is registered but no <UnusedCardMark> renders it`).toBe(true);
    }
  });

  it('every mark on screen is really registered — a red badge with no reason is not reviewable', () => {
    const ids = [...DASHBOARD.matchAll(/<UnusedCardMark id="([^"]+)"/g)]
      .concat([...MONITOR.matchAll(/<UnusedCardMark id="([^"]+)"/g)])
      .map((m) => m[1]);
    expect(ids.length).toBe(UNUSED_CARDS.length);
    for (const id of ids) {
      expect(unusedCard(id), `${id} is marked on screen but not registered`).toBeDefined();
    }
  });

  it('every entry states a reason the admin can check, not an opinion', () => {
    for (const card of UNUSED_CARDS) {
      expect(card.why.length).toBeGreaterThan(60);
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.tab.length).toBeGreaterThan(0);
    }
  });

  it('the ids are unique', () => {
    expect(new Set(UNUSED_CARDS.map((c) => c.id)).size).toBe(UNUSED_CARDS.length);
  });

  it('every reason has a label — a new reason cannot reach the screen unnamed', () => {
    for (const card of UNUSED_CARDS) {
      expect(reasonLabel(card.reason)).toMatch(/^[A-Z ]+$/);
    }
  });

  it('an unknown id draws NOTHING rather than an empty red badge', () => {
    expect(unusedCard('nothing-registers-this')).toBeUndefined();
  });

  it('🔒 the deliberate duplicate is NOT marked — a decision with a reason attached stands', () => {
    // "Published Apps" repeats the Publish Capacity card below it ON PURPOSE, and says so in its own
    // comment. Marking it would be agreeing with a count of cards over a written decision.
    const titles = UNUSED_CARDS.map((c) => c.title);
    expect(titles).not.toContain('Published Apps');
    expect(titles).not.toContain('Publish Capacity');
  });

  it('a mark hides nothing — the badge renders beside the card, never in place of it', () => {
    // COMMENTS STRIPPED FIRST. The header explains that nothing is hidden, so a raw scan matches the
    // prose and asserts the opposite of what it means — the test's own first draft did exactly that.
    const mark = read('src/components/admin/UnusedCardMark.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(mark).not.toMatch(/display:\s*'none'/);
    expect(mark).not.toMatch(/\bhidden\b/);
    expect(mark).not.toMatch(/\breturn null\b[\s\S]{0,40}entry\b/);
  });
});

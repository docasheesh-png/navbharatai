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

describe('🔴 A FIELD NAME THE SERVER DOES NOT SEND IS A CARD THAT SHOWS NOTHING', () => {
  // The first version of this panel guessed three shapes and got two of them wrong: the usage report
  // returns `perProvider` / `baselineCostUsd` (not `providers` / `realCostUsd`) and assistant spend
  // returns `days` + `today.freeShare` (not `totalInr` / `freeShare` / `calls`). Both cards rendered
  // a full frame with every value an em dash — built, shipped, and showing nothing, which is exactly
  // the state the second absolute rule forbids. `tsc` cannot catch it: the payloads are `any`.
  //
  // So each field the panel reads is asserted against the module that DECLARES it. A rename on the
  // server now fails here instead of silently emptying a card nobody is watching.
  /**
   * The panel WITHOUT its comments. The header of each fixed card deliberately NAMES the wrong field
   * it used to read, so a raw scan matches that explanation and asserts the opposite of what it means
   * — this suite's own first draft did exactly that, twice.
   */
  const PANEL_CODE = PANEL
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const TELEMETRY = read('src/server/AgentV3/AgentV3CostTelemetry.ts');
  const SPEND = read('src/server/lib/assistantSpendRollup.ts');
  const ROUTER = read('src/server/AI/Router/AIRouter.ts');

  it('the usage report reads the fields UsageReport really declares', () => {
    // 2026-09-23: the MEASURED half joins the list. The card used to lead with `marginUsd`, which is
    // `billed − Sonnet-equivalent baseline` — every engine priced at one flat rate — so a window that
    // charged 18% of that price rendered as a $1,257 loss in red. The baseline fields stay required
    // (they are still shown, as a reference) and the real ones are required beside them, so a card
    // that quietly stops showing what a build actually cost fails here.
    for (const field of [
      'perProvider', 'totalBilledUsd', 'totalBaselineCostUsd', 'marginUsd', 'lossBuilds',
      'totalRealSpendUsd', 'realMarginUsd', 'realCostCoverage', 'perModel', 'lossSpendUsd',
    ]) {
      expect(TELEMETRY, `UsageReport no longer declares ${field}`).toContain(`${field}`);
      expect(PANEL_CODE, `the panel stopped reading ${field}`).toContain(field);
    }
  });

  it('its per-provider rows read the fields UsageReportRow really declares', () => {
    for (const field of ['inputTokens', 'outputTokens', 'baselineCostUsd']) {
      expect(TELEMETRY).toContain(field);
      expect(PANEL_CODE).toContain(field);
    }
  });

  it('it does NOT read the names the first version guessed', () => {
    // ⚠️ NARROWED 2026-09-23, and the reason it had to be is worth keeping. This read
    // `not.toContain('realCostUsd')` — a SUBSTRING ban written when no such field existed anywhere.
    // `UsageReport` now really declares `totalRealCostUsd`, so the old line forbade the panel from
    // ever reading a field the server genuinely sends: a guard still firing after its reason expired,
    // which this repo has paid for before. What it MEANT is asserted instead — the panel must not
    // read a TOP-LEVEL `realCostUsd` off the payload, because the route does not send one.
    expect(PANEL_CODE).not.toMatch(/d\?\.realCostUsd\b/);
    // `d?.rows` is NOT asserted against: the takedowns card legitimately reads `rows`, which is what
    // that route really returns. Forbidding a field name globally because one card once misused it
    // would ban a correct reading elsewhere.
    expect(PANEL_CODE).not.toMatch(/Array\.isArray\(d\?\.providers\)/);
  });

  it('assistant spend reads the fields the rollup really declares', () => {
    for (const field of ['freeTurns', 'unmeasuredTurns', 'realUsd', 'freeShare']) {
      expect(SPEND, `the rollup no longer declares ${field}`).toContain(field);
    }
    for (const field of ['unmeasuredTurns', 'realUsd', 'freeShare', 'days']) {
      expect(PANEL_CODE, `the panel stopped reading ${field}`).toContain(field);
    }
  });

  it('assistant spend does NOT read the names the first version guessed', () => {
    expect(PANEL_CODE).not.toContain('totalInr');
    expect(PANEL_CODE).not.toMatch(/d\?\.calls/);
  });

  // 🔎 SIBLING SWEEP (rule 3). Two cards were found reading names the server never sends, so every
  // OTHER card's fields were checked the same way rather than assumed. Eleven were already correct.
  // The two whose shapes are least obvious are locked here; the rest read a single top-level key
  // straight off the route (`history`, `events`, `deployments`, `rows`) and are covered by the
  // endpoint assertions above.
  it('the release gate reads the fields ReleaseGateConfig really declares', () => {
    const GATE = read('src/server/lib/ReleaseGate.ts');
    for (const field of ['frozen', 'freezeReason', 'approvalRequired']) {
      expect(GATE, `ReleaseGateConfig no longer declares ${field}`).toContain(field);
      expect(PANEL_CODE, `the panel stopped reading ${field}`).toContain(field);
    }
  });

  it('the feature-flag card reads the fields the flag config really declares', () => {
    const FLAGS = read('src/server/FeatureFlagManager.ts');
    for (const field of ['flags', 'rollout', 'overrides']) {
      expect(FLAGS, `the flag config no longer declares ${field}`).toContain(field);
      expect(PANEL_CODE, `the panel stopped reading ${field}`).toContain(field);
    }
  });

  it('provider status reads what getProviderStats really returns, circuit state included', () => {
    for (const field of ['requestCount', 'errorCount', 'avgLatencyMs', 'circuitState']) {
      expect(ROUTER, `getProviderStats no longer returns ${field}`).toContain(field);
      expect(PANEL_CODE, `the panel stopped reading ${field}`).toContain(field);
    }
  });
});

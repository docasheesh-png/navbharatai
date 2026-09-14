import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildCostCard, costHeadline, realCostLabel, billLabel, avgWithSample, inr } from './BuildCostCard';

/**
 * THE BUILD-COST CARD (admin 2026-09-14, "han banao"): real cost vs bill per tier × app size.
 * These pin the two things that make it worth having: it is mounted and reads the real route, and
 * a cost that was not measured never renders as a number.
 */

describe('the labels never turn an absence into ₹0', () => {
  it('inr: absent is a dash', () => {
    expect(inr(null)).toBe('—');
    expect(inr(12.4)).toBe('₹12.40');
  });
  it('an average is never shown without its sample size', () => {
    expect(avgWithSample(12.4, 3)).toBe('₹12.40 · n=3');
    expect(avgWithSample(null, 0)).toBe('not measured');
    expect(avgWithSample(12.4, 0)).toBe('not measured');
  });
  it('🔒 real cost: a capped call log reads as a lower bound, unpriced calls as approximate, nothing as not measured', () => {
    expect(realCostLabel({ realInr: 8.7, measured: true, source: 'settled' })).toBe('₹8.70');
    expect(realCostLabel({ realInr: 8.7, measured: false, source: 'call-log-capped' })).toBe('≥ ₹8.70 (call log capped)');
    expect(realCostLabel({ realInr: 8.7, measured: false, source: 'call-log' })).toBe('≈ ₹8.70 (some calls unpriced)');
    expect(realCostLabel({ realInr: null, measured: false, source: 'none' })).toBe('not measured');
  });
  it('bill: ₹0 with its reason is a fact; an unsettled bill is "not recorded"', () => {
    expect(billLabel({ billedInr: null, zeroBillReason: null })).toBe('not recorded');
    expect(billLabel({ billedInr: 0, zeroBillReason: 'empty build' })).toBe('₹0 — empty build');
    expect(billLabel({ billedInr: 40, zeroBillReason: null })).toBe('₹40.00');
  });
});

describe('costHeadline', () => {
  const row = (measured: boolean) => ({ measured, realInr: measured ? 1 : null }) as never;
  it('names how many builds were measured and how many could not be', () => {
    expect(costHeadline({ rows: [row(true), row(true), row(false)], summary: [], usdInr: 87, window: 30, reportsRead: 3, sizeRule: '', note: '' }, ''))
      .toBe('3 builds read; real cost measured on 2, 1 not measurable (older reports or a capped call log).');
  });
  it('🔒 a failed read says nothing on the card is current', () => {
    expect(costHeadline(null, 'boom')).toContain('nothing on this card is current');
  });
  it('no builds is said plainly', () => {
    expect(costHeadline({ rows: [], summary: [], usdInr: 87, window: 30, reportsRead: 0, sizeRule: '', note: '' }, '')).toBe('No builds recorded yet.');
  });
});

describe('🔒 the wiring — an API with no screen is not a feature', () => {
  const dash = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  const card = readFileSync(join(process.cwd(), 'src/components/admin/BuildCostCard.tsx'), 'utf8');
  const admin = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');

  it('the card is mounted on the admin REPORTS tab, beside the all-builds list', () => {
    expect(dash).toContain("import { BuildCostCard } from './admin/BuildCostCard'");
    const at = dash.indexOf("{activeTab === 'reports' && (");
    expect(at).toBeGreaterThan(-1);
    const mount = dash.indexOf('<BuildCostCard adminToken={adminToken} />');
    expect(mount).toBeGreaterThan(at);
    expect(mount).toBeLessThan(dash.indexOf('All builds — every user, no submit needed'));
  });
  it('it reads the real route with the admin token', () => {
    expect(card).toContain("fetch('/api/admin/build-costs?limit=30'");
    expect(card).toContain("'x-admin-token': adminToken");
  });
  it('🔒 the route is admin-gated and reads the FULL stored reports (the metadata projection has no call log)', () => {
    expect(admin).toContain("app.get('/api/admin/build-costs', verifyAdminToken,");
    const at = admin.indexOf("app.get('/api/admin/build-costs'");
    expect(admin.slice(at, at + 1500)).toContain('listRecentFullReports(limit)');
  });
  it('renders its first paint without a number — dashes and "Reading", never a zero', () => {
    const html = renderToStaticMarkup(<BuildCostCard adminToken="t" />);
    expect(html).toContain('Build costs — real cost vs bill');
    expect(html).toContain('Reading the last builds');
    expect(html).not.toContain('₹0');
  });
});

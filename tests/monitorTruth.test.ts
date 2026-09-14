/**
 * Source-level rules for the admin Monitor, from the 2026-09-14 capture. Each is a wiring fact a
 * refactor could silently undo without any unit test noticing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
const monitorRoute = admin.slice(admin.indexOf("app.get('/api/admin/monitor'"), admin.indexOf("app.get('/api/admin/metrics/history'"));
const analyticsRoute = admin.slice(admin.indexOf("app.get('/api/admin/analytics'"), admin.indexOf("app.get('/api/admin/analytics'") + 12_000);

describe('/api/admin/monitor — the analysers read the same data the charts draw', () => {
  it('feeds alerts, finops and insights from the scoped snapshot, never the raw since-boot one', () => {
    expect(monitorRoute).toMatch(/evaluateAlerts\(scoped\.snapshot\)/);
    expect(monitorRoute).toMatch(/analyzeFinOps\(scoped\.snapshot\)/);
    expect(monitorRoute).toMatch(/generateInsights\(scoped\.snapshot/);
    expect(monitorRoute).not.toMatch(/evaluateAlerts\(snapshot\)/);
    expect(monitorRoute).not.toMatch(/generateInsights\(snapshot\)/);
    expect(monitorRoute).not.toMatch(/analyzeFinOps\(snapshot\)/);
  });

  it('the health score’s success rate comes from the scoped snapshot too', () => {
    expect(monitorRoute).toMatch(/successRatePct: scoped\.snapshot\.builds\.total > 0/);
  });

  it('tells the client which source it used', () => {
    expect(monitorRoute).toContain('metricsScope: scoped.scope');
  });

  it('still returns the since-boot snapshot for the panel that is labelled as such', () => {
    expect(monitorRoute).toMatch(/^\s*snapshot,\s*$/m);
  });
});

describe('/api/admin/analytics — one provider accounting, and honest scope', () => {
  it('derives BOTH provider panels from usage.byProvider, so they cannot disagree', () => {
    expect(analyticsRoute).toMatch(/providerWise\[name\] = r\.outputTokens/);
    expect(analyticsRoute).toMatch(/const providerRanking = Object\.entries\(usage\.byProvider\)/);
    // The old second tally and its case-mismatched lookup are gone.
    expect(analyticsRoute).not.toContain('providerRequestCount');
    expect(analyticsRoute).not.toMatch(/providerWise\[name\.toLowerCase\(\)\]/);
  });

  it('declares that its AI numbers are chat-only, so the screen can say so', () => {
    expect(analyticsRoute).toMatch(/scope: 'chat' as const/);
  });

  it('declares that hit counters are per-instance since boot', () => {
    expect(analyticsRoute).toContain('hitsSinceBoot: true');
  });
});

describe('AdminDashboard — labels follow the server’s scope rather than claiming "all providers"', () => {
  const dash = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
  it('never hardcodes "All providers combined" or "All time requests" as the only wording', () => {
    expect(dash).toMatch(/analytics\?\.scope === 'chat' \? 'Chat assistants only/);
    expect(dash).toMatch(/analytics\?\.hitsSinceBoot \?/);
  });
  it('shows unmeasured latency and tokens as unmeasured, not as 0', () => {
    expect(dash).toContain("p.avgLatencyMs == null ? 'latency not recorded'");
    expect(dash).toContain("p.measuredCalls === 0 ? 'tokens not measured'");
  });
});

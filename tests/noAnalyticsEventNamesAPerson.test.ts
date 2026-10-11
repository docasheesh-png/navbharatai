// NO ANALYTICS EVENT NAMES A PERSON (admin 2026-10-11, Q-783 option B).
//
// Every product event used to be appended to `analytics_events` with the person's real `userId`, "for
// cohort/segmentation drill-down" — a drill-down that was never built, so nothing ever read the store. The
// admin chose to stop collecting it. Two siblings carried the same per-person stream and go with it: the
// server log line printed `userId` + `sessionId` for every event, and the client sent both with every event
// in the first place. THE CLASS: a person attached to telemetry that no question needs. The day rollup
// (`analytics_daily`) keeps the funnel and holds no person.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('analytics keeps counts, not people', () => {
  it('🔒 the pipeline writes only the day rollup — no per-event store', () => {
    const pipeline = code('src/server/lib/AnalyticsPipeline.ts');
    expect(pipeline).not.toContain("'analytics_events'");
    expect(pipeline).not.toMatch(/\.add\(/);
    expect(pipeline).toContain("const DAILY_COLLECTION = 'analytics_daily'");
    // and it cannot be handed a person to store
    const sig = pipeline.slice(pipeline.indexOf('export async function recordAnalyticsEvent'), pipeline.indexOf('): Promise<void>', pipeline.indexOf('export async function recordAnalyticsEvent')));
    expect(sig).not.toMatch(/userId|sessionId/);
  });

  it('🔒 the server log line keeps the event and its numbers, never the person', () => {
    const route = code('src/server/routes/telemetry.ts');
    const block = route.slice(route.indexOf("app.post('/api/analytics/event'"), route.indexOf("app.post('/api/analytics/event'") + 900);
    expect(block).not.toMatch(/userId|sessionId/);
    expect(block).toMatch(/console\.log\('\[ANALYTICS\]', JSON\.stringify\(\{ event: sanitizeEventKey\(String\(event\)\), props/);
  });

  it('🔒 the client never sends who the person is', () => {
    const client = code('src/lib/analytics.ts');
    expect(client).not.toMatch(/navbharat_uid|userId|sessionId|SESSION_ID/);
    expect(client).toContain("JSON.stringify({ event, props, ts: Date.now() })");
  });

  it('rows written before the change still expire and are still erased with an account', () => {
    const retention = readFileSync('src/server/lib/DataRetentionManager.ts', 'utf8');
    expect(retention).toContain("{ collection: 'analytics_events', key: { field: 'userId' } }");
    expect(retention).toMatch(/collection: 'analytics_events', ttlDays: 30/);
  });
});

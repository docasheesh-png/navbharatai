import { describe, it, expect } from 'vitest';
import { generateAnalyticsIntegration, isAnalyticsProvider } from './AnalyticsGenerator';

describe('generateAnalyticsIntegration — PostHog', () => {
  const c = generateAnalyticsIntegration('posthog');

  it('emits a server capture helper using the private key', () => {
    const server = c.files['server/lib/analytics.ts'];
    expect(server).toContain("import { PostHog } from 'posthog-node'");
    expect(server).toContain('export function trackServerEvent(distinctId: string');
    expect(server).toContain('client.capture({ distinctId, event, properties })');
    expect(server).toContain('POSTHOG_KEY');
  });

  it('emits a client helper that inits once, tracks, identifies, and no-ops without a key', () => {
    const client = c.files['src/lib/analytics.ts'];
    expect(client).toContain("import posthog from 'posthog-js'");
    expect(client).toContain('export function initAnalytics()');
    expect(client).toContain('export function track(event: string');
    expect(client).toContain('export function identify(userId: string');
    expect(client).toContain('VITE_POSTHOG_KEY'); // browser uses the public key
    expect(client).toContain('if (!key) return'); // no key → analytics off, app unaffected
  });

  it('declares env keys + both deps + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['POSTHOG_KEY', 'POSTHOG_HOST', 'VITE_POSTHOG_KEY', 'VITE_POSTHOG_HOST']);
    expect(c.dependencies).toEqual([
      { name: 'posthog-node', version: '^4' },
      { name: 'posthog-js', version: '^1' },
    ]);
    expect(c.files['.env.example']).toContain('POSTHOG_KEY=\n');
    expect(c.files['.env.example']).toContain('VITE_POSTHOG_KEY=\n');
    expect(c.instructions).toContain('never stores');
  });

  it('.env.example carries NO real secret values (blank RHS only)', () => {
    for (const line of c.files['.env.example'].split('\n').filter(Boolean)) {
      expect(line).toMatch(/=$/);
    }
  });
});

describe('generateAnalyticsIntegration — Mixpanel', () => {
  const c = generateAnalyticsIntegration('mixpanel');

  it('emits a server + client helper and the two mixpanel deps', () => {
    expect(c.files['server/lib/analytics.ts']).toContain("import Mixpanel from 'mixpanel'");
    expect(c.files['server/lib/analytics.ts']).toContain('mixpanel.track(event, { distinct_id: distinctId');
    const client = c.files['src/lib/analytics.ts'];
    expect(client).toContain("import mixpanel from 'mixpanel-browser'");
    expect(client).toContain('mixpanel.identify(userId)');
    expect(client).toContain('VITE_MIXPANEL_TOKEN');
    expect(c.envKeys).toEqual(['MIXPANEL_TOKEN', 'VITE_MIXPANEL_TOKEN']);
    expect(c.dependencies).toEqual([
      { name: 'mixpanel', version: '^0.18' },
      { name: 'mixpanel-browser', version: '^2' },
    ]);
  });
});

describe('isAnalyticsProvider — guard', () => {
  it('accepts the two supported providers, rejects everything else', () => {
    expect(isAnalyticsProvider('posthog')).toBe(true);
    expect(isAnalyticsProvider('mixpanel')).toBe(true);
    expect(isAnalyticsProvider('amplitude')).toBe(false);
    expect(isAnalyticsProvider(undefined)).toBe(false);
  });
});

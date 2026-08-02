import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Reliability / Quality Engine (9), rock-solid verification.
 *
 * All 9 are real. Fixes: the "Pro Chat → Build any app" entries carried the retired v2.0 surface name
 * (now NavBharatAI Pro v5.0), and the three Analytics cards named "Analytics view" without saying how to
 * reach it (Home → Other AI → Analytics). App SBOM + Build Health are verified against the real backend/UI.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const analytics = read('src/components/ide/AppAnalytics.tsx');
const insights = read('src/components/panels/ProjectInsightsPanel.tsx');
const groups = read('src/components/home/homeToolGroups.ts');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('No Reliability entry names the retired "Pro Chat" surface', () => {
  it.each(['auto-dependency-sync', 'auto-test-generation', 'auto-code-review', 'build-version-history'])(
    '%s path uses NavBharatAI Pro v5.0, not Pro Chat',
    (id) => {
      const e = kb(id)!;
      expect(e).toBeTruthy();
      expect(e.path).not.toMatch(/Pro Chat/);
      expect(e.path).toMatch(/Pro v5\.0/);
    },
  );
});

describe('Analytics cards name the real doorway (Home → Other AI → Analytics)', () => {
  it.each([
    ['build-performance-analytics', 'Build Performance'],
    ['build-optimizer', 'Build Optimizer'],
    ['build-reliability-metrics', 'Build Reliability'],
  ])('%s path routes through Analytics and names its card', (id, card) => {
    const e = kb(id)!;
    expect(e.path).toMatch(/Home → Other AI → Analytics/);
    expect(e.path).toContain(card);
  });
  it('the Analytics tile + those cards really exist', () => {
    expect(groups).toContain("label: 'Analytics'");
    expect(analytics).toContain('Build Performance');
    expect(analytics).toContain('Build Optimizer');
    expect(analytics).toContain('Build Reliability');
  });
});

describe('App SBOM + Build Health are real', () => {
  it('SBOM has a real endpoint the KB points at', () => {
    const sbom = read('src/server/routes/sbom.ts');
    expect(sbom).toContain('/api/workspace/sbom');
    expect(kb('app-sbom')!.path).toContain('/api/workspace/sbom');
  });
  it('Build Health card is real (Run All Checks in the Insights panel)', () => {
    expect(insights).toContain('Build Health');
    expect(insights).toContain('Run All Checks');
    expect(kb('build-health-check')!.path).toMatch(/Insights & Webhooks → Build Health/);
  });
});

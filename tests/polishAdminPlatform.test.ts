import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Admin/Ops (6) + Platform/Navigation (51), the final sections + a CAMPAIGN-WIDE lock.
 *
 * The campaign's dominant defect class was stale KB navigation left by retired surfaces (Engineer AI,
 * Pro Chat v2.0), the 2026-07-23 tools move (Settings → Home Other AI), and the Deploy→Publish rename.
 * The regression lock below asserts that NO KB entry — across all 200+ — routes a user to any of those
 * dead doorways in its `path` (the field an AI reads first to answer "where is X?"). This is what keeps
 * the whole 203-feature roadmap rock-solid: a future edit that re-introduces a retired path fails CI.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const admin = read('src/server/routes/admin.ts');
const adminUi = read('src/components/AdminDashboard.tsx');
const insights = read('src/components/panels/ProjectInsightsPanel.tsx');
const settings = read('src/components/panels/SettingsPanel.tsx');

describe('CAMPAIGN-WIDE lock — no KB path routes through a retired surface', () => {
  const RETIRED = [
    /Engineer AI chat/i,
    /Pro Chat →/,
    /Deploy panel → Deploy tab/i,
    /Settings → Billing\b/,
    /→ Reports tab/i,
    /Settings → AI Tools → Voice/i,
    /floating "v5\.0" button/i,
    /Secrets & Keys(?! )/, // the bare label (real tile is "Secrets & API Keys")
  ];
  it('every feature.path avoids all retired doorways', () => {
    const offenders: Array<{ id: string; path: string }> = [];
    for (const f of APP_KNOWLEDGE_BASE) {
      if (typeof f.path !== 'string') continue;
      if (RETIRED.some((re) => re.test(f.path))) offenders.push({ id: f.id, path: f.path });
    }
    expect(offenders).toEqual([]);
  });
});

describe('Admin & Ops (6) — all real', () => {
  it('AI Deployment Ops + Release Gate endpoints exist (admin-gated)', () => {
    expect(admin).toContain("'/api/admin/deploy-risk'");
    expect(admin).toContain("'/api/admin/incident-analysis'");
    expect(admin).toContain("'/api/admin/release-gate'");
  });
  it('AI Insights, 2FA, and the v5.0 Cost-Ladder are real Admin Dashboard cards', () => {
    expect(adminUi).toContain('AI Insights');
    expect(adminUi).toContain('Two-Factor Authentication');
    expect(adminUi).toContain('Cost-Ladder');
  });
  it('Live Metrics is a real (admin-only) App Settings screen', () => {
    expect(settings).toContain('Live Metrics');
  });
});

describe('Platform / Navigation — sampled real controls + fixed retired entries', () => {
  it('the Insights & Webhooks quality checks are real cards', () => {
    for (const title of ['Code Confidence', 'React Hooks Safety', 'JSX Component Resolution', 'Explain Code']) {
      expect(insights).toContain(title);
    }
  });
  it('the fixed legacy entries now route to NavBharatAI Pro v5.0', () => {
    for (const id of ['unified-workspace', 'unified-memory', 'engineer_ai_github', 'iterative-agent-build', 'guider-plan-confirm']) {
      const e = APP_KNOWLEDGE_BASE.find((f) => f.id === id);
      expect(e, `missing ${id}`).toBeTruthy();
      expect(e!.path, `${id} path`).toMatch(/Pro v5\.0/);
    }
  });
});

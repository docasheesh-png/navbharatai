import { describe, it, expect } from 'vitest';
import { generateDashboard } from './DashboardGenerator';

describe('generateDashboard', () => {
  it('emits a stats route + a React dashboard page (dependency-free)', () => {
    const out = generateDashboard(['Post', 'User']);
    expect(Object.keys(out.files).sort()).toEqual([
      'server/routes/dashboard.routes.ts',
      'src/pages/Dashboard.tsx',
    ]);
    expect(out.dependencies).toEqual([]);
  });

  it('aggregates total + last-7-days counts per model, excluding soft-deleted', () => {
    const route = generateDashboard(['Post', 'User']).files['server/routes/dashboard.routes.ts'];
    expect(route).toContain("router.get('/stats'");
    expect(route).toContain('prisma.post.count({ where: { deletedAt: null } })');
    expect(route).toContain('prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since } } })');
    expect(route).toContain('stats["posts"]');
    expect(route).toContain('stats["users"]');
    expect(route).toContain('const WEEK_MS = 7 * 24 * 60 * 60 * 1000;');
  });

  it('the page fetches /api/dashboard/stats and renders stat tiles with loading/error states', () => {
    const page = generateDashboard(['Post']).files['src/pages/Dashboard.tsx'];
    expect(page).toContain("fetch('/api/dashboard/stats')");
    expect(page).toContain('export default function Dashboard()');
    expect(page).toContain('this week');
    expect(page).toContain('Loading…');
    expect(page).toContain('setError');
  });

  it('de-dupes models and never throws on malformed input', () => {
    const route = generateDashboard(['Post', 'post', 'Post']).files['server/routes/dashboard.routes.ts'];
    expect((route.match(/stats\["posts"\]/g) || []).length).toBe(1); // one entry despite duplicates
    // @ts-expect-error — malformed input must not throw
    expect(() => generateDashboard(null)).not.toThrow();
    expect(() => generateDashboard([])).not.toThrow();
  });
});

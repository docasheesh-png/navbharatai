// T1.3 (roadmap 2026-07-19) — Dashboard generator (product-scaffold slice 3).
//
// The audit's Feature-Completeness ❌ included "Dashboard". This emits a COMPLETE stats dashboard for a
// set of resources: a server endpoint that aggregates per-resource counts (total + created-in-the-last-7-
// days, soft-deleted rows excluded) on Prisma, and a React page that renders honest stat tiles. Reuses the
// shared Prisma client + error handler that generate_crud produces. Dependency-free.
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

function pascal(s: string): string {
  return String(s || 'Item')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Item';
}

function camelLower(pascalName: string): string {
  return pascalName.charAt(0).toLowerCase() + pascalName.slice(1);
}

function snakePlural(s: string): string {
  const snake = String(s || 'item')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '') || 'item';
  return /s$/.test(snake) ? snake : `${snake}s`;
}

export interface DashboardResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/**
 * Generate a stats dashboard (server aggregation endpoint + React page) for a set of resource/model
 * names. Pure — returns the files. Falls back to no-op files when no models are given. Never throws.
 */
export function generateDashboard(models: string[]): DashboardResult {
  const cleaned = (Array.isArray(models) ? models : [])
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  // De-dupe by Prisma model name.
  const seen = new Set<string>();
  const list = cleaned
    .map((name) => ({ model: camelLower(pascal(name)), label: snakePlural(name), display: pascal(name) }))
    .filter((m) => (seen.has(m.model) ? false : (seen.add(m.model), true)));
  const use = list.length ? list : [{ model: 'item', label: 'items', display: 'Item' }];

  const statLines = use
    .map(
      (m) =>
        `  stats[${JSON.stringify(m.label)}] = {\n` +
        `    total: await prisma.${m.model}.count({ where: { deletedAt: null } }),\n` +
        `    recent: await prisma.${m.model}.count({ where: { deletedAt: null, createdAt: { gte: since } } }),\n` +
        `  };`,
    )
    .join('\n');

  const routeFile = `import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/errorHandler';

// GET /api/dashboard/stats — per-resource totals + how many were created in the last 7 days.
// Soft-deleted rows (deletedAt) are excluded. Reuses the shared Prisma client from generate_crud.
const router = Router();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

router.get('/stats', asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - WEEK_MS);
  const stats: Record<string, { total: number; recent: number }> = {};
${statLines}
  res.json(stats);
}));

export default router;
`;

  const pageFile = `import { useEffect, useState } from 'react';

// Stats dashboard, bound to GET /api/dashboard/stats. Wire it into your router, e.g.
// <Route path="/dashboard" element={<Dashboard />} /> — guard it with requireRole for an admin area.

type Stat = { total: number; recent: number };
type Stats = Record<string, Stat>;

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/dashboard/stats')
      .then(async (r) => {
        if (!r.ok) throw new Error(\`Failed to load (\${r.status})\`);
        return (await r.json()) as Stats;
      })
      .then((s) => { if (alive) { setStats(s); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</h1>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#b4472f' }}>{error}</p>}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 16 }}>
          {Object.entries(stats).map(([name, stat]) => (
            <div key={name} style={{ border: '1px solid #e2e5e8', borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 13, color: '#666', textTransform: 'capitalize' }}>{name}</div>
              <div style={{ fontSize: 30, fontWeight: 800 }}>{stat.total}</div>
              <div style={{ fontSize: 12, color: '#2e8b57' }}>+{stat.recent} this week</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
`;

  return {
    files: {
      'server/routes/dashboard.routes.ts': routeFile,
      'src/pages/Dashboard.tsx': pageFile,
    },
    dependencies: [],
    instructions:
      `Created a stats dashboard: server/routes/dashboard.routes.ts (GET /api/dashboard/stats) + src/pages/Dashboard.tsx.\n` +
      `Mount the route: app.use('/api/dashboard', dashboardRouter); and add the page route: ` +
      `<Route path="/dashboard" element={<Dashboard />} />.\n` +
      `It reuses the shared Prisma client + error handler from generate_crud, and aggregates counts for: ` +
      `${use.map((m) => m.label).join(', ')}. Guard it with requireRole('admin') (generate_rbac) for an admin area.`,
  };
}

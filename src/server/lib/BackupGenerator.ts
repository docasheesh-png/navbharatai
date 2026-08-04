// T1.3 (roadmap 2026-07-19) — Backup / data-export generator (product-scaffold slice 4).
//
// The audit's Feature-Completeness ❌ included "Backup" and in-app "Export". This emits a real, complete
// data-export endpoint: GET /api/admin/backup streams every row of the given resources as a downloadable
// JSON snapshot (a genuine backup), on Prisma, reusing the shared client + error handler that generate_crud
// produces. Dependency-free. Guard it behind generate_rbac's requireRole('admin').
// PURE builder → the caller writes the file. Real, complete code — no stubs (the real-features rule).

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

export interface BackupResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/**
 * Generate a JSON data-export ("backup") endpoint for a set of resource/model names. Pure — returns the
 * file. Falls back to a single 'item' model when none given. Never throws.
 */
export function generateBackup(models: string[]): BackupResult {
  const cleaned = (Array.isArray(models) ? models : [])
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const list = cleaned
    .map((name) => ({ model: camelLower(pascal(name)), label: snakePlural(name) }))
    .filter((m) => (seen.has(m.model) ? false : (seen.add(m.model), true)));
  const use = list.length ? list : [{ model: 'item', label: 'items' }];

  const dumpLines = use
    .map((m) => `  data[${JSON.stringify(m.label)}] = await prisma.${m.model}.findMany();`)
    .join('\n');

  const routeFile = `import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/errorHandler';

// GET /api/admin/backup — a downloadable JSON snapshot of every row of each resource (a real backup).
// Reuses the shared Prisma client from generate_crud. Guard this route with requireRole('admin')
// (generate_rbac) — it exposes ALL data.
const router = Router();

router.get('/backup', asyncHandler(async (_req, res) => {
  const data: Record<string, unknown[]> = {};
${dumpLines}
  res.setHeader('Content-Disposition', 'attachment; filename="backup.json"');
  res.json({ exportedAt: new Date().toISOString(), data });
}));

export default router;
`;

  return {
    files: { 'server/routes/backup.routes.ts': routeFile },
    dependencies: [],
    instructions:
      `Created a data-export endpoint at server/routes/backup.routes.ts (GET /api/admin/backup). Mount it:\n` +
      `  app.use('/api/admin', requireRole('admin'), backupRouter); // guard it — it exposes ALL data\n` +
      `It downloads a JSON snapshot of every row of: ${use.map((m) => m.label).join(', ')}. Reuses ` +
      `generate_crud's Prisma client + error handler. For very large tables, stream/paginate the export later.`,
  };
}

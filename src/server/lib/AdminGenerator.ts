// T1.3 (roadmap 2026-07-19) — Admin panel generator (product-scaffold slice 2).
//
// The audit's Feature-Completeness ❌ included "Admin" — no recipe gave a generated app a working admin
// screen; it fell to the raw LLM. This emits a COMPLETE React admin page for one resource, bound to the
// endpoints that generate_crud produces (`/api/<resource>`): a paginated table of rows, per-row delete,
// and honest loading / error / empty states. Dependency-free (plain React + fetch).
// PURE builder → the caller writes the file. Real, complete code — no stubs (the real-features rule).

import { type MigrationEntity, type MigrationField } from '../AppMakerLab/generator/MigrationGenerator';

export interface AdminResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

function pascal(s: string): string {
  return String(s || 'Item')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Item';
}

function snakePlural(s: string): string {
  const snake = String(s || 'item')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '') || 'item';
  return /s$/.test(snake) ? snake : `${snake}s`;
}

/** Auto-managed columns the create/update forms never set (shown read-only in the table). */
function isManaged(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return n === 'id' || n === 'createdat' || n === 'created_at' || n === 'created'
    || n === 'updatedat' || n === 'updated_at' || n === 'updated'
    || n === 'deletedat' || n === 'deleted_at' || n === 'deleted';
}

/**
 * Generate a React admin page for one resource, bound to generate_crud's REST endpoints. Pure — returns
 * the file to write. Never throws.
 */
export function generateAdmin(entity: MigrationEntity): AdminResult {
  const safeName = entity && entity.name ? entity.name : 'Item';
  const Model = pascal(safeName);
  const route = snakePlural(safeName);
  const fields = (entity?.fields || []).filter((f: MigrationField) => f && f.name);
  const writable = fields.filter((f) => !isManaged(f.name)).map((f) => String(f.name));
  // Table columns: id + the writable fields + createdAt (a sensible, stable default view).
  const columns = ['id', ...writable, 'createdAt'];
  const columnsLiteral = JSON.stringify(columns);

  const page = `import { useCallback, useEffect, useState } from 'react';

// Admin panel for ${Model}, bound to the generate_crud REST endpoints (GET/DELETE /api/${route}).
// Wire it into your router, e.g. <Route path="/admin/${route}" element={<${Model}Admin />} />.

type Row = { id: string; [key: string]: unknown };
type Page = { data: Row[]; page: number; limit: number; total: number; totalPages: number };

const API = '/api/${route}';
const COLUMNS: string[] = ${columnsLiteral};
const LIMIT = 20;

export default function ${Model}Admin() {
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(\`\${API}?page=\${page}&limit=\${LIMIT}\`);
      if (!res.ok) throw new Error(\`Failed to load (\${res.status})\`);
      setPageData((await res.json()) as Page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm('Delete this ${Model}?')) return;
    const res = await fetch(\`\${API}/\${id}\`, { method: 'DELETE' });
    if (res.ok) void load();
    else window.alert(\`Delete failed (\${res.status})\`);
  }, [load]);

  const rows = pageData?.data ?? [];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>${Model} admin</h1>
      {error && <p style={{ color: '#b4472f' }}>{error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && !error && rows.length === 0 && <p style={{ color: '#666' }}>No ${route} yet.</p>}
      {!loading && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} style={{ textAlign: 'left', borderBottom: '2px solid #ddd', padding: '8px 6px' }}>{c}</th>
              ))}
              <th style={{ borderBottom: '2px solid #ddd', padding: '8px 6px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {COLUMNS.map((c) => (
                  <td key={c} style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                    {row[c] === null || row[c] === undefined ? '' : String(row[c])}
                  </td>
                ))}
                <td style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                  <button onClick={() => void remove(row.id)} style={{ color: '#b4472f' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pageData && pageData.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span>Page {pageData.page} of {pageData.totalPages} ({pageData.total} total)</span>
          <button disabled={page >= pageData.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
`;

  return {
    files: { [`src/admin/${Model}Admin.tsx`]: page },
    dependencies: [],
    instructions:
      `Created a React admin page for ${Model} at src/admin/${Model}Admin.tsx. Add a route to it, e.g.\n` +
      `  <Route path="/admin/${route}" element={<${Model}Admin />} />\n` +
      `It reads GET /api/${route} (paginated) and DELETE /api/${route}/:id — the endpoints generate_crud ` +
      `produces for this resource. Guard the route with requireRole('admin') (generate_rbac) for a real admin area.`,
  };
}

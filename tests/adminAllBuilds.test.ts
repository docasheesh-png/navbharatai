import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { workspaceOwnerUid } from '../src/server/AgentV3/DiagnosticsStore';

/**
 * ALL BUILDS admin browser (admin 2026-08-06: "koi bhi user kuch bhi app banaye — admin apne panel
 * se puri 0→100% build report download kar sake, user ke report send kiye bina"). The engine already
 * records every build durably; these invariants pin the admin's global window over it: admin-token
 * on every route, downloads that always load (session cap), and a listing query that can never
 * silently FAILED_PRECONDITION.
 */

describe('workspaceOwnerUid', () => {
  it('extracts the uid from a v5 workspace id; anon and junk yield null', () => {
    expect(workspaceOwnerUid('agentv3-Uid_123-1699999999999')).toBe('Uid_123');
    expect(workspaceOwnerUid('agentv3-anon-1699999999999')).toBeNull();
    expect(workspaceOwnerUid('something-else')).toBeNull();
    expect(workspaceOwnerUid('')).toBeNull();
    expect(workspaceOwnerUid(null)).toBeNull();
  });
});

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const adminRoutes = readFileSync(join(__dirname, '..', 'src/server/routes/admin.ts'), 'utf8');
const store = readFileSync(join(__dirname, '..', 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8');
const dashboard = readFileSync(join(__dirname, '..', 'src/components/AdminDashboard.tsx'), 'utf8');

describe('all-builds admin routes', () => {
  it('all three routes exist and each sits behind verifyAdminToken (never user-reachable)', () => {
    for (const route of ["'/api/admin/all-builds'", "'/api/admin/all-builds/:workspaceId'", "'/api/admin/all-builds/:workspaceId/download'"]) {
      const at = adminRoutes.indexOf(route);
      expect(at, `${route} missing`).toBeGreaterThan(-1);
      expect(adminRoutes.slice(at, at + 120)).toContain('verifyAdminToken');
    }
  });

  it('the session download is byte-capped exactly like the user-side stitch (it must actually LOAD)', () => {
    const code = stripComments(adminRoutes);
    const dl = code.indexOf("'/api/admin/all-builds/:workspaceId/download'");
    const seg = code.slice(dl, dl + 2600);
    expect(seg).toContain('capSessionReports(ordered)');
    expect(seg).toContain('omittedBuilds: omitted'); // truncation is counted, never silent
    expect(seg).toContain('Content-Disposition');
  });

  it('the global listing uses ONE auto-indexed orderBy — no composite/collection-group index to silently fail on', () => {
    const code = stripComments(store);
    const at = code.indexOf('export async function listAllDiagnostics');
    const seg = code.slice(at, at + 900);
    expect(seg).toContain(".orderBy('savedAt', 'desc')");
    expect(seg).not.toContain('.where(');
    expect(seg).not.toContain('collectionGroup');
  });
});

describe('admin dashboard surface', () => {
  it('the All Builds section is mounted in the reports tab with search, expand and both downloads', () => {
    expect(dashboard).toContain('All builds — every user, no submit needed');
    expect(dashboard).toContain('fetchAllBuilds');
    expect(dashboard).toContain('expandWorkspaceBuilds');
    expect(dashboard).toContain('downloadWorkspaceReport(b.workspaceId)');       // full session
    expect(dashboard).toContain('downloadWorkspaceReport(b.workspaceId, h.id)'); // one build
  });

  it('downloads carry the admin token on fetch (a plain link cannot) and land as a .json file', () => {
    const at = dashboard.indexOf('const downloadWorkspaceReport');
    const seg = dashboard.slice(at, at + 1200);
    expect(seg).toContain('{ headers }');
    expect(seg).toContain('.json');
    expect(seg).toContain('URL.createObjectURL');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadHeadline } from './LoadBoard';

/**
 * THE LOAD BOARD (ROADMAP §12) — the screen for `/api/admin/load`.
 *
 * The route has existed for weeks with NOTHING rendering it. These tests pin the two things that
 * make the screen worth having: it is actually mounted on the admin's home page, and an unreadable
 * ceiling never reads as a healthy one.
 */

const tile = (id: string, level: string, display = '1 / 10') =>
  ({ id, label: id, level, value: 1, cap: 10, display, note: '' } as Record<string, unknown>);

describe('loadHeadline', () => {
  it('names the ceilings that need attention, not just a count', () => {
    const out = loadHeadline({
      level: 'warn',
      tiles: [tile('Instances', 'ok'), tile('Published apps', 'warn')],
      unknown: [],
    } as never, '');
    expect(out).toContain('Published apps');
  });

  it('🔒 never says "all clear" while a ceiling is UNMEASURED', () => {
    // A board with green tiles and an unreadable one is not a healthy platform — it is a platform we
    // cannot see. This is the single failure that would make the screen worse than not having it.
    const out = loadHeadline({
      level: 'unknown',
      tiles: [tile('a', 'ok'), tile('b', 'ok'), tile('c', 'unknown', 'unknown')],
      unknown: ['c'],
    } as never, '');
    expect(out).toContain('could not be measured');
    expect(out.toLowerCase()).not.toContain('all clear');
    expect(out).not.toMatch(/^All \d+ ceilings measured/);
  });

  it('says all clear ONLY when every ceiling was genuinely read', () => {
    const out = loadHeadline({ level: 'ok', tiles: [tile('a', 'ok'), tile('b', 'ok')], unknown: [] } as never, '');
    expect(out).toBe('All 2 ceilings measured and have room.');
  });

  it('🔒 a failed fetch is UNKNOWN, never an empty healthy board', () => {
    expect(loadHeadline(null, 'boom')).toContain('UNKNOWN, not clear');
    // The error wins even when stale tiles are still on screen.
    expect(loadHeadline({ level: 'ok', tiles: [tile('a', 'ok')], unknown: [] } as never, 'boom'))
      .toContain('UNKNOWN, not clear');
  });

  it('an empty board says so rather than claiming health', () => {
    expect(loadHeadline({ level: 'unknown', tiles: [], unknown: [] } as never, '')).toBe('No ceilings reported yet.');
  });
});

describe('🔒 the wiring — an API with no screen is not a feature', () => {
  const dash = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  const board = readFileSync(join(process.cwd(), 'src/components/admin/LoadBoard.tsx'), 'utf8');

  it('the board is mounted on the admin HOME tab', () => {
    expect(dash).toContain("import { LoadBoard } from './admin/LoadBoard'");
    const at = dash.indexOf("{activeTab === 'monitor' && (");
    expect(at).toBeGreaterThan(-1);
    expect(dash.slice(at, at + 1400)).toContain('<LoadBoard adminToken={adminToken} />');
  });

  it('it reads the real route — no placeholder data anywhere on this screen', () => {
    expect(board).toContain("fetch('/api/admin/load'");
    expect(board).toContain("'x-admin-token': adminToken");
  });

  it('🔒 it renders the ROUTE’s own display string, so screen and API cannot disagree', () => {
    // Re-deriving "3 / 10" in the client is how a screen starts printing 0 for a ceiling the server
    // reported as unreadable.
    expect(board).toContain('{t.display}');
  });

  it('the hosting checks are on a button, not on every home-page visit', () => {
    // They make real Google API calls; firing them on load would spend quota to render "not on".
    expect(board).toContain('hostingOpen');
    expect(board).toContain("fetch('/api/admin/hosting/preflight'");
    expect(board).toContain("fetch('/api/admin/hosting/services'");
    // The ONLY thing that runs on mount is the load fetch.
    const mountEffects = board.match(/useEffect\([^;]*;/g) || [];
    expect(mountEffects.length).toBe(1);
    expect(mountEffects[0]).toContain('fetchLoad');
    expect(mountEffects[0]).not.toContain('fetchHosting');
  });
});

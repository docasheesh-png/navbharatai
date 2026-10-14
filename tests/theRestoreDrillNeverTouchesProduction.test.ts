// Go-live safety PR 7: restore drill is dry-run by default and can never target production.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
// @ts-expect-error — plain .mjs script module, no types
import { buildDrillPlan, validateDrill, PRODUCTION_DATABASE_IDS } from '../scripts/restoreDrillPlan.mjs';

const ok = { project: 'gen-lang-client-0866594388', exportPrefix: 'gs://nb-backups/firestore-backups/2026-10-13', targetDatabase: 'drill-2026-10-13', location: 'asia-southeast1' };

describe('restore drill plan', () => {
  it('builds create → import → counts → delete, all on the drill database', () => {
    const p = buildDrillPlan(ok);
    expect(p.ok).toBe(true);
    const cmds = p.steps.filter((s: any) => s.argv).map((s: any) => s.argv.join(' '));
    expect(cmds[0]).toContain('databases create --database=drill-2026-10-13');
    expect(cmds[1]).toContain('firestore import gs://nb-backups');
    expect(cmds.at(-1)).toContain('databases delete --database=drill-2026-10-13');
    for (const c of cmds) expect(c).toContain('drill-2026-10-13');
  });
  it('refuses every production database id and any non-drill name', () => {
    for (const id of [...PRODUCTION_DATABASE_IDS, 'prod', 'drill-', 'Drill-x', 'drill-x; rm -rf /']) {
      expect(validateDrill({ ...ok, targetDatabase: id }).ok, id).toBe(false);
    }
  });
  it('refuses a non-gs export and unsafe characters', () => {
    expect(validateDrill({ ...ok, exportPrefix: '/tmp/x' }).ok).toBe(false);
    expect(validateDrill({ ...ok, project: 'a b' }).ok).toBe(false);
  });
  it('the CLI is dry-run by default and refuses --execute without owner approval', () => {
    const base = ['scripts/restoreDrill.mjs', '--project', ok.project, '--export', ok.exportPrefix, '--target', ok.targetDatabase, '--location', ok.location];
    expect(execFileSync('node', base, { encoding: 'utf8' })).toContain('[DRY-RUN]');
    let code = 0;
    try { execFileSync('node', [...base, '--execute'], { stdio: 'pipe' }); } catch (e: any) { code = e.status; }
    expect(code).toBe(2);
  });
});

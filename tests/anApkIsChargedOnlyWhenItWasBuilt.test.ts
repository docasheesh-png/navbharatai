// AN APK IS CHARGED ONLY WHEN IT WAS BUILT, AND ONLY WHEN THE USER COMES BACK TO IT (admin 2026-10-11, Q-165:
// "when the user comes back, the APK build's real status is read; it is charged only on success").
//
// The decision was already the behaviour, built on 2026-08-17 — this test is what keeps it so. The ₹1 lives
// on `/api/mobile-ship/artifacts`, which charges only when GitHub published a file (a failed run publishes
// none). A user who left mid-build is charged nothing until they open the app again: "My built apps" reads
// the run's real status FIRST, and reaches the charging call only for a run that succeeded. THE CLASS: a
// charge that fires before the result is known. Both halves are pinned, so neither can drift on its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the returning user', () => {
  const panel = code('src/components/ide/MyBuiltApps.tsx');
  const check = panel.slice(panel.indexOf('const checkApp = useCallback'), panel.indexOf('}, [ghHeaders]);', panel.indexOf('const checkApp = useCallback')));

  it('🔒 reads the run\'s real status before anything that can charge', () => {
    const runs = check.indexOf('/api/mobile-ship/runs?');
    const building = check.indexOf("if (run.status !== 'completed')");
    const failed = check.indexOf("if (run.conclusion !== 'success')");
    const artifacts = check.indexOf('/api/mobile-ship/artifacts?');
    expect(runs).toBeGreaterThan(-1);
    expect(building).toBeGreaterThan(runs);
    expect(failed).toBeGreaterThan(building);
    // the charging call comes only after both early returns
    expect(artifacts).toBeGreaterThan(failed);
    expect(check.slice(building, failed)).toContain('return;');
    expect(check.slice(failed, artifacts)).toContain('return;');
  });

  it('opening an app is what reads it — nothing charges a user who never comes back', () => {
    expect(panel).toContain('if (next && !state[app.id]) void checkApp(app);');
  });
});

describe('the charge', () => {
  const route = code('src/server/routes/mobileShip.ts');
  const artifacts = route.slice(route.indexOf("app.get('/api/mobile-ship/artifacts'"), route.indexOf("app.get('/api/mobile-ship/download'"));

  it('🔒 lives on the artifacts call, once per built file, and never on the trigger', () => {
    expect(artifacts).toContain('debitWalletForBuild(');
    expect(artifacts).toContain('buildRef: apkChargeRef(owner, repo, String(a.id))');
    const trigger = route.slice(route.indexOf("app.post('/api/mobile-ship/trigger'"), route.indexOf("app.post('/api/mobile-ship/autofix'"));
    expect(trigger).not.toContain('debitWalletForBuild(');
  });
});

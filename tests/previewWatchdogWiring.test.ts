import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The sandbox-cost leak this pins (admin 2026-08-17): a Live preview left behind while the user moved
 * to chat kept polling `/api/agentv3/preview-health` every 150s. That route runs a real command in the
 * sandbox, every sandbox command refreshes the idle clock, and the idle sweep pauses at 300s — so the
 * sweep could never win and a billed E2B VM stayed awake until the browser tab closed.
 *
 * The unit tests next to `shouldWatchLivePreview` prove the RULE. These prove it is actually WIRED,
 * which is the half that silently rots: the rule can be perfect while a call site quietly stops
 * passing the truth, and nothing fails.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the preview watchdog is gated on real in-app visibility', () => {
  it('PreviewSurface decides through the shared rule, not an ad-hoc condition', () => {
    const src = read('src/components/agentv3/PreviewSurface.tsx');
    expect(src).toContain("import { shouldWatchLivePreview } from './previewKeepAlive'");
    // Both the probe and the interval must consult it, or they can drift apart and the interval keeps
    // firing while the probe declines — which is the leak, with extra steps.
    expect(src.split('shouldWatchLivePreview({').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('paneVisible is in the watcher effect deps, so leaving Preview tears the timer down', () => {
    // Without this the effect would keep its original closure and the interval would survive the
    // switch to chat — the exact bug, reintroduced through a dependency array.
    const src = read('src/components/agentv3/PreviewSurface.tsx');
    const deps = src.match(/\[autoResume, mode, workspaceId, paneVisible[^\]]*\]/g) ?? [];
    expect(deps.length).toBeGreaterThanOrEqual(2);
  });

  it('the ONE mount that survives hiding passes the REAL value', () => {
    // AgentV3Panel deliberately keeps the pane mounted (previewKeepAlive) so a detour does not destroy
    // the iframe. That makes it the only call site where a hardcoded `true` would be a lie.
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('paneVisible={previewVisible(showWorkspace, tab)}');
  });

  it('every other mount passes it too — the prop is required so none can forget', () => {
    // These two unmount when hidden, so a literal is correct for them. The value of the prop being
    // REQUIRED is that a future hidden-mount call site cannot compile without deciding.
    expect(read('src/components/panels/ViewPanels.tsx')).toContain('paneVisible');
    expect(read('src/components/ide/CodeStudio.tsx')).toContain('paneVisible');
  });

  it('the health route really does touch the sandbox — the premise of this whole gate', () => {
    // If this ever stops being true the gate becomes belt-and-braces rather than load-bearing, and
    // whoever changes it should see this test and know that.
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf("'/api/agentv3/preview-health'");
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 4000)).toContain('actuator.runCommand');
  });
});

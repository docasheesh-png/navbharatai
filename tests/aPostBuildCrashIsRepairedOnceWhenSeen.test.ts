// A CRASH THE USER HITS AFTER THE BUILD ENDED IS REPAIRED ONCE, AUTOMATICALLY, WHEN THE PLATFORM SEES IT TOO
// (Q-148, admin-approved (b) 2026-10-05). Before this, `/preview-error` only wrote the crash into the report.
// Option (b): paid builds only, once per build, and only for a crash reproduced in the platform's own browser.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoRepairDecision, autoRepairPrecheck, autoRepairPrompt, ranOnPaidTier, previewAutoRepairEnabled,
} from '../src/server/AgentV3/previewAutoRepair';

const paidEnded = { buildEnded: true, powerLevel: 'medium', noClaude: false, previewAutoRepairAt: null };

describe('the decision', () => {
  it('repairs a reproduced crash on an ended paid build, the first time', () => {
    expect(autoRepairDecision({ ...paidEnded, reproduced: true })).toMatchObject({ run: true });
  });

  it('never while the build runs', () => {
    expect(autoRepairDecision({ ...paidEnded, buildEnded: false, reproduced: true }).run).toBe(false);
  });

  it('once per build', () => {
    expect(autoRepairDecision({ ...paidEnded, previewAutoRepairAt: 1_700_000_000_000, reproduced: true }).run).toBe(false);
  });

  it('never on the free tier, and never on an unknown tier', () => {
    expect(ranOnPaidTier({ powerLevel: 'weak' })).toBe(false);
    expect(ranOnPaidTier({ powerLevel: 'max', noClaude: true })).toBe(false);
    expect(ranOnPaidTier({ powerLevel: null })).toBe(false);
    expect(ranOnPaidTier({ powerLevel: 'mini' })).toBe(true);
    expect(autoRepairDecision({ ...paidEnded, powerLevel: 'weak', reproduced: true }).run).toBe(false);
  });

  it('never for a crash the platform did not see, or could not look for — and says which', () => {
    const notSeen = autoRepairDecision({ ...paidEnded, reproduced: false });
    const couldNotLook = autoRepairDecision({ ...paidEnded, reproduced: null });
    expect(notSeen.run).toBe(false);
    expect(couldNotLook.run).toBe(false);
    expect(notSeen.reason).toContain('did not see this crash');
    expect(couldNotLook.reason).toContain('could not open the app');
  });

  it('the cheap checks run before any sandbox work', () => {
    expect(autoRepairPrecheck(paidEnded)).toBeNull();
    expect(autoRepairPrecheck({ ...paidEnded, powerLevel: 'weak' })).not.toBeNull();
  });

  it('the repair request carries what the preview reported and what the platform saw', () => {
    const p = autoRepairPrompt('TypeError: x is undefined', ['TypeError: x is undefined at App.tsx:12']);
    expect(p).toContain('Automatic repair (once)');
    expect(p).toContain('App.tsx:12');
  });

  it('has a kill switch, default on', () => {
    expect(previewAutoRepairEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(previewAutoRepairEnabled({ AGENTV3_PREVIEW_AUTO_REPAIR: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('the wiring', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const surface = readFileSync(join(__dirname, '..', 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
  const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

  it('the route is owner-checked, reproduces only on an awake sandbox, and claims the build before answering', () => {
    const start = route.indexOf("app.post('/api/agentv3/preview-error/auto-repair'");
    const body = route.slice(start, start + 4500);
    expect(body).toContain('assertWorkspaceOwner(req, workspaceId)');
    expect(body).toContain('if (sandboxDiag().livePreviewAvailable)');
    expect(body).toContain('if (sandboxId && actuator.browseUrl && actuator.getConsoleErrors)');
    expect(body).toContain('previewAutoRepairAt: Date.now()');
  });

  it('the preview asks only after the build ended, once per mount, and the panel never sends over a running build', () => {
    expect(surface).toContain('if (onAutoRepair && !buildingRef.current && !autoRepairAsked.current)');
    expect(panel).toMatch(/onAutoRepair=\{\(repairPrompt\) => \{[\s\S]{0,300}if \(running\) return;/);
  });
});

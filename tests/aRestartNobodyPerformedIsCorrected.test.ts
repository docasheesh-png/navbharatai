// Q-2714 (autopsy 57604006, build 1712adfa, 2026-11-17). The summary told the user "the earlier 'preview not running'
// issue was temporary — the server had gone stale. It's now restarted", while the build's only launch had answered
// "dev server already healthy on port 5173 — reused it (no relaunch)" and no outage was ever recorded.
import { describe, expect, it } from 'vitest';
import { auditSummaryClaims, claimCorrection } from '../src/server/AgentV3/claimAudit';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const SENTENCE = '⚠️ The earlier "preview not running" issue was temporary — the server had gone stale. It\'s now restarted and healthy. If it ever looks stuck again, just ask me to restart the preview.';
const REUSED = '[health-check] dev server already healthy on port 5173 — reused it (no relaunch; edits apply via HMR).\n[health-check] dev server is UP on port 5173. Call update_preview with port=5173.';
const base = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };

describe('the command log settles whether the dev server was relaunched', () => {
  it("build 1712adfa's own launch output reads 'reused'", () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run dev', exitCode: 0, stdout: REUSED });
    expect(d.devServerLaunchEvidence()).toBe('reused');
  });
  it('a real launch, or the platform starting the app itself, reads relaunched; no launch at all settles nothing', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run dev', exitCode: 0, stdout: REUSED });
    d.recordCommand({ command: 'npm run dev', exitCode: 0, stdout: '[health-check] dev server is UP on port 5173. Call update_preview with port=5173.' });
    expect(d.devServerLaunchEvidence()).toBe('relaunched');
    const p = new BuildDiagnostics();
    p.recordCommand({ command: 'npm run dev', exitCode: 0, stdout: REUSED });
    p.record({ phase: 'preview', severity: 'info', code: 'PLATFORM_PREVIEW_UP', message: 'started' });
    expect(p.devServerLaunchEvidence()).toBe('relaunched');
    expect(new BuildDiagnostics().devServerLaunchEvidence()).toBeUndefined();
  });
});

describe('a restart claim is corrected only when nothing was restarted', () => {
  it('the reported sentence, verbatim, on a reused server → corrected', () => {
    const c = auditSummaryClaims(SENTENCE, { ...base, devServerLaunch: 'reused' });
    expect(c.map((x) => x.kind)).toContain('restart-claimed');
    expect(claimCorrection(c)).toMatch(/already running and was reused/);
  });
  it('stands when the server really was relaunched, or when the log does not say', () => {
    expect(auditSummaryClaims(SENTENCE, { ...base, devServerLaunch: 'relaunched' }).map((x) => x.kind)).not.toContain('restart-claimed');
    expect(auditSummaryClaims(SENTENCE, base).map((x) => x.kind)).not.toContain('restart-claimed');
  });
  it('an offer to restart later is not a claim', () => {
    expect(auditSummaryClaims('If it ever looks stuck again, just ask me to restart the preview.', { ...base, devServerLaunch: 'reused' }).map((x) => x.kind)).not.toContain('restart-claimed');
  });
});

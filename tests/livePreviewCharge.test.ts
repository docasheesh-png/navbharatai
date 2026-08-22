import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { userCostBreakdown, livePreviewChargeLine } from '../src/server/routes/agentv3';

/**
 * THE LIVE-PREVIEW CHARGE, NAMED WHERE THE USER READS IT.
 *
 * ADMIN 2026-08-22: *"live preview (e2b) ka charge user se lena compulsory ho. user ke build
 * successful wale last message me live preview charge likh kar aye."*
 *
 * The CHARGE was already real — `AGENTV3_BILL_SANDBOX=on` with a measured `E2B_USD_PER_HOUR` has
 * billed sandbox seconds into every build since 2026-08-13, and `billableSandboxDetail` already caps
 * them at the build's own duration so idle minutes between builds are never sold twice. What did not
 * exist was the user being TOLD: it was folded into one total, which is how a correct charge still
 * reads as a deduction.
 *
 * 🔒 WHITE-LABEL LAW. §1 explicitly allows an itemised breakdown in NavBharatAI's own user-facing
 * categories; what it forbids is itemising by VENDOR. "Live preview" is our category — the same words
 * the Preview tab already shows the user — and the vendor's name appears nowhere.
 */

describe('userCostBreakdown carries the live-preview charge', () => {
  const usage = { inputTokens: 1000, outputTokens: 500 };

  it('reports the seconds and the ₹ derived from the SAME rate as the total', () => {
    const b = userCostBreakdown(usage, 1, 'off', 87, { seconds: 240, usd: 0.09 });
    expect(b.livePreviewSeconds).toBe(240);
    expect(b.livePreviewInr).toBeCloseTo(7.83, 2); // 0.09 × 87
    expect(b.billedInr).toBeCloseTo(87, 2);
  });

  it('shows NOTHING when the charge is zero — including when seconds were measured', () => {
    // The feature off, or no rate configured: we held the VM but charged nothing, so there is no line.
    // A "0 min — ₹0.00" row on every build is noise that teaches the user to stop reading the panel.
    expect(userCostBreakdown(usage, 1, 'off', 87, { seconds: 240, usd: 0 }).livePreviewSeconds).toBe(0);
    expect(userCostBreakdown(usage, 1, 'off', 87, null).livePreviewInr).toBe(0);
    expect(userCostBreakdown(usage, 1, 'off', 87).livePreviewInr).toBe(0);
  });

  it('never leaks the vendor — the law this line had to be written under', () => {
    const b = userCostBreakdown(usage, 1, 'max', 87, { seconds: 600, usd: 0.5 });
    const json = JSON.stringify(b).toLowerCase();
    for (const banned of ['e2b', 'sandbox', 'vm', 'firebase', 'aws', 'anthropic', 'claude', 'glm', 'kimi', 'gemini']) {
      expect(json).not.toContain(banned);
    }
    expect(b.engine).toBe('NavBharatAI Pro v5.0');
  });
});

describe('livePreviewChargeLine — the sentence in the success message', () => {
  it('names the time, the money, and the free alternative', () => {
    const line = livePreviewChargeLine({ livePreviewSeconds: 240, livePreviewInr: 7.83 });
    expect(line).toContain('Live preview');
    expect(line).toContain('4 min');
    expect(line).toContain('₹7.83');
    // Telling the user how to spend less is what makes the total worth reading rather than auditing.
    expect(line).toContain('in-browser preview is free');
  });

  it('uses seconds when a build held the preview for under a minute', () => {
    expect(livePreviewChargeLine({ livePreviewSeconds: 35, livePreviewInr: 1.2 })).toContain('35 sec');
  });

  it('is EMPTY when there is nothing to charge — no line, not a ₹0 line', () => {
    expect(livePreviewChargeLine({ livePreviewSeconds: 0, livePreviewInr: 0 })).toBe('');
    expect(livePreviewChargeLine({ livePreviewSeconds: 240, livePreviewInr: 0 })).toBe('');
    expect(livePreviewChargeLine({ livePreviewSeconds: 0, livePreviewInr: 5 })).toBe('');
  });
});

// ── The wiring: one measurement, two uses ───────────────────────────────────
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the number on the bill and the number on the screen are the same number', () => {
  it('the build measures live preview ONCE and feeds both the bill and the breakdown', () => {
    // Two measurements taken at different moments would count different seconds, and only the user
    // would ever notice the disagreement.
    expect(route).toContain('const livePreviewCharge = billableSandboxDetail(actuator, workspaceId, buildStartedAt);');
    expect(route).toContain('email, livePreviewCharge.usd)');
    expect(route).toContain('usdInrRate(), livePreviewCharge)');
  });

  it('the watchdog path does the same, so a time-capped build bills and reports identically', () => {
    // Fix 67's lesson: the finalizer used to bill by a different formula than the normal settle.
    expect(route).toContain('watchdogLivePreview = billableSandboxDetail(');
    expect(route).toContain('usdInrRate(), watchdogLivePreview)');
  });

  it('the charge line rides on a SUCCESSFUL build only', () => {
    expect(route).toContain('costBreakdown && result.ok ? livePreviewChargeLine(costBreakdown)');
  });

  it('idle time between builds is still never billed — the cap that predates this change', () => {
    // Charging for the reaper's own idle window would be charging for our convenience.
    expect(route).toContain('Math.min(seconds, buildSeconds)');
  });
});

describe('the client renders it without inventing anything', () => {
  const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

  it('shows the row only when a real charge arrived', () => {
    expect(panel).toContain("typeof state.costBreakdown.livePreviewInr === 'number' && state.costBreakdown.livePreviewInr > 0");
  });

  it('an older server that sends no such field renders no row rather than "undefined"', () => {
    const types = readFileSync(join(process.cwd(), 'src/components/agentv3/agentV3Types.ts'), 'utf8');
    expect(types).toContain('livePreviewSeconds?: number;');
    expect(types).toContain('livePreviewInr?: number;');
  });
});

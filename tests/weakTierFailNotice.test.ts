import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { weakTierBuildFailedNotice } from '../src/server/AgentV3/weakTierNotice';

// Regression lock for the 2026-09-14 fix (admin: "app fail ho jaye kisi bhi reason se, to user ko
// batao ki free plan me complex app nahi ban sakti"). The weak-tier "this app is complex, upgrade"
// notice must fire ONLY when the failure is genuinely about the weak tier's own capability — never
// when the real cause is our own cost-ceiling stop, a sandbox/infra outage, or a degraded provider.
// Before this fix, the gate at the notice's call site only checked
// `!result.ok && noClaudeBuild && expectsArtifacts`, so all three non-capability causes could reach it.

describe('weak-tier build-failed notice — only fires on a genuine capability failure', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('🔒 the gate excludes a cost-ceiling stop, a sandbox outage, and a degraded provider', () => {
    const at = route.indexOf('WEAK-TIER FAILURE GUIDANCE');
    expect(at).toBeGreaterThan(-1);
    const callAt = route.indexOf('weakTierBuildFailedNotice(failLang)', at);
    expect(callAt).toBeGreaterThan(at);
    // The whole gated `if (...)` block sits between the comment and the call — read that slice and
    // check every non-capability cause is excluded, rather than assuming the exact byte layout.
    const block = route.slice(at, callAt);
    expect(block).toContain('!sandboxUnavailable');
    expect(block).toContain('!costCeilingFired');
    expect(block).toContain('!providerFailuresLookDegraded(buildDiag.providerFailureBreakdown())');
    // The original capability gate must still be present — this is an ADDITION, not a replacement.
    expect(block).toContain('!result.ok');
    expect(block).toContain('noClaudeBuild');
    expect(block).toContain('expectsArtifacts');
  });

  it('the kill switch AGENTV3_WEAK_FAIL_NOTICE=off is untouched', () => {
    expect(route).toContain("(process.env.AGENTV3_WEAK_FAIL_NOTICE ?? '').trim().toLowerCase() !== 'off'");
  });
});

describe('weakTierBuildFailedNotice — the message text itself is unchanged by this fix', () => {
  it('names the tiers, never a provider/model — white-label law', () => {
    const en = weakTierBuildFailedNotice(null);
    expect(en).toContain('Strong');
    expect(en).toMatch(/complex app/i);
    for (const forbidden of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'Anthropic', 'glm-', 'kimi-', 'claude-']) {
      expect(en.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('returns a real string for every language it claims to support', () => {
    for (const lang of ['hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar', null, 'zz']) {
      const out = weakTierBuildFailedNotice(lang as string | null);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(20);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideMarkupOnProof, markupNeedsPreview } from '../src/server/AgentV3/previewEarnsMarkup';

/**
 * ADMIN-MANDATED 2026-09-18, on autopsy `1a7f4a58`:
 *   *"app बनी = preview चला — aur paise tabhi charge hone chahiye, jab preview chale"*
 *   and, choosing between three options: *"(c) सिर्फ़ असली लागत लें, बिना markup"*.
 *
 * The exact numbers from that build's billing record, so this is a replay and not a scenario:
 *
 *     billedUsd      6.389103     billedInr  613.08      ⇒ ₹/USD = 95.956
 *     realCostUsd    1.698349     (tokens)
 *     sandboxCostUsd 0.098019     (the VM, capped to this build's own window)
 *
 * And the formula it came from reproduces exactly, which is what makes these the real figures:
 *     tieredMarkup(1.698349 + 0.098019) = 4 + (0.796368 × 3) = 6.389104
 */
const REPORT = { billedUsd: 6.389103, realCostUsd: 1.698349, sandboxCostUsd: 0.098019, inrPerUsd: 613.08 / 6.389103 };

describe('🔴 REPLAYS THE REPORT: ₹613 on a free wallet for a build nobody could show working', () => {
  const decide = (over: Partial<Parameters<typeof decideMarkupOnProof>[0]> = {}) => decideMarkupOnProof({
    decidedBilledUsd: REPORT.billedUsd,
    realCostUsd: REPORT.realCostUsd,
    sandboxUsd: REPORT.sandboxCostUsd,
    previewProven: false,
    expectsArtifacts: true,
    ...over,
  });

  it('🔒 the margin is waived — the user pays what the build cost us, and nothing on top', () => {
    const d = decide();
    expect(d.markupApplied).toBe(false);
    expect(d.billedUsd).toBeCloseTo(REPORT.realCostUsd + REPORT.sandboxCostUsd, 6);
  });

  it('🔒 in rupees: ₹613.08 becomes ₹172.37', () => {
    const inr = decide().billedUsd * REPORT.inrPerUsd;
    expect(Math.round(inr * 100) / 100).toBe(172.37);
    // ⚠️ Recorded because I first told the admin "~₹145" in chat. That was wrong: it priced the tokens
    // and forgot the sandbox, which the bill's own formula includes BEFORE the markup. The correct
    // answer is ₹172.37, and this test is what pins it.
    expect(inr).toBeGreaterThan(145);
  });

  it('the old behaviour, pinned: without this rule the full markup stood', () => {
    const off = decide({ enabled: false });
    expect(off.markupApplied).toBe(true);
    expect(off.billedUsd).toBe(REPORT.billedUsd);
    expect(off.billedUsd * REPORT.inrPerUsd).toBeCloseTo(613.08, 1);
  });

  it('the user is told, in branded words with no vendor name in them', () => {
    const msg = decide().userMessage;
    expect(msg).toContain('could not confirm your app running');
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'Moonshot', 'Anthropic', 'OpenAI', 'Z.ai']) {
      expect(msg).not.toContain(vendor);
    }
  });
});

describe('🔒 a proven preview earns the margin — nothing about a working build changes', () => {
  it('previewProven ⇒ byte-identical to today', () => {
    const d = decideMarkupOnProof({
      decidedBilledUsd: REPORT.billedUsd,
      realCostUsd: REPORT.realCostUsd,
      sandboxUsd: REPORT.sandboxCostUsd,
      previewProven: true,
      expectsArtifacts: true,
    });
    expect(d.markupApplied).toBe(true);
    expect(d.billedUsd).toBe(REPORT.billedUsd);
    expect(d.reason).toBe('');
    expect(d.userMessage).toBe('');
  });

  it('🔒 a turn that was never going to produce an app is untouched', () => {
    // A chat turn, a survey or an import answers a QUESTION — it has no preview to earn, the same
    // carve-out `zeroBillForUnrenderedPreview` already makes.
    const d = decideMarkupOnProof({
      decidedBilledUsd: 2, realCostUsd: 0.1, sandboxUsd: 0, previewProven: false, expectsArtifacts: false,
    });
    expect(d.markupApplied).toBe(true);
    expect(d.billedUsd).toBe(2);
  });

  it('🔒 the kill switch restores the old behaviour with no deploy', () => {
    expect(markupNeedsPreview({ AGENTV3_MARKUP_NEEDS_PREVIEW: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(markupNeedsPreview({ AGENTV3_MARKUP_NEEDS_PREVIEW: 'OFF ' } as NodeJS.ProcessEnv)).toBe(false);
    // Unset, empty and anything else all mean ON — the rule is the default.
    expect(markupNeedsPreview({} as NodeJS.ProcessEnv)).toBe(true);
    expect(markupNeedsPreview({ AGENTV3_MARKUP_NEEDS_PREVIEW: '' } as NodeJS.ProcessEnv)).toBe(true);
    expect(markupNeedsPreview({ AGENTV3_MARKUP_NEEDS_PREVIEW: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('🔒 it can ONLY ever reduce', () => {
  const base = { previewProven: false, expectsArtifacts: true };

  it('a real cost at or above the decided bill leaves the bill alone', () => {
    // Some other formula already billed at or below cost; raising it here would be a price rise
    // nobody authorised.
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: 1, realCostUsd: 1, sandboxUsd: 0 }).billedUsd).toBe(1);
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: 1, realCostUsd: 5, sandboxUsd: 0 }).billedUsd).toBe(1);
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: 1, realCostUsd: 5, sandboxUsd: 0 }).markupApplied).toBe(true);
  });

  it('a build already free stays free', () => {
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: 0, realCostUsd: 3, sandboxUsd: 1 }).billedUsd).toBe(0);
  });

  it('🔒 it is never ₹0 — that was offered to the admin and refused', () => {
    // "agar preview chala gaya to ₹0 charge karoge to aise to mai barbad ho jaunga" (autopsy 4efab9d7).
    const d = decideMarkupOnProof({ ...base, decidedBilledUsd: 6, realCostUsd: 1.5, sandboxUsd: 0.1 });
    expect(d.billedUsd).toBeCloseTo(1.6, 6);
    expect(d.billedUsd).toBeGreaterThan(0);
  });

  it('garbage in never produces a charge out of thin air', () => {
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: NaN, realCostUsd: 1, sandboxUsd: 1 }).billedUsd).toBe(0);
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: 5, realCostUsd: NaN, sandboxUsd: NaN }).billedUsd).toBe(0);
    expect(decideMarkupOnProof({ ...base, decidedBilledUsd: -3, realCostUsd: 1, sandboxUsd: 0 }).billedUsd).toBe(0);
  });
});

describe('🔒 the wiring — a rule on one settle path is a rule a long build escapes', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const route = strip(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));

  it('BOTH billing paths apply it — the settle and the deadline finalizer', () => {
    // Fix 67 exists because these two priced the same build differently once already.
    const calls = route.split('decideMarkupOnProof(').length - 1;
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('both read the SAME render proof — buildObs.previewRendered, one fact one write', () => {
    const at = route.split('decideMarkupOnProof(');
    for (const frag of at.slice(1)) {
      expect(frag.slice(0, 400)).toContain('buildObs.previewRendered === true');
    }
  });

  it('the finalizer gets expectsArtifacts through billingCtx, defaulting to stand down', () => {
    expect(route).toContain('billingCtx.expectsArtifacts = expectsArtifacts');
    expect(route).toContain('expectsArtifacts: billingCtx.expectsArtifacts === true');
  });

  it('🔒 it runs BEFORE the zeroing rules, so those still take precedence', () => {
    const markupAt = route.indexOf('const markupDecision = decideMarkupOnProof(');
    // The CALL, not the exported definition near the top of the file — my first version matched the
    // latter and compared the settle against line 1001, which proved nothing.
    const zeroAt = route.indexOf('if (zeroBillForUnrenderedPreview(');
    expect(markupAt).toBeGreaterThan(-1);
    expect(zeroAt).toBeGreaterThan(markupAt);
  });

  it('🔒 REVERSION GUARD: the waiver is recorded, never silent', () => {
    expect(route).toContain('MARKUP_WAIVED_NO_PREVIEW');
  });
});

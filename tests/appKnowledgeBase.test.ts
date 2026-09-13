import { describe, it, expect } from 'vitest';
import { APP_KNOWLEDGE_BASE, getFeatureById } from '../src/server/AppContext/AppKnowledgeBase';
import { HOSTING_TIERS, FREE_PUBLISHED_APPS } from '../src/lib/hostingTiers';

describe('APP_KNOWLEDGE_BASE', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(APP_KNOWLEDGE_BASE)).toBe(true);
    expect(APP_KNOWLEDGE_BASE.length).toBeGreaterThan(0);
  });

  it('every entry has required fields', () => {
    for (const feature of APP_KNOWLEDGE_BASE) {
      expect(feature.id).toBeTruthy();
      expect(feature.name).toBeTruthy();
      expect(feature.path).toBeTruthy();
      expect(feature.description).toBeTruthy();
      expect(Array.isArray(feature.keywords)).toBe(true);
    }
  });

  it('contains "engineer_ai" entry', () => {
    const entry = APP_KNOWLEDGE_BASE.find(f => f.id === 'engineer_ai');
    expect(entry).toBeDefined();
  });

  it('all IDs are unique (no duplicates)', () => {
    const ids = APP_KNOWLEDGE_BASE.map(f => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('getFeatureById', () => {
  it('returns null for unknown id', () => {
    expect(getFeatureById('does-not-exist')).toBeNull();
  });

  it('returns the feature for a known id', () => {
    const feature = getFeatureById('engineer_ai');
    expect(feature).not.toBeNull();
    expect(feature?.id).toBe('engineer_ai');
  });
});

/**
 * 🔒 THE KNOWLEDGE BASE MUST QUOTE THE REAL CATALOGUE, NOT A REMEMBERED ONE.
 *
 * 🔴 THE DRIFT THIS EXISTS TO STOP, because it really happened (admin, 2026-09-13). The tiers were
 * re-priced to ₹299/₹599, the bundled ₹150 of Growth credit was stopped, the free allowance went
 * 5 → 3 apps and the traffic numbers changed — and `AppKnowledgeBase.ts` was not touched. Nothing
 * failed. For as long as that stood, EVERY AI in NavBharatAI would have quoted "Starter ₹149",
 * "Growth ₹499", "20 GB" and "₹150 of build credit added to your wallet every month" to real users,
 * confidently, because this file is the single source those assistants answer plan questions from.
 *
 * CLAUDE.md already requires the knowledge base to be updated in the same PR as any user-facing
 * change. That rule was in force and was still missed, which is the argument for a test rather than a
 * reminder: the prices here are LITERAL STRINGS, so nothing connects them to `HOSTING_TIERS` except
 * somebody remembering. This asserts the connection.
 */
describe('the hosting-plan entry quotes HOSTING_TIERS, never a remembered price', () => {
  const entry = () => APP_KNOWLEDGE_BASE.find((f) => f.id === 'hosting_plan')!;
  const allText = () => {
    const e = entry();
    return `${e.name}\n${e.description}\n${e.howToUse}`;
  };

  it('exists at all — every assertion below is vacuous without it', () => {
    expect(entry()).toBeTruthy();
  });

  it('names every tier at its CURRENT price, derived from the catalogue', () => {
    for (const tier of HOSTING_TIERS) {
      expect(allText()).toContain(`₹${tier.priceInr}`);
    }
  });

  it('🔴 quotes NO superseded price — the exact way this drifted', () => {
    // Prices the catalogue no longer sells. A plan entry mentioning one is quoting from memory.
    const live = new Set(HOSTING_TIERS.map((t) => t.priceInr));
    for (const dead of [149, 499]) {
      if (live.has(dead)) continue;
      expect(allText()).not.toContain(`₹${dead}`);
    }
  });

  it('states each tier\'s real traffic allowances, both of them', () => {
    for (const tier of HOSTING_TIERS) {
      expect(allText()).toContain(`${tier.includedFrontendGb} GB`);
      expect(allText()).toContain(`${tier.includedBackendGb} GB`);
    }
  });

  it('🔒 promises NO wallet credit while every tier bundles ₹0 (admin: "no free credit")', () => {
    const bundled = HOSTING_TIERS.reduce((sum, t) => sum + t.bundledCreditInr, 0);
    expect(bundled).toBe(0);
    // Not merely silent — it says so, because a user who was told about the old ₹150 will ask.
    expect(allText()).toMatch(/NEITHER PLAN INCLUDES ANY FREE WALLET CREDIT/);
    // ⚠️ The check is on the PROMISE, not on the digits. The entry deliberately quotes the old
    // "effectively ₹349" line inside an instruction NOT to say it, so a naive search for that phrase
    // fails on the very text that forbids it — a guard that cannot tell a prohibition from a promise
    // is worse than none, because it would push the next author to delete the warning.
    expect(allText()).not.toMatch(/of build credit added to your wallet every month/);
    expect(allText()).toMatch(/NEVER tell anyone a plan comes with credit/);
  });

  it('names the free published-app allowance the code actually enforces', () => {
    expect(allText()).toContain(`FREE allowance of ${FREE_PUBLISHED_APPS} published apps`);
    // And never the number it used to be, which is what a stale demotion warning would quote.
    expect(allText()).not.toContain('free allowance of 5 published apps');
  });

  it('tells users about server apps at all — the thing the new price actually buys', () => {
    for (const tier of HOSTING_TIERS) {
      expect(allText()).toContain(String(tier.backendApps));
    }
    expect(allText()).toMatch(/real server/i);
  });
});

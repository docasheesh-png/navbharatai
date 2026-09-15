// Builder tools held back as "Coming soon" (admin-mandated 2026-09-15).
//
// WHY THIS EXISTS, in the admin's own words: *"other ke andar bahut si cheeze aisi hai, jo ek normal
// indian user ke bas se bahar ki hai. aur hamse test bhi nahi ki hai … un cheezo ko band kar ke
// 'coming soon' likh do! … jab mai test karunga tab ek ek kar ke on karwa dunga apse."*
//
// So this is NOT a feature flag for something unbuilt — most of these tools are built and wired. It is
// an explicit product decision to keep untested surface away from real users until the admin has tried
// each one. The second absolute rule says a shipped button must do what it says; a tool nobody has
// exercised is not a promise worth making yet, and "Coming soon" is the honest label for it.
//
// 🔑 THIS SET IS THE ONE SOURCE OF TRUTH, and re-enabling is deliberately a ONE-LINE edit:
// delete the tool's id from the set below. Nothing else needs touching — the tile, the label and the
// open-gate all read this predicate, so a tool can never be half-on (a live tile that refuses to open,
// or a dead tile for a tool the gate would happily open).
//
// PURE module, no React and no browser APIs, so it is unit-testable and importable from anywhere —
// the same shape as `playCompliance.ts`, which solves the identical "one list, three call sites"
// problem for the Play medical gate.

/**
 * Tool ids (the workspace-tab ids in `components/home/homeToolGroups.ts`) that are switched OFF and
 * shown as "Coming soon" in the Other page.
 *
 * Grouped below exactly as the admin listed them, so re-enabling one is a matter of finding its line.
 * ⚠️ Every id here MUST exist in HOME_TOOL_GROUPS — an id that matches no tool silently does nothing,
 * which is why `comingSoonTools.test.ts` asserts the set against the real tool list.
 */
export const COMING_SOON_TOOL_IDS: ReadonlySet<string> = new Set([
  // ── AI Tools — only these two. Bot Builder, AI Image Gen, API Tester, Versioning, Minifier and
  //    APK Builder stay ON (the admin named just "code review" and "ai debugger").
  'debugger',      // AI Debugger
  'codereview',    // Code Review

  // ── Developer Tools — "developer tool sabhi", so the whole group.
  'dbstudio',      // Database Studio
  'apimarket',     // API Marketplace
  'localization',  // Localization
  'aitesting',     // Test Generator
  'plugins',       // Plugins
  'testing',       // Test Runner
  'performance',   // Performance
  'multipages',    // Multi-Page
  'components',    // Components
  'designsys',     // Design System
  'figma',         // Figma Import
  'darkmode',      // Dark Mode Gen

  // ── Publish & Deploy — "custom domain ko chor ke sabhi". 'domain' is deliberately NOT here.
  'cicd',          // CI/CD Pipeline
  'seo',           // SEO Optimizer
  'sharereview',   // Share for Review

  // ── Monetization & Team — "sabhi", the whole group.
  'monetize',      // Monetize
  'team',          // Team
  'collab',        // Live Collab
  'whitelabel',    // Whitelabel
  'analytics',     // Analytics
  'insights',      // Insights & Webhooks
  'gallery',       // Community Gallery
]);

/** True when this tool/view id is held back as "Coming soon". */
export function isComingSoonTool(id: string): boolean {
  return COMING_SOON_TOOL_IDS.has(id);
}

/** The label shown on a held-back tile. One constant so the tile and its test can never disagree. */
export const COMING_SOON_LABEL = 'Coming soon';

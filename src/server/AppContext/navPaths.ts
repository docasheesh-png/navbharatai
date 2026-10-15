// WHERE EVERY SCREEN ACTUALLY IS — the one source of truth for navigation, read by every AI's answer.
//
// 🔴 WHY THIS EXISTS (admin 2026-10-14, verbatim): *"navbharatai ke kisi ai ko pata hi nahi hai, ki
// 'secrets and keys' kaha dali jani hai. jab koi user google login wala page banata hai, to navbharatai
// bata raha hai, ki other ke jankar secret and keys dalo! jab ki secrets and keys to setting me hai!"*
//
// They are right, and the measurement is worse than the report. The keys vault is named in **155 places**
// across the server, under TWO different names for ONE screen — 126 as `Secrets & API Keys` (the real
// Settings tab) and 37 as `Keys & Secrets` (the builder's sheet) — and EIGHT of those spell out a full
// path, `⋮ More → Keys & Secrets`, which exists only INSIDE the NavBharatAI Pro panel. One of the eight is
// `NO_FAKE_FEATURE_RULE`, so that path is printed in RED into every built app that is waiting for a key:
// a user who then opens Settings and looks for "Keys & Secrets" finds nothing, because the tab there is
// called "Secrets & API Keys".
//
// 🧬 THE CLASS: a navigation path written as prose in many modules, under a name that does not match the
// screen it points at, with nothing comparing the two. This is the `workspacePath.ts` / `visionModels.ts`
// class (the fourth absolute rule's step 2) applied to what the AIs SAY rather than to what the code does.
// It is a self-awareness defect, which makes it the AppKnowledgeBase sync rule's own territory: a path
// nobody verifies is a path that goes stale silently, and the AI then sends a real user to a dead end.
//
// 🔒 AND THE DRIFT IS WHAT IS ACTUALLY LOCKED, not the string. `tests/everyPathLeadsSomewhereReal.test.ts`
// reads the REAL UI — `SettingsPanel.tsx`'s own group titles and tab labels — and fails when this file and
// the screen disagree. So renaming a tab breaks CI instead of quietly making every AI sentence wrong, which
// is the only thing that would have caught the reported bug before a user met it.
//
// PURE: data and string builders only. No I/O, never throws.

/** The three group titles in Settings, exactly as `SettingsPanel.tsx` renders them. */
export const SETTINGS_GROUPS = Object.freeze({
  profile: 'Profile Settings',
  app: 'App Settings',
  legal: 'Legal & Trust',
} as const);

/**
 * THE KEYS VAULT — one vault, two doors, and they are NOT two places.
 *
 * `canonical` is the answer to "where do I put my keys?" for every user on every surface. `inBuilder` is
 * the shortcut that opens the SAME vault without leaving a build, and it is offered as a convenience,
 * never as the address: it exists only inside the NavBharatAI Pro panel.
 */
export const SECRETS_SCREEN = Object.freeze({
  /** The tab's own label in Settings. Asserted against `SettingsPanel.tsx` by the drift test. */
  label: 'Secrets & API Keys',
  canonical: `Settings → ${SETTINGS_GROUPS.app} → Secrets & API Keys`,
  /** The builder sheet's own title. Asserted against `AgentV3Panel.tsx` by the drift test. */
  inBuilderLabel: 'Keys & Secrets',
  inBuilderPath: '⋮ More → Keys & Secrets',
});

/**
 * Where to save a key, in one sentence, for text a USER reads.
 *
 * `inBuilder` adds the shortcut for someone who is mid-build — it never replaces the canonical path,
 * because the sentence outlives the screen it was written on: it is printed into built apps, into the
 * post-build card and into chat, and only one of those is inside the builder.
 */
export function whereToSaveKeys(opts: { inBuilder?: boolean } = {}): string {
  return opts.inBuilder
    ? `${SECRETS_SCREEN.canonical} (or, without leaving this build, ${SECRETS_SCREEN.inBuilderPath} — the same vault)`
    : SECRETS_SCREEN.canonical;
}

/**
 * The RED line a built app shows while a feature is waiting for its key — the admin's reported case.
 *
 * It names the canonical path, because the person reading it is looking at their APP, not at the builder's
 * menu. `keyNames` is whatever the built code actually reads, so the user is never left guessing which
 * name to type.
 */
export function demoUntilKeySaved(feature: string, keyNames: string): string {
  return `${feature} is a demo, not real. Add ${keyNames} in NavBharatAI → ${SECRETS_SCREEN.canonical} to make it real.`;
}

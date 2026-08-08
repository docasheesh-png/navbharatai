// The names of NavBharatAI's own settings screens, in ONE place.
//
// WHY THIS EXISTS (2026-08-07). The vault tile is called **"Secrets & API Keys"**. Across the codebase,
// user-facing messages sent people to "Settings → Secrets & Keys" — a screen with that name does not
// exist. The label was hardcoded independently in a dozen strings, so when the tile was renamed most of
// them were never updated, and every one of them is an instruction a real user follows and fails.
//
// A test already guarded the KNOWLEDGE BASE against the stale label (`polishCollabSettings.test.ts`),
// which is how this was caught — but nothing guarded the messages the build engine and the settings
// screens actually print, and those had drifted. Fixing the strings one by one would repeat the
// original mistake at a later date; the label lives here now, and `settingsLabels.test.ts` fails if a
// user-facing source string spells it by hand again.
//
// Pure constants: safe to import from both client and server.

/** The vault tile's REAL name, exactly as it is rendered in App Settings. */
export const SECRETS_TILE = 'Secrets & API Keys';

/** The full navigation path to the vault, for any message that tells a user where to go. */
export const SECRETS_PATH = `Settings → ${SECRETS_TILE}`;

/** The Database screen's full navigation path — same reasoning, same drift risk. */
export const DATABASE_PATH = 'Settings → App Settings → Database';

// AgentV3 — the app's NAME, as the user chose it (admin 2026-09-04).
//
// THE ASK: *"jab jab bhi app bane to chat box me hi ek dedicated message sirf 'name' ke liye ho, aur
// us message ke aage edit button ho … jab user save kare to har jagah wahi name ho jo user ne dala
// hai (duplicate not allowed) aur sath me ai ka app building disturb bhi na ho."*
//
// WHY THIS MODULE EXISTS — the constraint that shapes everything below.
//
// Before this, a build's GitHub repo name was NEVER STORED. It was RECOMPUTED on every single build
// turn from the conversation's title + createdAt, and the storage layer's `ensureRepo(name)` means
// "find the repo with this name, else CREATE it". Those two facts together make a naive rename
// actively destructive: change the name the computation feeds on, and the next turn computes a name
// GitHub does not have, so it creates a BRAND-NEW EMPTY REPO and pushes there — leaving the real app
// and its whole history behind in the old one. That is the repo sprawl `GitStorageTarget`'s own
// header says the design exists to prevent.
//
// So a name the user can change requires the name to become STORED DATA rather than a derivation,
// and this module is the pure core of that: what a valid name is, which name wins, whether it
// collides, and what GitHub should be asked to call the repo. No I/O, no framework — every rule here
// is unit-testable, because these are the rules a rename must not get wrong.
//
// "BUILD MUST NOT BE DISTURBED" IS A PROPERTY OF THE DATA MODEL, NOT A PROMISE. Once `repoName` is
// persisted, it — not this module's derivation — is what a build pushes to. A rename that GitHub
// refuses therefore leaves the build pushing exactly where it already was. The failure is cosmetic
// by construction, which is the only kind of "smooth" worth claiming.

/** Longest name we accept. Comfortably fits a real product name; short enough to render in a chat
 *  card and to stay inside GitHub's 100-char repo limit once slugified. */
export const MAX_APP_NAME_LENGTH = 60;
/** Shortest meaningful name. One character is almost always a slip, and it slugifies to noise. */
export const MIN_APP_NAME_LENGTH = 2;

export type AppNameError =
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'no-usable-characters'
  | 'duplicate';

/**
 * Collapse the whitespace a real person types (leading/trailing, double spaces, a pasted newline)
 * without touching anything else. The user's capitalisation, spaces and punctuation are PRESERVED —
 * this is the name they will see, so "My Shop" must not come back as "my-shop". Pure.
 */
export function normalizeAppName(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * A GitHub-safe repo segment derived from the user's name: alnum/-/_ only, collapsed, lowercased.
 *
 * Deliberately the SAME transformation the repo namer already applied to a derived title, so a
 * user-chosen name and an auto-derived one produce names of the same shape and nothing downstream
 * has to care which it got.
 */
export function repoSlugFromAppName(name: string): string {
  return (name || '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 90);
}

export interface ValidatedAppName {
  ok: boolean;
  /** The stored display name — exactly what the user typed, whitespace-normalized. */
  name: string;
  /** The GitHub-safe repo segment for that name. */
  slug: string;
  error?: AppNameError;
}

/**
 * Validate a name the user typed, WITHOUT considering their other apps (that is `findDuplicate`).
 *
 * The `no-usable-characters` case is the one worth naming: "!!!" and "👍" are neither empty nor too
 * short, but they slugify to nothing at all — and a repo cannot be called "". Rejecting them here,
 * with a distinct reason, is what stops that from becoming a confusing GitHub error much later.
 */
export function validateAppName(raw: string | null | undefined): ValidatedAppName {
  const name = normalizeAppName(raw);
  const fail = (error: AppNameError): ValidatedAppName => ({ ok: false, name, slug: '', error });
  if (name === '') return fail('empty');
  if (name.length < MIN_APP_NAME_LENGTH) return fail('too-short');
  if (name.length > MAX_APP_NAME_LENGTH) return fail('too-long');
  const slug = repoSlugFromAppName(name);
  if (slug === '') return fail('no-usable-characters');
  return { ok: true, name, slug };
}

/** The minimum a caller must know about an app to answer "what is it called?". */
export interface NamedApp {
  id: string;
  /** The name the USER chose, if they ever chose one. */
  appName?: string | null;
  /** The name derived from the first prompt — the fallback, and what every old record has. */
  title?: string | null;
}

/**
 * WHICH NAME WINS. The user's chosen name, else the auto-derived title, else a plain placeholder.
 *
 * Every display surface must call this rather than reading `title` directly — that is the whole of
 * "har jagah wahi name". A surface that reads `title` would keep showing the machine's guess after
 * the user renamed, and the user would reasonably conclude the rename did not work.
 */
export function effectiveAppName(app: NamedApp | null | undefined): string {
  const chosen = normalizeAppName(app?.appName);
  if (chosen) return chosen;
  const title = normalizeAppName(app?.title);
  if (title) return title;
  return 'Untitled app';
}

/**
 * Find an app OTHER than `selfId` that already answers to `desired` (case- and spacing-insensitive).
 * Returns the clashing app, or null when the name is free.
 *
 * Compared on the normalized+lowercased DISPLAY name rather than the slug, because that is the
 * comparison the user can actually see: telling someone "My Shop" is taken when their other app is
 * called "my shop" is obviously right, whereas a slug collision between two visibly different names
 * would read as a bug. GitHub still enforces true repo uniqueness on the rename itself, so this
 * check is the friendly first line, not the only one.
 */
export function findDuplicate<T extends NamedApp>(
  desired: string,
  apps: readonly T[],
  selfId: string,
): T | null {
  const want = normalizeAppName(desired).toLowerCase();
  if (!want) return null;
  for (const app of apps) {
    if (!app || app.id === selfId) continue;
    if (effectiveAppName(app).toLowerCase() === want) return app;
  }
  return null;
}

/** A human sentence for each rejection — one place, so the API and the UI cannot drift apart. */
export function appNameErrorMessage(error: AppNameError, max = MAX_APP_NAME_LENGTH): string {
  switch (error) {
    case 'empty': return 'Give your app a name.';
    case 'too-short': return 'That name is too short — use at least 2 characters.';
    case 'too-long': return `That name is too long — keep it under ${max} characters.`;
    case 'no-usable-characters': return 'Use at least one letter or number in the name.';
    case 'duplicate': return 'You already have an app with this name. Pick a different one.';
  }
}

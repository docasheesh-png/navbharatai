/**
 * 🔴 A TURN THAT ENDS WITH UNSTYLED SCREENS IS HANDED THE CLASS LIST ONCE (autopsy 1be16985, 2026-10-01).
 *
 * "Make biology learning app", Weak tier. The architect wrote five screens using 63 class names no
 * stylesheet defined. After every write it was told so (`undefinedClassWriteNote`, autopsy e6d46cde) and
 * answered each time by writing the next screen. When it finally tried to add the rules, its edit to the
 * 529-line stylesheet missed its anchor; it read the end of the file and then ended its turn, saying the
 * app was ready. The 3,067 tokens of CSS it had just written were never applied.
 *
 * The readiness gate scored the app 92/100 and found no blockers, because readiness measures code health
 * and an unstyled screen is healthy code. So the turn ended, and the end-of-build check then spent a
 * 174-second repair pass, in a fresh context that re-read every screen, adding rules the first model
 * could have added in one edit with all of it still in view.
 *
 * 🔑 THE CLASS: a write-time steer with nothing at the end of the turn behind it. The note says "before
 * you finish"; nothing checked that it had been done before the turn was allowed to finish. This is that
 * check, at the one point the turn ends: the same `findUndefinedClasses` the end-of-build check uses,
 * asked while the architect still holds the screens, and handed back ONCE with the list. A model that
 * ignores it ends exactly as before, and the end-of-build repair is still the net.
 *
 * 🔒 IT CANNOT OVERRIDE AN ANSWER. A turn that declined or ended on a question to the user is left alone,
 * by the same two tests `unfinishedResume` reuses. Kill switch: `AGENTV3_STYLE_RESUME=off`. PURE.
 */
import { turnAskedTheUser, turnDeclined } from './nudgeToBuild';

export const MAX_STYLE_RESUMES = 1;

/** At most this many class names in the message — enough to act on, small enough to read. */
export const MAX_CLASSES_LISTED = 40;

export function styleResumeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_STYLE_RESUME ?? '').trim().toLowerCase() !== 'off';
}

export interface StyleResumeInput {
  /** The turn's own text — read for a refusal or a question, never for anything else. */
  text: string;
  /** Class names the screens use that no stylesheet defines (without the dot). */
  missing: ReadonlyArray<string>;
  /** The stylesheet the rules belong in, when the project has one. */
  sheet?: string;
  resumesUsed: number;
  env?: NodeJS.ProcessEnv;
}

export interface StyleResumeDecision {
  resume: boolean;
  /** The model-facing message; '' when `resume` is false. Never shown to the user. */
  message: string;
  standDown?: 'disabled' | 'nothing-missing' | 'limit' | 'declined' | 'asked-the-user';
}

export function decideStyleResume(input: StyleResumeInput): StyleResumeDecision {
  if (!styleResumeEnabled(input.env)) return { resume: false, message: '', standDown: 'disabled' };
  const missing = [...new Set((input.missing ?? []).map((c) => String(c ?? '').trim().replace(/^\./, '')).filter(Boolean))];
  if (missing.length === 0) return { resume: false, message: '', standDown: 'nothing-missing' };
  if (input.resumesUsed >= MAX_STYLE_RESUMES) return { resume: false, message: '', standDown: 'limit' };
  if (turnDeclined(input.text)) return { resume: false, message: '', standDown: 'declined' };
  if (turnAskedTheUser(input.text)) return { resume: false, message: '', standDown: 'asked-the-user' };
  const sheet = String(input.sheet ?? '').trim() || 'src/index.css';
  const shown = missing.slice(0, MAX_CLASSES_LISTED).map((c) => `.${c}`).join(', ');
  const more = missing.length > MAX_CLASSES_LISTED ? ` and ${missing.length - MAX_CLASSES_LISTED} more` : '';
  return {
    resume: true,
    message:
      `You ended your turn, but ${missing.length} class name(s) the screens use have NO rule in any stylesheet, `
      + `so those parts of the app render as plain unstyled HTML: ${shown}${more}.\n\n`
      + `Add a real rule for every one of them NOW, in ONE edit_file call on ${sheet} with an EMPTY old_string `
      + '(an empty old_string appends to the end of the file — no anchor needed). Use the palette variables '
      + 'already defined at the top of that file (var(--accent), var(--card), var(--border), var(--muted), var(--radius), …) '
      + 'and the kit classes it already has. You already wrote these screens, so do not read them again. '
      + 'Do not rename classes in the screens and do not remove existing rules. Then finish.',
  };
}

/** One sentence for the admin report — never user-facing, so it may name the mechanism. */
export function styleResumeNote(missingCount: number): string {
  return `The model ended its turn while ${missingCount} class name(s) the screens use had no style rule, so it was `
    + 'handed the list and told to add the rules in one edit before finishing (once). Before 2026-10-01 the turn '
    + 'ended here and a separate end-of-build repair pass, in a fresh context, added them.';
}

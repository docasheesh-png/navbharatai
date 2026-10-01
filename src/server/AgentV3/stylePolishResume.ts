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
import { DEFECT_TEXT, type DesignDefect } from './DesignCoverage';

export const MAX_STYLE_RESUMES = 1;

/** At most this many class names in the message — enough to act on, small enough to read. */
export const MAX_CLASSES_LISTED = 40;

/** At most this many pages in one message. */
export const MAX_PAGES_LISTED = 6;

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
  /**
   * Pages the end-of-build design check would repair (the same `analyzeDesignCoverage`). The sibling the
   * first version of this module missed: a page with a list and no empty state got a write-time note too,
   * the model moved on, and the end-of-build repair re-read every screen in a fresh context to add it.
   */
  pages?: ReadonlyArray<{ file: string; defects: ReadonlyArray<DesignDefect> }>;
  resumesUsed: number;
  env?: NodeJS.ProcessEnv;
  /** This run already wrote the screens — a closing question is an offer, not a decision (see unfinishedResume.ts). */
  producedFiles?: boolean;
  /** Screens with controls a screen reader cannot use (Q-002) — handed back in the same message. */
  a11y?: ReadonlyArray<{ file: string; issues: ReadonlyArray<string> }>;
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
  const pages = (input.pages ?? []).filter((p) => p && p.file && p.defects?.length).slice(0, MAX_PAGES_LISTED);
  const a11y = (input.a11y ?? []).filter((a) => a && a.file && a.issues?.length);
  if (missing.length === 0 && pages.length === 0 && a11y.length === 0) return { resume: false, message: '', standDown: 'nothing-missing' };
  if (input.resumesUsed >= MAX_STYLE_RESUMES) return { resume: false, message: '', standDown: 'limit' };
  if (turnDeclined(input.text)) return { resume: false, message: '', standDown: 'declined' };
  if (!input.producedFiles && turnAskedTheUser(input.text)) return { resume: false, message: '', standDown: 'asked-the-user' };
  const sheet = String(input.sheet ?? '').trim() || 'src/index.css';
  const parts: string[] = [];
  if (missing.length) parts.push(missingClassesInstruction(missing, sheet));
  if (pages.length) {
    parts.push(
      `These page(s) fall short of the app's own design standard:\n`
      + pages.map((p) => `- ${p.file}: ${p.defects.map((d) => DEFECT_TEXT[d]).join('; ')}.`).join('\n')
      + '\nFix only these pages, with the kit classes the app already uses.',
    );
  }
  if (a11y.length) {
    parts.push(
      'These screens have controls a screen-reader user cannot use:\n'
      + a11y.map((a) => `- ${a.file}: ${a.issues.join('; ')}.`).join('\n')
      + '\nGive each one a real, specific name that says what it does (not "button" or "icon").',
    );
  }
  return {
    resume: true,
    message:
      `You ended your turn, but the app is not finished yet:\n\n${parts.join('\n\n')}\n\n`
      + 'Do it NOW, while these files are still in front of you — do not read the screens again. Then finish.\n\n'
      // The user never saw this message, and already read your description of the app (autopsy d382b398:
      // the reply to this message — "Done — I added all the missing CSS rules to src/index.css" — became the
      // build's summary). Keep the closing words about the APP, short, with no class or file names.
      + 'The user did not see this message and has already read your description of the app. When you finish, '
      + 'reply with ONE short sentence about the app (for example "Every screen is now fully styled.") — do not '
      + 'repeat the summary, and do not mention class names, stylesheets or file names.',
  };
}

/** The instruction that names undefined classes and how to add them in one edit. PURE. */
export function missingClassesInstruction(missing: readonly string[], sheet: string): string {
  const shown = missing.slice(0, MAX_CLASSES_LISTED).map((c) => `.${c}`).join(', ');
  const more = missing.length > MAX_CLASSES_LISTED ? ` and ${missing.length - MAX_CLASSES_LISTED} more` : '';
  return `${missing.length} class name(s) the screens use have NO rule in any stylesheet, so those parts of the app `
    + `render as plain unstyled HTML: ${shown}${more}. Add a real rule for every one of them in ONE edit_file `
    + `call on ${sheet} with an EMPTY old_string (an empty old_string appends to the end of the file — no anchor `
    + 'needed). Use the palette variables already defined at the top of that file (var(--accent), var(--card), '
    + 'var(--border), var(--muted), var(--radius), …) and the kit classes it already has. Do not rename classes in '
    + 'the screens and do not remove existing rules.';
}

/**
 * 🔴 "THE APP LOOKS COMPLETE" WAS SAID OVER UNSTYLED SCREENS (autopsy 2f723acb, 2026-10-01). The done
 * check reads code health only, so it told the user "✅ The app looks complete — wrapping up." while the
 * screens used 19 classes no stylesheet defined; the end of the turn then sent the model back to style
 * them, and the user watched "wrapping up" turn into more work. When classes are missing, the done steer
 * carries this instead, and the user is not told the app is complete. PURE; '' when nothing is missing.
 */
export function doneStyleNote(missing: readonly string[], sheet: string | undefined): string {
  const list = [...new Set((missing ?? []).map((c) => String(c ?? '').trim().replace(/^\./, '')).filter(Boolean))];
  if (list.length === 0) return '';
  return `Before you finish: ${missingClassesInstruction(list, String(sheet ?? '').trim() || 'src/index.css')}`;
}

/** One sentence for the admin report — never user-facing, so it may name the mechanism. */
export function styleResumeNote(missingCount: number, pageCount = 0): string {
  return `The model ended its turn while ${missingCount} class name(s) had no style rule and ${pageCount} page(s) fell `
    + 'short of the design standard, so it was handed them and told to fix them before finishing (once). Before '
    + '2026-10-01 the turn ended here and a separate end-of-build repair pass, in a fresh context, fixed them.';
}

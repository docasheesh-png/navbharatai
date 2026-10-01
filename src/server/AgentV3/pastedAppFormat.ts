// A PASTED ONE-FILE APP STAYS ONE FILE (admin 2026-10-01, after autopsy a106df77).
//
// 🔴 WHAT HAPPENED. A user pasted their own bill maker — one HTML file, version 40 — and the build turned
// it into a Vite + React project of many files. The app worked, but it was no longer the user's app: a
// file they had edited forty times by hand, opened offline and shared as one file was now a project they
// could not open the same way, and its saved bills sat under storage keys the new app never read.
//
// 🔑 THE RULE: the format that was pasted is the format that comes back. When a NEW build's prompt is a
// whole pasted HTML document and the user's own words ask for nothing a single file cannot carry, the
// build:
//   • runs on the `static` framework (no build step), not React;
//   • starts from the user's own file as `index.html`, so the builder improves it IN PLACE instead of
//     writing a new app from a description of it;
//   • keeps the page's storage keys, so the data already saved on the user's device is still read;
//   • ends with a one-tap offer to upgrade to a full project, for when the user does want one.
// React is used when the user's words ask for it — a framework by name, a login, a database, a backend,
// several users — exactly as before.
//
// Kill switch: AGENTV3_PASTED_KEEPS_FORMAT=off restores the previous behaviour (a React rebuild).
// PURE — the env read is the only side input.
import { detectFrameworkFromPrompt } from '../../lib/frameworkDetect';
import { isCodeLine, isPastedHtmlDocument, readablePrompt } from '../lib/pastedSource';

export function pastedKeepsFormatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PASTED_KEEPS_FORMAT ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Words that ask for something one static HTML file cannot carry, or that name the stack outright.
 * Matched only against what the user WROTE around the paste, never against the paste itself — a bill
 * maker's own "Login" button is not a request for accounts.
 */
const NEEDS_A_PROJECT =
  /\b(?:log[\s-]?in|sign[\s-]?(?:in|up)|signup|auth(?:entication)?|user[\s-]accounts?|database|back[\s-]?end|server|multi[\s-]?user|full[\s-]?(?:stack|app|project)|react|next\.?js|typescript|vite|framework|npm)\b/i;

export type PastedFormatDecision =
  | { keep: true }
  | { keep: false; reason: 'off' | 'not-a-pasted-page' | 'not-a-new-build' | 'framework-picked' | 'words-name-a-framework' | 'words-need-a-project' };

/**
 * Should this build keep the pasted page as one HTML file? PURE.
 *
 * `newBuild` is false for an edit of an app that already exists — there the existing app's stack wins,
 * whatever was pasted. `frameworkPicked` is the user's own choice in the framework picker, which wins
 * over anything we infer.
 */
export function pastedFormatDecision(
  prompt: string | null | undefined,
  ctx: { newBuild: boolean; frameworkPicked: boolean },
  env: NodeJS.ProcessEnv = process.env,
): PastedFormatDecision {
  if (!pastedKeepsFormatEnabled(env)) return { keep: false, reason: 'off' };
  if (!isPastedHtmlDocument(prompt)) return { keep: false, reason: 'not-a-pasted-page' };
  if (!ctx.newBuild) return { keep: false, reason: 'not-a-new-build' };
  if (ctx.frameworkPicked) return { keep: false, reason: 'framework-picked' };
  const words = readablePrompt(prompt);
  const named = words ? detectFrameworkFromPrompt(words) : null;
  if (named && named !== 'static') return { keep: false, reason: 'words-name-a-framework' };
  if (NEEDS_A_PROJECT.test(words)) return { keep: false, reason: 'words-need-a-project' };
  return { keep: true };
}

/**
 * The pasted document itself: from its `<!doctype` / `<html` line to the last line of code, so the words
 * the user wrote after it are left out and anything they pasted after `</html>` (a106df77 had a stray
 * script there) is kept for the builder to repair. '' when the prompt is not a pasted page. PURE.
 */
export function pastedHtmlDocument(prompt: string | null | undefined): string {
  const text = String(prompt ?? '');
  if (!isPastedHtmlDocument(text)) return '';
  const lines = text.split('\n');
  const first = lines.findIndex((l) => /<!doctype\s+html|<html\b/i.test(l));
  if (first < 0) return '';
  let last = lines.length - 1;
  while (last > first && !isCodeLine(lines[last])) last--;
  const doc = lines.slice(first, last + 1).join('\n');
  // A line that opens the document may carry the user's words before it ("here is my app: <!doctype…").
  const at = doc.search(/<!doctype\s+html|<html\b/i);
  return `${doc.slice(Math.max(0, at)).trimEnd()}\n`;
}

/** The storage names the page reads and writes — localStorage keys and IndexedDB databases. PURE. */
export function pastedStorageKeys(doc: string | null | undefined, max = 12): string[] {
  const text = String(doc ?? '');
  const out: string[] = [];
  const add = (k: string): void => {
    const key = k.trim();
    if (key && key.length <= 80 && !out.includes(key) && out.length < max) out.push(key);
  };
  for (const m of text.matchAll(/\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\(\s*(['"`])([^'"`$]+)\1/g)) add(m[2]);
  for (const m of text.matchAll(/\b(?:localStorage|sessionStorage)\s*\[\s*(['"`])([^'"`$]+)\1\s*\]/g)) add(m[2]);
  for (const m of text.matchAll(/\bindexedDB\s*\.\s*open\(\s*(['"`])([^'"`$]+)\1/g)) add(m[2]);
  return out;
}

/** What the builder is told, in both lanes, when the pasted page stays one file. PURE. */
export function pastedOneFileRule(storageKeys: readonly string[]): string {
  const lines = [
    'ONE FILE, AND IT IS THE USER\'S OWN — index.html already holds the app exactly as the user pasted it.',
    'Improve it IN PLACE: read index.html first, then edit that file. Keep it ONE self-contained HTML file — markup, its <style> and its <script> — with no build step, no framework and no other source files. Do not rewrite it as a new app.',
    'Keep its own look: its colours, fonts and layout are the user\'s. Do not link style.css or any other stylesheet into it.',
    'A library may load from a CDN (<script src>), as the file may already do.',
  ];
  if (storageKeys.length) {
    lines.push(`Keep these storage names EXACTLY as they are, so the data already saved on the user's device is still read: ${storageKeys.map((k) => `"${k}"`).join(', ')}.`);
  }
  return lines.join('\n');
}

/** The scaffold files a pasted one-file app does not use — removed when the user's file is seeded. */
export const STATIC_SCAFFOLD_EXTRAS: readonly string[] = ['script.js', 'style.css'];

/** The report code that records the decision, and powers the one-tap upgrade offer. */
export const PASTED_ONE_FILE_CODE = 'PASTED_APP_KEPT_ONE_FILE';

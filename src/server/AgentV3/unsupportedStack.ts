/**
 * THE USER NAMED A STACK WE DO NOT BUILD — SAY SO, ONCE, PLAINLY (autopsy 8e124182, 2026-09-30).
 *
 * The request said, in its first sentence, *"… using PHP MVC architecture"*, and asked for server-side
 * validation, CSRF tokens and session timeouts. NavBharatAI has no PHP template, so `framework` stayed
 * the `vite-react` default without a word to anyone: the app was built in React with browser storage,
 * its shared types file told the reader it served *"the PHP MVC backend and the TypeScript frontend"* — a
 * backend that does not exist — and the summary never mentioned PHP at all. The app was fine; what it
 * was told to be and what it said it was were not.
 *
 * Two halves, both from one detector: the builder is told the truth before it writes (so it builds in
 * the project's stack and never claims the named one), and the user is told once, in the reply that says
 * the app is ready.
 *
 * ⚠️ PRECISION-FIRST: only a stack the prompt asks to BUILD WITH counts ("using PHP", "in Laravel",
 * "a PHP MVC app"). "Convert my PHP site to React" or "read the PHP file" name PHP without asking for it,
 * and telling that user we built it "instead of PHP" would be wrong. PURE.
 */
import { frameworkRunsInBrowser, serverFrameworkLabel } from '../../lib/frameworkDetect';

interface StackRule { name: string; re: RegExp }

const BUILD_WITH = String.raw`(?:using|use|in|with|on|built\s+(?:in|with|on)|written\s+in|based\s+on|via)\s+(?:the\s+|a\s+|an\s+)?`;
const RULES: readonly StackRule[] = [
  { name: 'PHP', re: new RegExp(String.raw`\b${BUILD_WITH}(?:php|laravel|codeigniter|symfony|cakephp|yii)\b|\b(?:php|laravel|codeigniter|symfony)\s+(?:mvc|app(?:lication)?|backend|back-end|website|web\s*app|framework|project|based|architecture)\b`, 'i') },
  { name: 'Ruby on Rails', re: new RegExp(String.raw`\b${BUILD_WITH}(?:ruby\s+on\s+rails|rails|ruby)\b|\bruby\s+on\s+rails\b`, 'i') },
  { name: 'ASP.NET', re: new RegExp(String.raw`\b${BUILD_WITH}(?:asp\.net|\.net(?:\s+core)?|c#|blazor)(?![\w])|\basp\.net\b`, 'i') },
];

/** Does the prompt ask to build with a stack NavBharatAI cannot scaffold? The stack's name, or null. PURE. */
export function unsupportedStackRequested(prompt: string | null | undefined): string | null {
  const p = String(prompt ?? '');
  // A migration ("convert my PHP site to React", "port it from Laravel") names the OLD stack. Asking for
  // PHP there is not what the user did, so a conversion request is never answered with this note.
  if (/\b(?:convert|migrat|port(?:ing|ed)?\b|rewrit|translat|re-?build)\w*\b[^.\n]{0,80}\b(?:to|into|from)\b/i.test(p)) return null;
  for (const r of RULES) if (r.re.test(p)) return r.name;
  return null;
}

/** A human name for the stack this project really is. PURE. */
export function builtWithLabel(framework: string | null | undefined): string {
  const f = String(framework ?? '').toLowerCase();
  if (!f || f === 'vite-react' || f === 'react') return 'React + TypeScript';
  return frameworkRunsInBrowser(f) ? f : serverFrameworkLabel(f);
}

/** The builder's instruction, prepended to the build prompt. PURE. */
export function unsupportedStackBuilderNote(stack: string, framework: string | null | undefined): string {
  const label = builtWithLabel(framework);
  return [
    `STACK NOTE — the user named ${stack}, which NavBharatAI cannot build or run. This project is ${label}; build the whole app in it.`,
    `- Never write ${stack} files and never claim the app is ${stack} or has a ${stack} backend — not in the UI, the README, or a code comment.`,
    ...(frameworkRunsInBrowser(String(framework ?? 'vite-react'))
      ? ['- There is no server here. Where the request asks for something only a server does (server-side validation, CSRF tokens, server sessions), build the real in-browser equivalent and name it honestly as client-side in the code.']
      : []),
  ].join('\n');
}

/** The one line the user reads in the ready message. Empty when nothing needs saying. PURE. */
export function unsupportedStackUserNote(stack: string | null, framework: string | null | undefined): string {
  if (!stack) return '';
  const label = builtWithLabel(framework);
  const inBrowser = frameworkRunsInBrowser(String(framework ?? 'vite-react'));
  return `\n\nℹ️ You asked for **${stack}**. NavBharatAI doesn't build ${stack} apps yet, so this app is built with **${label}** — the same features, a different language underneath.`
    + (inBrowser ? ' It runs in the browser, so the parts that need a server (like server-side checks) are done in the browser instead. Tell me if you want a real server and database added.' : '');
}

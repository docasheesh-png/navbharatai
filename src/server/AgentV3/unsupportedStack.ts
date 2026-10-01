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

interface StackRule { name: string; re: RegExp; mobile?: true }

const BUILD_WITH = String.raw`(?:using|use|in|with|on|built\s+(?:in|with|on)|written\s+in|based\s+on|via)\s+(?:the\s+|a\s+|an\s+)?`;
/**
 * "Swift" and "Expo" are also ordinary English words ("with swift search", "an expo app for a trade fair").
 * After "using/with/in", they name a stack only when the phrase ENDS there or continues as a stack list.
 */
const STACK_END = String.raw`(?=\s*(?:$|[,.;:)\n/+&]|and\b|for\s+(?:ios|iphone|android|mobile)\b))`;
const RULES: readonly StackRule[] = [
  { name: 'PHP', re: new RegExp(String.raw`\b${BUILD_WITH}(?:php|laravel|codeigniter|symfony|cakephp|yii)\b|\b(?:php|laravel|codeigniter|symfony)\s+(?:mvc|app(?:lication)?|backend|back-end|website|web\s*app|framework|project|based|architecture)\b`, 'i') },
  { name: 'Ruby on Rails', re: new RegExp(String.raw`\b${BUILD_WITH}(?:ruby\s+on\s+rails|rails|ruby)\b|\bruby\s+on\s+rails\b`, 'i') },
  { name: 'ASP.NET', re: new RegExp(String.raw`\b${BUILD_WITH}(?:asp\.net|\.net(?:\s+core)?|c#|blazor)(?![\w])|\basp\.net\b`, 'i') },
  // 🔴 AUTOPSY 042e472f (2026-10-01): "Technology: Kotlin, Jetpack Compose … The project must compile in
  // Android Studio." No rule named a native mobile stack, so the builder was told nothing, deleted the
  // starter's package.json / vite.config.ts / index.html one file at a time, and wrote Gradle files the
  // platform can neither run nor preview. A native stack is now named like any other we do not build —
  // and its note says what we DO build: a mobile-first web app that the APK Builder packages.
  { name: 'native Android (Kotlin)', mobile: true, re: new RegExp(String.raw`\b${BUILD_WITH}(?:kotlin|jetpack\s+compose)\b|\bjetpack\s+compose\b|\bkotlin\s+(?:android\s+)?(?:app|application|project|code|source)\b|\b(?:compile|compiles|build|builds|run|runs|open|opens)\s+in\s+android\s+studio\b|\bandroid\s+studio\s+project\b|\bbuild\.gradle(?:\.kts)?\b|\bsettings\.gradle(?:\.kts)?\b`, 'i') },
  { name: 'native iOS (Swift)', mobile: true, re: new RegExp(String.raw`\b${BUILD_WITH}swiftui\b|\b${BUILD_WITH}swift${STACK_END}|\bswiftui\b|\bswift\s+(?:ios\s+)?(?:app|application|project|code)\b|\b(?:compile|compiles|build|builds|run|runs|open|opens)\s+in\s+xcode\b|\bxcode\s+project\b`, 'i') },
  { name: 'Flutter', mobile: true, re: new RegExp(String.raw`\b${BUILD_WITH}(?:flutter|dart)\b|\bflutter\s+(?:app|application|project|code)\b|\bpubspec\.yaml\b`, 'i') },
  { name: 'React Native', mobile: true, re: new RegExp(String.raw`\b${BUILD_WITH}react[\s-]?native\b|\b${BUILD_WITH}expo${STACK_END}|\breact[\s-]?native\s+(?:app|application|project)\b`, 'i') },
];

/**
 * A "Technology:" / "Tech stack:" / "Built with:" heading whose list names the stack — the commonest way a
 * structured spec states it, with no "using" anywhere. Read only inside that list (eight lines at most), so
 * "Kotlin" elsewhere in prose is not a request.
 */
const TECH_LIST = /(?:^|\n)\s*(?:#+\s*)?(?:tech(?:nology|nologies)?(?:\s+stack)?|stack|built\s+with|platform|language)\s*:?\s*\n?((?:[ \t]*[^\n]*\n?){1,8})/gi;
const TECH_LIST_WORDS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'native Android (Kotlin)', re: /\bkotlin\b|\bjetpack\s+compose\b/i },
  { name: 'native iOS (Swift)', re: /\bswift(?:ui)?\b/i },
  { name: 'Flutter', re: /\bflutter\b|\bdart\b/i },
  { name: 'React Native', re: /\breact[\s-]?native\b|\bexpo\b/i },
  { name: 'PHP', re: /\bphp\b|\blaravel\b/i },
  { name: 'Ruby on Rails', re: /\bruby\s+on\s+rails\b|\brails\b/i },
  { name: 'ASP.NET', re: /\basp\.net\b|\bblazor\b/i },
];

function stackFromTechList(p: string): string | null {
  for (const m of p.matchAll(TECH_LIST)) {
    // The list ends at the first blank line or the next numbered/heading section.
    const block = (m[1] ?? '').split(/\n\s*\n|\n\s*(?:\d+[.)]|#)/)[0];
    const hit = TECH_LIST_WORDS.find((w) => w.re.test(block));
    if (hit) return hit.name;
  }
  return null;
}

/** Is this stack a native PHONE stack (the note then points at the APK Builder)? PURE. */
export function isMobileStack(stack: string | null | undefined): boolean {
  return RULES.some((r) => r.name === stack && r.mobile === true);
}

/** Where the installable Android app is made — the same path every other reply names. */
export const APK_BUILDER_PATH = 'More → Download APK';

/** Does the prompt ask to build with a stack NavBharatAI cannot scaffold? The stack's name, or null. PURE. */
export function unsupportedStackRequested(prompt: string | null | undefined): string | null {
  const p = String(prompt ?? '');
  // A migration ("convert my PHP site to React", "port it from Laravel") names the OLD stack. Asking for
  // PHP there is not what the user did, so a conversion request is never answered with this note.
  if (/\b(?:convert|migrat|port(?:ing|ed)?\b|rewrit|translat|re-?build)\w*\b[^.\n]{0,80}\b(?:to|into|from)\b/i.test(p)) return null;
  for (const r of RULES) if (r.re.test(p)) return r.name;
  return stackFromTechList(p);
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
  if (isMobileStack(stack)) {
    return [
      `STACK NOTE — the user named ${stack}. NavBharatAI cannot build, compile or preview ${stack} projects. It builds WEB apps that install on a phone: the user makes the Android app (APK) from ${APK_BUILDER_PATH}, which packages this project. This project is ${label}; build the whole app in it, mobile-first.`,
      `- Never write ${stack} files (no Gradle, Kotlin, Swift, Dart, Xcode or AndroidManifest files) and never claim the app is ${stack} — not in the UI, the README or a code comment.`,
      '- Never delete, empty or replace package.json, vite.config.*, index.html, tsconfig*.json or src/ — they ARE the app: without them nothing runs, previews or packages.',
      '- Phone features (microphone, speech, reminders, opening other apps, calls, SMS, battery) use the browser APIs and the phone plugins named elsewhere in this brief; where a phone only allows it with the user\'s confirmation, ask for it in the UI.',
      '- If the request asks for a module plan, Gradle files or "Android architecture" (MVVM, ViewModel, StateFlow), map each part to its web equivalent (components, hooks, a store) — the same structure, in this project\'s language.',
    ].join('\n');
  }
  return [
    `STACK NOTE — the user named ${stack}, which NavBharatAI cannot build or run. This project is ${label}; build the whole app in it.`,
    `- Never write ${stack} files and never claim the app is ${stack} or has a ${stack} backend — not in the UI, the README, or a code comment.`,
    ...(frameworkRunsInBrowser(String(framework ?? 'vite-react'))
      ? ['- There is no server here. Where the request asks for something only a server does (server-side validation, CSRF tokens, server sessions), build the real in-browser equivalent and name it honestly as client-side in the code.']
      : []),
  ].join('\n');
}

/** The one line the user reads in the ready message. Empty when nothing needs saying. PURE. */
export function unsupportedStackUserNote(stack: string | null, framework: string | null | undefined, summary?: string | null): string {
  if (!stack) return '';
  const label = builtWithLabel(framework);
  const inBrowser = frameworkRunsInBrowser(String(framework ?? 'vite-react'));
  if (isMobileStack(stack)) {
    // The device notice (devicePowers.ts) may already have said how to get the APK — one place says it once.
    const how = /download\s+apk/i.test(String(summary ?? '')) ? '' : ` To install it on Android, open **${APK_BUILDER_PATH}**, connect your GitHub, and NavBharatAI builds the APK for you — no Android Studio needed.`;
    return `\n\nℹ️ You asked for a **${stack}** app. NavBharatAI builds phone apps from web code, so this one is built with **${label}**, mobile-first — the same screens and features.${how}`;
  }
  return `\n\nℹ️ You asked for **${stack}**. NavBharatAI doesn't build ${stack} apps yet, so this app is built with **${label}** — the same features, a different language underneath.`
    + (inBrowser ? ' It runs in the browser, so the parts that need a server (like server-side checks) are done in the browser instead. Tell me if you want a real server and database added.' : '');
}

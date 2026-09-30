// Shared complex-app category signal — the SINGLE source of truth for "this prompt describes a
// genuinely large, multi-module app" (SaaS, CRM, e-commerce, social network, full-stack, …).
//
// WHY THIS EXISTS (root-cause of a real drift bug): two independent detectors used to keep their own
// keyword lists and disagreed on the same prompt —
//   • RequestAnalyser.RE.complexApp (request TIER) classified "build a SaaS CRM" as `complex_app`, but
//   • BuildTimeEstimator.complexityFromPrompt (pipeline DEPTH + ETA) scored it magnitude 2 → the `fast`
//     lane, so a genuinely complex full-stack build was denied the deep pipeline (blueprint + 1.5×
//     wall-clock) and showed a wildly optimistic ETA.
// Both now read THIS regex, so they can never drift apart and route the same prompt two different ways.
// Pure, dependency-free, unit-tested. It is a SUPERSET of the historical RE.complexApp alternatives
// (every prior match is preserved) plus a few unambiguous app-category signals (crm, erp, marketplace,
// food delivery, ride-hailing) that both detectors previously missed.
import { analyzeRequirementGaps } from './RequirementGapAnalyzer';

/** The value `analyzeRequirementGaps` returns when it recognised no business domain at all. */
export const GENERAL_DOMAIN = 'general';

export const COMPLEX_APP_SIGNAL =
  /\b(full[- ]?stack|full app|complete app|saas|crm|erp|dashboard|admin panel|authentication|auth|login system|signup|payment|stripe|razorpay|checkout|e[-\s]?commerce|marketplace|database|backend|rest api|graphql|multi[- ]?page|multi[- ]?file|crud|real[- ]?time|websocket|chat app|social|booking|inventory|food[- ]?delivery|ride[- ]?hailing)\b/i;

/**
 * Page-scoped deliverables — the request is for ONE static/marketing page, however it's themed.
 * "SaaS landing page" is a landing page ABOUT a SaaS, not a SaaS platform.
 */
export const PAGE_DELIVERABLE_SIGNAL =
  /\b(landing page|portfolio (page|site|website)|single page|one[- ]pager?\b|one[- ]page (site|website|app)|simple website|coming[- ]soon page|splash page)\b/i;

/**
 * A DOCUMENT somebody wants rendered — not a system to build. Pure.
 *
 * 🔴 ROOT CAUSE (autopsy bb688add, 2026-09-20). A printed Hindi मंगल विवाह निश्चय पत्र — one page, no
 * data entry, no accounts — was scored a **complex app (58 → 68)** and routed past the cheap opening
 * rung onto the slower engine. The whole build followed from it: ~48s preamble calls, a shared-contract
 * call left 396ms short that returned nothing, eleven `TS2339` errors, three repair passes, a hand-off.
 * **16.4 minutes and ₹177.98 on the free tier, for a card.** The same report told the builder the app
 * was missing *ticket types, RSVP, QR check-in and payments*.
 *
 * 🔑 THE EXACT MECHANISM, AND IT IS THIS REPO'S OWN RECURRING SHAPE. `namesBusinessDomain` promotes a
 * prompt whose DOMAIN regex matched, and the `events` domain deliberately reads Devanagari —
 * `शादी|विवाह|समारोह|मेला|कार्यक्रम`. Its two narrowing guards, `PAGE_DELIVERABLE_SIGNAL` and
 * `SIMPLE_APP_SIGNAL`, are **pure ASCII**. So the promotion learned Hindi and the brakes did not:
 * in Devanagari that predicate has been running *unguarded* since the day it shipped. A guard that
 * cannot read what its signal reads is not a guard.
 *
 * ⚠️ PRECISION-FIRST, AND THE ASYMMETRY DECIDES THE LIST. Wrong toward "document" costs one cheap
 * opening call the ladder climbs out of; wrong toward "system" cost this build sixteen minutes with no
 * recovery path. So these are the words that name a thing people ask to be PRINTED or SHOWN —
 * invitation, card, letter, certificate, biodata, notice, poster, menu, resume — and never a word that
 * could name an app (`ऐप`, `सिस्टम`, `पोर्टल`, `डैशबोर्ड` are deliberately absent).
 *
 * 🔒 `पत्र` is matched only in its document senses (`निश्चय पत्र`, `निमंत्रण पत्र`, `प्रमाण पत्र`,
 * `पत्रिका`), never bare: bare `पत्र` also means a leaf and appears inside unrelated compounds, and a
 * guard that fires on an accident is how a real hospital system gets demoted.
 */
export const DOCUMENT_DELIVERABLE_SIGNAL =
  /निमंत्रण|आमंत्रण|निश्चय\s*पत्र|निमंत्रण\s*पत्र|प्रमाण\s*पत्र|प्रमाणपत्र|पत्रिका|बायोडाटा|बायो\s*डाटा|कार्ड|सूचना\s*पत्र|पोस्टर|मेन्यू|मेनू|रेज्यूमे|बधाई\s*पत्र|शुभकामना/i;

/**
 * Pure DOMAIN/THEME words: they name what an app is ABOUT, not what must be BUILT. Only used to
 * discount a theme word on a page-scoped deliverable; scope words (auth, database, backend, payment,
 * checkout, real-time, …) are never discounted. /g is safe here — used only in String.replace.
 */
const CATEGORY_THEME_WORDS = /\b(saas|crm|erp|e[-\s]?commerce|marketplace|social|food[- ]?delivery|ride[- ]?hailing)\b/gi;

/**
 * True when the prompt names a genuinely complex, multi-module app to BUILD. Pure.
 *
 * ROOT CAUSE this guards (build report 2026-07-06): "Make a modern SaaS landing page…" matched the
 * category word `saas` and was classified complex_app/deep — a ONE-page marketing site was sent to
 * the multi-agent blueprint pipeline (148 steps, 29 min, died at the wall clock) instead of the
 * ~2-min fast lane. The category word describes the page's THEME, not its SCOPE. So: when the
 * deliverable is page-scoped, strip pure theme words and only stay "complex" if a real build-scope
 * signal remains ("SaaS landing page with login system and stripe checkout" stays complex).
 */
/**
 * Simple, self-contained apps cheap models build reliably — MOVED HERE from `RequestAnalyser.RE`
 * (2026-09-18) so the two questions this module answers, *"is this big?"* and *"is this one of the
 * small ones?"*, are asked from ONE list. `namesBusinessDomain` needs it as a guard, and a second
 * copy is the drifted-list class this module's own header exists to prevent.
 */
export const SIMPLE_APP_SIGNAL =
  /\b(calculator|calc|clock|stopwatch|stop-watch|timer|todo|to-do|to do list|counter|dice|ludo|tic[\s-]?tac[\s-]?toe|snake game|memory game|quiz|flashcard|stopwatch|weather widget|color picker|qr code|bouncing ball|3d ball|landing page|portfolio page|single page|simple website|note app|notes app)\b/i;

/**
 * 🔴 A PROMPT THAT NAMES A BUSINESS DOMAIN IS NOT "hi" (the admin's failure table, 2026-09-18).
 *
 * `COMPLEX_APP_SIGNAL` above lists the words a DEVELOPER uses — saas, crm, checkout, auth, backend.
 * Real users do not write those. They write **`hospital management system`**, `school management
 * system`, `restaurant billing app`, `courier tracking app`, `event management website` — and not
 * one of those matches any signal in this repo's sizing path. Measured on today's `main`, every one
 * scored **5**: the same number as the word *"hi"*, because `detectTaskType` fell through to its
 * final `return 'chat'`.
 *
 * What a 5 buys, all of it wrong for a hospital: the cheapest opening rung, an 80-step ceiling
 * instead of 150, the one-shot/simple lane, no blueprint, and a fast-lane ETA.
 *
 * 🔑 THE FIX IS NOT A NEW KEYWORD LIST — the platform already knows. `analyzeRequirementGaps` is the
 * classifier the admin's own Failure Category panel uses to label those very rows *healthcare*,
 * *education*, *restaurant*, *logistics*, *events*. It had already answered correctly for every
 * prompt above while the module deciding how much engine to spend called them chat. Asking the owner
 * of the fact is what this file's header demands ("both now read THIS regex, so they can never
 * drift apart"); a third list here would be the drift, not the fix.
 *
 * 🔒 TWO GUARDS, both narrowing, so this can only ever fire where nothing else has an opinion:
 *   • a PAGE-scoped deliverable is still a page — "a landing page for a hospital" is a landing page,
 *     the same discount `isComplexAppPrompt` already applies to "SaaS landing page" (the 29-minute
 *     incident in this file's history);
 *   • a SIMPLE deliverable is still simple — "a todo app for my restaurant" is a todo app, and
 *     promoting it would over-spend on exactly the builds the cheap lane exists for.
 * `analyzeRequirementGaps` brings its own precision guard: ordinary-English uses of domain words are
 * stripped before any domain is matched ("good job!" is not a jobs portal), so this inherits a
 * false-positive defence rather than inventing one.
 *
 * ⚠️ It is DELIBERATELY not folded into `isComplexAppPrompt`. That predicate is consulted BEFORE
 * `debugging` and `simple_app` in `detectTaskType`, so widening it would change verdicts that are
 * already correct. This is a separate question, asked last, where the answer today is "I know
 * nothing". PURE.
 */
export function namesBusinessDomain(prompt: string): boolean {
  const p = String(prompt || '');
  if (PAGE_DELIVERABLE_SIGNAL.test(p)) return false;
  // The same guard, in the script the domain regexes already read — see DOCUMENT_DELIVERABLE_SIGNAL.
  if (DOCUMENT_DELIVERABLE_SIGNAL.test(p)) return false;
  if (SIMPLE_APP_SIGNAL.test(p)) return false;
  const domain = analyzeRequirementGaps(p).domain;
  return domain !== GENERAL_DOMAIN && !isPersonalTool(domain, p);
}

/**
 * THE ONE ANSWER to "is this a personal tool rather than a business?", asked by both predicates so the
 * two can never disagree about the same prompt.
 */
function isPersonalTool(domain: string, prompt: string): boolean {
  if (!PERSONAL_TOOL_DOMAINS.has(domain)) return false;
  return !(domain === 'game' && HEAVY_GAME_SIGNAL.test(prompt));
}

/**
 * A game that names real engineering is not the simple family: 3D rendering, an online or multiplayer
 * mode, a physics engine, an open world. "Physics" alone is a school subject ("a physics quiz game"), so
 * only a physics ENGINE or physics-BASED gameplay counts. Those keep today's complex opening (admin 2026-09-27: games go
 * to the cheap engine *"agar saste module me ho sakte hai"* — only where it can). Scope words such as
 * login, database or real-time are already caught earlier by `isComplexAppPrompt`.
 * `3d ball` is deliberately NOT here: it is a named simple app in `SIMPLE_APP_SIGNAL`.
 */
export const HEAVY_GAME_SIGNAL =
  /\b3d\b(?!\s+ball\b)|three\.?js|webgl|babylon|\bmulti[- ]?player\b|\bonline\s+(?:game|play|match|mode|battle)|\bpvp\b|\bmmo\b|physics[- ](?:engine|based)|realistic\s+physics|open[- ]world|\bunity\b|\bunreal\b/i;

/**
 * Domains the requirement analyser recognises that are NOT a business: the personal tools a single
 * person uses — a todo list, a reminder, a planner, a habit tracker, a checklist, notes.
 *
 * 🔴 AUTOPSY d829b523 (2026-09-27). *"Build a water drinking reminder app…"* scored **58, complex_app** —
 * the score of a hospital ERP — because the requirement analyser correctly labelled it `productivity`
 * and `namesBusinessDomain` promoted EVERY labelled domain. The build opened on the always-reasoning
 * rung, skipped the fast lane, and first rendered at 237 s for a one-screen localStorage app. Even
 * *"build a reminder app"* alone scored 58, while *"a todo app"* scored 15 — the same family, split only
 * by which of its words happened to be in `SIMPLE_APP_SIGNAL`.
 *
 * 🔑 This is `namesBusinessDomain`'s OWN second guard, not a new rule: its docblock says *"a todo app
 * for my restaurant is a todo app, and promoting it would over-spend on exactly the builds the cheap
 * lane exists for."* The `productivity` domain's own regex begins with `todo`. A set rather than a
 * keyword list, so the analyser stays the single owner of the vocabulary.
 *
 * ⚠️ Scope-bearing words still win, because `isComplexAppPrompt` is asked FIRST in `detectTaskType`:
 * *"a team task manager with login and a database"* is still complex.
 *
 * 🎮 `game` JOINED 2026-09-27, on the admin's decision (*"han, agar saste module me ho sakte hai to, hona
 * chahiye"*). A snake, memory or racing game is one screen of canvas code; it was opening on the
 * always-reasoning rung only because `namesBusinessDomain` promoted every labelled domain. The admin's
 * condition — *only where it can* — is `HEAVY_GAME_SIGNAL`: 3D, multiplayer/online, a physics engine or
 * an open world keep the complex opening.
 */
export const PERSONAL_TOOL_DOMAINS: ReadonlySet<string> = new Set(['productivity', 'game']);

/**
 * True when the prompt names one of the personal-tool domains above — the simple family, recognised by
 * the same analyser that recognises the business domains, so the two can never overlap. Carries the
 * page/document guards of `namesBusinessDomain` for the same reason. PURE.
 */
export function namesPersonalTool(prompt: string): boolean {
  const p = String(prompt || '');
  if (PAGE_DELIVERABLE_SIGNAL.test(p) || DOCUMENT_DELIVERABLE_SIGNAL.test(p)) return false;
  return isPersonalTool(analyzeRequirementGaps(p).domain, p);
}

/**
 * A heavy GAME — the game domain with real engineering named (3D, multiplayer, a physics engine, an
 * open world). The same two facts `isPersonalTool` already combines, asked directly.
 *
 * 🔴 AUTOPSY f496c75b (2026-09-30). *"Single file html code se mobile friendly 3d fight game banao
 * realastic"* scored **30, coding** — the "small snippet" class — because `html` is on the coding list
 * and that check runs before the domain question. A realistic 3D fight game opened on the cheapest flash
 * rung, which then spent 196 s timing out, and the 5–11 min estimate became 17.7 min. A technology word
 * inside an app request does not make the request a snippet. Asked BEFORE `coding` in RequestAnalyser;
 * a page or document deliverable is still a page. PURE.
 */
export function namesHeavyGame(prompt: string): boolean {
  const p = String(prompt || '');
  if (PAGE_DELIVERABLE_SIGNAL.test(p) || DOCUMENT_DELIVERABLE_SIGNAL.test(p)) return false;
  return HEAVY_GAME_SIGNAL.test(p) && analyzeRequirementGaps(p).domain === 'game';
}

export function isComplexAppPrompt(prompt: string): boolean {
  const p = String(prompt || '');
  if (!COMPLEX_APP_SIGNAL.test(p)) return false;
  if (PAGE_DELIVERABLE_SIGNAL.test(p)) {
    return COMPLEX_APP_SIGNAL.test(p.replace(CATEGORY_THEME_WORDS, ' '));
  }
  return true;
}

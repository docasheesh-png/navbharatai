// AgentV3 — THE ONE REQUEST-NOTES LIST, AND HOW A LANE READS IT (autopsy 9c612cdb, 2026-10-12, Q-991).
//
// Every note about the REQUEST (the stack we do not build, a script asked for, a name we do not know, the
// no-login scope, a keypad phone, a property only a third party controls) is gathered into ONE list in the
// route, and every lane that plans or writes the app reads that list: the architect, the fast lane, the
// one-shot lane, the project planner, the plan-first planner and the writing sub-agents. Each note used to be
// threaded into each lane by hand, and each fix reached only the lanes its author remembered.
//
// The join lives here, not in the route, because the chat handler sits at TypeScript's control-flow limit
// (TS2563): every `notes ? … : …` written there is one more branch the checker must walk. PURE.

/** What separates one note from the next, and the notes from the prompt they open. */
export const REQUEST_NOTE_SEPARATOR = '\n\n---\n\n';

/**
 * A prompt opened by the request notes; the prompt unchanged when there are none. The separator joins two
 * things, so it is written only when there ARE two — an empty side would otherwise leave a bare `---` for a
 * model to read as a missing section (found by Q-1017's own test). PURE.
 */
export function withRequestNotes(prompt: string, notesText: string): string {
  if (!notesText) return prompt;
  if (!prompt) return notesText;
  return `${notesText}${REQUEST_NOTE_SEPARATOR}${prompt}`;
}

// ── THE CAP BELONGS TO THE REQUEST, NEVER TO THE JOIN (Q-1017, 2026-10-16) ───────────────────────────────
//
// 🔴 WHAT WENT WRONG, AND WHY RAISING THE CAP WAS NOT THE FIX. `createProjectPlan` capped its goal at
// MAX_GOAL_CHARS and the route handed it the JOINED text — our notes first, the user's request after. So the
// cut always landed on the user's own words, and the notes' length decided how many of them survived: a
// ~1,100-char stack note ate 1,100 characters of the spec before the spec was even measured.
//
// Autopsy 042e472f (2026-10-01) met this exact failure — a spec's closing requirements cut off the end — and
// the fix was to raise the cap from 4,000 to 6,000. That is the fourth rule's forbidden shape: the cliff
// moved, the class survived, and a longer spec walks off the new edge the same way. The CONDITION is that one
// scalar bound was applied AFTER a join of two different things, so one part's size silently spent the
// other's budget.
//
// 🔑 SO THE BOUND IS APPLIED BEFORE THE JOIN, TO THE REQUEST ALONE. The notes are ours, they are few and
// short, and they are kept whole; the request gets the whole cap to itself, so the same spec keeps the same
// characters whatever notes ride with it. And when the request really is longer than the cap, the text SAYS
// so (the fifth rule's step 5) instead of letting the reader believe the spec ended there.

/** The marker that tells a reader the request itself was longer than its cap — never silent. */
export const REQUEST_TRUNCATION_MARKER = '[… the request above was longer than this build records and was cut here]';

export interface BoundedRequestNotes {
  /** The notes whole, opening a request capped on its own. */
  text: string;
  /** True when the REQUEST exceeded the cap — the notes never cause this and never suffer it. */
  requestTruncated: boolean;
}

/**
 * The same join as `withRequestNotes`, with the cap where it belongs: on the request. The notes are kept
 * whole, so no note can shorten the user's words, and the surviving prefix of a given request is identical
 * whether it carries six notes or none. PURE.
 */
export function withRequestNotesBounded(prompt: string, notesText: string, maxRequestChars: number): BoundedRequestNotes {
  const request = prompt || '';
  const cap = Number.isFinite(maxRequestChars) && maxRequestChars > 0 ? Math.floor(maxRequestChars) : 0;
  const requestTruncated = request.length > cap;
  const kept = requestTruncated
    ? `${request.slice(0, cap)}\n\n${REQUEST_TRUNCATION_MARKER}`
    : request;
  return { text: withRequestNotes(kept, notesText), requestTruncated };
}

// ── THE LIST ITSELF, COMPUTED ONCE (Q-1016, 2026-10-15) ──────────────────────────────────────────────────
//
// 🔴 WHY IT MOVED HERE. Q-991 gathered every note into one list in the route and had every lane read it.
// Q-1020's rebuilt census then measured something that list could not fix: SIX builder prompts still read
// the BARE request — the blueprint lane's file manifest and its shared contract, the mega-app roadmap
// planner (twice) and the repair pass (twice). None of them was a wiring oversight. Every one of them runs
// ABOVE the line where the first note input was computed, so there was nothing to hand them: the blueprint
// lane plans at route ~16750 and the first note input appeared at ~16978. A Kotlin request, a keypad phone
// or a no-login scope was therefore planned blind, and the plan is what the whole build then follows.
//
// 🔑 SO THE FIX IS NOT ANOTHER THREADED ARGUMENT — IT IS ONE COMPUTATION, READ IN BOTH PLACES. Every input
// is available long before any lane plans (`planning.text` at route ~12881, `intent`/`framework` earlier
// still); only the project read for the third-party players is asynchronous, and the route does that read
// before calling this. Shape borrowed from Q-1026/Q-1033, where the same "two readers, one computation"
// move closed the same class.
//
// It also returns the FACTS each note was derived from, because the route's report lines need them
// (`UNSUPPORTED_STACK`, `UNKNOWN_NAME_IN_REQUEST`, `REQUEST_SCOPE_NOTE`, `SCRIPT_REQUEST_AS_WEB_APP`) and
// deriving them a second time there is how two answers to one question appear.
//
// PURE: every producer below is pure and never throws, except `requestScopeVerdict`, which is wrapped.

import { unsupportedStackRequested, unsupportedStackBuilderNote } from './unsupportedStack';
import { unknownNameNoteEnabled, unknownNamesInRequest, unknownNameBuilderNote } from './unknownName';
import { requestScopeVerdict, type RequestScopeReason } from './requestScope';
import { scriptRequestNoteEnabled, scriptDeliverableRequested, liveDataRequested, scriptRequestBuilderNote } from './scriptRequest';
import { namedNonSmartphone, nonSmartphoneBuildRule } from './deviceTarget';
import { thirdPartyLimitAsked, thirdPartyLimitsBuilderNote, type OwnAdNetwork } from './thirdPartyLimits';
import { analyzeRequirementGaps } from '../lib/RequirementGapAnalyzer';

export interface RequestNoteInputs {
  /** The user's words for this turn. */
  prompt: string;
  /** The planning request — the words PLUS the attachment and the earlier requests (autopsy 3f959fde). */
  planningText: string;
  newBuild: boolean;
  /** An edit of an app that exists. A keypad phone named in an edit is a detail, not a target (Q-868). */
  editing: boolean;
  importTurn: boolean;
  framework: string;
  /** The WHOLE project's ad-serving players — the route's own async read (`editTurnAdFacts`). */
  thirdPartyPlayers?: readonly string[];
  /**
   * …and its OWN ad networks (`projectOwnAdSdks`, Q-1018) — the ads that ARE ours to remove, as opposed to
   * the ones inside another service's player.
   *
   * ✅ THREADED ON MERGE, AS THIS FIELD'S FIRST VERSION PROMISED. Q-1016 shipped with it typed `never`,
   * because #3753 (which adds this third argument to `thirdPartyLimitsBuilderNote`) was green but unmerged
   * and this module was written against a `main` that did not have it. Stacking branches to borrow it would
   * have been worse than one recorded follow-up; both have now landed, so the note the blueprint lane reads
   * names the app's own ad slots too.
   */
  thirdPartyOwnAds?: readonly OwnAdNetwork[];
  /** The user answered YES to our offer to build this request (buildConfirmation.ts). */
  offerAccepted?: boolean;
}

/**
 * 🔴 A YES IS NOT AN INVITATION TO ASK AGAIN (autopsy 35bd9e17, 2026-10-21). "Ai video makerwith prompt" got our
 * offer to build; the user typed "Start". The build ran on that request — and the builder answered with a scope
 * summary and "Does that match what you had in mind?", the same question the offer had just put to the user. The
 * nudge rightly stands down for a model that asks (overriding an answer has cost users working apps), so the
 * turn ended with no app and the user had to say yes a second time. The builder never knew the yes had happened:
 * the offer lives in the chat route, and the model saw only the request. So it is told, in the one list every
 * lane reads. The note forbids the question, not the thinking: defaults are chosen and stated.
 */
export function offerAcceptedBuilderNote(offerAccepted: boolean | undefined): string {
  if (!offerAccepted) return '';
  return 'CONFIRMED BY THE USER: they were already offered this exact build and answered yes. Do not ask them to confirm the scope, '
    + 'style or defaults again, and do not end your turn with a question — pick sensible defaults, build the app, and say in one '
    + 'closing line which defaults you chose. Ask only if something is impossible without their answer.';
}

/** The list, the joined text, and every fact the notes were derived from. */
export interface RequestNotesResult {
  notes: ReadonlyArray<{ code: string; text: string }>;
  /** The notes joined in the architect's reading order — '' when there are none. */
  text: string;
  unsupportedStackAsked: string | null;
  unknownNamesAsked: readonly string[];
  unknownNameNote: string;
  requestScopeText: string;
  requestScopeReason: RequestScopeReason | null;
  scriptFormAsked: string | null;
  liveDataAsked: boolean;
  scriptRequestNote: string;
  keypadPhone: { device: string; kind: string } | null;
  thirdPartyLimitAsk: boolean;
}

/**
 * Every request note for this turn, and the facts behind them. Call it ONCE, before the first lane plans.
 * Order is the architect's reading order, top first — the unchanged order of the old route prepends. PURE.
 */
export function requestNotesFor(input: RequestNoteInputs): RequestNotesResult {
  const newBuildOnly = input.newBuild && !input.importTurn;

  // THE USER NAMED A STACK WE DO NOT BUILD (autopsy 8e124182). Only a NEW build is told: an edit of an
  // existing app already has a stack.
  const unsupportedStackAsked = newBuildOnly ? unsupportedStackRequested(input.prompt) : null;

  // A word we do not know is not a service to connect to (Q-067, autopsy de3bb2bb: "COACT" became a chat
  // to "the COACT backend").
  const unknownNamesAsked = newBuildOnly && unknownNameNoteEnabled() ? unknownNamesInRequest(input.prompt) : [];
  const unknownNameNote = unknownNameBuilderNote(unknownNamesAsked);

  // A login nobody asked for is a wall in front of the app (autopsy 70e030bb, requestScope.ts). The ONE
  // producer here that can throw, so it keeps the route's own try — a note must never fail a build.
  let requestScopeText = '';
  let requestScopeReason: RequestScopeReason | null = null;
  try {
    const scope = requestScopeVerdict({
      request: input.planningText,
      newBuild: newBuildOnly,
      domain: analyzeRequirementGaps(input.planningText).domain,
    });
    requestScopeText = scope?.note ?? '';
    requestScopeReason = scope?.reason ?? null;
  } catch { requestScopeText = ''; requestScopeReason = null; }

  // A script, a CLI, a Streamlit dashboard or a notebook is built as a web app, and the user hears it
  // BEFORE the build (Q-274, autopsy 241215d1).
  const liveDataAsked = liveDataRequested(input.prompt);
  const scriptFormAsked = newBuildOnly && scriptRequestNoteEnabled() ? scriptDeliverableRequested(input.prompt) : null;
  const scriptRequestNote = scriptRequestBuilderNote(scriptFormAsked, liveDataAsked);

  // A KEYPAD PHONE THE USER NAMED (Q-846), new builds only (Q-868): on an edit — "add a Nokia 3310 as a
  // pickup in my 3D city game" — the phone is a detail of the request, and "never three.js" would break a
  // working 3D game.
  const keypadPhone = !input.importTurn && input.newBuild && !input.editing ? namedNonSmartphone(input.prompt) : null;

  // NO ADS FROM A PLAYER THAT SHOWS ITS OWN (Q-990, autopsy 9c612cdb).
  const players = input.thirdPartyPlayers ?? [];
  const thirdPartyLimitAsk = thirdPartyLimitAsked({
    prompt: input.prompt, newBuild: input.newBuild, importTurn: input.importTurn, projectPlayers: players,
  });

  const notes: ReadonlyArray<{ code: string; text: string }> = [
    { code: 'unsupported-stack', text: unsupportedStackAsked ? unsupportedStackBuilderNote(unsupportedStackAsked, input.framework) : '' },
    { code: 'script-request', text: scriptRequestNote },
    { code: 'unknown-name', text: unknownNameNote },
    { code: 'request-scope', text: requestScopeText },
    { code: 'device', text: keypadPhone ? nonSmartphoneBuildRule(keypadPhone.device, keypadPhone.kind) : '' },
    { code: 'third-party-limits', text: thirdPartyLimitsBuilderNote(thirdPartyLimitAsk, players, input.thirdPartyOwnAds ?? []) },
    { code: 'offer-accepted', text: offerAcceptedBuilderNote(input.offerAccepted) },
  ];

  return {
    notes,
    text: notes.map((n) => n.text.trim()).filter(Boolean).join(REQUEST_NOTE_SEPARATOR),
    unsupportedStackAsked, unknownNamesAsked, unknownNameNote,
    requestScopeText, requestScopeReason,
    scriptFormAsked, liveDataAsked, scriptRequestNote,
    keypadPhone, thirdPartyLimitAsk,
  };
}

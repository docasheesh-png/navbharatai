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

/** A prompt opened by the request notes; the prompt unchanged when there are none. PURE. */
export function withRequestNotes(prompt: string, notesText: string): string {
  return notesText ? `${notesText}${REQUEST_NOTE_SEPARATOR}${prompt}` : prompt;
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
import { thirdPartyLimitAsked, thirdPartyLimitsBuilderNote } from './thirdPartyLimits';
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
   * ⚠️ NOT THREADED YET, DELIBERATELY. #3753 (Q-1018) adds the app's OWN ad networks as a third argument
   * to `thirdPartyLimitsBuilderNote`, and that PR is green but unmerged; this branch is cut from `main`,
   * where the argument does not exist. Stacking branches to borrow it would be worse than one recorded
   * follow-up: when #3753 lands, pass its `ownAds` through here so the blueprint lane hears that note too.
   */
  thirdPartyOwnAds?: never;
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
    { code: 'third-party-limits', text: thirdPartyLimitsBuilderNote(thirdPartyLimitAsk, players) },
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

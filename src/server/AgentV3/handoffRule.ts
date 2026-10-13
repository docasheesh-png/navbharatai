// AgentV3 — the ONE exception to the architect's delegation rule, and the marker that turns it on.
//
// 🔴 WHY (autopsy 121c2431, 2026-09-26; admin approved the narrow exception the same day: "architect
// wala PR banao"). Two instructions reached the architect in the same build and contradicted each other:
//
//   • the system prompt: "MANDATORY DELEGATION (no exceptions) … never write application code yourself";
//   • the fast-lane hand-off note: "READ these files first and COMPLETE the app around them … fix any
//     error in place".
//
// The architect fixed one import itself, then spent a 71-second call and 26,371 characters arguing with
// itself about which instruction it had broken, and ended its turn without a tool call. Build 2 of the
// same app delegated the same fixes to the frontend specialist and succeeded — so the rule is not
// wrong, it is incomplete. Delegating a one-line import fix costs a specialist spawn (minutes); arguing
// about it costs the build.
//
// 🔒 THE EXCEPTION IS NARROW BY CONSTRUCTION, and both halves read from here so they cannot drift:
//   • it applies only to files a faster lane already wrote — the hand-off note carries
//     `SALVAGE_HANDOFF_MARKER`, and the rule names that exact marker;
//   • only MECHANICAL errors: an import, a type or props annotation, a name collision, a path. A new
//     feature, component or page is still delegated, exactly as before.

/** Opens the build prompt when the fast lane handed finished files to the full builder. */
export const SALVAGE_HANDOFF_MARKER = '[CONTINUE — DO NOT START OVER]';

/** The system-prompt lines that grant the exception (indented to sit under the delegation rule). */
export const HANDOFF_MECHANICAL_FIX_RULE: readonly string[] = [
  `  ONE EXCEPTION — files a faster lane already wrote: when the request opens with ${SALVAGE_HANDOFF_MARKER},`,
  '  you MAY fix MECHANICAL errors in those files yourself with edit_file — a missing or wrong import, a',
  '  wrong type or props annotation, a name collision, a wrong path. Delegating a one-line fix costs minutes.',
  '  New features, new components and new pages are still delegated. Do not deliberate over this rule: if',
  '  the fix is mechanical, make it; if it is not, send it to the specialist.',
];

/** The sentence the hand-off note adds, so the note and the rule say the same thing. */
export const HANDOFF_NOTE_FIX_LINE =
  'Mechanical fixes in these files (an import, a type or props annotation, a name, a path) you make yourself with edit_file — '
  + 'that is the one exception to delegation. New features, components and pages still go to the specialists.';

/**
 * The hand-off sentence that names every shared type the faster lane renamed off a component's name. '' when
 * there is none. PURE.
 *
 * 🔴 BUILD 9c612cdb (Q-942). The lane renamed `VideoList` (the data) to `VideoListData` because
 * `src/components/VideoList.tsx` is the component, and said so only to the user. This note said "keep their
 * types and export names", so the builder — which never saw the contract call — wrote `VideoList` as a type in
 * App.tsx and met TS2749 with the compiler's own wrong suggestion (`typeof VideoList`). The rename is a fact
 * the next writer needs; it travels with the hand-off (and in the shared types file's header).
 */
export function contractRenameHandoffLine(renames: ReadonlyArray<{ from: string; to: string; component?: string }> | undefined): string {
  const list = (renames ?? []).filter((r) => r && r.from && r.to && r.from !== r.to);
  if (list.length === 0) return '';
  const named = list.map((r) => `${r.from} → ${r.to} (${r.from} is the component${r.component ? ` in ${r.component}` : ''})`).join('; ');
  return `NavBharatAI renamed these shared types so no data type shares a component's name: ${named}. `
    + 'In a type position always write the NEW name and import it from the shared types file — the old name is the component, '
    + 'and the compiler\'s "Did you mean typeof …" suggestion is only right when you mean the component itself.';
}

/**
 * Why the faster lane's files are being handed over — the clause after "A faster build lane already generated N
 * file(s) of THIS app" in the CONTINUE note. PURE.
 *
 * 🔴 BUILD 9c612cdb (Q-912). It was picked by ONE question — did the lane fail its compile? — so every other
 * ending said "before running out of time", including that build's hand-off: the lane stopped ON PURPOSE 32 s
 * into a 240 s budget, because its next engine reasons before every answer. The next builder was told a
 * deadline had cut the work short, which invites it to treat the files as unfinished. The same one-reason-for-
 * every-ending class `laneFallbackSummary` fixed for the report's own line (Q-939), here in the note the model
 * reads. The reason the lane ended now picks the words, and "running out of time" is said only about time.
 */
export function salvageWhyClause(reason: string | undefined, handedOff: boolean | undefined): string {
  const why = String(reason ?? '');
  if (why === 'verify_failed') return 'and they do not compile yet';
  if (handedOff) return 'and then handed the rest of the app to you on purpose (its next engine reasons before every answer, which that lane cannot carry), not because it ran out of time';
  if (/\btimed out\b/i.test(why)) return 'before running out of time';
  if (/stage\(s\) left would need/i.test(why)) return 'before stopping early, because the stages left could not finish inside its time budget';
  if (/root component/i.test(why)) return "but not the app's root component, so they are not connected to the page yet";
  return 'before it stopped';
}

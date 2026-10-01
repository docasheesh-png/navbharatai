// AgentV3 — EARLY PREVIEW: the user sees their app WHILE it is being built, not after.
//
// Admin 2026-10-01, verbatim: "yeh kaam to mai navbharatai jab se banna suru kiya hai, tab se bol raha
// hu … preview jitna jaldi ayega, user utna rukega.... banao".
//
// 🔴 WHAT THE REPORT SHOWED (autopsy 120eb52f / b4901ce5, the calendar app). Two builds, nine minutes,
// and the user never once saw their app. In the first build the full builder wrote the store, a hook,
// the header, the day cell, the event modal and the calendar page — and never `src/App.tsx`, so for
// five minutes the live preview rendered the starter page. In the second it rewrote App.tsx at minute
// three, and the user pressed Stop at 214 s, one second after the engine said "the app looks complete".
// Both stops were people who could not see anything happening to their app.
//
// 🔑 THE CAUSE IS AN ORDER, NOT A SPEED. The preview has followed every write since streaming first
// paint (2026-08-14): each `file_changed` re-renders it from the sandbox. But a React app shows NOTHING
// of a screen until its ENTRY renders that screen, and the entry was written LAST on both lanes: the
// fast lane generates it in the final tier by design (it needs its children's real props), and the full
// builder writes leaves first by habit. So the preview was live and had nothing to show.
//
// THE FIX, in three parts that need each other:
//   1. The full builder writes the ENTRY right after the shared types — the real layout and imports of
//      the screens it is about to write (`shellEarlyRule`). The write-time typecheck already routes the
//      resulting "cannot find module" errors to the file that fixes them ("write X next"), so this
//      costs no repair turn.
//   2. While a build is running, the in-browser preview renders an import of a screen that is not
//      written yet as a "being built" card instead of nothing (`ReactPreview.ts`, `building`). An entry
//      written first therefore shows the app's real frame at once, and each card turns into the real
//      screen the moment it lands. After the build the old honest "missing file" banner is back.
//   3. A fast-lane hand-off that never reached the entry tells the full builder so, by name
//      (`entryFirstHandoffLine`) — the exact shape of the calendar report's first build.
//
// ⚠️ WHAT THIS DOES NOT CHANGE: the fast lane's own tier order. Its entry still comes last, because
// that is what lets the entry use its children's REAL props in one pass — reordering it would trade
// first-try success for a faster first paint, and both are the admin's aims. On a healthy fast lane the
// whole app lands at once at the end of generation (seconds after the entry), so the gain there is small.
//
// Kill switch: AGENTV3_EARLY_PREVIEW=off → no rule, no hand-off line, no placeholder; the preview and
// the prompts are exactly what they were before.

import { envFlag } from '../lib/envFlag';

/** Is early preview on? Default ON — the late preview is the defect, so the env is a kill switch. */
export function earlyPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) return envFlag('AGENTV3_EARLY_PREVIEW', true);
  const raw = String(env.AGENTV3_EARLY_PREVIEW ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === 'false' || raw === '0' || raw === 'no');
}

/**
 * The rule the full builder (and any specialist that writes the UI) is given: the entry is written
 * right after the shared types. Lines, so it drops into the prompt arrays the way the other rules do;
 * empty when the switch is off.
 */
export function shellEarlyRule(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!earlyPreviewEnabled(env)) return [];
  return [
    '    • 🖥️ GET THE APP ON SCREEN EARLY — on a NEW app, or one whose entry still shows the starter page:',
    '      right after `src/types.ts`, write the ENTRY (`src/App.tsx`) — the real layout, navigation and',
    '      imports of the screens you are about to write — BEFORE the screens themselves. The user watches',
    '      a live preview while you build: it renders the entry at once and shows every screen you have',
    '      not written yet as a "being built" card that turns into the real screen the moment you write',
    '      it. An entry written last means minutes of a starter page, and people stop builds they cannot',
    '      see. The typecheck names those imports as missing until you write them — that is expected:',
    '      write them next, never stub them out or delete the imports. (This is the ROOT importing its',
    '      children; a child still never imports from the root.)',
  ];
}

/** The specialists that write the app's UI and therefore its entry. */
export function writesTheEntry(role: string): boolean {
  return role === 'frontend' || role === 'fullstack' || role === 'mobile';
}

/**
 * The hand-off line for a fast lane that stopped before its entry was written: name the entry and say
 * it comes first. `unwritten` is `unwrittenEntries(plan, salvaged)` — computed by the caller so this
 * module stays a leaf the architect prompt can import. '' when there is nothing to name or the switch
 * is off. Pure.
 */
export function entryFirstHandoffLine(unwritten: readonly string[] | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!earlyPreviewEnabled(env)) return '';
  const entries = (unwritten ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (entries.length === 0) return '';
  const names = entries.join(', ');
  return `${names} ${entries.length > 1 ? 'are' : 'is'} NOT written yet, so the user's live preview still shows the starter page. `
    + `Write ${names} NEXT, before any other file — the real layout and the imports of the screens — then write the screens: `
    + 'each one appears in the preview the moment it is written.';
}

/**
 * Should this in-browser render show unwritten screens as "being built"? Only while a build is really
 * running — the client says so, or this instance is running one — and only with the switch on.
 */
export function renderWhileBuilding(clientSaysBuilding: unknown, buildRunningHere: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!earlyPreviewEnabled(env)) return false;
  return clientSaysBuilding === true || buildRunningHere === true;
}

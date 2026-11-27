// AgentV3 — A REPLY IS NOT TRUE AFTER THE BUILD HAS PROVEN IT WRONG (build report #2566, 2026-11-27).
//
// 🔴 WHAT HAPPENED. A "continue … finish/fix the build" turn. At ~830 s the builder closed its turn with: *"all four
// areas build every time. The clean console confirms it."* The platform then opened the preview again, saw
// `[world] no dry ground was found for "riverside-town" anywhere on the map; it was left out.` in the console, and
// started a preview-render repair (~955 s). That repair was still investigating when the 25-minute wall-clock cap
// stopped the build (1500 s). The user was handed the 830 s reply — unqualified — and the record said `ok: true`.
//
// 🧬 THE CLASS: the reply the user reads is written by the model at the END OF ITS TURN, but the platform keeps
// checking after that (render verify + repair, runtime auto-fix, last-chance proof, the deadline). `adoptHealResult`
// deliberately keeps the build's own reply through every repair (autopsy 8e124182), and a repair that never finishes
// changes nothing at all — so nothing ever compared the reply's moment with what the platform found AFTER it. Any
// later, still-standing finding outlived the summary in silence.
//
// 🔑 THE RULE. A summary is dated (the moment its runner emitted `done`). Every preview / runtime finding recorded
// after that moment, and NOT answered by a later clean real-browser check, is contrary evidence. So is the
// wall-clock cap firing after it: a STOPPED build is never presented as a plain success. The correction is appended
// in plain words (the reply stays — it describes real work — but it is marked as written before the last check).
//
// 🔒 PRECISION. Only findings AFTER the reply count (an error the reply itself fixed is never re-raised), only the
// preview/runtime family (the claims a reply makes about the running app), and a later clean check supersedes
// every finding before it. A summary whose moment cannot be found gets no correction (silence beats a wrong date).
// Kill switch: AGENTV3_STALE_SUMMARY_NOTE=off. PURE.

export function staleSummaryNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_STALE_SUMMARY_NOTE ?? '').trim().toLowerCase() !== 'off';
}

export interface DatedReply { ts: number; text: string }
export interface TimelineEntry { ts: number; code: string; severity: string; message: string; autoResolved?: boolean }

/** Findings that say the running app is NOT as a reply describes it. */
const PROBLEM_CODES = new Set(['PREVIEW_NOT_RENDERED', 'OUTCOME_PREVIEW_FAILED', 'RUNTIME_ERRORS_REMAIN']);
/** Checks that answer every finding before them: a real browser opened the app and it ran clean. */
const CLEAN_CODES = new Set(['OUTCOME_BUILD_SUCCESS', 'RUNTIME_VERIFIED']);
/** The wall-clock watchdog's outcome — the build did not converge (the advisory cap is a different code on purpose). */
export const STOPPED_CODE = 'OUTCOME_STOPPED';

const squash = (t: string): string => String(t ?? '').replace(/\s+/g, ' ').trim();

/**
 * When was the reply inside `summary` written? The latest dated reply whose opening (first 160 chars, whitespace
 * folded) appears in the summary — the platform only ever adds lines around a reply, so its opening survives. NULL
 * when none matches: the caller then says nothing. PURE.
 */
export function summaryWrittenAt(replies: readonly DatedReply[], summary: string): number | null {
  const s = squash(summary);
  if (!s) return null;
  let at: number | null = null;
  for (const r of Array.isArray(replies) ? replies : []) {
    const head = squash(r?.text ?? '').slice(0, 160);
    if (head.length < 40 || !Number.isFinite(r.ts)) continue;
    if (s.includes(head) && (at === null || r.ts > at)) at = r.ts;
  }
  return at;
}

function isClean(e: TimelineEntry): boolean {
  if (CLEAN_CODES.has(e.code)) return true;
  return e.code === 'LAST_CHANCE_PROOF' && e.severity === 'info';
}

export interface LaterEvidence {
  /** The still-standing findings recorded after the reply, oldest first (messages). */
  problems: string[];
  /** The wall-clock cap fired after the reply. */
  stopped: boolean;
  /** The cap in minutes, when the stop record names it. */
  capMinutes: number | null;
}

/** What the platform found after `since` that no later clean check answered. PURE. */
export function laterEvidence(input: {
  since: number | null;
  issues: readonly TimelineEntry[];
  /** The last clean real-browser preview check (BuildDiagnostics.recordPreviewVerified), if any. */
  lastCleanAt?: number | null;
}): LaterEvidence {
  const none: LaterEvidence = { problems: [], stopped: false, capMinutes: null };
  if (input.since === null || !Number.isFinite(input.since)) return none;
  const after = (Array.isArray(input.issues) ? input.issues : []).filter((e) => e && Number.isFinite(e.ts) && e.ts >= (input.since as number));
  let lastClean = Number.isFinite(input.lastCleanAt as number) ? (input.lastCleanAt as number) : -Infinity;
  for (const e of after) if (isClean(e) && e.ts > lastClean) lastClean = e.ts;
  const problems: string[] = [];
  for (const e of after) {
    if (!PROBLEM_CODES.has(e.code) || e.autoResolved === true || e.ts <= lastClean) continue;
    const m = squash(e.message);
    if (m && !problems.includes(m)) problems.push(m);
  }
  const stop = after.find((e) => e.code === STOPPED_CODE);
  const min = stop ? /\((\d+)\s*min\)/.exec(stop.message)?.[1] : undefined;
  return { problems, stopped: !!stop, capMinutes: min ? Number(min) : null };
}

/** The first concrete thing the platform saw — a console line when there is one, quoted as the user would see it. */
function firstObservation(problems: readonly string[]): string {
  for (const p of problems) {
    const consoleLine = /console:\s*([^|]+)/.exec(p)?.[1]?.trim();
    if (consoleLine) return consoleLine.slice(0, 240);
  }
  return String(problems[0] ?? '').split(' | ')[0]!.slice(0, 240);
}

/** The user-facing correction. '' when there is nothing to correct. English, plain, no vendor names. PURE. */
export function staleSummaryNote(e: LaterEvidence): string {
  if (e.problems.length === 0 && !e.stopped) return '';
  const limit = e.capMinutes ? `the ${e.capMinutes}-minute build time limit` : 'the build time limit';
  const lead = '\n\n⚠️ **Written before the last check — this is not the final word.** The reply above was written before the platform finished checking your app.';
  if (e.problems.length > 0) {
    const seen = `After it, the live preview still showed: "${firstObservation(e.problems)}"`
      + (e.problems.length > 1 ? ` (and ${e.problems.length - 1} more finding${e.problems.length === 2 ? '' : 's'}).` : '.');
    const end = e.stopped
      ? ` A repair was started, but ${limit} stopped the build before it finished, so this problem is still in your app. Ask me to continue and I will pick up from here.`
      : ' The repair attempts ran out before it was fixed, so this problem is still in your app. Ask me to fix it and I will start from here.';
    return `${lead} ${seen}${end}`;
  }
  return `${lead} Then ${limit} stopped the build while the platform was still checking and repairing it, so what the reply says was not confirmed at the end. Ask me to continue and I will finish the check.`;
}

/** The admin report line. PURE. */
export function staleSummaryReport(e: LaterEvidence): string {
  const parts: string[] = [];
  if (e.problems.length) parts.push(`${e.problems.length} preview/runtime finding(s) recorded after it were never answered by a clean check: ${e.problems.slice(0, 2).join(' || ').slice(0, 400)}`);
  if (e.stopped) parts.push(`the wall-clock cap${e.capMinutes ? ` (${e.capMinutes} min)` : ''} stopped the build after it`);
  return `The delivered summary was written before the platform's last checks — ${parts.join('; ')}. The summary now says so.`;
}

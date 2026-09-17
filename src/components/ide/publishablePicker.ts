// publishablePicker — WHICH of my NavBharatAI apps can I publish to App Mart, and how is each one
// labelled? (admin 2026-08-26: "isi page me sabse upar ek dropdown selector chahiye, jisme user apni
// woh app upload kar sake jo navbharatai me bani hai".)
//
// 🔒 WHY THE PICKER IS AN IMPROVEMENT AND NOT JUST A CONVENIENCE. The Publish tab used to be nothing
// but instructions: "open your app, build its APK, then press a button on a different screen." A page
// whose only content is directions to another page is a dead end wearing a tab label — the user came
// here to publish and left with homework. The picker makes THIS page the place it claims to be.
//
// 🔒 AND IT CANNOT WIDEN WHAT THE STORE ACCEPTS. Publishing still goes through the SAME
// `POST /api/nav-store/web/publish`, which re-verifies ownership from the token and re-runs the whole
// publish gate (hardcoded-secret scan, file/size caps, browser-runnable proof). This module only
// decides what to OFFER; the server decides what is allowed. A picker that could publish something
// the gate refuses would be a lie, so it deliberately shows the gate's own refusal verbatim instead
// of pre-guessing it.
//
// PURE: conversations in, rows out — so the ordering, filtering and labelling are unit-tested.

/** One row of `GET /api/agentv3/conversations`, narrowed to what the picker needs. */
export interface ConversationRow {
  id: string;
  title?: string;
  workspaceId?: string;
  updatedAt?: number;
  createdAt?: number;
  live?: boolean;
}

export interface PublishableApp {
  workspaceId: string;
  /** What the dropdown shows. Never empty. */
  label: string;
  /** The name field is pre-filled with this — the user can edit it before publishing. */
  suggestedName: string;
  updatedAt: number;
  /** This app is currently live on NavBharatAI hosting (shown as a hint, never a gate). */
  live: boolean;
}

/** An app with no title yet still needs a name a human can recognise in a list. */
export const UNTITLED_LABEL = 'Untitled app';

/**
 * The longest name this picker will SUGGEST.
 *
 * 🔴 WHY A CAP EXISTS AT ALL (admin 2026-09-17, from a phone screenshot of App Mart). A
 * workspace's `title` is the user's own BUILD PROMPT, and the suggested name was that title
 * verbatim. People accept a pre-filled field, so App Mart filled up with listings called
 * "To build a massive, rapidly scaling carpool…" and "I already have the complete frontend UI
 * for…". Nobody browsing can tell what those apps DO, which is what the admin actually saw.
 *
 * ⚠️ THE SERVER ALREADY CUTS AT 60 (`/api/nav-store/web/publish`), and that is a different thing
 * from this: 60 is the longest a name may BE, this is the longest one we will PUT THERE for
 * somebody. A prompt fragment is still not a name at 60 characters — it is just a shorter prompt
 * fragment — so this cuts at a word boundary near 42, which is about what fits two lines of an App
 * Mart tile, and leaves the field fully editable.
 *
 * It deliberately does NOT try to invent a better name from the prompt. Guessing a product name
 * from a sentence is the kind of cleverness that produces a confidently wrong label the creator
 * never notices; a visibly truncated one invites the edit instead.
 */
export const MAX_SUGGESTED_NAME = 42;

/**
 * Trim a workspace title down to something name-shaped. PURE.
 *
 * Collapses runs of whitespace (a pasted multi-line prompt arrives with newlines in it), then cuts
 * at the last word boundary that fits so a name never ends mid-word. A single word longer than the
 * cap is cut hard — there is no boundary to find, and keeping it whole would defeat the cap.
 */
export function shortenSuggestedName(raw: string, max: number = MAX_SUGGESTED_NAME): string {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour a boundary that leaves a usable name — cutting "Extraordinarily long single word"
  // at its first space would hand back one letter.
  const body = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,.;:\-—]+$/, '')}…`;
}

/** Human "when" for the dropdown — a list of identical titles is useless without it. PURE. */
export function whenLabel(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (!ts || !Number.isFinite(ts)) return '';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * The apps worth offering, newest first. PURE.
 *
 * A conversation with NO workspaceId is a chat that never became an app — offering it would produce a
 * refusal the user could do nothing about ("there is nothing to publish yet"), so it is left out
 * rather than shown and then rejected. Duplicate workspace ids collapse to the most recent row: one
 * workspace is one app, however many history entries point at it.
 */
export function publishableApps(rows: ConversationRow[] | null | undefined, now: number): PublishableApp[] {
  const byWorkspace = new Map<string, PublishableApp>();
  for (const row of rows ?? []) {
    const workspaceId = String(row?.workspaceId ?? '').trim();
    if (!workspaceId) continue;
    const updatedAt = Number(row?.updatedAt ?? row?.createdAt ?? 0) || 0;
    const existing = byWorkspace.get(workspaceId);
    if (existing && existing.updatedAt >= updatedAt) continue;
    const title = String(row?.title ?? '').trim();
    const suggestedName = shortenSuggestedName(title) || UNTITLED_LABEL;
    const when = whenLabel(updatedAt, now);
    byWorkspace.set(workspaceId, {
      workspaceId,
      label: when ? `${suggestedName} · ${when}` : suggestedName,
      suggestedName,
      updatedAt,
      live: row?.live === true,
    });
  }
  return [...byWorkspace.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Can the Publish button run right now? Returns '' when it can, or the honest reason why not — the
 * button is only ever enabled on ''. No dead buttons: every disabled state has words next to it.
 * PURE.
 */
export function publishBlockedReason(input: {
  signedIn: boolean;
  loading: boolean;
  appCount: number;
  workspaceId: string;
  name: string;
  busy: boolean;
}): string {
  if (!input.signedIn) return 'Sign in to publish an app you built.';
  if (input.loading) return 'Looking for the apps you have built…';
  if (input.appCount === 0) return 'You have not built an app yet — build one in NavBharatAI Pro first, then come back here.';
  if (!input.workspaceId) return 'Choose which of your apps to publish.';
  if (!input.name.trim()) return 'Give your app a name.';
  if (input.busy) return 'Publishing…';
  return '';
}

// WHAT THE USER MUST DO — the client's view of it (admin 2026-09-20).
//
// Mirrors `src/server/AgentV3/userActions.ts`, the way `agentV3Types.ts` mirrors the server's event
// union: the wire shape and the wording the tray puts around it. No state, no fetching — so the
// grouping, the honesty note under a closed row, and the sentence a row hands to the composer are all
// testable without rendering anything.

// ⚠️ A DELIBERATE MIRROR, AND SINCE 2026-09-21 A TEST-LOCKED ONE. The browser cannot import server
// code, so this union is a second copy of the writer's — the drift class this repo has paid for
// repeatedly. Adding `'connect'` on the server and forgetting it here produces NO error: the row
// falls through every branch and the tray hands the user a generic sentence.
// `tests/theTrayKnowsWhatIsNotConnected.test.ts` reads both unions out of their sources and fails
// when they differ, so the copy cannot silently fall behind.
export type UserActionKind = 'secret' | 'approve' | 'question' | 'connect';
export type UserActionStatus = 'open' | 'done' | 'not_needed' | 'superseded';
export type UserActionClosedBy = 'user' | 'verified' | 'ai' | 'system';

export interface UserActionView {
  id: string;
  kind: UserActionKind;
  title: string;
  why: string;
  envName?: string;
  callId?: string;
  blocking: boolean;
  status: UserActionStatus;
  createdAt: number;
  closedAt?: number;
  closedBy?: UserActionClosedBy;
}

export type UserActionGroup = 'blocking' | 'needed' | 'later';

/** The three sections, in the order they are read. Urgency first. */
export const GROUP_ORDER: readonly UserActionGroup[] = ['blocking', 'needed', 'later'];

export const GROUP_TITLES: Record<UserActionGroup, string> = {
  blocking: 'The build is waiting for you',
  needed: 'Your app needs this to work',
  later: 'Worth a look, nothing is stuck',
};

export function groupOf(action: UserActionView): UserActionGroup {
  if (action.blocking) return 'blocking';
  return action.kind === 'question' ? 'later' : 'needed';
}

export function isOpen(action: UserActionView): boolean {
  return action.status === 'open';
}

/** Open rows, split into their sections. An empty section is omitted rather than shown as empty. */
export function groupedOpen(actions: readonly UserActionView[]): Array<{ group: UserActionGroup; items: UserActionView[] }> {
  return GROUP_ORDER
    .map((group) => ({ group, items: actions.filter((a) => isOpen(a) && groupOf(a) === group) }))
    .filter((s) => s.items.length > 0);
}

/** Everything already dealt with, newest first — the "done" half of the tray. */
export function closedRows(actions: readonly UserActionView[]): UserActionView[] {
  return actions
    .filter((a) => !isOpen(a))
    .sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt));
}

/**
 * WHO SAYS IT IS DONE — and the two answers are not interchangeable.
 *
 * `verified` means the platform looked and the thing is true. `user` means they pressed Done and we
 * never checked. Printing both as a tick would be the system claiming a measurement it does not have,
 * which is exactly what the honesty rules forbid — so the row says which one it is.
 */
export function closedNote(action: UserActionView): string {
  if (action.status === 'not_needed') return 'You said your app does not need this.';
  if (action.status === 'superseded') return 'Your app no longer needs this.';
  if (action.closedBy === 'verified') return 'Checked — this is set.';
  if (action.closedBy === 'ai') return 'Handled during the build.';
  return 'You marked this done. Nothing was checked.';
}

/**
 * THE SENTENCE A ROW HANDS TO THE COMPOSER (admin 2026-09-20).
 *
 * *"ho sakta hai cheezo ke answer woh na ho, jo popup notification me dikhe, ho sakta hai user kuch
 * aur soch raha ho, aisi stithi me, user apne input box me type kar ke navbharatai pro ko direct
 * instruction/suggestion de/le sake."*
 *
 * So no row is a dead end. Every one of them can be TALKED about instead of obeyed, and the way in is
 * the pattern the credential card already uses: prepare the question in the composer and let the user
 * edit it before sending. It is never sent automatically — a message the user did not choose to send
 * is not a conversation, and it would spend their money.
 */
export function askPrompt(action: UserActionView): string {
  if (action.kind === 'secret' && action.envName) {
    return `I don't have ${action.envName} yet. Where do I get it? Guide me step by step — I'll tell you what I see on the screen. If there's a way to build this without it, tell me that too.`;
  }
  if (action.kind === 'approve') {
    return `Before I answer "${action.title}" — explain in simple words what will happen if I say yes, and what happens if I say no.`;
  }
  // A CONNECT row is the one kind whose way out is often "do I have to?" (PR 2, connectActions.ts).
  // It is derived from the app's own code — so the honest offer is to explain what breaks without it
  // and what the alternatives are, not to assume the user has already decided to do it.
  if (action.kind === 'connect') {
    return `About "${action.title}" — what exactly stops working in my app if I don't do this? Walk me through it step by step, and tell me if there is a simpler option.`;
  }
  return `About this: "${action.title}" — here is what I actually want instead: `;
}

/** The one-line summary the tray's header shows. Honest about zero rather than congratulatory. */
export function traySummary(openCount: number): string {
  if (openCount === 0) return 'Nothing is waiting on you.';
  return openCount === 1 ? '1 thing needs you' : `${openCount} things need you`;
}

/** What the running build is asking for RIGHT NOW, as the panel already holds it in memory. */
export interface LiveAsks {
  pendingSecrets?: { callId: string; secrets: Array<{ name: string; why: string }> };
  pendingPermission?: { callId: string; action: string };
  pendingClarify?: { questions: string[] };
}

/** The thing a row is about — an env var, or the words of the ask. Used to match a live row to a stored one. */
export function subjectOf(action: UserActionView): string {
  return (action.kind === 'secret' ? action.envName ?? action.title : action.title).trim().toLowerCase();
}

/**
 * 🔒 THE TRAY WORKS EVEN IF NOTHING WAS STORED — and this is a safety property, not a nicety.
 *
 * The durable record is best-effort by design: it must never be able to fail a build, so every write
 * can silently do nothing. A permission gate genuinely STOPS the build and auto-denies on its timeout,
 * so if the tray could only show what the store returned, an unavailable store would turn this feature
 * into the cause of the failure it exists to prevent — and the inline card it replaces is gone.
 *
 * So the tray renders the union: what was stored, plus whatever the live build is asking for right
 * now. A live ask whose stored row is already open is not added twice (matched on the THING, never on
 * the id, because the id carries a server-side hash and a second implementation of that hash on the
 * client is a drift waiting to happen).
 */
export function mergeLiveActions(stored: readonly UserActionView[], live: LiveAsks, now: number): UserActionView[] {
  const out = stored.map((a) => ({ ...a }));
  const known = new Set(out.filter(isOpen).map((a) => `${a.kind}:${subjectOf(a)}`));
  const add = (row: UserActionView) => {
    const key = `${row.kind}:${subjectOf(row)}`;
    if (known.has(key)) return;
    known.add(key);
    out.push(row);
  };
  const base = { blocking: false, status: 'open' as const, createdAt: now };
  for (const s of live.pendingSecrets?.secrets ?? []) {
    if (!s?.name) continue;
    add({ ...base, id: `live:secret:${s.name}`, kind: 'secret', title: s.name, why: s.why ?? '', envName: s.name, callId: live.pendingSecrets?.callId });
  }
  if (live.pendingPermission?.action) {
    add({ ...base, id: `live:approve:${live.pendingPermission.callId}`, kind: 'approve', title: live.pendingPermission.action, why: '', callId: live.pendingPermission.callId, blocking: true });
  }
  for (const q of live.pendingClarify?.questions ?? []) {
    if (!q) continue;
    add({ ...base, id: `live:question:${q}`, kind: 'question', title: q, why: 'I assumed an answer and carried on building. Tell me if it is wrong.' });
  }
  return out;
}

/**
 * A row that exists only in this screen's memory, because the durable write has not landed (or failed).
 *
 * It can still be ANSWERED — a gate is answered through the build's own channel, and a key is saved to
 * the vault — but it carries no Done/Not-needed buttons, because there is nowhere to record that
 * decision and a button that silently forgets what it was told is worse than no button.
 */
export function isLiveOnly(action: UserActionView): boolean {
  return action.id.startsWith('live:');
}

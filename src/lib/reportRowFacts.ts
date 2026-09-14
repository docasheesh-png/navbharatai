// ONE shape for a build-report row, whichever of the two admin lists it came from (admin 2026-09-14).
//
// THE REQUEST: *"dono build report ko ek jaisa bana do… sender, email, time, user, charge status etc —
// yeh dono me ek extra button bana do information, usme yeh sab dal do. bahar ka UI ek dam clean aur
// clear ho."*
//
// Two lists had grown apart. The USER-SUBMITTED inbox rendered a nine-column table — SN, Application,
// Sender, Email, Time, User, Charged, Status — which on the admin's own phone (393 px) ran **513 px
// past the right edge**, so the last four columns were unreachable without a horizontal scroll nobody
// discovers. The ALL-BUILDS list rendered a clean card row and showed none of those facts at all.
// Neither was right: one was unreadable, the other was poorer.
//
// So the facts move OFF the row and BEHIND one ⓘ button, and both lists render from this ONE function.
// A field added here appears in both lists by construction — which is the actual fix, because the
// drift is what produced a nine-column table on one screen and nothing on the other.
//
// 🔒 "NOT RECORDED" IS A FACT, AND IT IS NEVER A ZERO. A build that failed before settling has no
// charge; a report written before billing was recorded has none either. Printing "₹0" for those would
// tell the admin we charged nothing when the truth is we do not know — the same lie as an unread
// counter rendering as 0. Every value here is either a real value or an explicit "not recorded".
//
// Pure, framework-free, and unit-tested: the admin panel is 4,000 lines of JSX, and a rule that lives
// inside it cannot be tested without rendering it.

/** One labelled fact, as the ⓘ panel renders it. */
export interface RowFact {
  label: string;
  value: string;
  /** How to colour it. 'muted' is the default and is what an unknown always gets. */
  tone?: 'default' | 'muted' | 'good' | 'bad' | 'warn';
  /** Longer text for a title/tooltip — e.g. WHY a charge was zero. */
  hint?: string;
}

/** The subset of a user-submitted report row these facts are read from. */
/**
 * The ACCOUNT's tier, as the ⓘ panel prints it. Mirrors server/lib/accountTier.ts's own labels so the
 * filter control and the panel can never word the same bucket differently.
 */
export function tierFactFor(accountTier: unknown): RowFact {
  switch (String(accountTier ?? '')) {
    case 'paid': return { label: 'User', value: 'Paid', tone: 'good', hint: 'This account has bought tokens with real ₹.' };
    case 'free': return { label: 'User', value: 'Free', tone: 'muted', hint: 'A real account that has never purchased.' };
    case 'admin': return { label: 'User', value: 'Admin / tester', tone: 'warn', hint: 'On the free list — these builds are deliberately not billed.' };
    default: return { label: 'User', value: 'Unknown', tone: 'muted', hint: 'No account record was found — not the same as "never paid".' };
  }
}

export interface SubmittedRowLike {
  name?: string | null;
  email?: string | null;
  userId?: string | null;
  reportedAt?: number | null;
  /** How THIS BUILD was billed — e.g. "free (welcome bonus — cheap engines)". Not the account. */
  userTier?: string | null;
  tier?: string | null;
  /** The ACCOUNT's tier: has this person ever bought tokens with real ₹? */
  accountTier?: string | null;
  billedInr?: number | null;
  billedUsd?: number | null;
  ok?: boolean | null;
  inFlight?: boolean;
  buildMs?: number | null;
  workspaceId?: string | null;
  sessionParts?: number | null;
}

/** The subset of an all-builds row these facts are read from. */
export interface AllBuildRowLike {
  workspaceId?: string | null;
  ownerUid?: string | null;
  owner?: { label?: string; email?: string; name?: string; anonymous?: boolean } | null;
  savedAt?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  ok?: boolean | null;
  /** How THIS BUILD was billed. Not the account — see `tier`. */
  userTier?: string | null;
  /** The ACCOUNT's tier: has this person ever bought tokens with real ₹? */
  tier?: string | null;
  billedInr?: number | null;
  billedUsd?: number | null;
  zeroBillReason?: string | null;
}

const NOT_RECORDED = 'not recorded';

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A timestamp in the admin's own locale, or an honest blank. Pure. */
export function formatWhen(ms: unknown, now?: number): string {
  const t = num(ms);
  if (!t || t <= 0) return NOT_RECORDED;
  const when = new Date(t).toLocaleString();
  const ref = num(now);
  if (!ref) return when;
  // A relative hint is what an admin actually triages by ("is this still happening?"), and it costs
  // one line. The absolute time stays, because "3 days ago" cannot be matched against a log.
  const mins = Math.round((ref - t) / 60000);
  if (mins < 0) return when;
  if (mins < 1) return `${when} (just now)`;
  if (mins < 60) return `${when} (${mins} min ago)`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${when} (${hrs} h ago)`;
  return `${when} (${Math.round(hrs / 24)} d ago)`;
}

/** A duration in the shortest form that is still exact enough to act on. Pure. */
export function formatDuration(ms: unknown): string {
  const v = num(ms);
  if (v === null || v < 0) return NOT_RECORDED;
  if (v < 1000) return `${Math.round(v)} ms`;
  const secs = v / 1000;
  if (secs < 90) return `${secs.toFixed(1)}s`;
  const mins = secs / 60;
  if (mins < 90) return `${mins.toFixed(1)} min`;
  return `${(mins / 60).toFixed(1)} h`;
}

/**
 * The charge, and — when it is zero — WHY. Pure.
 *
 * A ₹0 charge is routine and correct here ("working app or free"), so the number alone would read as
 * a billing bug on a screen full of failed builds. `reason` is what turns it into a statement.
 */
export function formatCharge(inr: unknown, usd: unknown, zeroReason?: unknown): RowFact {
  const r = num(inr);
  const u = num(usd);
  if (r === null && u === null) {
    return { label: 'Charged', value: NOT_RECORDED, tone: 'muted', hint: 'No billing was recorded for this build — not the same as a ₹0 charge.' };
  }
  const why = text(zeroReason);
  if (r !== null && r <= 0) {
    return { label: 'Charged', value: '₹0', tone: 'muted', hint: why ? `₹0 — ${why}` : 'Nothing was charged for this build.' };
  }
  const shown = r !== null ? `₹${r.toFixed(2)}` : `$${(u as number).toFixed(4)}`;
  return { label: 'Charged', value: shown, tone: 'good', hint: u !== null && r !== null ? `$${u}` : undefined };
}

/** The outcome, in the words the admin list already uses everywhere else. Pure. */
export function formatOutcome(ok: unknown, inFlight?: boolean): RowFact {
  if (ok === true) return { label: 'Status', value: 'Success', tone: 'good' };
  if (ok === false) return { label: 'Status', value: 'Failed', tone: 'bad' };
  // "—" for an unfinished build used to read as "it produced nothing", which is the alarming reading
  // and the wrong one. This wording is carried over from the table it replaces, deliberately.
  if (inFlight) return { label: 'Status', value: 'Still running', tone: 'warn' };
  return { label: 'Status', value: 'No outcome recorded', tone: 'muted', hint: 'The build stopped without recording whether it worked.' };
}

/**
 * Who the person is, in one line, preferring a NAME over an id.
 *
 * The all-builds row resolves this server-side (`owner.label`); a submitted report carries name/email
 * directly. Both end here so the two lists can never label the same person differently.
 */
export function personLabel(name: unknown, email: unknown, uid: unknown): string {
  return text(name) || text(email) || (text(uid) ? `id ${String(uid).slice(0, 8)}…` : 'Signed-out user');
}

/** The facts behind the ⓘ button for a USER-SUBMITTED report. Pure. */
export function submittedRowFacts(r: SubmittedRowLike, now?: number): RowFact[] {
  const facts: RowFact[] = [
    { label: 'Sender', value: text(r.name) || NOT_RECORDED, tone: text(r.name) ? 'default' : 'muted' },
    { label: 'Email', value: text(r.email) || text(r.userId) || NOT_RECORDED, tone: text(r.email) ? 'default' : 'muted' },
    { label: 'Reported', value: formatWhen(r.reportedAt, now) },
    // TWO DIFFERENT FACTS, shown as two (admin 2026-09-14). "User" answers the admin's question — has
    // this person ever paid us? "This build" says how that one build was routed, which a user changes
    // by choosing the Weak engine. Collapsing them is what made a ₹500 customer read as Free.
    tierFactFor(r.accountTier),
    { label: 'This build', value: text(r.userTier) || text(r.tier) || NOT_RECORDED, tone: 'muted', hint: 'How this one build was billed — not whether the user has ever paid.' },
    formatCharge(r.billedInr, r.billedUsd, null),
    formatOutcome(r.ok, r.inFlight),
  ];
  if (num(r.buildMs) !== null) facts.push({ label: 'Build time', value: formatDuration(r.buildMs) });
  if ((num(r.sessionParts) ?? 1) > 1) facts.push({ label: 'Session', value: `${r.sessionParts} builds in this report` });
  if (text(r.workspaceId)) facts.push({ label: 'Workspace', value: String(r.workspaceId), tone: 'muted' });
  return facts;
}

/** The facts behind the ⓘ button for an ALL-BUILDS row. Same labels, same order. Pure. */
export function allBuildRowFacts(b: AllBuildRowLike, now?: number): RowFact[] {
  const name = text(b.owner?.name);
  const email = text(b.owner?.email);
  const facts: RowFact[] = [
    { label: 'Sender', value: name || text(b.owner?.label) || NOT_RECORDED, tone: name || text(b.owner?.label) ? 'default' : 'muted' },
    { label: 'Email', value: email || (text(b.ownerUid) ? `id ${String(b.ownerUid)}` : NOT_RECORDED), tone: email ? 'default' : 'muted' },
    // "Reported" on the other list; here nobody reported anything — the row exists because the build
    // ran. Naming it "Built" rather than reusing the word is the honest difference between the lists.
    { label: 'Built', value: formatWhen(b.savedAt ?? b.startedAt, now) },
    tierFactFor(b.tier),
    { label: 'This build', value: text(b.userTier) || NOT_RECORDED, tone: 'muted', hint: 'How this one build was billed — not whether the user has ever paid.' },
    formatCharge(b.billedInr, b.billedUsd, b.zeroBillReason),
    formatOutcome(b.ok, false),
  ];
  const started = num(b.startedAt);
  const ended = num(b.endedAt);
  if (started !== null && ended !== null && ended >= started) facts.push({ label: 'Build time', value: formatDuration(ended - started) });
  if (text(b.workspaceId)) facts.push({ label: 'Workspace', value: String(b.workspaceId), tone: 'muted' });
  return facts;
}

/** Every fact as plain text — what the ⓘ panel's "copy" hands over, and what a test can assert. Pure. */
export function factsToText(facts: ReadonlyArray<RowFact>): string {
  return (facts ?? []).map((f) => `${f.label}: ${f.value}`).join('\n');
}

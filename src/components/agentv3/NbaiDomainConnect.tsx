// NbaiDomainConnect — the workspace-scoped "connect your own domain" flow for the Publish surface
// (Hosting Slice 3). Firebase-native custom domains are PER-APP (the domain attaches to this
// workspace's dedicated Firebase site), so this component is always scoped to a workspaceId.
//
// Real flow: enter domain -> POST /api/domains/nbai/connect (creates the Firebase custom domain on
// the workspace's site, returns the EXACT DNS records) -> user adds them at their registrar ->
// "Check" polls /api/domains/nbai/status until ownership + host + SSL are all active. Honest
// throughout: it shows the real pending/active state and never claims a domain is connected when it
// isn't. Gated by the server flag (the caller only renders this when custom domains are enabled).

import { useState, useEffect, useRef } from 'react';
import { readDomainDraft, writeDomainDraft, clearDomainDraft, draftNotice } from './domainDraftCache';
import { Globe, ChevronLeft, CheckCircle2, Copy, Check, RefreshCw, Info, ExternalLink, Rocket } from 'lucide-react';
import { timeAgo, needsPublishDot, type PublishFreshness } from '../../lib/publishFreshness';
import { TirangaLoader } from '../ui/TirangaLoader';
import { REGISTRARS, registrarById, detectRegistrarId, registrarNameFromRdap } from '../../lib/registrarGuide';
import { authJsonHeaders as authHeaders } from '../../lib/authHeaders';

interface DnsRecord { type: string; name: string; value: string; note?: string; done?: boolean; }
interface DomainStatus {
  /** Server capability: the zero-copy-paste nameserver-delegation path is available. */
  autoDns?: boolean;
  /** Server capability: Domain Connect one-click check is worth offering. */
  domainConnect?: boolean;
  /** Server capability: Hostinger token-based setup is enabled. */
  hostingerDns?: boolean;
  domain: string;
  active: boolean;
  ownershipState: string;
  hostState: string;
  sslState: string;
  records: DnsRecord[];
  /** STABLE, never-forgotten record view: everything ever shown, each tagged done (✓ added & accepted)
   *  or not (⏳ still needed). Preferred over `records` for display; `records` stays the live pending set
   *  the auto-setup appliers act on. Absent on an older server → fall back to `records`. */
  displayRecords?: DnsRecord[];
  /** What the domain ACTUALLY serves when opened. Absent on an older server. */
  serving?: { state: string; status: number; note: string } | null;
  /** The app's publish state — is anything live, when did it go live, is it behind the app?
   *  Absent on an older server, which `publishButton` renders as a plain, claimless "Publish". */
  publish?: { live: boolean; url: string | null; publishedAt: number | null; freshness: PublishFreshness } | null;
  /** Why pressing Publish cannot put this app on the domain (a server app). '' / absent = it can. */
  publishBlocked?: string | null;
  /** Firebase's OWN explanation of why the domain is stuck. Absent on an older server. */
  issues?: string[];
  /** When the hosting service last looked at the user's DNS (ISO). Absent on an older server. */
  lastCheckedAt?: string;
  /** What OUR resolver can see of the user's records right now. Absent on an older server. */
  dnsCheck?: {
    allSeen: boolean;
    summary: string;
    checks: Array<{ type: string; name: string; expected: string; seen: boolean; found: string[]; lookupError: string }>;
  } | null;
}

export interface NbaiDomainConnectProps {
  workspaceId: string;
  onBack: () => void;
  /**
   * Publish this app — the SAME pipeline the main Publish button drives, passed in rather than
   * re-implemented, so there is exactly one publish path in the product.
   *
   * Returns an HONEST reason string when the publish could not start (nothing built yet, a build
   * already running, quota) — the chooser's standing no-dead-buttons rule. That reason is rendered
   * right here, because the caller's own error line lives on a different view the user is not on.
   * Absent ⇒ no button is rendered at all, which is correct for a host that has nothing to publish.
   */
  onPublish?: () => string | null | void;
  /** A build/publish is already running — the button shows it instead of pretending to be idle. */
  publishBusy?: boolean;
  /**
   * What the publish actually SAID — the server's own words, verbatim, from the host that owns the
   * request (a build error with the compiler's output, a refusal, or the live link).
   *
   * 🔒 A PROP AND NOT A DETAIL OF EACH HOST, on purpose. Both hosts of this screen already held this
   * text; one rendered it beside the screen and the other rendered it on a view the user was not
   * looking at, which is how the domain screen came to have a Publish button that could fail in total
   * silence. Making it an input of the screen that owns the button means the next host cannot forget.
   */
  publishResult?: string;
  /**
   * Take this app off NavBharatAI hosting. Resolves to '' on success, or an HONEST message.
   *
   * Absent ⇒ the control is not rendered at all. A remove button with nothing behind it is the dead
   * button this codebase keeps deleting.
   */
  onUnpublish?: () => Promise<string>;
  /**
   * The freshness the CALLER already measured, used until this screen's own status call returns.
   *
   * It is what makes the dot trail continuous: the user follows a dot in from the Publish sheet, and
   * the button here already carries it instead of appearing plain for the second it takes to check.
   * The screen's own status response takes over as soon as it lands — it is the fresher reading.
   */
  publishFreshness?: PublishFreshness;
}

/**
 * The connect flow's stage, in the user's words (admin 2026-08-09: "DNS record daal diye — par ab
 * kya karna hai? connect karne ka button hi nahi hai?"). The raw API states (OWNERSHIP_PENDING /
 * HOST_ACTIVE / CERT_PENDING) are engineering vocabulary; a non-technical user reading them cannot
 * tell whether the ball is in their court or ours. This maps the three real states to ONE plain
 * sentence plus the ONE next action — and it stays honest, because each sentence describes exactly
 * the state the API reported (nothing is claimed done until the API says active).
 *
 * Pure + exported for tests.
 */
/**
 * Firebase's own sentence, ready to prepend — or '' when it shipped none.
 *
 * Trimmed, single-spaced and capped, because these come from `google.rpc.Status` and can arrive long,
 * multi-line, or duplicated across the domain's `issues[]` and the certificate's. Only the FIRST is
 * used: a stack of provider messages in a user-facing note is how a real explanation becomes noise.
 * PURE.
 */
export function hostingReason(issues?: string[] | null): string {
  const first = (issues ?? []).map((i) => String(i ?? '').replace(/\s+/g, ' ').trim()).find((i) => i.length > 0);
  if (!first) return '';
  const text = first.length > 220 ? `${first.slice(0, 217)}…` : first;
  return `Your host says: “${/[.!?]$/.test(text) ? text : `${text}.`}” `;
}

export function connectStage(
  s: {
    active: boolean; ownershipState: string; hostState: string; sslState: string;
    serving?: { state: string; note: string } | null;
    /**
     * Why pressing Publish cannot help THIS app — '' or absent for the ordinary app, where it can.
     * The server forms this from the app's own manifests; see domainPublishBlockNote.
     */
    publishBlocked?: string | null;
    /**
     * WHAT FIREBASE ITSELF SAID IS WRONG (`issues[]`), when it said anything.
     *
     * 🔒 THIS FILE'S OWN RULE, APPLIED TO ITS OWN NEW CODE: "Never diagnose from a status enum when
     * the API also shipped the reason" (firebaseCustomDomain.ts, after `ownership: missing` reached
     * the admin as one unexplained word). The MISMATCH branch below was written on 2026-09-02 doing
     * exactly what that rule forbids — it read the enum and ASSERTED a cause ("connected from another
     * app before"), which is the likeliest cause and is not evidence. If Firebase shipped a reason, it
     * outranks anything we infer; our sentence is the fallback for when it did not.
     */
    issues?: string[] | null;
  },
): { headline: string; action: 'check' | 'none' | 'publish'; note: string; tone?: 'ok' | 'warn' } {
  if (s.active) {
    /**
     * 🔒 NEVER SEND SOMEONE AT A BUTTON THAT CANNOT WORK (admin 2026-08-24).
     *
     * The branch below is right for almost every app: nothing is published, so press Publish. For an
     * app with a server half it is an instruction that can only be refused — the publish route will
     * not upload a running server to a static CDN, and rightly so. The screen would then say "press
     * Publish", the button would refuse, and the screen would say it again. That is the same shape as
     * the three-day "waiting for DNS" over a permanent conflict, and it is fixed the same way: say the
     * true next step, and take the useless action off the screen rather than leaving it to fail.
     *
     * Checked BEFORE the nothing_published branch because it is the more specific fact about the same
     * situation, and silent unless the server positively identified a server app.
     */
    if (s.publishBlocked) {
      return {
        headline: 'Connected — but this app needs its server part deployed first.',
        action: 'none',
        tone: 'warn',
        note: s.publishBlocked,
      };
    }
    // 🔒 "LIVE!" MUST BE EARNED (admin 2026-08-21, mitrify.com). This used to claim Live the moment
    // ownership/host/SSL went active — but those three describe DNS and a CERTIFICATE, not whether
    // anything was ever published to the site the domain points at. A domain connected AFTER the last
    // publish points at an EMPTY site, so the admin read "Live!", opened mitrify.com, got Firebase's
    // "Site Not Found", and reasonably concluded the connection had failed. The old note did say
    // "publish once" — but under a green ✅ Live headline it reads as a tip, not as "your domain shows
    // an error page until you do this". The headline is the thing people act on, so the headline is
    // what had to change.
    if (s.serving?.state === 'nothing_published') {
      return {
        headline: 'Connected — one last step: press Publish.',
        action: 'publish',
        tone: 'warn',
        note: s.serving.note
          || 'Your domain is connected, but no app has been published to it yet, so opening it shows an '
             + 'error page. Press Publish once and your domain will start showing your app.',
      };
    }
    if (s.serving?.state === 'error') {
      return {
        headline: 'Connected, but your domain is answering with an error.',
        action: 'publish',
        tone: 'warn',
        note: s.serving.note || 'Publishing again usually fixes this.',
      };
    }
    /**
     * ⚠️ I GOT THIS WRONG THE FIRST TIME, and the admin's screenshot is the proof.
     *
     * The previous version printed "Live!" for `unknown` too, reasoning that if our server could not
     * reach the domain, the three active states were still the best evidence we had. But that is not
     * evidence the domain SHOWS THE APP — and on 2026-08-21 our check failed to reach mitrify.com
     * while the admin was looking at Firebase's "Site Not Found" on that exact domain. We printed
     * "Live!" over it. Claiming something we did not verify is the one thing rule 2 forbids.
     *
     * So `unknown` now says CONNECTED and admits what it could not check. It is not a warning — the
     * connection genuinely is done, and there may well be nothing wrong — it simply stops asserting
     * the half we never saw. Only a check that actually SAW the app earns the word "Live".
     */
    if (s.serving?.state !== 'serving') {
      return {
        headline: 'Connected, with HTTPS.',
        action: 'none',
        tone: 'ok',
        note: 'We could not open your domain from here to confirm it is showing your app — open it '
          + 'yourself to check. If it shows an error page, press Publish once.',
      };
    }
    return { headline: 'Live! Your domain is connected, with HTTPS.', action: 'none', tone: 'ok', note: 'Publish again any time to update what your domain shows.' };
  }
  const ownershipDone = /ACTIVE/i.test(s.ownershipState || '');
  const hostDone = /ACTIVE/i.test(s.hostState || '');
  /**
   * 🔒 A CONFLICT IS NOT A WAIT — and calling it one cost the admin three days.
   *
   * The hosting service reported `ownership: conflict` with host and certificate BOTH active, and its
   * own message said exactly why: more than one `hosting-site=` TXT on the domain, where it permits at
   * most one. That is a permanent REFUSAL, not a slow state. But this screen had no branch for it, so
   * it fell through to "Waiting for your DNS records to spread across the internet" — and the admin,
   * reasonably, waited. Three days, for something that could never resolve on its own.
   *
   * Telling someone to wait for a thing that will never happen is the most expensive kind of dishonest
   * message this codebase can produce: it is not a wrong label, it is wasted days. So the conflict says
   * plainly that waiting will not help, and names the one action that fixes it — which now genuinely
   * does, because "Check & apply records" removes the stale tokens (see applyRecords' TXT sweep).
   */
  /**
   * 🔒 MISMATCH IS THE SIBLING OF CONFLICT, AND IT WAS MISSED — the same wasted days, a different word.
   *
   * The branch below was written for `ownership: conflict` (more than one token). The hosting service
   * also reports `ownership: MISMATCH` — a `hosting-site=` token that EXISTS but names a different
   * site. It had no branch, so it fell straight through to "Waiting for your DNS records to spread
   * across the internet", and the admin waited again (screenshot 2026-09-02, `mitrify.com`,
   * `ownership: mismatch · host: active · SSL: active`).
   *
   * A wrong VALUE does not become right by waiting, any more than a duplicate does. And the same
   * button fixes it, genuinely: `applyRecords`' TXT sweep adds the token the service is asking for and
   * deletes every `hosting-site=` token that is not it — checked in cloudflareManagedDns.ts before
   * this message was written, because pointing someone at a button that would not help is how the
   * three days happened the first time.
   */
  if (/MISMATCH/i.test(s.ownershipState || '')) {
    return {
      headline: 'Your domain\'s ownership record points at a different app — waiting will not change it.',
      action: 'check',
      tone: 'warn',
      note: `${hostingReason(s.issues)}The record is there, but it carries the wrong value — most often because this domain was `
        + 'connected from another app before. A wrong value does not fix itself, however long you wait. '
        + 'Tap “Check & apply records” above: we replace it with the right one and remove the wrong one.',
    };
  }
  if (/CONFLICT/i.test(s.ownershipState || '')) {
    return {
      headline: 'Your domain has more than one ownership record — waiting will not clear it.',
      action: 'check',
      tone: 'warn',
      note: hostingReason(s.issues)
        + 'This happens when the same domain was connected from more than one app: each one left its '
        + 'own ownership record, and only one is allowed. It will not fix itself, however long you wait. '
        + 'Tap “Check & apply records” above — we will remove the extra ones and keep the right one.',
    };
  }
  if (!ownershipDone) {
    return {
      headline: 'Waiting for your DNS records to spread across the internet.',
      action: 'check',
      // HONEST timeline (admin's real Hostinger experience 2026-08-19: records added, ~4-5 hours of
      // waiting, page looked stuck). DNS propagation genuinely runs from minutes to a few HOURS at some
      // registrars — under-promising "a few minutes" makes a normal wait look broken. And now that the
      // records you added are remembered (never re-shuffled), we can honestly say leaving is safe.
      note: 'This can take anywhere from a few minutes to a few hours to spread across the internet — some registrars (like Hostinger) are on the slower side. You can safely close this page: the records you added and your progress are saved. Come back anytime and tap Check — nothing is lost.',
    };
  }
  if (!hostDone) {
    return {
      headline: 'Ownership confirmed — now pointing your domain at your app.',
      action: 'check',
      note: 'Almost done — this usually finishes within a few minutes, occasionally longer. It is safe to leave and come back; tap Check when you return.',
    };
  }
  return {
    headline: 'Almost there — issuing your free HTTPS certificate.',
    action: 'check',
    note: 'The certificate is created automatically — usually a few minutes, sometimes up to an hour. Your progress is saved, so you can safely leave and tap Check later.',
  };
}

/**
 * What the connect screen's PUBLISH button should say (admin 2026-08-21: "Visit se pahle ek button
 * banao — Publish. Is publish se app edit karne ke bad wapas publish ki jayegi").
 *
 * The button alone answers "how do I republish". The thing that actually leaves people with a stale
 * public site is the other half — nobody tells them their live site is older than their app — so the
 * button STATES which of the three situations they are in, and that is the whole point of it being
 * computed instead of a fixed label:
 *
 *   • never published → this is the missing step; make it the loud primary action.
 *   • changed         → their site is behind their app. The only case that needs urgency.
 *   • up to date      → offer it quietly, and say when it last went out so the offer is informative.
 *   • unknown         → we could not measure it. Offer the button, claim NOTHING about staleness.
 *
 * 🔒 `unknown` is silence, never a guess. A wrong "you have unpublished changes" would send people to
 * re-publish a current site forever; a wrong "up to date" would leave a stale site up while promising
 * it is not. The freshness verdict itself is the SHARED module the server computes with, so the label
 * and the measurement can never drift apart. Pure, exported for tests.
 */
/**
 * WHAT THE STATUS BLOCK'S ICON SHOULD BE — and the six-hour spinner it exists to kill.
 *
 * 🔒 ROOT CAUSE (admin 2026-08-22, verbatim: "bahut der ⏰ 6hr se spinner ghum raha hai"). The block
 * used to pick its icon from the STAGE alone: `tone === 'ok' ? tick : <TirangaLoader/>`. A pending
 * DNS connection is never `ok`, so the spinner ran forever — through a wait that is genuinely
 * hours long at some registrars. Nothing was loading. Nothing was even being requested.
 *
 * That is not a cosmetic complaint. A spinner is a PROMISE that work is happening right now and the
 * screen will change by itself in a moment. Pointing one at a multi-hour DNS wait makes a completely
 * normal wait look like a hang — which is exactly how the admin read it, and why the copy beside it
 * saying "this can take a few hours" was not believed. The picture and the sentence contradicted each
 * other, and people believe the picture.
 *
 * So the icon is driven by whether a REQUEST IS ACTUALLY IN FLIGHT, not by how far along DNS is:
 *   • 'busy'    — a real fetch is running right now. A spinner is honest here, and only here.
 *   • 'waiting' — nothing is happening; we are waiting on the world's DNS. A CLOCK, which reads as
 *                 "come back later" instead of "hang on a second".
 *   • 'done'    — a tick.
 * PURE, so the rule is pinned by tests rather than by whoever next edits the JSX.
 */
export type StatusIcon = 'busy' | 'waiting' | 'done';

export function statusIcon(input: { tone?: 'ok' | 'warn'; checking: boolean }): StatusIcon {
  if (input.checking) return 'busy';
  return input.tone === 'ok' ? 'done' : 'waiting';
}

/**
 * "Last checked 4 minutes ago" — the line that replaces a spinner's false sense of motion.
 *
 * A waiting screen has to prove it is alive somehow. A spinner fakes that; a real timestamp earns it,
 * because it says something a frozen page cannot: we looked, recently, and here is when. Returns ''
 * when we have never checked, so the UI renders nothing rather than "Last checked never".
 */
export function lastCheckedLabel(checkedAt: number | null | undefined, now: number): string {
  if (typeof checkedAt !== 'number' || checkedAt <= 0) return '';
  return `Last checked ${timeAgo(checkedAt, now)}.`;
}

/**
 * WHAT THE AUTOMATIC-SETUP LINE SHOULD SAY — and the sentence that wasted six hours.
 *
 * 🔒 ROOT CAUSE (admin 2026-08-22, screenshot: "Nameservers live — 0 records applied automatically").
 * The old line printed the number of records CHANGED, and that number cannot distinguish the two
 * OPPOSITE outcomes it collapses:
 *   • 0 changed because everything was already correct  → complete success
 *   • 0 changed because nothing was ever written        → the thing that is broken
 * Printing "0 records applied" for both reads as failure in the first case and as success in the
 * second. The admin, correctly, read it as failure — and it was very likely success, so six hours
 * went into a screen that had the answer and would not say it.
 *
 * The fix is to stop reporting an ACTION COUNT and start reporting the STATE OF THE ZONE, which the
 * server now reads back: `missing` is the list of records the hosting service asked for that are
 * genuinely not in the zone. `null` means we could not look, and that is said plainly rather than
 * guessed in either direction. PURE.
 */
/**
 * "we added 1" / "we added 1 and removed 1 unrelated record that belonged to a different app" / "".
 *
 * 🔒 SPLIT ON PURPOSE (admin screenshot, 2026-09-02: "all 1 record are now in place (we added 2)").
 * `applyRecords` used to return ONE combined number covering two different operations: a desired
 * record written, and a FOREIGN ownership token deleted as cleanup (see `dropForeignSiteTokens` for
 * the same confusion found once already, in what a "Verified" badge was allowed to claim). Cleaning
 * up one stale token while adding one desired record produced "2", printed beside "all 1 record" — a
 * number contradicting the sentence it was in.
 *
 * `added` can never exceed the number of records actually desired (`cloudflareManagedDns.ts`'s
 * `ApplyRecordsResult`); `removed` is cleanup and is named as such, so it explains the extra activity
 * instead of silently inflating "added" past what the sentence claims. PURE.
 */
export function appliedCountsPhrase(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`added ${added}`);
  if (removed > 0) parts.push(`removed ${removed} unrelated record${removed === 1 ? '' : 's'} that belonged to a different app`);
  return parts.length === 0 ? '' : ` (we ${parts.join(' and ')})`;
}

export function autoDnsSummary(input: {
  zoneStatus: string | null;
  /** Records that now hold a value that was actually DESIRED — never exceeds `desired`. */
  added: number | null;
  /** Records deleted as cleanup (a foreign ownership token, an excess stale value) — never desired. */
  removed?: number | null;
  desired?: number | null;
  missing?: Array<{ type: string; name: string }> | null;
  zoneRecordCount?: number | null;
  /**
   * What the HOSTING SERVICE currently says about ownership (`OWNERSHIP_ACTIVE`, `…_MISMATCH`, …).
   *
   * 🔒 WHY THIS PARAMETER EXISTS. Without it this function claimed "Nothing left for you to do; your
   * domain connects on its own from here" from `missing.length === 0` alone — and `missing` only means
   * "the records we manage are present in the zone". It says nothing about whether the service has
   * ACCEPTED them. The admin's screenshot showed both at once: every record in place, the green
   * "nothing left to do", and `ownership: mismatch` printed two lines above it.
   *
   * A record existing in DNS is not the service accepting it. This file already learned that lesson in
   * the other direction — the "Verified" badge below was computed from what the service was ASKING
   * for, not from evidence the record existed. Same mistake, mirrored.
   */
  ownershipState?: string | null;
}): { text: string; tone: 'ok' | 'warn' | 'info' } {
  if (input.zoneStatus !== 'active') {
    return {
      tone: 'info',
      text: 'Waiting for your nameserver change to take effect. This is the one slow step, and it happens only once — after this, every record is written for you instantly.',
    };
  }
  if (input.added === null) return { tone: 'info', text: 'Nameservers are live. Tap “Check & apply records”.' };
  if (input.missing === null || input.missing === undefined) {
    // We wrote what we could but could not confirm. Say exactly that — claiming either verdict here
    // is how a screen ends up insisting a domain is fine while it is not, or vice versa.
    const added = input.added ?? 0;
    const removed = input.removed ?? 0;
    if (added === 0 && removed === 0) {
      return { tone: 'info', text: 'Nameservers live. We could not re-read your DNS to confirm what is in place; tap Check now in a minute.' };
    }
    // Named separately, not combined — the same reason `appliedCountsPhrase` exists: "written" and
    // "removed" are different facts, and folding them into one count is what produced the original bug.
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} record${added === 1 ? '' : 's'} written`);
    if (removed > 0) parts.push(`${removed} unrelated record${removed === 1 ? '' : 's'} removed`);
    return {
      tone: 'info',
      text: `Nameservers live — ${parts.join(', ')}. We could not re-read your DNS to confirm; tap Check now in a minute.`,
    };
  }
  if (input.missing.length === 0) {
    const ownership = String(input.ownershipState ?? '');
    const ownershipSettled = ownership === '' || /ACTIVE/i.test(ownership);
    if (!ownershipSettled) {
      // RECORDS IN PLACE ≠ THE SERVICE HAS ACCEPTED THEM. Claiming completion here is what put a
      // green "nothing left to do" directly beneath a red `ownership: mismatch`. The records really
      // are correct now, so this is not a failure — but the last word is the service's, not ours, and
      // a wrong value that survives the re-check needs the button again rather than more patience.
      return {
        tone: 'info',
        text: `Your records are in place. ${/MISMATCH|CONFLICT/i.test(ownership)
          ? 'Your host still reports the ownership record as wrong — it re-checks on its own schedule, so give it a while. If it still says that in an hour, tap “Check & apply records” once more.'
          : 'Your host has not confirmed ownership yet — it re-checks on its own schedule. Come back and tap Check in a little while.'}`,
      };
    }
    // THE CASE THAT USED TO READ AS FAILURE. Every record is in place; the only thing left is the
    // hosting service's own sweep, which is not ours to hurry — so say that, instead of a bare "0".
    const added = input.added ?? 0;
    const removed = input.removed ?? 0;
    if (added === 0 && removed === 0) {
      return { tone: 'ok', text: 'Done — every record is already in place. Nothing left for you to do; your domain connects on its own from here.' };
    }
    // `desired` names the target count only when we genuinely have one to name — a null/absent value
    // used to print as a literal blank ("all  record are now in place"), papered over with a
    // double-space collapse. "your records" is honest instead of guessing a number we do not have.
    const desired = typeof input.desired === 'number' && input.desired > 0 ? input.desired : null;
    const subject = desired !== null ? `all ${desired} record${desired === 1 ? '' : 's'}` : 'your records';
    const verb = desired === 1 ? 'is' : 'are';
    return {
      tone: 'ok',
      text: `Done — ${subject} ${verb} now in place${appliedCountsPhrase(added, removed)}. Nothing left for you to do; your domain connects on its own from here.`,
    };
  }
  return {
    tone: 'warn',
    text: `${input.missing.length} record${input.missing.length === 1 ? ' is' : 's are'} still missing from your DNS (${input.missing.map((m) => `${m.type} ${m.name}`).join(', ')}). Tap “Check & apply records” again — if it keeps saying this, tell us and we will look.`,
  };
}

/**
 * WHAT A FINISHED RECORD'S BADGE MAY CLAIM — "Verified" has to be earned, like "Live!" before it.
 *
 * 🔒 ROOT CAUSE (admin screenshot 2026-08-22): three records were badged **Verified** and two of them
 * had never been verified by anything. `done` is computed as "not in the currently-pending set", which
 * is a statement about what the hosting service is ASKING FOR — not evidence that a record exists in
 * DNS. Those two were another app's ownership tokens, so of course this app's site never asked for
 * them; the badge turned "irrelevant here" into "confirmed working".
 *
 * The pollution itself is fixed upstream (`dropForeignSiteTokens`). This closes the second half: the
 * word only appears when something actually LOOKED. We have a real observer — `dnsCheck`, our own
 * resolver reading the user's live DNS — so:
 *   • seen by our resolver        → "Verified", genuinely earned
 *   • no longer requested, unseen → "Added", which is all we can honestly say
 * The green tick stays on both: either way there is nothing left for the user to do, and that is the
 * question the row is answering. PURE.
 */
export function recordBadge(
  rec: { type: string; name: string; value: string },
  dnsCheck: { checks?: Array<{ type: string; name: string; expected: string; seen: boolean }> } | null | undefined,
): 'Verified' | 'Added' {
  const norm = (s: string) => String(s ?? '').trim().replace(/\.$/, '').toLowerCase();
  const val = (s: string) => String(s ?? '').trim().replace(/^"|"$/g, '');
  const hit = (dnsCheck?.checks ?? []).find(
    (c) => norm(c.type) === norm(rec.type) && norm(c.name) === norm(rec.name) && val(c.expected) === val(rec.value),
  );
  return hit?.seen === true ? 'Verified' : 'Added';
}

export function publishButton(
  freshness: PublishFreshness | undefined,
  publishedAt: number | null | undefined,
  now: number,
): { label: string; primary: boolean; note: string } {
  const last = typeof publishedAt === 'number' && publishedAt > 0 ? `Last published ${timeAgo(publishedAt, now)}.` : '';
  switch (freshness) {
    case 'never_published':
      return {
        label: 'Publish now',
        primary: true,
        note: 'Your app has not been published yet — this is the step that puts it on your domain.',
      };
    case 'changed':
      return {
        label: 'Update',
        primary: true,
        note: `You have changed your app since it was published, so your domain is still showing the older version.${last ? ` ${last}` : ''}`,
      };
    case 'up_to_date':
      // 🔒 NOTHING TO OFFER (admin 2026-08-22: "update — jab user app edit kare SIRF tab dikhe").
      // An "Update" button on a site that is already current invites a build that changes nothing,
      // and the user has no way to know it is pointless — the label promises something it cannot
      // deliver. An EMPTY label is the caller's signal to render no button at all. The "Last
      // published …" line stays: when the site last went out is useful and costs nothing to read.
      return {
        label: '',
        primary: false,
        note: `Your domain is showing your latest build.${last ? ` ${last}` : ''}`,
      };
    default:
      // Includes `unknown` and an older server that sends no publish block at all.
      return { label: 'Publish', primary: false, note: '' };
  }
}

/**
 * THE WORD THAT ARMS AN IRREVERSIBLE ACTION (admin 2026-08-22: "capital me DELETE type kiya jaye,
 * tab hi unpublish ho").
 *
 * 🔒 EXACT MATCH, CAPITALS INCLUDED — and that strictness is the entire point. Taking a live site
 * down cannot be undone from any visitor's side: every link anyone has shared dies the instant it
 * runs. A confirm dialog gets dismissed by reflex; typing a specific word in a specific case cannot
 * be done by accident. Accepting "delete" or " Delete " would hand back exactly the carelessness the
 * gate exists to prevent, so surrounding whitespace is trimmed (a real paste artefact) and nothing
 * else is forgiven. PURE.
 */
export const UNPUBLISH_WORD = 'DELETE';

export function unpublishArmed(typed: string): boolean {
  return String(typed ?? '').trim() === UNPUBLISH_WORD;
}

/**
 * A DNS record name the way a REGISTRAR's add-record form wants it (admin 2026-08-08, Hostinger
 * screenshot): those forms take names RELATIVE to the domain — the apex is "@", a subdomain is just
 * its prefix — while the hosting API hands back fully-qualified names. Pure, exported for tests.
 */
export function relativeRecordName(name: string, domain: string): string {
  const fq = (name || '').replace(/\.$/, '').toLowerCase();
  const d = (domain || '').replace(/\.$/, '').toLowerCase();
  if (!fq || !d) return name;
  if (fq === d) return '@';
  if (fq.endsWith(`.${d}`)) return fq.slice(0, -(d.length + 1));
  return name;
}


export function NbaiDomainConnect({ workspaceId, onBack, onPublish, publishBusy, publishResult, publishFreshness, onUnpublish }: NbaiDomainConnectProps) {
  /**
   * OPENS WITH WHAT YOU ALREADY TYPED (admin 2026-08-22: "abhi lagta hai sab gayab ho gaya").
   *
   * Read SYNCHRONOUSLY in the initialiser, not in an effect — an effect runs after the first paint,
   * which is the blank frame the admin is describing. The server state below still loads and still
   * wins; this only removes the empty screen in front of it. See domainDraftCache.ts for why the
   * records come back instantly and the verification states deliberately do not.
   */
  const draft = useRef(readDomainDraft(typeof localStorage !== 'undefined' ? localStorage : null, workspaceId || '', Date.now())).current;
  const [domain, setDomain] = useState(draft?.domain || '');
  /** True once the SERVER has answered. Until then, anything restored is last-known, not confirmed. */
  const [confirmed, setConfirmed] = useState(false);
  /** The server answered, but could NOT reach the live source. Not the same as "not connected". */
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  /** The honest reason the last publish attempt did not start (no dead buttons). Cleared on retry. */
  const [publishBlocked, setPublishBlocked] = useState<string | null>(null);
  // UNPUBLISH — deliberately behind a TYPED confirmation (admin 2026-08-22: "user ko bataya jaye
  // website delete ho jayegi, capital me DELETE type kiya jaye, tab hi unpublish ho").
  //
  // 🔒 WHY TYPING, NOT A SECOND TAP: taking a live site down is irreversible from every visitor's
  // side — a shared link dies the moment this runs, and no undo exists. A confirm dialog is dismissed
  // by reflex; typing a word cannot be. The word is checked EXACTLY, capitals and all, so a stray
  // "delete" does not arm it.
  const [unpubOpen, setUnpubOpen] = useState(false);
  const [unpubTyped, setUnpubTyped] = useState('');
  const [unpubBusy, setUnpubBusy] = useState(false);
  const [unpubMsg, setUnpubMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sanitized REAL reason from the ownership-checked route — dim, owner-only, diagnosis-grade.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Server said 402 needsPlan: the Custom Domain plan is required — an upgrade note, not a red error.
  const [needsPlan, setNeedsPlan] = useState(false);
  const [result, setResult] = useState<DomainStatus | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Auto-DNS (nameserver delegation): the zero-copy-paste path. Offered only when the server says a
  // tap can actually deliver it (result.autoDns), and honest about the ONE registrar step it needs.
  const [autoNs, setAutoNs] = useState<string[] | null>(draft?.nameServers?.length ? draft.nameServers : null);
  const [autoZoneStatus, setAutoZoneStatus] = useState<string | null>(null);
  // SPLIT, not summed (admin screenshot 2026-09-02: "all 1 record are now in place (we added 2)").
  // `added` = records that now hold a value that was actually DESIRED (can never exceed `autoDesired`);
  // `removed` = cleanup deletes (a foreign ownership token, an excess stale value) — never part of
  // "desired", and reported separately so cleanup activity cannot inflate "we added N" past N's meaning.
  const [autoAdded, setAutoAdded] = useState<number | null>(null);
  const [autoRemoved, setAutoRemoved] = useState<number | null>(null);
  // The zone read-back (see autoDnsSummary): `null` = we could not look, `[]` = everything is there.
  const [autoMissing, setAutoMissing] = useState<Array<{ type: string; name: string }> | null>(null);
  const [autoDesired, setAutoDesired] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  // Domain Connect one-click (registrar-approved template) + Hostinger token flow (Slice B/C).
  const [dcCheck, setDcCheck] = useState<{ supported: boolean; providerName?: string; applyUrl?: string; reason?: string } | null>(null);
  const [hostingerToken, setHostingerToken] = useState('');
  const [hostingerDone, setHostingerDone] = useState<number | null>(null);
  // "Where did you buy this domain?" — preselected from public RDAP data when possible; the user's
  // own pick always wins (admin suggestion 2026-08-06, adapted: placed at the nameserver step where
  // the question actually arises, with auto-detection so most users never touch the dropdown).
  const [registrarId, setRegistrarId] = useState('');

  /**
   * REHYDRATE ON MOUNT (admin 2026-08-06: a tab switch reloaded the page and "sab chala gaya").
   * Every fact was safe server-side the whole time — only this component's memory died. One request
   * restores the domain, its live status + records, and the automatic-setup state (nameservers +
   * zone), so a reload lands the user exactly where they left off. Guarded so it never clobbers a
   * domain the user is actively typing.
   */
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/domains/nbai/state?${params.toString()}`, { headers: await authHeaders() });
        if (!res.ok) return;                              // no saved state / not enabled — a fresh form is correct
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        // The server has spoken, so nothing on screen is a remembered guess any more — even when it
        // had nothing to say, which honestly means "no domain connected" rather than "not loaded".
        setConfirmed(true);
        if (!data?.domain) {
          // THE SERVER SAYS NOTHING IS CONNECTED, and the device remembers a domain. That is a real
          // divergence — the connection was removed elsewhere, or from another device — and keeping
          // the remembered copy on screen would be the stale-artifact trap this module exists to
          // avoid. The server is the authority on what is connected; forget ours.
          clearDomainDraft(typeof localStorage !== 'undefined' ? localStorage : null, workspaceId || '');
          return;
        }
        setDomain((prev) => prev || data.domain);
        /**
         * 🔒 USE THE COPY THE SERVER KEPT (admin 2026-08-22: "server par bhi doge? mujhe dono jagah
         * chahiye"). It always kept both — the domain and the records live in Firestore — and it now
         * returns `savedRecords` OUTSIDE `status` precisely so a failed live lookup cannot take the
         * records down with it. This client was reading only `data.status`, which is null in exactly
         * that case, so it threw the saved copy away and the user saw a page with no records: the
         * server half of that fix had landed and the client half had not.
         *
         * `statusUnavailable` is the honest distinction it carries — "we could not look" is not
         * "not connected", and telling them apart is the difference between waiting and retyping a
         * domain that was never lost.
         */
        const saved: DnsRecord[] = Array.isArray(data.savedRecords) ? data.savedRecords : [];
        if (data.status) {
          setResult((prev) => prev ?? data.status);
        } else if (saved.length > 0) {
          // Known records, unknown status — stated as exactly that, never as a connection verdict.
          setResult((prev) => prev ?? {
            domain: data.domain,
            active: false,
            ownershipState: 'unknown',
            hostState: 'unknown',
            sslState: 'unknown',
            records: saved,
            displayRecords: saved,
          });
          setStatusUnavailable(true);
        }
        if (data.zone?.nameServers?.length) {
          setAutoNs((prev) => prev ?? data.zone.nameServers);
          setAutoZoneStatus((prev) => prev ?? data.zone.status);
        }
        // Keep the device copy current, so the NEXT visit is instant too. Only ever "what to type" —
        // writeDomainDraft has no field for a verification state, by construction.
        writeDomainDraft(
          typeof localStorage !== 'undefined' ? localStorage : null,
          workspaceId || '',
          {
            domain: data.domain,
            records: data.status?.displayRecords || data.status?.records || saved,
            nameServers: data.zone?.nameServers,
          },
          Date.now(),
        );
      } catch { /* offline — the manual flow still works from scratch, now with the saved copy shown */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /**
   * Remember what to type, after any answer that produced records.
   *
   * One function so connect, re-check and first load cannot drift on WHAT is remembered — and so the
   * "never remember a verification" rule lives in exactly one place (domainDraftCache.ts refuses to
   * store one at all, which is the stronger form of the same guarantee).
   */
  const rememberDraft = (status: DomainStatus | null | undefined, nameServers?: string[] | null) => {
    if (!status?.domain) return;
    writeDomainDraft(
      typeof localStorage !== 'undefined' ? localStorage : null,
      workspaceId || '',
      { domain: status.domain, records: status.displayRecords || status.records || [], nameServers: nameServers || undefined },
      Date.now(),
    );
  };

  const cleanDomain = cleanDomainInput(domain);
  const domainValid = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(cleanDomain);

  const copy = (txt: string, key: string) => {
    navigator.clipboard.writeText(txt).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  const connect = async () => {
    if (!domainValid || busy) return;
    setBusy(true); setError(null); setErrorDetail(null);
    try {
      const res = await fetch('/api/domains/nbai/connect', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, domain: cleanDomain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 402 needsPlan is not a failure — it is the plan pitch (Custom Domain plan). Rendered as an
        // upgrade note, not a red error: nothing is broken, one purchase away.
        setNeedsPlan(data?.needsPlan === true);
        setError(data?.error || 'Could not start the connection.');
        setErrorDetail(typeof data?.detail === 'string' ? data.detail : null);
        return;
      }
      setNeedsPlan(false);
      setResult(data);
      setConfirmed(true);
      setStatusUnavailable(false);
      rememberDraft(data, autoNs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    if (!domainValid || checking) return;
    setChecking(true); setError(null); setErrorDetail(null);
    try {
      const params = new URLSearchParams({ workspaceId, domain: cleanDomain });
      const res = await fetch(`/api/domains/nbai/status?${params.toString()}`, { headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not check status.'); return; }
      setResult(data);
      setConfirmed(true);
      setStatusUnavailable(false);
      rememberDraft(data, autoNs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setChecking(false);
    }
  };

  /**
   * LOOK AGAIN AFTER PUBLISHING (admin 2026-08-21). Publishing changes the two things this screen is
   * asserting — whether the domain serves anything, and whether the live site is behind the app — so
   * when the publish finishes we re-check instead of leaving stale words on screen. Without this the
   * user presses Publish, it succeeds, and the box above still reads "press Publish once": the only
   * way out is a page reload, which is exactly the dead end this whole screen keeps being fixed for.
   *
   * Checked TWICE: once immediately, and once ~8s later, because hosting can take a moment to start
   * serving the new release and a single early look would report the old state as if it were final.
   */
  const wasPublishing = useRef(false);
  useEffect(() => {
    const finished = wasPublishing.current && !publishBusy;
    wasPublishing.current = !!publishBusy;
    if (!finished || !domainValid) return;
    void checkStatus();
    const t = setTimeout(() => { void checkStatus(); }, 8_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishBusy]);

  const autoDnsStart = async () => {
    setAutoBusy(true); setError(null); setErrorDetail(null);
    try {
      const res = await fetch('/api/domains/nbai/auto-dns/start', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, domain: cleanDomain }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Could not start automatic setup.'); setErrorDetail(typeof data?.detail === 'string' ? data.detail : null); return; }
      setAutoNs(Array.isArray(data?.nameServers) ? data.nameServers : []);
      setAutoZoneStatus(typeof data?.zoneStatus === 'string' ? data.zoneStatus : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally { setAutoBusy(false); }
  };

  const autoDnsSync = async () => {
    setAutoBusy(true); setError(null); setErrorDetail(null);
    try {
      const res = await fetch('/api/domains/nbai/auto-dns/sync', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, domain: cleanDomain }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Could not apply the records.'); setErrorDetail(typeof data?.detail === 'string' ? data.detail : null); return; }
      setAutoZoneStatus(typeof data?.zoneStatus === 'string' ? data.zoneStatus : null);
      if (Array.isArray(data?.nameServers)) setAutoNs(data.nameServers);
      if (typeof data?.added === 'number') setAutoAdded(data.added);
      if (typeof data?.removed === 'number') setAutoRemoved(data.removed);
      // The zone read-back: what is genuinely there, so the line below states a fact instead of a count.
      setAutoMissing(Array.isArray(data?.missing) ? data.missing : null);
      setAutoDesired(typeof data?.desired === 'number' ? data.desired : null);
      if (data?.domain) setResult((prev) => (prev ? { ...prev, ...data.domain } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally { setAutoBusy(false); }
  };

  useEffect(() => {
    // Detect the registrar only once the nameserver step is on screen, from RDAP (public data).
    // Best-effort: CORS/timeouts fall back to the manual dropdown; a manual pick is never overridden.
    if (!autoNs || !cleanDomain) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(cleanDomain)}`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok || cancelled) return;
        const detected = detectRegistrarId(registrarNameFromRdap(await res.json().catch(() => null)));
        if (detected && !cancelled) setRegistrarId((prev) => prev || detected);
      } catch { /* unknown registrar — the dropdown handles it */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNs, cleanDomain]);

  const domainConnectCheck = async () => {
    setAutoBusy(true); setError(null); setErrorDetail(null);
    try {
      const params = new URLSearchParams({ workspaceId, domain: cleanDomain });
      const res = await fetch(`/api/domains/nbai/domain-connect/check?${params.toString()}`, { headers: await authHeaders() });
      const data = await res.json().catch(() => null);
      setDcCheck(data && typeof data.supported === 'boolean' ? data : { supported: false, reason: 'Could not check one-click support.' });
    } catch {
      setDcCheck({ supported: false, reason: 'Could not check one-click support.' });
    } finally { setAutoBusy(false); }
  };

  const hostingerApply = async () => {
    setAutoBusy(true); setError(null); setErrorDetail(null);
    try {
      const res = await fetch('/api/domains/nbai/hostinger/apply', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, domain: cleanDomain, apiToken: hostingerToken }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Hostinger setup failed.'); setErrorDetail(typeof data?.detail === 'string' ? data.detail : null); return; }
      setHostingerDone(typeof data?.applied === 'number' ? data.applied : 0);
      setHostingerToken('');   // the token's job is done — it never lingers, not even in state
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally { setAutoBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors" title="Back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div>
          <h3 className="text-sm font-bold text-white">Connect your own domain</h3>
          <p className="text-[11px] text-zinc-400">Point your domain at this app on NavBharatAI — free HTTPS included.</p>
        </div>
      </div>

      {/* WHERE THIS CAME FROM, while the live check runs (admin 2026-08-22). The page is already
          populated from the device by now, so the reassurance the admin asked for — "your work is
          still here" — is carried by the screen itself; this line only says the status is not
          confirmed YET. It deliberately never says connected or verified: see domainDraftCache.ts. */}
      {draftNotice(!!draft?.domain, confirmed) && (
        <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse shrink-0" />
          {draftNotice(!!draft?.domain, confirmed)}
        </p>
      )}

      {/* "We could not look" is NOT "not connected", and the difference is the difference between
          waiting a minute and retyping a domain that was never lost. Your records are below either
          way — the server keeps them, which is exactly what they were saved for. */}
      {statusUnavailable && (
        <p className="text-[11px] text-amber-400/90 flex items-start gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1" />
          Your domain and its DNS records are saved — NavBharatAI just could not check the live status
          this moment. Nothing is lost; press Check status again in a minute.
        </p>
      )}

      {/* Step 1 — domain */}
      <div className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
          placeholder="e.g. myshop.com"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60"
        />
        <button
          onClick={connect}
          disabled={!domainValid || busy}
          className="px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
        >
          {busy ? <TirangaLoader className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
          {busy ? 'Starting…' : 'Connect'}
        </button>
      </div>
      {domain && !domainValid && (
        <p className="text-[10px] text-red-400">Enter a valid domain like myshop.com (no https://, no slashes).</p>
      )}

      {error && needsPlan && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[11px] text-amber-100/90">{error}</p>
            <p className="mt-1 text-[10px] text-amber-200/60">Open the Billing panel → Plans to activate it, then come back and tap Connect.</p>
          </div>
        </div>
      )}
      {error && !needsPlan && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <Info className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[11px] text-red-200/90">{error}</p>
            {errorDetail && <p className="mt-1 text-[10px] text-red-200/50 break-words">[{errorDetail}]</p>}
          </div>
        </div>
      )}

      {/* Step 2 — the real DNS records + live status */}
      {result && (
        <div className="flex flex-col gap-2">
          {/* WHAT NOW? — FIRST, not last (admin 2026-08-09: "DNS record daal diye, par ab kya karna
              hai? connect karne ka button hi nahi hai?"). The status bar and its Check button used to
              sit BELOW the records, the automatic-setup block and the registrar picker — three
              screens down on a phone — so the one action the user needed was invisible and the page
              looked like it had no next step. State first, action first; the records below are
              reference material. */}
          {(() => {
            const stage = connectStage(result);
            // The COLOUR follows the stage, not `active` — a domain that is "connected" but serves an
            // error page must not be painted green with a tick. That combination is what let the admin
            // read ✅ Live over a domain showing "Site Not Found".
            return (
              <div className={`flex flex-col gap-2 px-3 py-3 rounded-xl border ${stage.tone === 'ok' ? 'bg-green-500/10 border-green-500/25' : 'bg-amber-500/10 border-amber-500/25'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {stage.tone === 'ok'
                    ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                    : <TirangaLoader className="w-4 h-4 shrink-0" />}
                  <span className={`text-[12px] font-bold ${stage.tone === 'ok' ? 'text-green-200' : 'text-amber-100'}`}>{stage.headline}</span>
                </div>
                <p className="text-[11px] text-zinc-300/80 leading-relaxed">{stage.note}</p>
                {/* THE CHECK BUTTON MOVED DOWN (admin 2026-08-22: "check now button sahi jagah nahi
                    hai … upar wala"). It used to sit HERE — above the records, i.e. before the user
                    has anything to check. Someone lands on this screen, is told to add DNS records,
                    and the first button they meet asks whether the records they have not added yet
                    have propagated. The one prominent Check now now lives AFTER the records, which is
                    the only moment pressing it can be true. */}
                {/* A REAL way to do the one thing that is left. Telling someone to "press Publish"
                    while they are two screens deep in the domain flow is an instruction, not a path —
                    this takes them back to the sheet where that button actually is. */}
                {stage.action === 'publish' && (
                  <button
                    onClick={onBack}
                    className="self-start flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-bold"
                  >
                    Go to Publish
                  </button>
                )}
                {/* WHAT WE CAN SEE OF THEIR DNS (admin 2026-08-21, mitrify.com). The status line
                    below said `ownership: missing` while all three records were live and byte-perfect
                    in public DNS — a state indistinguishable from "you typed it wrong", so the user
                    kept re-editing correct records. This sentence separates the three cases: a wrong
                    value they must fix, a record their registrar has not published yet, or everything
                    correct and the remaining wait being OURS, not theirs. */}
                {result.dnsCheck?.summary && (
                  <p className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-2 border ${
                    result.dnsCheck.allSeen
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-100'
                      : 'bg-zinc-800/60 border-zinc-700 text-zinc-300'}`}>
                    {result.dnsCheck.allSeen ? '✓ ' : ''}{result.dnsCheck.summary}
                  </p>
                )}

                {/* FIREBASE'S OWN WORDS. We used to parse the state enum and DROP the `issues[]`
                    array that carries the actual reason — so a stuck domain reached the user as one
                    unexplained word while the API had already printed why. */}
                {result.issues && result.issues.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {result.issues.map((msg, i) => (
                      <p key={i} className="text-[11px] leading-relaxed text-amber-100/90">• {msg}</p>
                    ))}
                  </div>
                )}

                {/* The raw states stay available — dim, small, owner-only diagnosis — because a
                    support question is answered by them, but they must never be the headline.
                    `last checked` is what makes the button above honest: it re-reads the hosting
                    service's answer, and cannot force that service to re-run its own DNS sweep. */}
                <p className="text-[9px] text-zinc-500/80 font-mono">
                  ownership: {short(result.ownershipState)} · host: {short(result.hostState)} · SSL: {short(result.sslState)}
                  {result.lastCheckedAt ? ` · last checked ${new Date(result.lastCheckedAt).toLocaleString()}` : ''}
                </p>
              </div>
            );
          })()}
          {/* ⬆️ THE FAST PATH GOES FIRST (admin 2026-08-22: "auto-DNS ko upar lao").

              🔒 WHY THE ORDER IS THE FIX, not decoration. This block used to sit BELOW the
              copy-these-five-records list and was labelled "Or:", so the first thing every user met
              was the SLOW path: type five records by hand at a registrar whose default TTL is often
              14400 (four hours), and then wait for that TTL on every single change, forever. The
              automatic path writes the records itself at TTL 300 and needs a nameserver change ONCE —
              slow that first time, then instant for every future app and every future update.

              For someone shipping app after app, that difference is hours per app versus hours once.
              We were leading with the worse deal because of where a div sat. */}
          {result.autoDns && (
            <div className="px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex flex-col gap-2">
              <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Or: automatic setup (one-time nameserver change)</span>
              {!autoNs && (
                <>
                  <p className="text-[11px] text-zinc-300">
                    NavBharatAI can add these records for you. You change your domain's nameservers ONCE at
                    your registrar (GoDaddy, Hostinger, anywhere) — after that, we manage the DNS records
                    automatically, now and for every future update.
                  </p>
                  <p className="text-[10px] text-amber-200/80">
                    ⚠️ Changing nameservers moves ALL DNS for this domain to NavBharatAI — custom email or
                    other records set at your registrar will need re-adding here. Skip this and use the
                    manual records above if that worries you.
                  </p>
                  <button onClick={autoDnsStart} disabled={autoBusy}
                    className="self-start px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold">
                    {autoBusy ? 'Starting…' : 'Set up automatically'}
                  </button>
                </>
              )}
              {autoNs && (
                <>
                  <p className="text-[11px] text-zinc-300">Set these two nameservers at your registrar (replace the existing ones):</p>
                  {autoNs.map((ns, i) => (
                    <Field key={ns} label={`Nameserver ${i + 1}`} value={ns} k={`ns${i}`} copied={copied} onCopy={copy} />
                  ))}
                  <div className="flex items-center gap-2">
                    <button onClick={autoDnsSync} disabled={autoBusy}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold">
                      {autoBusy ? 'Checking…' : 'Check & apply records'}
                    </button>
                    {/* The line that used to say "0 records applied automatically" for BOTH complete
                        success and total failure. It now reports what is genuinely in the zone. */}
                    {(() => {
                      // The host's own verdict travels WITH the record counts, so this line can never announce
                      // completion while the service is still refusing the domain — the exact pairing in the
                      // admin's screenshot: a green "nothing left to do" under a red `ownership: mismatch`.
                      const s = autoDnsSummary({ zoneStatus: autoZoneStatus, added: autoAdded, removed: autoRemoved, desired: autoDesired, missing: autoMissing, ownershipState: result?.ownershipState });
                      const tone = s.tone === 'ok' ? 'text-green-300' : s.tone === 'warn' ? 'text-amber-300' : 'text-zinc-400';
                      return <span className={`text-[10px] leading-relaxed ${tone}`}>{s.text}</span>;
                    })()}
                  </div>
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-indigo-500/20">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Where did you buy this domain?</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={registrarId}
                        onChange={(e) => setRegistrarId(e.target.value)}
                        aria-label="Your domain registrar"
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500/60"
                      >
                        <option value="">Select…</option>
                        {REGISTRARS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      {registrarById(registrarId)?.panelUrl && (
                        <a href={registrarById(registrarId)!.panelUrl} target="_blank" rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">
                          Open {registrarById(registrarId)!.name} →
                        </a>
                      )}
                    </div>
                    {registrarById(registrarId) && (
                      <p className="text-[10px] text-zinc-400">{registrarById(registrarId)!.steps}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 🔒 THE WARNING THAT COST SIX HOURS (admin 2026-08-22). Once the domain's nameservers point
              at us, the registrar's own DNS panel STOPS BEING USED — Hostinger says so in its own words
              ("Inactive — changes saved here apply once nameservers point to Hostinger"), but only if you
              scroll to the right box. The admin added five records by hand into that dead panel while
              this screen went on instructing them to do exactly that. Nothing was wrong with the records;
              they were simply being written where nothing would ever read them.
              So when automatic setup is live, the manual list is DEMOTED and prefixed with the truth. */}
          {autoZoneStatus === 'active' && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
              <p className="text-[11px] text-amber-100 leading-relaxed">
                <span className="font-bold">You do not need to add these by hand.</span> Your domain now uses
                NavBharatAI&apos;s nameservers, so we write these records for you — and any record you add at
                your registrar&apos;s DNS page is ignored from now on. The list below is only for reference.
              </p>
            </div>
          )}
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
            {autoZoneStatus === 'active' ? 'For reference: the records we manage for you' : 'Or: add these DNS records yourself at your registrar'}
          </span>
          {/* STABLE record list (admin 2026-08-19: "DNS record bhulne nahi chahiye"). Prefer the server's
              never-forgotten `displayRecords` — records you already added stay visible with a ✓ instead of
              silently vanishing when the internet accepts them, and any newly-needed record shows as ⏳. An
              older server without the field falls back to the live pending `records`. */}
          {(() => { const shown = result.displayRecords ?? result.records; const pendingCount = shown.filter((r) => !r.done).length; const doneCount = shown.length - pendingCount; return (
          <>
          {shown.length === 0 && (
            // Freshly-attached domains often report their records a few seconds AFTER create (the
            // hosting API prepares them asynchronously). "No records needed" read as "done" while
            // ownership sat pending — admin screenshot 2026-08-06. Say what is actually happening.
            <p className="text-[11px] text-zinc-400">
              {result.active
                ? 'No records needed — this domain is fully set up.'
                : 'Your records are being prepared — tap "Check" below in a few seconds to load them.'}
            </p>
          )}
          {doneCount > 0 && (
            <p className="text-[10px] text-green-300/90">✓ {doneCount} record{doneCount === 1 ? '' : 's'} you added {doneCount === 1 ? 'is' : 'are'} verified{pendingCount > 0 ? ` — ${pendingCount} more to add below.` : ' — nothing more to add.'}</p>
          )}
          {shown.map((rec, i) => rec.done ? (
            /**
             * Already added & accepted — COMPACT, but never a dead end.
             *
             * ADMIN, 2026-08-21: "jo jo DNS connect hai, us par bas green tick aa raha hai, DNS value
             * show nahi ho rahi — mujhe wapas se copy karni padi to? kaise karu."
             *
             * A verified record collapsed to `✓ TXT @ Verified` and its VALUE disappeared, so there was
             * no way to copy it again — and there are real reasons to need it: moving registrar, a DNS
             * reset, an accidental delete, or simply checking that what is live matches what we asked
             * for. Compact was right; LOSING the value was not. It now opens on click.
             */
            <details key={i} className="px-3 py-1.5 rounded-lg bg-green-500/5 border border-green-500/20 group/rec">
              <summary className="flex items-center gap-2 cursor-pointer list-none marker:hidden">
                <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">{rec.type}</span>
                <span className="text-[11px] text-zinc-400 font-mono truncate">{relativeRecordName(rec.name, cleanDomain)}</span>
                {/* "Verified" only when our resolver actually saw it — see recordBadge. */}
                <span className="ml-auto text-[10px] text-green-300 shrink-0">{recordBadge(rec, result.dnsCheck)}</span>
                {/* Says what the click DOES. A bare chevron on a row nobody expects to be clickable is
                    how a feature stays undiscovered. */}
                <span className="text-[10px] text-zinc-500 shrink-0 group-open/rec:hidden">show</span>
                <span className="text-[10px] text-zinc-500 shrink-0 hidden group-open/rec:inline">hide</span>
              </summary>
              <div className="flex flex-col gap-1 pt-2">
                {/* The SAME three copyable fields the pending card shows — a verified record is not a
                    different kind of record, so it must not be a different kind of card. */}
                <Field label="Type" value={rec.type} k={`dt${i}`} copied={copied} onCopy={copy} />
                <Field label="Name" value={relativeRecordName(rec.name, cleanDomain)} k={`dn${i}`} copied={copied} onCopy={copy} />
                <Field label="Value" value={rec.value} k={`dv${i}`} copied={copied} onCopy={copy} />
                <p className="text-[10px] text-zinc-500">
                  Already live at your registrar — this is here so you can copy it again if you ever
                  need to re-add it.
                </p>
              </div>
            </details>
          ) : (
            <div key={i} className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">{rec.type}</span>
                {rec.note && <span className="text-[10px] text-zinc-500">{rec.note}</span>}
              </div>
              {/* THE CARD SHOWS EXACTLY WHAT GETS PASTED (admin 2026-08-09: "jo jo copy paste hoga,
                  wahi wahi dikhna chahiye — mere users non-technical hain"). Registrar forms lead
                  with a "Type" dropdown and take names RELATIVE to the domain ("@" for the apex) —
                  Hostinger, GoDaddy, Namecheap, all of them. So Type is a first-class copyable
                  Field, and NAME displays and copies the RELATIVE form directly. The earlier
                  version showed the full name with a "if rejected, type @ instead" footnote — a
                  half-measure: the user should never be asked to translate. */}
              <Field label="Type" value={rec.type} k={`t${i}`} copied={copied} onCopy={copy} />
              <Field label="Name" value={relativeRecordName(rec.name, cleanDomain)} k={`n${i}`} copied={copied} onCopy={copy} />
              <Field label="Value" value={rec.value} k={`v${i}`} copied={copied} onCopy={copy} />
              <p className="text-[10px] text-zinc-500">
                At your registrar: in the "Type" dropdown choose <span className="font-bold text-zinc-300">{rec.type}</span>, copy Name and Value into their boxes, and leave TTL as-is.
                {relativeRecordName(rec.name, cleanDomain) === '@' && (
                  <> ("@" simply means your domain, {cleanDomain} — every registrar form understands it.)</>
                )}
              </p>
            </div>
          ))}
          </>
          ); })()}

          {result.domainConnect && (
            <div className="px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20 flex flex-col gap-2">
              <span className="text-[10px] font-black text-sky-300 uppercase tracking-widest">Or: one-click at your registrar</span>
              {!dcCheck && (
                <button onClick={domainConnectCheck} disabled={autoBusy}
                  className="self-start px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-bold">
                  {autoBusy ? 'Checking…' : 'Check if my registrar supports one-click'}
                </button>
              )}
              {dcCheck && dcCheck.supported && dcCheck.applyUrl && (
                <a href={dcCheck.applyUrl} target="_blank" rel="noreferrer"
                  className="self-start px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold">
                  Approve at {dcCheck.providerName || 'your registrar'} →
                </a>
              )}
              {dcCheck && !dcCheck.supported && (
                <p className="text-[11px] text-zinc-400">{dcCheck.reason}</p>
              )}
            </div>
          )}

          {result.hostingerDns && (
            <div className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 flex flex-col gap-2">
              <span className="text-[10px] font-black text-violet-300 uppercase tracking-widest">Or: I'm on Hostinger</span>
              {hostingerDone === null ? (
                <>
                  <p className="text-[11px] text-zinc-300">
                    Paste an API token from Hostinger hPanel (Account → API). It is used once to add these
                    records to your zone and never stored.
                  </p>
                  <div className="flex gap-2">
                    <input value={hostingerToken} onChange={(e) => setHostingerToken(e.target.value)}
                      placeholder="Hostinger API token" type="password" autoComplete="off"
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-violet-500/60" />
                    <button onClick={hostingerApply} disabled={autoBusy || !hostingerToken.trim()}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold shrink-0">
                      {autoBusy ? 'Applying…' : 'Apply records'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-green-300">✓ {hostingerDone} record{hostingerDone === 1 ? '' : 's'} sent to Hostinger — tap "Check" below once DNS refreshes.</p>
              )}
            </div>
          )}

          {/* The status + Check button now live at the TOP of this block (see the comment there);
              a second copy here would be two sources of truth for one state. What remains is the
              closing reassurance, which belongs after the reference material. */}
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            DNS changes can take a few minutes to a few hours. Publish your app once after connecting, so the
            domain serves your latest build. HTTPS is issued automatically once the records resolve.
          </p>
          {/* THE ONE Check now, and it is now the prominent one (admin 2026-08-22). It sits directly
              under the records the user just added, which is the only place where pressing it means
              anything — and it is the primary action of this whole screen while a domain is pending,
              so it is styled like one instead of a faint outline nobody finds. */}
          {!result.active && (
            <button
              onClick={checkStatus}
              disabled={checking}
              className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-[13px] font-bold transition-colors"
            >
              {checking ? <TirangaLoader className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
              {checking ? 'Checking…' : 'Check now'}
            </button>
          )}

          {/* VISIT YOUR DOMAIN (admin 2026-08-21: "jab domain successfully connect ho jaye, to isi
              page ke niche 'visit mitrify.com' aana chahiye — aur us par click kar sake").
              
              The obvious missing ending. Everything above is setup — records, checks, waiting — and
              once it is done the one thing a person wants is to GO AND LOOK AT IT, and until now the
              page never offered that. They had to retype their own domain into the address bar.
              
              Shown for a CONNECTED domain regardless of what it currently serves: it is their domain,
              and the honest state box directly above already says what they will find there — so this
              never has to pretend, and never has to be withheld either. */}
          {/* PUBLISH / REPUBLISH (admin 2026-08-21: "Visit se pahle ek button banao — publish. Is
              publish se app edit karne ke bad wapas publish ki jayegi").

              Placed directly ABOVE Visit because that is the real order of the two actions: publish
              what you changed, then go and look at it. The label is computed, not fixed — see
              `publishButton` for why the button has to say WHICH of the three situations you are in,
              and why an unmeasurable state says nothing rather than guessing.

              It drives the SAME pipeline as the main Publish button (passed in as `onPublish`), so
              this is a second entry point to one implementation, never a second implementation. */}
          {/* NOT SHOWN when the server has positively identified an app static hosting can never
              serve (see domainPublishBlockNote — a bare server, not a fullstack app, so there is no
              configuration under which this button could work). A button that can only ever refuse is
              the dead button this codebase keeps deleting; the box above already says what to do
              instead. It returns by itself the moment the app is publishable. */}
          {result.active && onPublish && !result.publishBlocked && (() => {
            // This screen's own reading wins once it has one; until then the caller's, so the dot the
            // user followed in here does not blink out and back.
            const freshness = result.publish?.freshness ?? publishFreshness;
            const p = publishButton(freshness, result.publish?.publishedAt, Date.now());
            return (
              <div className="flex flex-col gap-1.5">
                {p.label && (
                <button
                  onClick={() => { setPublishBlocked(null); const r = onPublish(); if (typeof r === 'string' && r) setPublishBlocked(r); }}
                  disabled={!!publishBusy}
                  className={`self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-50 ${
                    p.primary
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      : 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  {publishBusy ? <TirangaLoader className="w-4 h-4" /> : <Rocket className="w-4 h-4" />}
                  {publishBusy ? 'Publishing…' : p.label}
                  {/* THE END OF THE DOT TRAIL — this is the button that clears it. */}
                  {!publishBusy && needsPublishDot(freshness) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-label="You have unpublished changes" />
                  )}
                </button>
                )}
                {p.note && <p className="text-[11px] text-zinc-400 leading-relaxed">{p.note}</p>}
                {/* WHAT HAPPENED WHEN THEY PRESSED IT (admin 2026-08-24: "yeh theek se deploy ho hi
                    nahi raha hai").

                    🔒 THE BUG THIS CLOSES. This screen had a Publish button whose OUTCOME rendered on
                    a different view. The synchronous refusal was passed back and shown here; the
                    asynchronous one — the server's real answer, which is the only one that can say a
                    build failed or an app cannot be hosted — was written to state that the publish
                    sheet renders only in its `choose` branch. So a user standing on the domain screen
                    pressed Publish, watched a spinner run and stop, saw NOTHING, and was told again by
                    the box above to "press Publish". A loop with no information in it, over a message
                    that existed the whole time.

                    Precedence is deliberate: a refusal that stopped this attempt outranks the text of
                    the last one, which the host has not cleared because the request never started. */}
                {(publishBlocked || publishResult) && (
                  <p className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words ${publishBlocked ? 'text-amber-300' : 'text-zinc-300'}`}>
                    {publishBlocked || publishResult}
                  </p>
                )}
              </div>
            );
          })()}

          {result.active && (
            <a
              href={visitUrl(cleanDomain)}
              target="_blank"
              rel="noreferrer"
              className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-[13px] font-bold transition-colors"
            >
              <Globe className="w-4 h-4" />
              Visit {cleanDomain}
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </a>
          )}

          {/* UNPUBLISH (admin 2026-08-22). Offered only for an app that is genuinely LIVE — there is
              nothing to take down otherwise, and a control with nothing behind it is the dead button
              this file keeps deleting. Placed LAST, after Visit, because destroying something belongs
              at the end of a screen, never beside the thing you came here to do.

              🔒 The consequence is stated BEFORE the field, in plain English, and the word must be
              typed exactly. See `unpublishArmed` for why a typed word and not a second tap. */}
          {result.active && onUnpublish && result.publish?.live && (
            <div className="mt-1 pt-3 border-t border-zinc-800 flex flex-col gap-2">
              {!unpubOpen ? (
                <button
                  onClick={() => { setUnpubOpen(true); setUnpubMsg(''); setUnpubTyped(''); }}
                  className="self-start text-[11px] text-zinc-500 hover:text-red-400 underline underline-offset-2 transition-colors"
                >
                  Take this website offline
                </button>
              ) : (
                <>
                  <p className="text-[11.5px] text-red-200 leading-relaxed">
                    <span className="font-bold">This will delete your website.</span>{' '}
                    {cleanDomain} will stop working, and anyone you shared the link with will no longer
                    be able to open it. Your app and its files are safe — you can publish it again later
                    — but this cannot be undone right now.
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Type <span className="font-mono font-bold text-red-300">{UNPUBLISH_WORD}</span> to confirm:
                  </p>
                  <input
                    value={unpubTyped}
                    onChange={(e) => setUnpubTyped(e.target.value)}
                    placeholder={UNPUBLISH_WORD}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Type ${UNPUBLISH_WORD} to confirm taking the website offline`}
                    className="self-start w-40 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[12px] font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        if (!unpublishArmed(unpubTyped) || unpubBusy) return;
                        setUnpubBusy(true); setUnpubMsg('');
                        try {
                          const msg = await onUnpublish();
                          // '' means it really came down. Anything else is the server's own reason,
                          // shown verbatim — a generic failure line is what makes a button feel fake.
                          if (msg) { setUnpubMsg(msg); return; }
                          setUnpubOpen(false);
                          setUnpubTyped('');
                          void checkStatus();   // the screen must stop saying the site is live
                        } catch {
                          setUnpubMsg('Could not reach NavBharatAI. Check your connection and try again.');
                        } finally {
                          setUnpubBusy(false);
                        }
                      }}
                      disabled={!unpublishArmed(unpubTyped) || unpubBusy}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[12px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {unpubBusy ? <TirangaLoader className="w-3.5 h-3.5" /> : null}
                      {unpubBusy ? 'Taking it offline…' : 'Unpublish'}
                    </button>
                    <button
                      onClick={() => { setUnpubOpen(false); setUnpubTyped(''); setUnpubMsg(''); }}
                      disabled={unpubBusy}
                      className="px-3 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-[12px] font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                  {unpubMsg && <p className="text-[11px] text-amber-300 leading-relaxed">{unpubMsg}</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the user typed, reduced to a bare hostname. PURE.
 *
 * Extracted from an inline expression because THREE things now depend on it being right: the connect
 * call, the record names shown for the apex, and — since 2026-08-21 — the "Visit <domain>" link. A
 * paste of `https://mitrify.com/app` must become `mitrify.com` in all three, and the link must always
 * be built as `https://` + this, never from the raw input: pasting a scheme back into an href is how
 * `https://https://…` reaches a user.
 */
export function cleanDomainInput(raw: string): string {
  return String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/** The address the Visit button opens. Always https, always the bare host. PURE. */
export function visitUrl(domain: string): string {
  const host = cleanDomainInput(domain);
  return host ? `https://${host}` : '';
}

/** Trim the API's verbose state enums (OWNERSHIP_ACTIVE -> active) for the status line. */
function short(state: string): string {
  return (state || '').replace(/^[A-Z]+_/, '').toLowerCase() || 'pending';
}

function Field({ label, value, k, copied, onCopy }: { label: string; value: string; k: string; copied: string | null; onCopy: (v: string, k: string) => void; }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 w-10 shrink-0 uppercase">{label}</span>
      <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-zinc-200 bg-black/40 rounded px-2 py-1">{value}</code>
      <button onClick={() => onCopy(value, k)} className="shrink-0 text-zinc-400 hover:text-white" title="Copy">
        {copied === k ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default NbaiDomainConnect;

import type { Express, Request, Response } from 'express';
import { domainOpsRateLimiter, verifyFirebaseToken, verifyFirebaseIdentity, enforceNotBanned } from '../lib/authMiddleware';
import { sendSafeError } from '../lib/httpError';
import { hostingPlansEnabled, hostingPlanPriceInr, probeHostingPlan, readHostingPlanStatus } from '../lib/hostingPlan';
import { getServerDb } from '../lib/serverDb';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';
import {
  normalizeDomain,
  firebaseCustomDomainsEnabled,
  firebaseHostingConfigured,
  attachCustomDomain,
  deleteCustomDomain,
  customDomainStatusLive,
  customDomainErrorMessage,
  sanitizeDomainErrorDetail,
  siteIdForWorkspace,
  type CustomDomainStatus,
} from '../lib/firebaseCustomDomain';
import {
  linkWorkspaceDomain, firebaseDomainsForWorkspace, firebaseDomainLinksForUser, linkForDomain,
  rememberDomainDnsRecords, getStoredDomainDnsRecords,
} from '../lib/firebaseDomainLink';
import { mergeStableRecords, dropForeignSiteTokens, recordsStillPending, type StableDnsRecord } from '../lib/domainDnsRecords';
import {
  managedDnsConfigured, ensureZone, zoneStatus, applyRecords, sanitizeManagedDnsError,
  listZoneRecords, missingFromZone,
} from '../lib/cloudflareManagedDns';
import { canonicalHost, alternateHost } from '../lib/domainPair';
import { decideDomainMove } from '../lib/domainMove';
import { checkDomainConnect, domainConnectEnabled } from '../lib/domainConnect';
import { hostingerDnsEnabled, applyHostingerRecords } from '../lib/hostingerDns';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
import { verifyRecordsLive } from '../lib/domainDnsVerify';
import { checkDomainServing } from '../lib/domainServingCheck';
import { siteHasRelease } from '../lib/firebaseCustomDomain';
import { resolvePublishState } from '../AgentV3/publishState';
import { planDeployment, domainPublishBlockNote } from '../AgentV3/deployPlan';
import { loadWorkspaceFilesByPath, loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { analyzeApiWiring } from '../AgentV3/apiWiring';
import { isBackendPointed, backendPointedRefusal, backendPointedStage } from '../AgentV3/domainPointing';
import { getConversationStore } from './agentv3';

/**
 * Firebase-NATIVE custom-domain routes (Slice 2) — connect a user's own domain directly to their
 * "Host on NavBharatAI" (Firebase Hosting) site:
 *   - POST /api/domains/nbai/connect — attach the domain to the workspace's dedicated Firebase site
 *     and return the EXACT DNS records to add (Firebase issues SSL automatically once they resolve).
 *   - GET  /api/domains/nbai/status  — poll ownership / host / SSL status for a connected domain.
 *
 * Gated by `AGENTV3_FIREBASE_CUSTOM_DOMAINS` (off by default → honest "not enabled" 503). Ownership
 * is STRICT: only the VERIFIED owner of a real `agentv3-<uid>-…` workspace may attach a domain
 * (attaching provisions a real Firebase resource against our project, so it must not be spoofable).
 */

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Strict owner gate: the verified uid must own this real workspace (no anon, no claimed fallback). */
// Ownership is decided by the shared policy module, never re-typed here (audit finding #2). A custom
// domain must attach to a real, verified owner — an anon workspace has nobody to own it.
const ownsWorkspace = (verifiedUid: string | null, workspaceId: unknown): workspaceId is string =>
  ownedByVerifiedUid(verifiedUid, workspaceId);

/**
 * Turn a live status into a STABLE record view the UI can trust (admin 2026-08-19: "DNS record bhulne
 * nahi chahiye"). It remembers every record shown so far and returns the union — added ✓ + still-needed
 * ⏳ — so nothing the user already entered ever disappears. Best-effort: if the store is unavailable it
 * falls back to the live pending set tagged not-done, which is exactly today's behaviour. The live
 * `records` field is left untouched so the auto-DNS / Hostinger / Cloudflare appliers keep acting only
 * on what is actually pending.
 */
async function stableRecordsFor(
  domain: string,
  liveRecords: { type: string; name: string; value: string; note?: string }[],
  workspaceId?: string,
): Promise<StableDnsRecord[]> {
  try {
    await rememberDomainDnsRecords(domain, liveRecords);
    const stored = await getStoredDomainDnsRecords(domain);
    /**
     * 🔒 SCOPE THE STORE'S CONTENTS TO THIS APP (admin 2026-08-22). The store is keyed by domain
     * alone, so one domain connected from several apps pools every app's `hosting-site=` ownership
     * token under one key — and the user is then told to add records that can do nothing for the app
     * in front of them. See `dropForeignSiteTokens` for why this is corrected on READ rather than by
     * re-keying live customer data.
     *
     * Applied to the STORED set only. The live set is what the hosting service is asking for right
     * now and is already correct by construction; filtering it could only ever remove something the
     * user genuinely needs. Without a workspaceId nothing is dropped at all.
     */
    const siteId = workspaceId ? siteIdForWorkspace(workspaceId) : '';
    return mergeStableRecords(dropForeignSiteTokens(stored, siteId), liveRecords);
  } catch {
    return liveRecords.map((r) => ({ ...r, done: false }));
  }
}

/**
 * ONE VERDICT FOR A DOMAIN, WHICHEVER ROUTE WAS ASKED (admin screenshots 2026-09-07, mitrify.com).
 *
 * 🔴 THE FLIP THIS ENDS. Two screenshots a minute apart, same domain: an amber *"Connected — but this
 * app needs its server part deployed first"*, then a green *"Connected, with HTTPS … If it shows an
 * error page, press Publish once"* — with a Publish button that, for this app, can only refuse. The
 * second came from pressing Connect on an already-connected domain: the connect route answered with a
 * BARE status (no `serving`, no `publishBlocked`, no `dnsCheck`), and the screen rendered that as if it
 * were a verdict. Two routes, two shapes, one screen that trusted both.
 *
 * So the enrichment that turns a hosting-service status into something honest to show — the stable
 * record view, the live DNS check, the serving probe, the backend-pointed verdict, the publish state
 * and the "press Publish cannot help this app" note — lives HERE, once, and both routes return it.
 * A screen can no longer receive two different truths about one domain depending on which button was
 * pressed. Test-pinned: exactly one serving probe and one DNS check exist in this file.
 */
async function formDomainVerdict(
  workspaceId: string,
  host: string,
  status: CustomDomainStatus,
): Promise<CustomDomainStatus & Record<string, unknown>> {
  /**
   * www ↔ apex (ROADMAP §13, 1.2). The twin's records ride in the SAME list the user is shown and
   * the same list the automatic appliers write — one instruction set, so `www` cannot be forgotten
   * by a user who did everything the screen asked. Its own states are reported beside the verdict
   * (`alternate`), never folded INTO it: the verdict stays the canonical domain's, formed by the
   * one serving probe below, and a twin that is still pending must not make a finished domain
   * read as unfinished. Best-effort: an unreadable twin is `null`, which the screen shows as
   * "could not check", not as done.
   */
  const twinHost = alternateHost(host);
  const twin = twinHost ? await customDomainStatusLive(workspaceId, twinHost).catch(() => null) : null;
  const twinRecords = twin && twinHost ? await stableRecordsFor(twinHost, twin.records, workspaceId) : [];
  const alternate = twinHost
    ? (twin
      ? { host: twinHost, active: twin.active, ownershipState: twin.ownershipState, hostState: twin.hostState, sslState: twin.sslState, redirectTarget: twin.redirectTarget ?? null, pendingRecords: twin.records.length }
      : { host: twinHost, active: false, ownershipState: 'unknown', hostState: 'unknown', sslState: 'unknown', redirectTarget: null, pendingRecords: 0 })
    : null;
  const displayRecords = [...(await stableRecordsFor(host, status.records, workspaceId)), ...twinRecords];
  // DID THE USER'S RECORDS ACTUALLY LAND? (admin 2026-08-21, mitrify.com.) The screen used to
  // show one word from Firebase — `ownership: missing` — while every required record was live and
  // byte-perfect in public DNS. That state is indistinguishable from "you typed it wrong", so a
  // user who had done everything right kept editing correct records. We now look ourselves and
  // say which of the three it is: wrong value (they fix it), not published yet (their registrar
  // is still working), or correct and live (nothing left for them to do but wait for Firebase).
  // Best-effort and bounded — a DNS hiccup must never turn a working status screen into an error.
  const dnsCheck = await verifyRecordsLive(recordsStillPending(displayRecords)).catch(() => null);
  // DOES THE DOMAIN ACTUALLY SHOW THE APP? (admin 2026-08-21, mitrify.com.) The screen said
  // "Live! Your domain is connected, with HTTPS" while opening mitrify.com gave Firebase's "Site
  // Not Found" — both true at once, because ownership/host/SSL describe DNS and a certificate,
  // NOT whether anything was ever published to the site the domain points at. A domain connected
  // AFTER the last publish points at an empty site. The only honest way to claim a domain is live
  // is to OPEN it. Bounded, best-effort, and SSRF-guarded (the domain is user-supplied).
  // 🔒 THE AUTHORITATIVE ANSWER FIRST. `siteHasRelease` asks FIREBASE whether anything was ever
  // published to this app's site — no egress to the user's domain, and a site with zero releases
  // has unambiguously never been published to. The HTTP fetch below stays as a SECOND opinion for
  // everything a release count cannot see (a release exists but the page errors), but it must not
  // be the only witness: it failed to reach mitrify.com and the screen printed "Live!" over a
  // domain the admin was watching show "Site Not Found".
  /**
   * 🔴 A DOMAIN THAT MOVED TO THE BACKEND IS NOT "STILL CONNECTING" (admin 2026-09-07).
   *
   * `status.active` is the STATIC host's answer to "are MY records in place?". Once a backend
   * deploy moves the domain to the running service those records are deliberately gone, so that
   * answer is legitimately false while the site is legitimately LIVE. Letting it drive the verdict
   * printed "still connecting" over a working domain — and worse, re-opened the setup block whose
   * button would have taken the site down (see the sync route's guard).
   *
   * So for a backend-pointed domain the verdict comes from whether the domain ANSWERS, which is
   * the question the user was asking all along.
   */
  const pointingRec = await getConversationStore().get(String(workspaceId)).catch(() => null);
  const backendPointed = isBackendPointed(pointingRec, host);
  let serving = (status.active || backendPointed) ? await checkDomainServing(host).catch(() => null) : null;
  let everPublished: boolean | null = null;
  if (backendPointed) {
    const stage = backendPointedStage(host, serving);
    return {
      ...status,
      // The domain genuinely works (or genuinely does not) on its own merits now — never on the
      // static host's record check, which cannot see the service at all.
      active: serving?.state === 'serving',
      backendPointed: true,
      backendStage: stage,
      displayRecords: [],
      serving,
      alternate,
    };
  }
  if (status.active) {
    everPublished = await siteHasRelease(workspaceId).catch(() => null);
    if (everPublished === false) {
      serving = {
        state: 'nothing_published',
        status: serving?.status ?? 0,
        note: 'Your domain is connected, but this app has never been published to it — opening it '
          + 'shows an error page. Press Publish once and your domain will start showing your app.',
      };
    }
  }
  // IS THE LIVE SITE STILL THE APP THEY HAVE? (admin 2026-08-21, the Publish-button request.) A
  // button answers "how do I republish"; this answers the question nobody was asking them — "do I
  // NEED to?". Two real timestamps off the SAME server clock: when the bytes went live, and when
  // the workspace's files were last written. Both reads are metadata-only and bounded, and either
  // one missing yields `unknown`, which the UI renders as silence rather than a guess.
  const publish = await resolvePublishState(workspaceId, everPublished);
  /**
   * CAN "PRESS PUBLISH" EVEN WORK FOR THIS APP? (admin 2026-08-24.)
   *
   * Asked ONLY when we are about to tell them to press it — an app that is already serving needs
   * no verdict, and paying four document reads on every status poll for a question nobody asked
   * is how a correct feature becomes too expensive to keep. `loadWorkspaceFilesByPath` fetches the
   * manifests by id: no listing, no whole-workspace load.
   *
   * 🔒 SILENT ON DOUBT. An unreadable workspace yields `{}`, and `planDeployment` calls that
   * static-sufficient — so the note is '' and the screen says exactly what it says today. A
   * classifier that guessed would start telling users with perfectly publishable apps not to
   * publish them, which is a worse failure than the one it fixes.
   */
  let publishBlocked = '';
  /**
   * ⚠️ WIDENED 2026-09-04, HOURS AFTER THE FIRST FIX SHIPPED WITH THIS HOLE — and the admin's next
   * screenshot is the proof, on the same domain.
   *
   * The gate was `state === 'nothing_published'`, chosen because that is where the screen says
   * "one last step: press Publish". But `nothing_published` is not the only state that says it:
   * `error` says "Publishing again usually fixes this", and `unknown` — our probe could not reach
   * the domain — says *"If it shows an error page, press Publish once."* That last one is exactly
   * what mitrify.com now shows, so the very fix written to stop this loop did not fire in the
   * state the admin was actually looking at.
   *
   * The right gate was never a state name, it is the QUESTION: is this screen about to tell the
   * user to press Publish? Every non-serving state does. So it asks for all of them.
   *
   * Cost is unchanged where it matters: a domain that IS serving asks nothing, and a non-serving
   * one is precisely the case where the user needs the answer. The two-stage read below still
   * charges the full workspace only to an app already judged non-static.
   */
  /**
   * ⚠️ THIRD CORRECTION, SAME GATE, SAME DAY — and the reason it kept being wrong is worth more
   * than the fix. Each time I picked which STATES need the verdict; the answer was never a list of
   * states, it is *"whatever makes the screen say press Publish"*, and only the client knows that.
   *
   * The client's branch is `s.serving?.state !== 'serving'` — which is TRUE when `serving` is null.
   * This gate required it to be truthy. So when our probe cannot reach the domain at all (a real,
   * common outcome — `checkDomainServing` returns null and the screen says *"We could not open
   * your domain from here to confirm… If it shows an error page, press Publish once"*), the client
   * told the user to press a button that always refuses while the server stayed silent.
   *
   * That is exactly the admin's mitrify.com screenshot, after two rounds of fixing this same gate.
   * The expression is now CHARACTER-FOR-CHARACTER the client's, and `publishGateMatchesClient` in
   * the tests fails if either side is edited without the other.
   */
  if (serving?.state !== 'serving') {
    try {
      const manifests = await loadWorkspaceFilesByPath(
        workspaceId,
        ['package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile'],
      );
      /**
       * 🔒 THE SIBLING OF A BUG THE PUBLISH ROUTE ALREADY FIXED (found 2026-09-04, hunting the
       * class rather than the instance).
       *
       * On 2026-08-25 the publish route learned that a verdict formed on THE MANIFESTS ALONE is
       * not good enough: `planDeployment`'s other half — does the app's own source actually
       * IMPORT a server framework — can never fire when only four manifests are handed to it. The
       * publish route was given a second stage that loads the real files before it refuses. This
       * call was left on the old single stage, so the two halves of the very same product could
       * reach OPPOSITE conclusions about one app: publish refuses it as a server, while this
       * screen, seeing "static", cheerfully says "one last step: press Publish."
       *
       * Same two-stage shape as the publish route, and the same cost profile: the ordinary static
       * app pays exactly what it paid before, and only an app about to be told something
       * discouraging pays for the real read.
       */
      let plan = planDeployment(manifests);
      let src: Record<string, string> | null = null;
      if (!plan.staticHostingSufficient) {
        src = await loadWorkspaceFiles(workspaceId).catch(() => null);
        if (src) plan = planDeployment({ ...src, ...manifests });
      }
      // Only the app's own code can say whether it can be split, and only a real `false` (ship
      // whole) makes a fullstack refusal certain enough to state. See domainPublishBlockNote.
      const splitAdvised = plan.shape === 'fullstack' && src
        ? analyzeApiWiring(src).strategy === 'split'
        : undefined;
      publishBlocked = domainPublishBlockNote(plan, { splitAdvised });
    } catch { /* never let a shape check break a status screen */ }
  }
  return { ...status, displayRecords, dnsCheck, serving, publish, alternate, ...(publishBlocked ? { publishBlocked } : {}) };
}

export function registerNbaiDomainsRoutes(app: Express): void {
  app.post('/api/domains/nbai/connect', domainOpsRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled()) {
      res.status(503).json({ error: 'Custom-domain hosting on NavBharatAI is not enabled yet. Please try again later.' });
      return;
    }
    const identity = await verifyFirebaseIdentity(req);
    const verifiedUid = identity?.uid ?? null;
    if (!verifiedUid) {
      res.status(401).json({ error: 'Please sign in to connect a custom domain.' });
      return;
    }
    const workspaceId = req.body?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only connect a domain to your own app.' });
      return;
    }
    // PLAN GATE (admin-approved 2026-08-06): connecting a custom domain is part of the paid Custom
    // Domain plan. Free-list (admin/tester) accounts are exempt; a store outage FAILS OPEN (`known`
    // false ⇒ allow — rule #1: an outage must never block a paying user's setup). Only the CONNECT
    // action is gated — status/checks/sync for an already-connected domain keep working, so a lapse
    // never breaks a live site mid-flow.
    if (hostingPlansEnabled() && !isAgentV3FreeUser(verifiedUid, identity?.email ?? null)) {
      const plan = await probeHostingPlan(verifiedUid);
      if (plan.known && !plan.active) {
        res.status(402).json({
          error: `Connecting your own domain is part of a hosting plan (from ₹${hostingPlanPriceInr()}/month, paid from your wallet — it also removes the "Made with NavBharatAI" badge). Buy it from Billing → Plans, then connect.`,
          needsPlan: true,
          priceInr: hostingPlanPriceInr(),
        });
        return;
      }
      /**
       * THE TIER'S DOMAIN COUNT, ENFORCED (2026-09-10). Starter includes 1 domain and Growth 3, and
       * a number printed on a plan card that nothing checks is a fake feature — the second absolute
       * rule's exact case. Counted over the user's ACTIVE links only, so a domain already suspended
       * by a lapse does not occupy a slot the user is paying for.
       *
       * ⚠️ It reads the plan STATUS (not the cached probe) because only the status knows which tier
       * is held; and like the gate above, any failure to read it FAILS OPEN — being unable to count
       * must never block a paying user from connecting the domain they bought.
       */
      try {
        const status = await readHostingPlanStatus(getServerDb() as any, verifiedUid);
        const allowed = status.tier?.domains ?? 0;
        if (allowed > 0) {
          const existing = (await firebaseDomainLinksForUser(verifiedUid)).filter((l) => !l.suspended);
          const alreadyThis = existing.some((l) => l.domain === canonicalHost(normalizeDomain(req.body?.domain)));
          if (!alreadyThis && existing.length >= allowed) {
            res.status(402).json({
              error: `Your ${status.tier?.name} plan covers ${allowed} domain${allowed === 1 ? '' : 's'}, and ${allowed === 1 ? 'one is' : `${existing.length} are`} already connected. Move to a bigger plan in Billing → Plans, or disconnect a domain first.`,
              needsPlan: true,
              domainLimit: allowed,
              connected: existing.length,
            });
            return;
          }
        }
      } catch { /* fail OPEN — see the note above */ }
    }
    const host = canonicalHost(normalizeDomain(req.body?.domain));
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Enter a valid domain like myshop.com (no https://, no slashes).' });
      return;
    }
    if (!firebaseHostingConfigured()) {
      res.status(503).json({ error: 'Custom-domain hosting is not configured on the server yet. Please try again later.' });
      return;
    }
    /**
     * "MOVE THIS DOMAIN TO THIS APP" — one tap (ROADMAP §13, 1.3; admin screenshots 2026-09-02 and
     * 2026-09-10). If the domain is already held by ANOTHER app of the SAME user, pressing Connect
     * here is the instruction: it is taken off that app's site first (both spellings), so the
     * hosting service does not refuse this attach as "already connected elsewhere", and the screen
     * says it moved. Held by a different account ⇒ refused, naming nobody. Decided by a pure
     * function; the link read fails open to "nobody", which can only mean an ordinary attach — the
     * hosting service still refuses a genuinely held domain, exactly as before.
     */
    const holder = await linkForDomain(host);
    const move = decideDomainMove(holder, workspaceId, verifiedUid);
    if (move.action === 'refuse') {
      res.status(409).json({ error: move.message });
      return;
    }
    let movedFrom: string | null = null;
    if (move.action === 'move') {
      for (const spelling of [host, alternateHost(host)].filter((h): h is string => !!h)) {
        try { await deleteCustomDomain(move.from, spelling); } catch (detachErr) {
          console.warn(`[nbai domains] could not detach ${spelling} from ${move.from} before moving: ${detachErr instanceof Error ? detachErr.message : String(detachErr)}`);
        }
      }
      movedFrom = move.from;
    }
    try {
      const status = await attachCustomDomain(workspaceId, host);
      // Persist the link so the deploy path publishes future builds to this workspace's dedicated site.
      await linkWorkspaceDomain({ domain: host, workspaceId, userId: verifiedUid });
      /**
       * www ↔ apex (ROADMAP §13, 1.2). The twin is attached WITH a redirect to the canonical, so
       * `www.` answers with a redirect rather than a second copy of the site, and it is linked as an
       * alternate so a plan lapse detaches it and a renewal re-attaches it with the same redirect.
       * Best-effort on purpose: the canonical is connected and linked already, and a twin that
       * could not be attached must not turn that success into a 500 — it is retried by the next
       * connect/check, and the verdict names it as pending rather than pretending.
       */
      const twin = alternateHost(host);
      if (twin) {
        try {
          await attachCustomDomain(workspaceId, twin, { redirectTarget: host });
          await linkWorkspaceDomain({ domain: twin, workspaceId, userId: verifiedUid, alternateOf: host });
        } catch (twinErr) {
          console.warn(`[nbai domains] www twin attach deferred for ${twin}: ${twinErr instanceof Error ? twinErr.message : String(twinErr)}`);
        }
      }
      // Remember these records + return the STABLE (never-forgotten) view alongside the live set.
      // 🔒 THE SAME VERDICT THE STATUS ROUTE FORMS — never a bare status (admin screenshot 2026-09-07).
      // Pressing Connect on an already-connected domain used to answer without `serving` / `publishBlocked`
      // / `dnsCheck`, and the screen rendered that as a second, contradictory verdict. See formDomainVerdict.
      const verdict = await formDomainVerdict(workspaceId, host, status);
      if (movedFrom) (verdict as Record<string, unknown>).movedFrom = movedFrom;
      // autoDns tells the client whether the zero-copy-paste path (nameserver delegation) exists on
      // this server — the UI offers it only when a tap can actually deliver it.
      res.json({ ...verdict, autoDns: managedDnsConfigured(), domainConnect: domainConnectEnabled(), hostingerDns: hostingerDnsEnabled() });
    } catch (err: any) {
      // HONEST failure (admin 2026-08-02): a permanent problem (server not permitted, domain taken)
      // must NOT tell the user to "try again" — that loops them forever on something a retry can
      // never fix. customDomainErrorMessage classifies it. The SANITIZED real reason rides along for
      // the owner (this route is ownership-checked): every class of this failure looked identical
      // from a screenshot (admin 2026-08-06, mitrify.in) until the cause was allowed to name itself.
      console.error(`[HTTP 500] nbai domain connect: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      res.status(500).json({ error: customDomainErrorMessage(err), detail: sanitizeDomainErrorDetail(err) });
    }
  });

  app.get('/api/domains/nbai/status', domainOpsRateLimiter(), async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled()) {
      res.status(503).json({ error: 'Custom-domain hosting on NavBharatAI is not enabled yet.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    const workspaceId = req.query?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only view your own app’s domain.' });
      return;
    }
    const host = canonicalHost(normalizeDomain(req.query?.domain));
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Invalid domain.' });
      return;
    }
    try {
      const status = await customDomainStatusLive(workspaceId, host);
      if (!status) {
        res.status(404).json({ error: 'This domain has not been connected yet.' });
        return;
      }
      res.json(await formDomainVerdict(workspaceId, host, status));
    } catch (err: any) {
      sendSafeError(res, 500, 'Failed to check domain status. Please try again.', err, 'nbai domain status');
    }
  });

  /**
   * AUTO-DNS via nameserver delegation (admin 2026-08-06: "DNS hum set kar dein, user kuch na kare
   * — GoDaddy bhi, Hostinger bhi"). Works on EVERY registrar: the user changes nameservers ONCE;
   * from then on NavBharatAI writes the records itself. `start` creates/fetches the managed zone
   * and returns the two nameservers; `sync` (tapped as "Check & apply") pushes the records Firebase
   * asked for into the zone once it is active. Both ownership-checked; both honest about the one
   * step only the user can do (the registrar's nameserver form) and about delegation replacing
   * their existing DNS.
   */
  app.post('/api/domains/nbai/auto-dns/start', domainOpsRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled() || !managedDnsConfigured()) {
      res.status(503).json({ error: 'Automatic DNS setup is not enabled on this server yet.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    if (!verifiedUid) { res.status(401).json({ error: 'Please sign in first.' }); return; }
    if (!ownsWorkspace(verifiedUid, req.body?.workspaceId)) {
      res.status(403).json({ error: 'You can only set up DNS for your own app.' });
      return;
    }
    const host = canonicalHost(normalizeDomain(req.body?.domain));
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Enter a valid domain like myshop.com (no https://, no slashes).' });
      return;
    }
    try {
      const zone = await ensureZone(host);
      res.json({ nameServers: zone.nameServers, zoneStatus: zone.status });
    } catch (err) {
      console.error(`[HTTP 500] auto-dns start: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      res.status(500).json({ error: 'Could not start automatic DNS setup.', detail: sanitizeManagedDnsError(err) });
    }
  });

  app.post('/api/domains/nbai/auto-dns/sync', domainOpsRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled() || !managedDnsConfigured()) {
      res.status(503).json({ error: 'Automatic DNS setup is not enabled on this server yet.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    if (!verifiedUid) { res.status(401).json({ error: 'Please sign in first.' }); return; }
    const workspaceId = req.body?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only set up DNS for your own app.' });
      return;
    }
    const host = canonicalHost(normalizeDomain(req.body?.domain));
    if (!DOMAIN_RE.test(host)) { res.status(400).json({ error: 'Invalid domain.' }); return; }
    /**
     * 🔴 REFUSE TO WRITE THE WEBSITE RECORDS OVER A DOMAIN THAT IS SERVING THE APP'S OWN SERVER
     * (admin 2026-09-07). This is the single most destructive thing this route could do.
     *
     * Once a backend deploy moves a domain to the running service, the static host's records are
     * deliberately gone — so its status goes non-active, the connect screen concludes the domain is
     * "still connecting", re-opens the setup block and offers this very button. Pressing it would
     * write an A record at the apex; the cross-type sweep would then delete the service's CNAME
     * (DNS forbids both at one name); and the live site would go down, handed back to a host that —
     * for a fullstack app — can only ever answer "Site Not Found".
     *
     * The button looks helpful and is destructive, so the refusal names what would be LOST rather
     * than merely saying no. See domainPointing.ts.
     */
    const pointingRec = await getConversationStore().get(String(workspaceId)).catch(() => null);
    if (isBackendPointed(pointingRec, host)) {
      res.status(409).json({ error: backendPointedRefusal(host) });
      return;
    }
    try {
      const zone = await zoneStatus(host);
      if (!zone) { res.status(404).json({ error: 'Automatic setup has not been started for this domain.' }); return; }
      if (zone.status !== 'active') {
        // The one honest wait: the registrar's nameserver change has not propagated yet. Nothing to
        // apply until it has — pretending otherwise would write records into a zone nobody queries.
        res.json({ zoneStatus: zone.status, nameServers: zone.nameServers, added: 0, removed: 0 });
        return;
      }
      const fb = await customDomainStatusLive(workspaceId, host);
      if (!fb) { res.status(404).json({ error: 'Connect the domain first, then run automatic setup.' }); return; }
      // www ↔ apex (ROADMAP §13, 1.2): the twin's records are written in the same pass, so one tap
      // finishes both spellings. An unreadable twin contributes nothing rather than failing the sync.
      const syncTwin = alternateHost(host);
      const twinFb = syncTwin ? await customDomainStatusLive(workspaceId, syncTwin).catch(() => null) : null;
      const desiredAll = [...fb.records, ...(twinFb?.records ?? [])];
      // `added`/`removed` come back SEPARATE (admin screenshot 2026-09-02: "all 1 record are now in
      // place (we added 2)"). The old single `applied` count mixed two different operations — a
      // desired record written, and a FOREIGN ownership token deleted as cleanup — so cleaning up one
      // stale token while adding one desired record produced "2", printed beside "1 record". `added`
      // can never exceed `desired` (see ApplyRecordsResult in cloudflareManagedDns.ts); `removed` is
      // reported separately so the cleanup is explained rather than silently inflating "added".
      const { added, removed } = await applyRecords(zone.id, desiredAll);
      // The screen replaces its record list with this response, so the twin's records must be in it
      // too — or one tap of "Check & apply" would make the www record vanish from view.
      const displayRecords = [
        ...(await stableRecordsFor(host, fb.records, workspaceId as string)),
        ...(twinFb && syncTwin ? await stableRecordsFor(syncTwin, twinFb.records, workspaceId as string) : []),
      ];
      /**
       * 🔒 READ THE ZONE BACK, AND REPORT EVIDENCE INSTEAD OF A COUNT (admin 2026-08-22).
       *
       * `added`/`removed` are how many records CHANGED, so on their own they cannot tell the two
       * opposite outcomes apart: "0 added" means either everything was already correct, or nothing was
       * written at all. The screen printed "0 records applied automatically" for both, which reads as a
       * failure in the success case and as success in the failure case — the worst possible pairing,
       * and exactly what left a domain sitting for six hours with nobody able to say what was wrong.
       *
       * So we ask the zone what it actually holds. `missing` is then a FACT, and the message can name
       * the real situation. Best-effort: a failed read-back must not fail a sync that already wrote
       * the records, so it degrades to "we could not verify" rather than inventing either verdict.
       */
      const inZone = await listZoneRecords(zone.id).catch(() => null);
      const missing = inZone ? missingFromZone(desiredAll, inZone) : null;
      res.json({
        zoneStatus: zone.status,
        nameServers: zone.nameServers,
        added,
        removed,
        desired: desiredAll.length,
        // null ⇒ we genuinely could not look; [] ⇒ we looked and everything is there.
        missing: missing ? missing.map((r) => ({ type: r.type, name: r.name, value: r.value })) : null,
        zoneRecordCount: inZone ? inZone.length : null,
        domain: { ...fb, displayRecords },
      });
    } catch (err) {
      console.error(`[HTTP 500] auto-dns sync: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      res.status(500).json({ error: 'Could not apply the DNS records automatically.', detail: sanitizeManagedDnsError(err) });
    }
  });

  /**
   * REHYDRATE (admin 2026-08-06: "tab badalne se reload hua, aur sab chala gaya — permanent DNA
   * level par fix karo"). The connect flow's every fact already lives durably server-side — the
   * domain↔workspace link in Firestore, the attach status at the hosting API, the zone +
   * nameservers at the DNS service. Only the SCREEN forgot, because its state lived in component
   * memory. This route answers "where was I?" in one round-trip, so a reload, a tab switch, or a
   * different device lands the user exactly where they left off — nothing to re-type, ever.
   */
  app.get('/api/domains/nbai/state', domainOpsRateLimiter(), async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled()) {
      res.status(503).json({ error: 'Custom-domain hosting on NavBharatAI is not enabled yet.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    const workspaceId = req.query?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only view your own app’s domain.' });
      return;
    }
    try {
      const domains = await firebaseDomainsForWorkspace(workspaceId as string);
      const domain = domains[0] ?? null;
      if (!domain) {
        res.json({ domain: null });
        return;
      }
      const status = await customDomainStatusLive(workspaceId as string, domain).catch(() => null);
      /**
       * 🔒 THE RECORDS SURVIVE A FAILED LIVE LOOKUP (admin 2026-08-22: "bar bar website type karni
       * padti hai", and "1-2 din baad wapas aaye to wahi DNS data dikhna chahiye").
       *
       * ROOT CAUSE this fixes: `displayRecords` used to be `status ? … : []`. The live Hosting call
       * is a network round-trip to Google, so a slow or failed one — an outage, a quota blip, a cold
       * instance — returned `status: null` AND an EMPTY record list. The user then opened a domain
       * they had already set up and saw a blank form, so they typed the domain in again, and their
       * DNS records appeared to have been forgotten. They never were: `rememberDomainDnsRecords`
       * has been storing them all along. We were throwing away our own saved copy because a
       * DIFFERENT call failed.
       *
       * So the stored records are read unconditionally now. This is exactly the kind of data we
       * persisted them FOR — the moment the live source is unavailable is the moment they matter.
       */
      // www ↔ apex (ROADMAP §13, 1.2): the twin's record must survive a reload too — the saved view
      // is what the screen shows before any check, and a record that vanishes until "Check now" is
      // the "DNS record bhulne nahi chahiye" defect in a new coat. Best-effort like the rest.
      const twinHost = alternateHost(domain);
      const twinStatus = status && twinHost ? await customDomainStatusLive(workspaceId as string, twinHost).catch(() => null) : null;
      const twinRecords = twinStatus && twinHost
        ? await stableRecordsFor(twinHost, twinStatus.records, workspaceId as string)
        : twinHost ? await getStoredDomainDnsRecords(twinHost).catch(() => []) : [];
      const displayRecords = [
        ...(status
          ? await stableRecordsFor(domain, status.records, workspaceId as string)
          : await getStoredDomainDnsRecords(domain).catch(() => [])),
        ...twinRecords,
      ];
      // Zone lookup is best-effort: a missing/errored zone must not hide the rest of the state.
      const zone = managedDnsConfigured() ? await zoneStatus(domain).catch(() => null) : null;
      res.json({
        domain,
        status: status ? { ...status, displayRecords, autoDns: managedDnsConfigured(), domainConnect: domainConnectEnabled(), hostingerDns: hostingerDnsEnabled() } : null,
        // The saved records ride OUTSIDE `status` too, so the screen can show the user what to add
        // even in the one case where we genuinely cannot say how far along the connection is. A
        // known set of records with an unknown status beats an empty screen with neither.
        savedRecords: displayRecords,
        // When the live check could not run, say so plainly instead of letting the client guess from
        // a null status — the difference between "not connected" and "we could not look" is the
        // difference between retyping a domain and simply waiting.
        statusUnavailable: !status,
        zone: zone ? { nameServers: zone.nameServers, status: zone.status } : null,
      });
    } catch (err) {
      sendSafeError(res, 500, 'Could not load the saved domain state.', err, 'nbai domain state');
    }
  });

  /**
   * The signed-in user's connected domains, as a workspaceId → domain[] map (admin 2026-08-19: the
   * "Connect my website" list gave no way to tell which app was already connected). Read-only,
   * verified-owner-scoped (only the caller's own links), and fail-open ([] on any store hiccup) — it
   * only decorates the picker, so a lapse hides the badge, never blocks the flow.
   */
  app.get('/api/domains/nbai/links', domainOpsRateLimiter(), async (req: Request, res: Response) => {
    const verifiedUid = await verifyFirebaseToken(req);
    if (!verifiedUid) {
      res.status(401).json({ error: 'Please sign in.' });
      return;
    }
    const links = await firebaseDomainLinksForUser(verifiedUid);
    const byWorkspace: Record<string, string[]> = {};
    for (const l of links) {
      if (l.suspended) continue; // a plan-lapsed domain isn't actively serving — don't badge it "connected"
      if (l.alternateOf) continue; // a `www` twin is a spelling of its canonical, not a second badge (ROADMAP §13, 1.2)
      (byWorkspace[l.workspaceId] ??= []).push(l.domain);
    }
    res.json({ byWorkspace });
  });

  /**
   * ONE-CLICK via Domain Connect (Slice B): is the user's registrar in the protocol, and if so,
   * where does the Approve button go? Flag-gated until our template is registered with the
   * registrars — the UI never shows a button that would 404 at GoDaddy.
   */
  app.get('/api/domains/nbai/domain-connect/check', domainOpsRateLimiter(), async (req: Request, res: Response) => {
    const verifiedUid = await verifyFirebaseToken(req);
    const workspaceId = req.query?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only set up your own app.' });
      return;
    }
    const host = canonicalHost(normalizeDomain(req.query?.domain));
    if (!DOMAIN_RE.test(host)) { res.status(400).json({ error: 'Invalid domain.' }); return; }
    try {
      const fb = await customDomainStatusLive(workspaceId, host);
      // www ↔ apex (ROADMAP §13, 1.2): the registrar's one-click template carries both spellings.
      const dcTwin = alternateHost(host);
      const dcTwinFb = fb && dcTwin ? await customDomainStatusLive(workspaceId, dcTwin).catch(() => null) : null;
      const check = await checkDomainConnect(host, [...(fb?.records ?? []), ...(dcTwinFb?.records ?? [])]);
      res.json(check);
    } catch (err) {
      // Discovery failing is never fatal to the flow — the other two paths remain.
      res.json({ supported: false, reason: 'Could not check one-click support right now — use automatic (nameservers) or the manual records.' });
    }
  });

  /**
   * HOSTINGER direct apply (Slice C): the user's own hPanel API token writes the records into their
   * own zone, once — the token is used for this single call and NEVER stored, logged, or echoed.
   */
  app.post('/api/domains/nbai/hostinger/apply', domainOpsRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    if (!hostingerDnsEnabled()) {
      res.status(503).json({ error: 'Hostinger automatic setup is not enabled on this server yet.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    if (!verifiedUid) { res.status(401).json({ error: 'Please sign in first.' }); return; }
    const workspaceId = req.body?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only set up your own app.' });
      return;
    }
    const host = canonicalHost(normalizeDomain(req.body?.domain));
    if (!DOMAIN_RE.test(host)) { res.status(400).json({ error: 'Invalid domain.' }); return; }
    const apiToken = typeof req.body?.apiToken === 'string' ? req.body.apiToken.trim() : '';
    if (!apiToken || apiToken.length > 512) {
      res.status(400).json({ error: 'Paste the API token from Hostinger hPanel (Account → API).' });
      return;
    }
    try {
      const fb = await customDomainStatusLive(workspaceId, host);
      if (!fb) { res.status(404).json({ error: 'Connect the domain first, then run Hostinger setup.' }); return; }
      // www ↔ apex (ROADMAP §13, 1.2): one tap at the registrar finishes both spellings.
      const hTwin = alternateHost(host);
      const hTwinFb = hTwin ? await customDomainStatusLive(workspaceId, hTwin).catch(() => null) : null;
      const hDesired = [...fb.records, ...(hTwinFb?.records ?? [])];
      const result = await applyHostingerRecords(apiToken, host, hDesired);
      if (!result.ok) { res.status(502).json({ error: 'Hostinger did not accept the records.', detail: result.error }); return; }
      res.json({ ok: true, applied: hDesired.length });
    } catch (err) {
      console.error(`[HTTP 500] hostinger apply: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Could not apply the records at Hostinger.' });
    }
  });
}

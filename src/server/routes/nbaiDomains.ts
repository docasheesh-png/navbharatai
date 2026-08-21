import type { Express, Request, Response } from 'express';
import { domainOpsRateLimiter, verifyFirebaseToken, verifyFirebaseIdentity, enforceNotBanned } from '../lib/authMiddleware';
import { sendSafeError } from '../lib/httpError';
import { hostingPlansEnabled, hostingPlanPriceInr, probeHostingPlan } from '../lib/hostingPlan';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';
import {
  normalizeDomain,
  firebaseCustomDomainsEnabled,
  firebaseHostingConfigured,
  attachCustomDomain,
  customDomainStatusLive,
  customDomainErrorMessage,
  sanitizeDomainErrorDetail,
} from '../lib/firebaseCustomDomain';
import {
  linkWorkspaceDomain, firebaseDomainsForWorkspace, firebaseDomainLinksForUser,
  rememberDomainDnsRecords, getStoredDomainDnsRecords,
} from '../lib/firebaseDomainLink';
import { mergeStableRecords, type StableDnsRecord } from '../lib/domainDnsRecords';
import {
  managedDnsConfigured, ensureZone, zoneStatus, applyRecords, sanitizeManagedDnsError,
} from '../lib/cloudflareManagedDns';
import { checkDomainConnect, domainConnectEnabled } from '../lib/domainConnect';
import { hostingerDnsEnabled, applyHostingerRecords } from '../lib/hostingerDns';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
import { verifyRecordsLive } from '../lib/domainDnsVerify';
import { checkDomainServing } from '../lib/domainServingCheck';
import { siteHasRelease } from '../lib/firebaseCustomDomain';

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
async function stableRecordsFor(domain: string, liveRecords: { type: string; name: string; value: string; note?: string }[]): Promise<StableDnsRecord[]> {
  try {
    await rememberDomainDnsRecords(domain, liveRecords);
    const stored = await getStoredDomainDnsRecords(domain);
    return mergeStableRecords(stored, liveRecords);
  } catch {
    return liveRecords.map((r) => ({ ...r, done: false }));
  }
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
          error: `Connecting your own domain is part of the Custom Domain plan (₹${hostingPlanPriceInr()}/month, paid from your wallet — it also removes the "Made with NavBharatAI" badge). Buy it from Billing → Plans, then connect.`,
          needsPlan: true,
          priceInr: hostingPlanPriceInr(),
        });
        return;
      }
    }
    const host = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Enter a valid domain like myshop.com (no https://, no slashes).' });
      return;
    }
    if (!firebaseHostingConfigured()) {
      res.status(503).json({ error: 'Custom-domain hosting is not configured on the server yet. Please try again later.' });
      return;
    }
    try {
      const status = await attachCustomDomain(workspaceId, host);
      // Persist the link so the deploy path publishes future builds to this workspace's dedicated site.
      await linkWorkspaceDomain({ domain: host, workspaceId, userId: verifiedUid });
      // Remember these records + return the STABLE (never-forgotten) view alongside the live set.
      const displayRecords = await stableRecordsFor(host, status.records);
      // autoDns tells the client whether the zero-copy-paste path (nameserver delegation) exists on
      // this server — the UI offers it only when a tap can actually deliver it.
      res.json({ ...status, displayRecords, autoDns: managedDnsConfigured(), domainConnect: domainConnectEnabled(), hostingerDns: hostingerDnsEnabled() });
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
    const host = normalizeDomain(req.query?.domain);
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
      const displayRecords = await stableRecordsFor(host, status.records);
      // DID THE USER'S RECORDS ACTUALLY LAND? (admin 2026-08-21, mitrify.com.) The screen used to
      // show one word from Firebase — `ownership: missing` — while every required record was live and
      // byte-perfect in public DNS. That state is indistinguishable from "you typed it wrong", so a
      // user who had done everything right kept editing correct records. We now look ourselves and
      // say which of the three it is: wrong value (they fix it), not published yet (their registrar
      // is still working), or correct and live (nothing left for them to do but wait for Firebase).
      // Best-effort and bounded — a DNS hiccup must never turn a working status screen into an error.
      const dnsCheck = await verifyRecordsLive(displayRecords).catch(() => null);
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
      let serving = status.active ? await checkDomainServing(host).catch(() => null) : null;
      if (status.active) {
        const published = await siteHasRelease(workspaceId).catch(() => null);
        if (published === false) {
          serving = {
            state: 'nothing_published',
            status: serving?.status ?? 0,
            note: 'Your domain is connected, but this app has never been published to it — opening it '
              + 'shows an error page. Press Publish once and your domain will start showing your app.',
          };
        }
      }
      res.json({ ...status, displayRecords, dnsCheck, serving });
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
    const host = normalizeDomain(req.body?.domain);
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
    const host = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(host)) { res.status(400).json({ error: 'Invalid domain.' }); return; }
    try {
      const zone = await zoneStatus(host);
      if (!zone) { res.status(404).json({ error: 'Automatic setup has not been started for this domain.' }); return; }
      if (zone.status !== 'active') {
        // The one honest wait: the registrar's nameserver change has not propagated yet. Nothing to
        // apply until it has — pretending otherwise would write records into a zone nobody queries.
        res.json({ zoneStatus: zone.status, nameServers: zone.nameServers, applied: 0 });
        return;
      }
      const fb = await customDomainStatusLive(workspaceId, host);
      if (!fb) { res.status(404).json({ error: 'Connect the domain first, then run automatic setup.' }); return; }
      const applied = await applyRecords(zone.id, fb.records);
      const displayRecords = await stableRecordsFor(host, fb.records);
      res.json({ zoneStatus: zone.status, nameServers: zone.nameServers, applied, domain: { ...fb, displayRecords } });
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
      const displayRecords = status ? await stableRecordsFor(domain, status.records) : [];
      // Zone lookup is best-effort: a missing/errored zone must not hide the rest of the state.
      const zone = managedDnsConfigured() ? await zoneStatus(domain).catch(() => null) : null;
      res.json({
        domain,
        status: status ? { ...status, displayRecords, autoDns: managedDnsConfigured(), domainConnect: domainConnectEnabled(), hostingerDns: hostingerDnsEnabled() } : null,
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
    const host = normalizeDomain(req.query?.domain);
    if (!DOMAIN_RE.test(host)) { res.status(400).json({ error: 'Invalid domain.' }); return; }
    try {
      const fb = await customDomainStatusLive(workspaceId, host);
      const check = await checkDomainConnect(host, fb?.records ?? []);
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
    const host = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(host)) { res.status(400).json({ error: 'Invalid domain.' }); return; }
    const apiToken = typeof req.body?.apiToken === 'string' ? req.body.apiToken.trim() : '';
    if (!apiToken || apiToken.length > 512) {
      res.status(400).json({ error: 'Paste the API token from Hostinger hPanel (Account → API).' });
      return;
    }
    try {
      const fb = await customDomainStatusLive(workspaceId, host);
      if (!fb) { res.status(404).json({ error: 'Connect the domain first, then run Hostinger setup.' }); return; }
      const result = await applyHostingerRecords(apiToken, host, fb.records);
      if (!result.ok) { res.status(502).json({ error: 'Hostinger did not accept the records.', detail: result.error }); return; }
      res.json({ ok: true, applied: fb.records.length });
    } catch (err) {
      console.error(`[HTTP 500] hostinger apply: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Could not apply the records at Hostinger.' });
    }
  });
}

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
import { linkWorkspaceDomain, firebaseDomainsForWorkspace } from '../lib/firebaseDomainLink';
import {
  managedDnsConfigured, ensureZone, zoneStatus, applyRecords, sanitizeManagedDnsError,
} from '../lib/cloudflareManagedDns';
import { checkDomainConnect, domainConnectEnabled } from '../lib/domainConnect';
import { hostingerDnsEnabled, applyHostingerRecords } from '../lib/hostingerDns';

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
function ownsWorkspace(verifiedUid: string | null, workspaceId: unknown): workspaceId is string {
  return (
    !!verifiedUid &&
    /^[A-Za-z0-9_-]{1,64}$/.test(verifiedUid) &&
    typeof workspaceId === 'string' &&
    workspaceId.startsWith(`agentv3-${verifiedUid}-`)
  );
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
      // autoDns tells the client whether the zero-copy-paste path (nameserver delegation) exists on
      // this server — the UI offers it only when a tap can actually deliver it.
      res.json({ ...status, autoDns: managedDnsConfigured(), domainConnect: domainConnectEnabled(), hostingerDns: hostingerDnsEnabled() });
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
      res.json(status);
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
      res.json({ zoneStatus: zone.status, nameServers: zone.nameServers, applied, domain: fb });
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
      // Zone lookup is best-effort: a missing/errored zone must not hide the rest of the state.
      const zone = managedDnsConfigured() ? await zoneStatus(domain).catch(() => null) : null;
      res.json({
        domain,
        status: status ? { ...status, autoDns: managedDnsConfigured(), domainConnect: domainConnectEnabled(), hostingerDns: hostingerDnsEnabled() } : null,
        zone: zone ? { nameServers: zone.nameServers, status: zone.status } : null,
      });
    } catch (err) {
      sendSafeError(res, 500, 'Could not load the saved domain state.', err, 'nbai domain state');
    }
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

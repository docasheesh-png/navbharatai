// NbaiDomainConnect — the workspace-scoped "connect your own domain" flow for the Publish surface
// (Hosting Slice 3). Firebase-native custom domains are PER-APP (the domain attaches to this
// workspace's dedicated Firebase site), so this component is always scoped to a workspaceId.
//
// Real flow: enter domain -> POST /api/domains/nbai/connect (creates the Firebase custom domain on
// the workspace's site, returns the EXACT DNS records) -> user adds them at their registrar ->
// "Check" polls /api/domains/nbai/status until ownership + host + SSL are all active. Honest
// throughout: it shows the real pending/active state and never claims a domain is connected when it
// isn't. Gated by the server flag (the caller only renders this when custom domains are enabled).

import { useState, useEffect } from 'react';
import { Globe, ChevronLeft, CheckCircle2, Copy, Check, RefreshCw, Info } from 'lucide-react';
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
export function connectStage(
  s: { active: boolean; ownershipState: string; hostState: string; sslState: string; serving?: { state: string; note: string } | null },
): { headline: string; action: 'check' | 'none' | 'publish'; note: string; tone?: 'ok' | 'warn' } {
  if (s.active) {
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
    // 'serving' or 'unknown'. `unknown` still claims Live on purpose: if we could not reach the domain
    // from our server, the three active states remain the best evidence we have, and downgrading a
    // genuinely working domain because OUR check failed trades one wrong answer for another.
    return { headline: 'Live! Your domain is connected, with HTTPS.', action: 'none', tone: 'ok', note: 'Publish again any time to update what your domain shows.' };
  }
  const ownershipDone = /ACTIVE/i.test(s.ownershipState || '');
  const hostDone = /ACTIVE/i.test(s.hostState || '');
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


export function NbaiDomainConnect({ workspaceId, onBack }: NbaiDomainConnectProps) {
  const [domain, setDomain] = useState('');
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
  const [autoNs, setAutoNs] = useState<string[] | null>(null);
  const [autoZoneStatus, setAutoZoneStatus] = useState<string | null>(null);
  const [autoApplied, setAutoApplied] = useState<number | null>(null);
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
        if (cancelled || !data?.domain) return;
        setDomain((prev) => prev || data.domain);
        if (data.status) setResult((prev) => prev ?? data.status);
        if (data.zone?.nameServers?.length) {
          setAutoNs((prev) => prev ?? data.zone.nameServers);
          setAutoZoneStatus((prev) => prev ?? data.zone.status);
        }
      } catch { /* offline — the manual flow still works from scratch */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setChecking(false);
    }
  };

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
      if (typeof data?.applied === 'number') setAutoApplied(data.applied);
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
                {stage.action === 'check' && (
                  <button
                    onClick={checkStatus}
                    disabled={checking}
                    className="self-start flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[12px] font-bold"
                  >
                    {checking ? <TirangaLoader className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {checking ? 'Checking…' : 'Check now'}
                  </button>
                )}
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
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Add these DNS records at your registrar</span>
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
            // Already added & accepted — kept visible so the user's work is never "lost", shown compact.
            <div key={i} className="px-3 py-1.5 rounded-lg bg-green-500/5 border border-green-500/20 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">{rec.type}</span>
              <span className="text-[11px] text-zinc-400 font-mono truncate">{relativeRecordName(rec.name, cleanDomain)}</span>
              <span className="ml-auto text-[10px] text-green-300 shrink-0">Verified</span>
            </div>
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
                    <span className="text-[10px] text-zinc-400">
                      {autoZoneStatus === 'active'
                        ? (autoApplied !== null ? `Nameservers live — ${autoApplied} record${autoApplied === 1 ? '' : 's'} applied automatically.` : 'Nameservers live.')
                        : 'Waiting for the nameserver change to take effect (can take a few hours).'}
                    </span>
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
          {/* A second Check within thumb reach for the user who scrolled down to add records —
              same handler, so there is exactly one implementation of the action. */}
          {!result.active && (
            <button
              onClick={checkStatus}
              disabled={checking}
              className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/10 text-[11px] font-bold disabled:opacity-40"
            >
              {checking ? <TirangaLoader className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
              {checking ? 'Checking…' : 'Check now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
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

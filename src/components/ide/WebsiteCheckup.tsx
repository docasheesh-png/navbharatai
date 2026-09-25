import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, Info, Loader2, Globe, RefreshCw, ExternalLink } from 'lucide-react';
import { authHeader, authJsonHeaders } from '../../lib/authHeaders';

/**
 * WEBSITE CHECKUP — a friendly, one-tap health check the user runs on THEIR OWN NavBharatAI site.
 *
 * Admin, verbatim (2026-09-25): *"user apni koi bhi website yaha aa kar test kare … navbharatai ki
 * branding se, copyright free, indian non technical user ke liye simple"*, and on scope: *"user ki
 * khud ki website check karwani hai? kisi aur ki nahi!!"*
 *
 * The site list and the checkup both come from the server, which only ever returns / checks a site
 * this signed-in user published (see `routes/websiteCheckup.ts`). This screen never takes a typed URL,
 * so there is no way to point it at someone else's site.
 */

type Severity = 'critical' | 'warn' | 'good' | 'info';

interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  fix?: string;
}

interface CheckupResult {
  url: string;
  requestedUrl: string;
  checkedAt: string;
  findings: Finding[];
  grade: 'excellent' | 'good' | 'needs-attention' | 'at-risk' | 'unreachable';
  summary: string;
  counts: { critical: number; warn: number; good: number; info: number };
}

interface Site {
  workspaceId: string;
  url: string;
  updatedAt: number;
}

const GRADE_STYLE: Record<CheckupResult['grade'], { label: string; className: string }> = {
  excellent: { label: 'Excellent', className: 'bg-emerald-500/10 text-success border-emerald-500/30' },
  good: { label: 'Good', className: 'bg-emerald-500/10 text-success border-emerald-500/30' },
  'needs-attention': { label: 'Needs attention', className: 'bg-amber-500/10 text-warn border-amber-500/30' },
  'at-risk': { label: 'Action needed', className: 'bg-red-500/10 text-danger border-red-500/30' },
  unreachable: { label: 'Could not open', className: 'bg-well text-muted border-line' },
};

function SeverityIcon({ severity }: { severity: Severity }): React.ReactElement {
  if (severity === 'critical') return <ShieldAlert className="h-4 w-4 shrink-0 text-danger" />;
  if (severity === 'warn') return <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />;
  if (severity === 'good') return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  return <Info className="h-4 w-4 shrink-0 text-muted" />;
}

function prettyHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function WebsiteCheckup(): React.ReactElement {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [loadingSites, setLoadingSites] = useState(true);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [selected, setSelected] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CheckupResult | null>(null);
  const [error, setError] = useState('');

  const loadSites = useCallback(async () => {
    setLoadingSites(true);
    setError('');
    setNeedsSignIn(false);
    try {
      const res = await fetch('/api/website-checkup/sites', { headers: await authHeader() });
      if (res.status === 401) { setNeedsSignIn(true); setSites([]); return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || 'Your sites could not be loaded.');
      const list: Site[] = Array.isArray(data.sites) ? data.sites : [];
      setSites(list);
      if (list.length > 0) setSelected(list[0].workspaceId);
    } catch (e) {
      setError((e as Error)?.message || 'Your sites could not be loaded.');
      setSites([]);
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => { void loadSites(); }, [loadSites]);

  const run = async () => {
    if (!selected) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/website-checkup', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId: selected }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) { setNeedsSignIn(true); return; }
      if (!res.ok || !data) throw new Error(data?.error || 'The checkup could not finish. Please try again.');
      setResult(data as CheckupResult);
    } catch (e) {
      setError((e as Error)?.message || 'The checkup could not finish. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface text-body">
      <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-accent/10 p-2.5">
            <ShieldCheck className="h-6 w-6 text-accent-text" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-ink">Website Checkup</h1>
            <p className="text-[13px] leading-snug text-muted">
              A quick, safe health check of a website you published with NavBharatAI. We only read what
              your site already shows every visitor — nothing is changed, and only your own sites appear here.
            </p>
          </div>
        </div>

        {needsSignIn && (
          <div className="rounded-xl border border-line bg-card p-4 text-sm text-body">
            Please sign in to check your sites.
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-[13px] leading-snug text-danger">
            <AlertTriangle size={15} className="mt-px shrink-0" /> {error}
          </p>
        )}

        {/* Site picker */}
        {!needsSignIn && (
          <div className="rounded-xl border border-line bg-card p-4 space-y-3">
            {loadingSites ? (
              <p className="flex items-center gap-2 text-[13px] text-faint">
                <Loader2 size={14} className="animate-spin" /> Finding your published sites…
              </p>
            ) : sites && sites.length === 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink">You have no published sites yet</p>
                <p className="text-[13px] text-muted">
                  Publish an app with NavBharatAI first — then come back here and check it in one tap.
                </p>
              </div>
            ) : (
              <>
                <label htmlFor="checkup-site" className="block text-[13px] font-medium text-muted">
                  Choose one of your sites
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                    <select
                      id="checkup-site"
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                      className="w-full rounded-lg border border-line bg-surface py-2 pl-8 pr-3 text-sm text-ink"
                    >
                      {(sites ?? []).map((s) => (
                        <option key={s.workspaceId} value={s.workspaceId}>{prettyHost(s.url)}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => void run()}
                    disabled={running || !selected}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50"
                  >
                    {running ? (
                      <span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Checking…</span>
                    ) : 'Run checkup'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Grade + summary */}
            <div className="rounded-xl border border-line bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${GRADE_STYLE[result.grade].className}`}>
                  {GRADE_STYLE[result.grade].label}
                </span>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[12px] font-medium text-accent-text hover:underline"
                >
                  {prettyHost(result.url)} <ExternalLink size={12} />
                </a>
              </div>
              <p className="text-sm text-body">{result.summary}</p>
              {result.grade !== 'unreachable' && (
                <div className="flex flex-wrap gap-3 text-[12px] text-muted">
                  {result.counts.critical > 0 && <span className="text-danger">● {result.counts.critical} to fix</span>}
                  {result.counts.warn > 0 && <span className="text-warn">● {result.counts.warn} to improve</span>}
                  <span className="text-success">● {result.counts.good} healthy</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => void run()}
                disabled={running}
                className="flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-body disabled:opacity-50"
              >
                <RefreshCw size={12} className={running ? 'animate-spin' : ''} /> Check again
              </button>
            </div>

            {/* Findings */}
            {result.findings.length > 0 && (
              <div className="space-y-2">
                {result.findings.map((f) => (
                  <div key={f.id} className="rounded-lg border border-line bg-card p-3">
                    <div className="flex items-start gap-2">
                      <SeverityIcon severity={f.severity} />
                      <div className="min-w-0 space-y-1">
                        <p className="text-[13px] font-semibold text-ink">{f.title}</p>
                        <p className="text-[12px] leading-snug text-muted">{f.detail}</p>
                        {f.fix && (
                          <p className="text-[12px] leading-snug text-body">
                            <span className="font-semibold text-accent-text">How to fix: </span>{f.fix}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
